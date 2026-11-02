package app

import (
	"fmt"
	"os"
	"strconv"

	"github.com/nats-io/nats.go"
)

// Capacity can grow without discarding retained messages or changing delivery
// semantics. Shrinking an existing stream requires a separate operator procedure.
func streamCapacity(key string, fallback int64) (int64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 1<<20 || n > 1<<40 {
		return 0, fmt.Errorf("%s must be bytes between 1 MiB and 1 TiB", key)
	}
	return n, nil
}

func (a *Application) ensureStream(cfg *nats.StreamConfig) error {
	// Runtime streams carry JSON that repeats its identifiers, so S2 shrinks each
	// sealed block several-fold. Existing streams switch on startup; blocks
	// written before keep their old encoding until they expire.
	cfg.Compression = nats.S2Compression
	existing, err := a.JS.StreamInfo(cfg.Name)
	if err == nats.ErrStreamNotFound {
		_, err = a.JS.AddStream(cfg)
		return err
	}
	if err != nil {
		return err
	}
	c := existing.Config
	if len(c.Subjects) != 1 || c.Subjects[0] != cfg.Subjects[0] || c.Storage != cfg.Storage || c.Retention != cfg.Retention || c.Discard != cfg.Discard || c.MaxAge != cfg.MaxAge {
		return fmt.Errorf("incompatible %s stream configuration", cfg.Name)
	}
	// Unlimited existing streams need an explicit migration; silently limiting
	// one could evict retained data. Preserve larger finite operator allocations.
	if c.MaxBytes <= 0 {
		return fmt.Errorf("%s requires an explicit migration to bounded capacity", cfg.Name)
	}
	if c.MaxBytes < cfg.MaxBytes || c.Compression != cfg.Compression {
		c.MaxBytes = max(c.MaxBytes, cfg.MaxBytes)
		c.Compression = cfg.Compression
		_, err = a.JS.UpdateStream(&c)
	}
	return err
}
