// Package logging is the Go worker equivalent of src/lib/logging.ts: colorized
// text on stdout, plus JSON lines appended to logs/combined.log (everything)
// and logs/error.log (errors only). LOG_LEVEL controls the minimum level,
// same env var and same values (error/warn/info/debug) as the TS side.
package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type level int

const (
	levelError level = iota
	levelWarn
	levelInfo
	levelDebug
)

func (l level) String() string {
	switch l {
	case levelError:
		return "error"
	case levelWarn:
		return "warn"
	case levelInfo:
		return "info"
	default:
		return "debug"
	}
}

// ANSI color codes matching winston's default npm-level colorize() palette.
const (
	colorReset  = "\x1b[0m"
	colorRed    = "\x1b[31m"
	colorYellow = "\x1b[33m"
	colorGreen  = "\x1b[32m"
	colorBlue   = "\x1b[34m"
)

func (l level) color() string {
	switch l {
	case levelError:
		return colorRed
	case levelWarn:
		return colorYellow
	case levelInfo:
		return colorGreen
	default:
		return colorBlue
	}
}

func parseLevel(s string) (level, bool) {
	switch s {
	case "error":
		return levelError, true
	case "warn", "warning":
		return levelWarn, true
	case "info":
		return levelInfo, true
	case "debug":
		return levelDebug, true
	default:
		return 0, false
	}
}

var (
	mu          sync.Mutex
	combinedLog *os.File
	errorLog    *os.File
	minLevel    = levelInfo
)

func init() {
	if l, ok := parseLevel(os.Getenv("LOG_LEVEL")); ok {
		minLevel = l
	}

	if err := os.MkdirAll("logs", 0o755); err == nil {
		if f, err := os.OpenFile(filepath.Join("logs", "combined.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			combinedLog = f
		}
		if f, err := os.OpenFile(filepath.Join("logs", "error.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			errorLog = f
		}
	}
}

type fileEntry struct {
	Level     string `json:"level"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
	Stack     string `json:"stack,omitempty"`
}

func write(l level, msg string, err error) {
	if l > minLevel {
		return
	}

	now := time.Now()
	errText := ""
	if err != nil {
		errText = err.Error()
	}

	mu.Lock()
	defer mu.Unlock()

	consoleMsg := msg
	if errText != "" {
		consoleMsg = msg + ": " + errText
	}
	fmt.Fprintf(os.Stdout, "%s%s [%s]: %s%s\n", l.color(), now.Format("15:04:05"), l, consoleMsg, colorReset)

	entry := fileEntry{
		Level:     l.String(),
		Message:   msg,
		Timestamp: now.Format("2006-01-02 15:04:05"),
		Stack:     errText,
	}
	line, marshalErr := json.Marshal(entry)
	if marshalErr != nil {
		return
	}
	line = append(line, '\n')

	if combinedLog != nil {
		_, _ = combinedLog.Write(line)
	}
	if l == levelError && errorLog != nil {
		_, _ = errorLog.Write(line)
	}
}

func Info(msg string)  { write(levelInfo, msg, nil) }
func Warn(msg string)  { write(levelWarn, msg, nil) }
func Debug(msg string) { write(levelDebug, msg, nil) }

// Error logs at error level; err may be nil.
func Error(msg string, err error) { write(levelError, msg, err) }
