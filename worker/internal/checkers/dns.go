package checkers

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

var dnsResolver = &net.Resolver{PreferGo: true}

// Longest answer set we quote back in a failure message. A wildcard TXT zone
// can return a lot, and the message column is read in a notification.
const maxAnswersInMessage = 5

// DNS looks up one record for the monitor's hostname and, when the monitor
// carries an expected value, asserts that value appears in the answer.
//
// The record type is the monitor's own (default "A", which is what every DNS
// monitor did before record selection existed). Watching an MX or a TXT
// separately is the point: mail delivery and SPF/DKIM break without anything
// an HTTP or A-record check would notice.
func DNS(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	host := strings.TrimSpace(monitor.URL)
	if host == "" {
		msg := "No hostname configured"
		return store.CheckResult{Status: "Down", ResponseTime: 0, Message: &msg}
	}

	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	lookupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	recordType := monitor.DNSRecordType
	if recordType == "" {
		recordType = "A"
	}

	started := time.Now()
	answers, err := lookupRecords(lookupCtx, recordType, host)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	if len(answers) == 0 {
		return downMessage(started, fmt.Sprintf("No %s records returned", recordType))
	}

	// A blank expected value asserts only that the record still resolves,
	// which is what "is it still there" means for most of them.
	if expected := strings.TrimSpace(deref(monitor.DNSExpectedValue)); expected != "" && !answersContain(answers, expected) {
		return downMessage(started, fmt.Sprintf(
			"%s record does not contain %q (got %s)", recordType, expected, summarize(answers),
		))
	}

	return store.CheckResult{Status: gradeLatency(cfg, responseTime), ResponseTime: responseTime}
}

// lookupRecords resolves one record type into a comparable list of strings.
// Must stay in step with dnsRecordTypeEnum in src/lib/monitor-types.ts — a
// type the form can save but this switch doesn't know would fail every check.
func lookupRecords(ctx context.Context, recordType, host string) ([]string, error) {
	switch recordType {
	case "A", "AAAA":
		network := "ip4"
		if recordType == "AAAA" {
			network = "ip6"
		}
		addrs, err := dnsResolver.LookupIP(ctx, network, host)
		if err != nil {
			return nil, err
		}
		return mapStrings(addrs, func(ip net.IP) string { return ip.String() }), nil

	case "CNAME":
		name, err := dnsResolver.LookupCNAME(ctx, host)
		if err != nil {
			return nil, err
		}
		// LookupCNAME answers with the host itself when there is no CNAME, so
		// that case has to be read as "no record" rather than as a match.
		if trimDot(name) == "" || strings.EqualFold(trimDot(name), trimDot(host)) {
			return nil, nil
		}
		return []string{trimDot(name)}, nil

	case "MX":
		records, err := dnsResolver.LookupMX(ctx, host)
		if err != nil {
			return nil, err
		}
		// Answer order is not stable across queries; sorting by preference
		// keeps the message readable and the primary MX first.
		sort.SliceStable(records, func(i, j int) bool { return records[i].Pref < records[j].Pref })
		return mapStrings(records, func(mx *net.MX) string {
			return fmt.Sprintf("%d %s", mx.Pref, trimDot(mx.Host))
		}), nil

	case "NS":
		records, err := dnsResolver.LookupNS(ctx, host)
		if err != nil {
			return nil, err
		}
		return mapStrings(records, func(ns *net.NS) string { return trimDot(ns.Host) }), nil

	case "TXT":
		return dnsResolver.LookupTXT(ctx, host)

	case "SRV":
		// Empty service and proto make LookupSRV resolve `host` verbatim, so
		// the form takes the full _service._proto.name the way it is written
		// in the zone file.
		_, records, err := dnsResolver.LookupSRV(ctx, "", "", host)
		if err != nil {
			return nil, err
		}
		return mapStrings(records, func(srv *net.SRV) string {
			return fmt.Sprintf("%d %d %d %s", srv.Priority, srv.Weight, srv.Port, trimDot(srv.Target))
		}), nil

	default:
		return nil, fmt.Errorf("unsupported DNS record type %q", recordType)
	}
}

// answersContain is a case-insensitive substring match. Substring rather than
// equality because the useful assertion is usually a fragment of the answer —
// "include:_spf.google.com" inside a longer SPF record, or a mail host inside
// an MX answer that also carries its preference.
func answersContain(answers []string, expected string) bool {
	needle := strings.ToLower(trimDot(expected))
	for _, answer := range answers {
		if strings.Contains(strings.ToLower(trimDot(answer)), needle) {
			return true
		}
	}
	return false
}

func summarize(answers []string) string {
	if len(answers) > maxAnswersInMessage {
		return strings.Join(answers[:maxAnswersInMessage], ", ") +
			fmt.Sprintf(" and %d more", len(answers)-maxAnswersInMessage)
	}
	return strings.Join(answers, ", ")
}

// trimDot drops the root label DNS answers carry, so an expected
// "mail.example.com" matches an answer of "mail.example.com.".
func trimDot(name string) string {
	return strings.TrimSuffix(strings.TrimSpace(name), ".")
}

func mapStrings[T any](items []T, format func(T) string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, format(item))
	}
	return out
}
