package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestStartupDelayBacksOffToTenSeconds(t *testing.T) {
	for attempt, want := range map[int]time.Duration{1: 500 * time.Millisecond, 2: time.Second, 3: 2 * time.Second, 5: 8 * time.Second, 6: 10 * time.Second, 100: 10 * time.Second} {
		if got := startupDelay(attempt); got != want {
			t.Errorf("startupDelay(%d) = %s, want %s", attempt, got, want)
		}
	}
}

// unresolvedTransport fails the first dials the way Docker's DNS does while a
// container is being recreated.
type unresolvedTransport struct {
	failures atomic.Int32
	next     http.RoundTripper
}

func (u *unresolvedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if u.failures.Add(-1) >= 0 {
		return nil, &net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "server misbehaving", Name: "api-web", Server: "127.0.0.11:53", IsTemporary: true}}
	}
	return u.next.RoundTrip(r)
}

func noDelay(int) time.Duration { return time.Millisecond }

func TestStartupWaitsForTheControlPlaneToAnswer(t *testing.T) {
	var served atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if served.Add(1) == 1 {
			// nginx is up before php-fpm behind it.
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = io.WriteString(w, `{"connections":[],"devices":[{"uuid":"device-1"}],"retention":[]}`)
	}))
	defer server.Close()
	transport := &unresolvedTransport{next: http.DefaultTransport}
	transport.failures.Store(2)
	control := &ControlClient{URL: server.URL, Token: strings.Repeat("t", 32), Client: &http.Client{Transport: transport}}
	var logs bytes.Buffer
	var state devices.ControlState
	attempts := 0
	err := awaitControlPlane(context.Background(), slog.New(slog.NewTextHandler(&logs, nil)), time.Minute, noDelay, func() error {
		attempts++
		return control.request(context.Background(), "GET", "/state", nil, &state)
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 4 || len(state.Devices) != 1 {
		t.Fatalf("attempts = %d, devices = %d; want 4 attempts and the fetched state", attempts, len(state.Devices))
	}
	if retries := strings.Count(logs.String(), "control plane not ready"); retries != 3 {
		t.Errorf("logged %d retries, want 3:\n%s", retries, logs.String())
	}
	if !strings.Contains(logs.String(), "server misbehaving") || !strings.Contains(logs.String(), "returned 502") {
		t.Errorf("retries should log their cause:\n%s", logs.String())
	}
}

func TestStartupStopsWaitingWhenRetryingCannotHelp(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	unavailable := &controlStatusError{Method: "GET", Path: "/state", Status: http.StatusServiceUnavailable}

	attempts := 0
	rejected := &controlStatusError{Method: "GET", Path: "/state", Status: http.StatusBadRequest}
	err := awaitControlPlane(context.Background(), logger, time.Minute, noDelay, func() error { attempts++; return rejected })
	if !errors.Is(err, rejected) || attempts != 1 {
		t.Errorf("a rejected request should fail at once, got %v after %d attempts", err, attempts)
	}

	attempts = 0
	err = awaitControlPlane(context.Background(), logger, 20*time.Millisecond, func(int) time.Duration { return 5 * time.Millisecond }, func() error { attempts++; return unavailable })
	if !errors.Is(err, unavailable) || attempts < 2 || attempts > 4 {
		t.Errorf("the wait should run out with the last error, got %v after %d attempts", err, attempts)
	}

	ctx, cancel := context.WithCancel(context.Background())
	attempts = 0
	err = awaitControlPlane(ctx, logger, 2*time.Hour, func(int) time.Duration { return time.Hour }, func() error {
		attempts++
		time.AfterFunc(10*time.Millisecond, cancel)
		return unavailable
	})
	if !errors.Is(err, context.Canceled) || attempts != 1 {
		t.Errorf("shutdown should end the wait, got %v after %d attempts", err, attempts)
	}
}
