package storage

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func leadershipStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("Requires the isolated Devices database")
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		t.Fatal("Refusing a non-test database")
	}
	s, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Pool.Close)
	return s
}

func fastLeadership(t *testing.T) {
	t.Helper()
	retry, check := leadershipRetry, leadershipCheck
	leadershipRetry, leadershipCheck = 20*time.Millisecond, 20*time.Millisecond
	t.Cleanup(func() { leadershipRetry, leadershipCheck = retry, check })
}

func TestOneRuntimeLeadsAndAReleasedLockCanBeTakenAtAHigherEpoch(t *testing.T) {
	ctx := context.Background()
	first, second := leadershipStore(t), leadershipStore(t)
	a, err := first.LeadRuntime(ctx, "a", false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Release()
	if a.Epoch < 1 || a.Instance != "a" || a.Since.IsZero() {
		t.Fatalf("leadership = %+v", a)
	}
	if _, err = second.LeadRuntime(ctx, "b", false); !errors.Is(err, ErrRuntimeActive) {
		t.Fatalf("a second runtime got %v, want ErrRuntimeActive", err)
	}
	a.Release()
	a.Release() // twice is safe
	select {
	case <-a.Lost():
		t.Fatal("a released lock was reported lost")
	case <-time.After(50 * time.Millisecond):
	}
	b, err := second.LeadRuntime(ctx, "b", false)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Release()
	if b.Epoch != a.Epoch+1 {
		t.Fatalf("epoch after a takeover = %d, want %d", b.Epoch, a.Epoch+1)
	}
	var instance string
	var epoch int64
	if err = second.Pool.QueryRow(ctx, `SELECT instance, epoch FROM device_runtime.runtime_leaders WHERE scope='all'`).Scan(&instance, &epoch); err != nil || instance != "b" || epoch != b.Epoch {
		t.Fatalf("stored leader = %q at %d (%v), want b at %d", instance, epoch, err, b.Epoch)
	}
}

func TestAStandbyTakesOverWhenTheHoldersSessionEndsAndTheHolderIsTold(t *testing.T) {
	fastLeadership(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	first, second := leadershipStore(t), leadershipStore(t)
	a, err := first.LeadRuntime(ctx, "a", false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Release()
	taken := make(chan *Leadership, 1)
	failed := make(chan error, 1)
	go func() {
		b, err := second.LeadRuntime(ctx, "b", true)
		if err != nil {
			failed <- err
			return
		}
		taken <- b
	}()
	select {
	case b := <-taken:
		b.Release()
		t.Fatal("the standby took a held lock")
	case err = <-failed:
		t.Fatal(err)
	case <-time.After(150 * time.Millisecond): // several attempts
	}
	// The holder's session ends without its doing, as when its host or network is lost.
	if _, err = second.Pool.Exec(ctx, `SELECT pg_terminate_backend($1)`, a.conn.Conn().PgConn().PID()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-a.Lost():
	case <-ctx.Done():
		t.Fatal("the holder was not told its lock was lost")
	}
	select {
	case b := <-taken:
		defer b.Release()
		if b.Epoch != a.Epoch+1 {
			t.Fatalf("standby epoch = %d, want %d", b.Epoch, a.Epoch+1)
		}
	case err = <-failed:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal("the standby did not take the lock")
	}
}

func TestAWaitingRuntimeStopsWhenItIsCancelled(t *testing.T) {
	fastLeadership(t)
	first, second := leadershipStore(t), leadershipStore(t)
	a, err := first.LeadRuntime(context.Background(), "a", false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Release()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if b, err := second.LeadRuntime(ctx, "b", true); !errors.Is(err, context.DeadlineExceeded) {
		if b != nil {
			b.Release()
		}
		t.Fatalf("cancelled wait returned %v", err)
	}
}
