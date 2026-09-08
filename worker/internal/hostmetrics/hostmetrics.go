// Package hostmetrics reads a Linux machine's own utilisation — CPU, memory,
// disk and load — for cmd/agent.
//
// Straight out of /proc and one statfs syscall, with no dependency and no cgo,
// for the same reason the rest of worker/ is built that way: the agent is a
// static binary someone scp's onto a box they already trust, and adding a
// library that shells out or links against libc would make it the one part of
// StayUp that can't just be dropped onto an Alpine container.
//
// No TypeScript counterpart. The dashboard never measures a machine; it only
// ever receives what this reports (src/lib/server-metrics.ts).
package hostmetrics

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Report is one snapshot, and is the JSON body cmd/agent POSTs.
//
// Percentages rather than absolutes for the three that get thresholds: a
// threshold has to mean the same thing on a 2 GB VPS and a 512 GB database
// host, and "85% full" does while "200 GB used" does not. The absolutes come
// along anyway, because "85% of what" is the first question anyone asks.
type Report struct {
	// 0-100, averaged over the sampling window below.
	CPUPercent float64 `json:"cpuPercent"`
	// 0-100, of total RAM. Excludes reclaimable page cache — see readMemory.
	MemoryPercent float64 `json:"memoryPercent"`
	MemoryTotalKB uint64  `json:"memoryTotalKb"`
	MemoryUsedKB  uint64  `json:"memoryUsedKb"`
	// 0-100, of the filesystem holding DiskPath.
	DiskPercent float64 `json:"diskPercent"`
	DiskPath    string  `json:"diskPath"`
	DiskTotalKB uint64  `json:"diskTotalKb"`
	DiskUsedKB  uint64  `json:"diskUsedKb"`
	// 1/5/15-minute run queue averages, as /proc/loadavg reports them.
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
	// Seconds since boot, so the dashboard can say "this machine rebooted"
	// rather than leaving a gap in the graph unexplained.
	UptimeSeconds int64 `json:"uptimeSeconds"`
	// Reported for the operator's benefit: an agent's monitor is named by a
	// human and may not match what the machine calls itself.
	Hostname string `json:"hostname"`
}

// Collect takes one reading. CPU needs two samples `sample` apart, because
// /proc/stat counts ticks since boot — a single read gives the average since
// the machine started, which is never the number anyone wants.
func Collect(diskPath string, sample time.Duration) (Report, error) {
	report := Report{DiskPath: diskPath, Hostname: hostname()}

	cpu, err := readCPUPercent(sample)
	if err != nil {
		return report, err
	}
	report.CPUPercent = cpu

	if err := readMemory(&report); err != nil {
		return report, err
	}
	if err := readDisk(&report); err != nil {
		return report, err
	}
	readLoad(&report)
	readUptime(&report)

	return report, nil
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return ""
	}
	return name
}

// cpuTotals returns (busy, total) jiffies from the aggregate "cpu" line of
// /proc/stat. Idle and iowait are the not-busy pair; everything else counts.
func cpuTotals() (busy, total uint64, err error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0, fmt.Errorf("hostmetrics: read /proc/stat: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		for i, raw := range fields[1:] {
			value, err := strconv.ParseUint(raw, 10, 64)
			if err != nil {
				continue
			}
			total += value
			// Columns are user, nice, system, idle, iowait, ... — 3 and 4 are
			// the machine doing nothing and the machine waiting on a disk.
			if i != 3 && i != 4 {
				busy += value
			}
		}
		return busy, total, nil
	}
	return 0, 0, fmt.Errorf("hostmetrics: no cpu line in /proc/stat")
}

func readCPUPercent(sample time.Duration) (float64, error) {
	busy1, total1, err := cpuTotals()
	if err != nil {
		return 0, err
	}
	time.Sleep(sample)
	busy2, total2, err := cpuTotals()
	if err != nil {
		return 0, err
	}

	// A counter that didn't move (or wrapped, on a very long uptime) is not an
	// idle machine, it is no measurement — report 0 rather than a fraction
	// with a zero denominator.
	if total2 <= total1 {
		return 0, nil
	}
	return round2(float64(busy2-busy1) / float64(total2-total1) * 100), nil
}

// readMemory uses MemAvailable rather than MemFree, deliberately. MemFree
// counts the page cache as used, so a healthy Linux box that has been up for a
// week reports ~98% memory used and would trip every threshold ever set.
// MemAvailable is the kernel's own estimate of what a new process could get.
func readMemory(report *Report) error {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return fmt.Errorf("hostmetrics: read /proc/meminfo: %w", err)
	}
	defer file.Close()

	var total, available uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value
		case "MemAvailable:":
			available = value
		}
	}
	if total == 0 {
		return fmt.Errorf("hostmetrics: no MemTotal in /proc/meminfo")
	}

	used := total
	if available < total {
		used = total - available
	}
	report.MemoryTotalKB = total
	report.MemoryUsedKB = used
	report.MemoryPercent = round2(float64(used) / float64(total) * 100)
	return nil
}

// readDisk measures the filesystem holding the configured path, reporting
// exactly what `df` reports.
//
// That match is the whole point, and it is not free: `df` computes Use% over
// used + *available*, not over the total, so the blocks reserved for root are
// left out of the base. Measuring against the raw total instead is arguably
// more honest — that space really is unusable by an application — but it
// reads several points higher than `df` on the same filesystem, and the first
// thing anyone does with a disk alert is SSH in and run `df -h`. A monitoring
// number that disagrees with the operator's own command is a number they stop
// believing.
//
// Bavail rather than Bfree for the available half regardless: the reserve is
// not space the application can write into, so counting it as free is how a
// "90% full" alert arrives after the service has already failed to write.
func readDisk(report *Report) error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(report.DiskPath, &stat); err != nil {
		return fmt.Errorf("hostmetrics: statfs %s: %w", report.DiskPath, err)
	}
	if stat.Blocks == 0 {
		return fmt.Errorf("hostmetrics: %s reports no blocks", report.DiskPath)
	}

	blockKB := uint64(stat.Bsize) / 1024
	report.DiskTotalKB = stat.Blocks * blockKB
	report.DiskUsedKB = (stat.Blocks - stat.Bfree) * blockKB

	usable := report.DiskUsedKB + stat.Bavail*blockKB
	if usable == 0 {
		return fmt.Errorf("hostmetrics: %s reports no usable blocks", report.DiskPath)
	}
	report.DiskPercent = round2(float64(report.DiskUsedKB) / float64(usable) * 100)
	return nil
}

// readLoad and readUptime are best-effort: a missing value is a blank field,
// not a failed report. Neither carries a threshold, so losing one costs a
// number on a dashboard rather than an alert.
func readLoad(report *Report) {
	raw, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 3 {
		return
	}
	report.Load1, _ = strconv.ParseFloat(fields[0], 64)
	report.Load5, _ = strconv.ParseFloat(fields[1], 64)
	report.Load15, _ = strconv.ParseFloat(fields[2], 64)
}

func readUptime(report *Report) {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 1 {
		return
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return
	}
	report.UptimeSeconds = int64(seconds)
}

func round2(value float64) float64 {
	return float64(int64(value*100+0.5)) / 100
}
