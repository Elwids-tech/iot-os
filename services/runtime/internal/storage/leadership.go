package storage

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// One runtime is active against a deployment (ADR-046). The lock is a session-level
// advisory lock: PostgreSQL releases it when the holder's session ends, so a crashed
// holder never has to be timed out. The holder keeps checking that session and
// reports its loss, because a runtime that carries on without the lock would share
// its Sparkplug host ID with its successor.

// ErrRuntimeActive is returned when another runtime holds the lock and the caller
// did not ask to wait for it.
var ErrRuntimeActive = errors.New("another Devices runtime is already active")

// runtimeLockKey is the same key every runtime version has used, so an older and a
// newer runtime still exclude each other during an upgrade or a rollback.
const runtimeLockKey int64 = 528254100482801

// leadershipScope names what the lock covers: every broker connection, until the
// runtime is sharded by connection.
const leadershipScope = "all"

var (
	// leadershipRetry is how often a waiting runtime tries the lock.
	leadershipRetry = time.Second
	// leadershipCheck is how often the holder checks its lock session, and
	// leadershipCheckTimeout how long one check may take. A holder that stops itself on
	// a slow database is an outage of its own, so the timeout is generous.
	leadershipCheck        = 2 * time.Second
	leadershipCheckTimeout = 5 * time.Second
)

// Leadership is a held runtime lock.
type Leadership struct {
	// Epoch counts how many times the lock has changed hands; a later holder's is higher.
	Epoch    int64
	Instance string
	Since    time.Time

	conn    *pgxpool.Conn
	lost    chan struct{}
	stop    chan struct{}
	stopped chan struct{}
	once    sync.Once
}

// LeadRuntime takes the runtime lock for instance. With wait it keeps trying until
// the lock is free or ctx ends; without, a held lock is ErrRuntimeActive.
func (s *Store) LeadRuntime(ctx context.Context, instance string, wait bool) (*Leadership, error) {
	for {
		l, err := s.tryLead(ctx, instance)
		if l != nil {
			return l, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if !wait {
			if err == nil {
				err = ErrRuntimeActive
			}
			return nil, err
		}
		// A failed attempt (the database restarting, say) is retried like a held lock.
		timer := time.NewTimer(leadershipRetry)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

// tryLead makes one attempt. It returns nil, nil when another session holds the lock.
func (s *Store) tryLead(ctx context.Context, instance string) (*Leadership, error) {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	// A session that is given up is closed, not returned to the pool, so that it
	// cannot keep the lock.
	abandon := func() {
		_ = conn.Conn().Close(context.Background())
		conn.Release()
	}
	var acquired bool
	if err = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", runtimeLockKey).Scan(&acquired); err != nil || !acquired {
		if err != nil {
			abandon()
		} else {
			conn.Release()
		}
		return nil, err
	}
	// PostgreSQL notices a holder whose host or network is gone only by TCP keepalive,
	// hours away by default. These bring it to about ten seconds. They do not apply to
	// a Unix socket, and a server that refuses them still has the lock.
	_, _ = conn.Exec(ctx, "SET tcp_keepalives_idle = 5; SET tcp_keepalives_interval = 2; SET tcp_keepalives_count = 3")
	l := &Leadership{Instance: instance, conn: conn, lost: make(chan struct{}), stop: make(chan struct{}), stopped: make(chan struct{})}
	err = conn.QueryRow(ctx, `INSERT INTO device_runtime.runtime_leaders(scope,epoch,instance,acquired_at) VALUES($1,1,$2,now())
 ON CONFLICT (scope) DO UPDATE SET epoch=runtime_leaders.epoch+1, instance=EXCLUDED.instance, acquired_at=EXCLUDED.acquired_at
 RETURNING epoch, acquired_at`, leadershipScope, instance).Scan(&l.Epoch, &l.Since)
	if err != nil {
		abandon()
		return nil, err
	}
	l.Since = l.Since.UTC()
	go l.watch()
	return l, nil
}

// watch checks the lock session until it is released or lost.
func (l *Leadership) watch() {
	defer close(l.stopped)
	ticker := time.NewTicker(leadershipCheck)
	defer ticker.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), leadershipCheckTimeout)
			_, err := l.conn.Exec(ctx, "SELECT 1")
			cancel()
			if err != nil {
				select {
				case <-l.stop: // released meanwhile
				default:
					close(l.lost)
				}
				return
			}
		}
	}
}

// Lost is closed when the lock session is gone while the lock was still wanted. The
// lock may then be another runtime's: the holder must stop acting at once.
func (l *Leadership) Lost() <-chan struct{} { return l.lost }

// Release gives the lock up. It is safe to call more than once.
func (l *Leadership) Release() {
	l.once.Do(func() {
		close(l.stop)
		<-l.stopped
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = l.conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", runtimeLockKey)
		// Closing the session releases the lock even when the unlock did not get through.
		_ = l.conn.Conn().Close(ctx)
		l.conn.Release()
	})
}
