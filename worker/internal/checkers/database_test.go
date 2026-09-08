package checkers

import (
	"testing"
	"time"

	"stayup/worker/internal/store"
)

func monitorWithURL(url string) store.Monitor {
	return store.Monitor{
		ID: "mon", Name: "test", URL: url, Type: "MySQL", Status: "Up", Interval: "60s", Enabled: true,
	}
}

func TestIsMySQLDSN(t *testing.T) {
	// Only the explicit scheme selects the authenticated path — every monitor
	// created before it existed holds a bare host and must keep doing the
	// handshake check.
	tests := map[string]bool{
		"mysql://user@db.internal:3306/appdb": true,
		"MySQL://user@db.internal/appdb":      true,
		"db.internal":                         false,
		"db.internal:3306":                    false,
		"":                                    false,
	}

	for url, want := range tests {
		if got := isMySQLDSN(url); got != want {
			t.Errorf("isMySQLDSN(%q) = %v, want %v", url, got, want)
		}
	}
}

func TestMySQLDSN(t *testing.T) {
	timeout := 5 * time.Second

	t.Run("password comes from the credential column", func(t *testing.T) {
		monitor := monitorWithURL("mysql://probe@db.internal:3307/appdb")
		monitor.Credential = strPtr("s3cret")

		got, err := mysqlDSN(monitor, timeout)
		if err != nil {
			t.Fatalf("mysqlDSN() error = %v", err)
		}
		want := "probe:s3cret@tcp(db.internal:3307)/appdb?readTimeout=5s&timeout=5s"
		if got != want {
			t.Errorf("mysqlDSN() = %q, want %q", got, want)
		}
	})

	t.Run("an inline password wins over the credential column", func(t *testing.T) {
		monitor := monitorWithURL("mysql://probe:inline@db.internal/appdb")
		monitor.Credential = strPtr("stored")

		got, err := mysqlDSN(monitor, timeout)
		if err != nil {
			t.Fatalf("mysqlDSN() error = %v", err)
		}
		// No port in the DSN and none on the monitor: the MySQL default.
		want := "probe:inline@tcp(db.internal:3306)/appdb?readTimeout=5s&timeout=5s"
		if got != want {
			t.Errorf("mysqlDSN() = %q, want %q", got, want)
		}
	})

	t.Run("the port column fills in for a DSN without one", func(t *testing.T) {
		monitor := monitorWithURL("mysql://probe@db.internal/appdb")
		port := 3399
		monitor.Port = &port

		got, err := mysqlDSN(monitor, timeout)
		if err != nil {
			t.Fatalf("mysqlDSN() error = %v", err)
		}
		want := "probe@tcp(db.internal:3399)/appdb?readTimeout=5s&timeout=5s"
		if got != want {
			t.Errorf("mysqlDSN() = %q, want %q", got, want)
		}
	})

	t.Run("query parameters survive", func(t *testing.T) {
		monitor := monitorWithURL("mysql://probe@db.internal/appdb?tls=true")

		got, err := mysqlDSN(monitor, timeout)
		if err != nil {
			t.Fatalf("mysqlDSN() error = %v", err)
		}
		want := "probe@tcp(db.internal:3306)/appdb?readTimeout=5s&timeout=5s&tls=true"
		if got != want {
			t.Errorf("mysqlDSN() = %q, want %q", got, want)
		}
	})

	t.Run("a DSN with no host is an error, not a dial to nowhere", func(t *testing.T) {
		if _, err := mysqlDSN(monitorWithURL("mysql:///appdb"), timeout); err == nil {
			t.Fatal("expected an error for a hostless connection string")
		}
	})
}
