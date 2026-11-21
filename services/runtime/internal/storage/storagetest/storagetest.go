// Package storagetest prepares the isolated Devices test database for a package's tests.
package storagetest

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// StopBackgroundJobs stops TimescaleDB's job scheduler in the test database, so
// the compression policy never runs beside a test. The policy job starts within
// seconds of being added (the first Open of a fresh database, and every run of
// the compression policy test), compresses the old chunks tests create, and ends
// each chunk by raising its lock to ACCESS EXCLUSIVE. A test statement that
// touches every chunk, such as a cleanup DELETE by organization, then deadlocks
// with it. The scheduler stays stopped until PostgreSQL restarts.
//
// Call it from TestMain in every package that uses DEVICE_TEST_DATABASE_URL. It
// does nothing when the variable is unset.
func StopBackgroundJobs() error {
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		return nil
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		return errors.New("refusing a non-test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, e := pgx.Connect(ctx, url)
	if e != nil {
		return e
	}
	defer conn.Close(ctx)
	var stopped bool
	if e = conn.QueryRow(ctx, "SELECT _timescaledb_functions.stop_background_workers()").Scan(&stopped); e != nil {
		return fmt.Errorf("stop TimescaleDB background jobs: %w", e)
	}
	if !stopped {
		return errors.New("TimescaleDB background jobs did not stop")
	}
	return nil
}
