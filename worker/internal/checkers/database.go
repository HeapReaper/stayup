package checkers

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	// Registers the "mysql" driver used by the authenticated MySQL check. The
	// handshake check below needs no driver at all.
	_ "github.com/go-sql-driver/mysql"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// Default MySQL port, applied when the monitor leaves the port field blank.
// Mirrors DEFAULT_PORTS in src/lib/monitor-types.ts.
const mysqlPort = 3306

// Postgres opens a real connection with the monitor's DSN and round-trips a
// query. Unlike a TCP port check this proves the server is accepting
// authenticated sessions and answering — a Postgres that is listening but has
// exhausted max_connections, or is still in recovery, fails here and passes a
// port check.
//
// The DSN lives in monitor.url (validated by the monitor router), so a
// password can be given either inline or in monitor.credential.
func Postgres(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	queryCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	// "pgx" is already registered by internal/db's blank import — the same
	// driver the workers use for their own database.
	pool, err := sql.Open("pgx", postgresDSN(monitor))
	if err != nil {
		return downResult(started, err)
	}
	defer pool.Close()

	// One connection, used once and thrown away: a monitor must not keep a
	// pool warm against the system it's watching.
	pool.SetMaxOpenConns(1)

	var one int
	if err := pool.QueryRowContext(queryCtx, "SELECT 1").Scan(&one); err != nil {
		return downResult(started, err)
	}

	return gradedResult(cfg, started)
}

// postgresDSN folds monitor.credential into the DSN as the password when the
// DSN itself doesn't carry one, so the secret can be stored in the column
// that is kept out of API responses rather than inline in the URL.
func postgresDSN(monitor store.Monitor) string {
	dsn := strings.TrimSpace(monitor.URL)
	credential := deref(monitor.Credential)
	if credential == "" {
		return dsn
	}
	if strings.Contains(dsn, "@") && strings.Contains(strings.SplitN(dsn, "@", 2)[0], ":") {
		return dsn // the DSN already has userinfo with a password
	}
	if strings.Contains(dsn, "?") {
		return dsn + "&password=" + credential
	}
	return dsn + "?password=" + credential
}

// MySQL checks the server in one of two ways, decided by what the monitor's
// target field holds:
//
//   - a bare host — read the initial handshake packet. No driver and no
//     login: the handshake is the first thing mysqld writes on an accepted
//     connection, so a well-formed one proves the server is up and past its
//     connection limit, without this monitor needing credentials to a
//     production database.
//   - a mysql:// DSN — log in and round-trip SELECT 1, the way the Postgres
//     checker does. The handshake alone cannot see a server that is
//     authenticating fine but whose database is unreadable (a full disk, a
//     replica still in recovery, a revoked grant), and that is an outage for
//     whoever depends on it.
//
// Either way a server that answers the TCP connect but nothing more — the
// classic "too many connections" or a stuck server — fails here and passes a
// port check.
func MySQL(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	if isMySQLDSN(monitor.URL) {
		return mysqlQuery(ctx, cfg, monitor)
	}
	return mysqlHandshake(ctx, cfg, monitor)
}

// mysqlQuery is the authenticated path: a real login followed by SELECT 1.
func mysqlQuery(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	queryCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	dsn, err := mysqlDSN(monitor, timeout)
	if err != nil {
		return downResult(started, err)
	}

	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		return downResult(started, err)
	}
	defer pool.Close()

	// One connection, used once and thrown away: a monitor must not keep a
	// pool warm against the system it's watching.
	pool.SetMaxOpenConns(1)

	var one int
	if err := pool.QueryRowContext(queryCtx, "SELECT 1").Scan(&one); err != nil {
		return downResult(started, err)
	}

	return gradedResult(cfg, started)
}

// isMySQLDSN distinguishes the two target shapes. Only the explicit scheme
// selects the authenticated path, so every monitor created before it existed
// (a bare host) keeps doing the handshake check.
func isMySQLDSN(raw string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(raw)), "mysql://")
}

// mysqlDSN rewrites the mysql:// URL the form accepts into the driver's own
// DSN form (user:pass@tcp(host:port)/dbname?params), folding in the password
// from monitor.credential when the URL doesn't carry one — so the secret can
// live in the column that is kept out of API responses.
func mysqlDSN(monitor store.Monitor, timeout time.Duration) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(monitor.URL))
	if err != nil {
		return "", fmt.Errorf("invalid MySQL connection string: %w", err)
	}

	user := parsed.User.Username()
	password, hasPassword := parsed.User.Password()
	if !hasPassword {
		password = deref(monitor.Credential)
	}

	credentials := user
	if password != "" {
		credentials = user + ":" + password
	}
	if credentials != "" {
		credentials += "@"
	}

	host := parsed.Hostname()
	if host == "" {
		return "", fmt.Errorf("MySQL connection string has no host")
	}
	port := parsed.Port()
	if port == "" {
		port = strconv.Itoa(portOr(monitor, mysqlPort))
	}

	// Query parameters are carried through so a caller can ask for TLS
	// (?tls=true) or a specific collation; the timeouts are ours, and match
	// the deadline the query context is already under.
	params := parsed.Query()
	params.Set("timeout", timeout.String())
	params.Set("readTimeout", timeout.String())

	return fmt.Sprintf("%stcp(%s)/%s?%s", credentials, net.JoinHostPort(host, port),
		strings.TrimPrefix(parsed.Path, "/"), params.Encode()), nil
}

// mysqlHandshake is the credential-free path: read the server's greeting.
func mysqlHandshake(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	started := time.Now()

	conn, err := dialFor(ctx, cfg, monitor, mysqlPort, false)
	if err != nil {
		return downResult(started, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(time.Duration(cfg.HTTPTimeoutSecs) * time.Second))

	// 3-byte little-endian payload length, 1-byte sequence id, then payload.
	header := make([]byte, 4)
	if _, err := io.ReadFull(conn, header); err != nil {
		return downResult(started, fmt.Errorf("no MySQL handshake: %w", err))
	}
	length := int(header[0]) | int(header[1])<<8 | int(header[2])<<16
	if length == 0 || length > 1<<20 {
		return downMessage(started, fmt.Sprintf("Malformed MySQL handshake (payload length %d)", length))
	}

	payload := make([]byte, 1)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return downResult(started, err)
	}

	// 0xff is an error packet — the server is alive but refusing us (host
	// blocked, too many connections). That is still an outage for whoever
	// depends on it.
	if payload[0] == 0xff {
		return downMessage(started, "MySQL refused the connection (error packet instead of a handshake)")
	}
	if payload[0] != 0x0a {
		return downMessage(started, fmt.Sprintf("Unexpected MySQL protocol version %d", payload[0]))
	}

	return gradedResult(cfg, started)
}

// Redis speaks just enough RESP to say PING and read PONG, authenticating
// first when the monitor carries a credential. No client library: a liveness
// check is two commands, and PING is the one command a loaded Redis still
// answers.
func Redis(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	started := time.Now()

	conn, err := dialFor(ctx, cfg, monitor, 6379, false)
	if err != nil {
		return downResult(started, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(time.Duration(cfg.HTTPTimeoutSecs) * time.Second))
	reader := bufio.NewReader(conn)

	if credential := deref(monitor.Credential); credential != "" {
		if _, err := conn.Write(respCommand("AUTH", credential)); err != nil {
			return downResult(started, err)
		}
		reply, err := reader.ReadString('\n')
		if err != nil {
			return downResult(started, err)
		}
		if !strings.HasPrefix(reply, "+OK") {
			return downMessage(started, "Redis rejected AUTH: "+strings.TrimSpace(reply))
		}
	}

	if _, err := conn.Write(respCommand("PING")); err != nil {
		return downResult(started, err)
	}
	reply, err := reader.ReadString('\n')
	if err != nil {
		return downResult(started, err)
	}
	if !strings.HasPrefix(reply, "+PONG") {
		return downMessage(started, "Redis did not answer PING: "+strings.TrimSpace(reply))
	}

	return gradedResult(cfg, started)
}

// respCommand encodes a Redis command as a RESP array of bulk strings.
func respCommand(parts ...string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(parts))
	for _, part := range parts {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(part), part)
	}
	return []byte(b.String())
}

// dialFor opens a TCP (or TLS) connection to the monitor's host, applying the
// per-type default port when the form left it blank.
func dialFor(ctx context.Context, cfg settings.Settings, monitor store.Monitor, defaultPort int, useTLS bool) (net.Conn, error) {
	port := defaultPort
	if monitor.Port != nil && *monitor.Port > 0 {
		port = *monitor.Port
	}

	address := net.JoinHostPort(hostOf(monitor.URL), fmt.Sprint(port))
	dialer := &net.Dialer{Timeout: time.Duration(cfg.HTTPTimeoutSecs) * time.Second}

	if !useTLS {
		return dialer.DialContext(ctx, "tcp", address)
	}
	return tlsDial(ctx, dialer, address, cfg)
}

// hostOf tolerates a host that was typed with a scheme or a trailing path,
// so "redis://cache.internal:6379" and "cache.internal" both work.
func hostOf(raw string) string {
	host := strings.TrimSpace(raw)
	if index := strings.Index(host, "://"); index != -1 {
		host = host[index+3:]
	}
	host = strings.SplitN(host, "/", 2)[0]
	// Strip any port typed into the host field; the port column wins.
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}
