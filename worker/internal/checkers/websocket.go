package checkers

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// The magic string RFC 6455 appends to the client key before hashing. Its
// only job is to prove the peer is a real WebSocket implementation rather
// than something that happened to answer 101.
const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// WebSocket performs the RFC 6455 opening handshake and verifies the
// server's Sec-WebSocket-Accept. Done by hand rather than with a client
// library: the handshake *is* the check — once it succeeds there is nothing
// an uptime monitor wants to say over the socket, and it keeps the workers
// dependency-free.
//
// A reverse proxy that answers the HTTP request but is not configured to
// upgrade — the single most common way a WebSocket endpoint breaks while
// looking healthy — fails here and passes both a port and an HTTP check.
func WebSocket(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	started := time.Now()

	target, err := url.Parse(strings.TrimSpace(monitor.URL))
	if err != nil {
		return downResult(started, err)
	}

	secure := target.Scheme == "wss" || target.Scheme == "https"
	address := target.Host
	if target.Port() == "" {
		if secure {
			address = net.JoinHostPort(target.Hostname(), "443")
		} else {
			address = net.JoinHostPort(target.Hostname(), "80")
		}
	}

	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	dialer := &net.Dialer{Timeout: timeout}

	var conn net.Conn
	if secure {
		conn, err = tlsDial(ctx, dialer, address, cfg)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return downResult(started, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(timeout))

	key, err := websocketKey()
	if err != nil {
		return downResult(started, err)
	}

	path := target.RequestURI()
	if path == "" {
		path = "/"
	}
	request := fmt.Sprintf(
		"GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
			"Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nUser-Agent: StayUp-Monitor/1.0\r\n\r\n",
		path, target.Host, key)

	if _, err := conn.Write([]byte(request)); err != nil {
		return downResult(started, err)
	}

	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil {
		return downResult(started, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		return downMessage(started, fmt.Sprintf("Server did not upgrade the connection (HTTP %d)", resp.StatusCode))
	}
	if !strings.EqualFold(resp.Header.Get("Upgrade"), "websocket") {
		return downMessage(started, "Server answered 101 without an Upgrade: websocket header")
	}
	if got, want := resp.Header.Get("Sec-WebSocket-Accept"), websocketAccept(key); got != want {
		return downMessage(started, "Server returned an invalid Sec-WebSocket-Accept — this is not a WebSocket endpoint")
	}

	return gradedResult(cfg, started)
}

func websocketKey() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// websocketAccept is the value RFC 6455 requires the server to echo back:
// base64(sha1(key + GUID)). SHA-1 here is protocol-mandated, not a security
// choice — it is a handshake token, not a digest of anything secret.
func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + websocketGUID)) // #nosec G401 — required by RFC 6455
	return base64.StdEncoding.EncodeToString(sum[:])
}
