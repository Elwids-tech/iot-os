package storage

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsQueryTimeoutRecognisesStatementCancellationOnly(t *testing.T) {
	timeout := &pgconn.PgError{Code: "57014", Message: "canceling statement due to statement timeout"}
	if !IsQueryTimeout(timeout) || !IsQueryTimeout(fmt.Errorf("state history: %w", timeout)) {
		t.Fatal("statement timeout not recognised")
	}
	if IsQueryTimeout(&pgconn.PgError{Code: "40001"}) || IsQueryTimeout(errors.New("57014")) || IsQueryTimeout(nil) {
		t.Fatal("other errors read as timeouts")
	}
}

func TestRangeReadsGetALongerStatementLimitThanThePool(t *testing.T) {
	store, ctx, _ := historyStore(t)
	var pool, ranged string
	if err := store.Pool.QueryRow(ctx, "SHOW statement_timeout").Scan(&pool); err != nil {
		t.Fatal(err)
	}
	tx, err := store.beginRangeRead(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, "SHOW statement_timeout").Scan(&ranged); err != nil {
		t.Fatal(err)
	}
	if pool != "5s" || ranged != rangeReadTimeout {
		t.Fatalf("pool %q, range read %q", pool, ranged)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO device_runtime.devices DEFAULT VALUES"); err == nil {
		t.Fatal("range reads must be read-only")
	}
	// A real cancellation at the limit is reported as a timeout.
	cancelled, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelled.Rollback(ctx)
	if _, err = cancelled.Exec(ctx, "SET LOCAL statement_timeout = '20ms'"); err != nil {
		t.Fatal(err)
	}
	if _, err = cancelled.Exec(ctx, "SELECT pg_sleep(1)"); !IsQueryTimeout(err) {
		t.Fatalf("expected a statement timeout, got %v", err)
	}
}
