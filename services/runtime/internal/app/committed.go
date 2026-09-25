package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/nats-io/nats.go"
)

func committedStreamConfig() *nats.StreamConfig {
	return &nats.StreamConfig{
		Name: devices.CommittedTelemetryStream, Subjects: []string{devices.CommittedTelemetrySubject},
		Storage: nats.FileStorage, Retention: nats.LimitsPolicy,
		MaxAge: 7 * 24 * time.Hour, MaxBytes: 768 << 20, Discard: nats.DiscardNew,
	}
}

func (a *Application) ensureCommittedStream() error {
	cfg := committedStreamConfig()
	existing, err := a.JS.StreamInfo(cfg.Name)
	if err == nats.ErrStreamNotFound {
		_, err = a.JS.AddStream(cfg)
		return err
	}
	if err != nil {
		return err
	}
	// Fail explicitly rather than silently using an incompatible pre-existing stream.
	c := existing.Config
	if len(c.Subjects) != 1 || c.Subjects[0] != cfg.Subjects[0] || c.Storage != cfg.Storage || c.Retention != cfg.Retention || c.Discard != cfg.Discard || c.MaxAge != cfg.MaxAge || c.MaxBytes != cfg.MaxBytes {
		return fmt.Errorf("incompatible %s stream configuration", cfg.Name)
	}
	return nil
}

// Independent of the control-plane relay and device fences: a full stream or a
// broker outage may delay publication, but never holds a command/lifecycle lock.
func (a *Application) relayCommitted(ctx context.Context) {
	delay := time.NewTimer(0)
	defer delay.Stop()
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-delay.C:
			count, err := a.publishCommittedBatch(ctx)
			if err != nil {
				a.committedFailures.Add(1)
				a.Logger.Warn("committed telemetry publication deferred", "error", err, "retry_seconds", backoff.Seconds())
				delay.Reset(backoff)
				backoff = min(backoff*2, 30*time.Second)
			} else {
				backoff = time.Second
				if count == 100 {
					delay.Reset(time.Millisecond)
				} else {
					delay.Reset(time.Second)
				}
			}
		}
	}
}

func (a *Application) publishCommittedBatch(ctx context.Context) (int, error) {
	events, err := a.Store.CommittedPending(ctx)
	if err != nil {
		return 0, err
	}
	for i, event := range events {
		raw, err := json.Marshal(event)
		if err != nil {
			return i, err
		}
		message := nats.NewMsg(devices.CommittedTelemetrySubject)
		message.Data = raw
		message.Header.Set(nats.MsgIdHdr, event.EventID)
		publishCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		_, err = a.JS.PublishMsg(message, nats.Context(publishCtx))
		cancel()
		if err != nil {
			return i, err
		}
		if err = a.Store.AckCommitted(ctx, event.EventID); err != nil {
			return i, err // stop here: retry this stable ID before later events
		}
	}
	return len(events), nil
}

func (a *Application) committedStatus(w http.ResponseWriter, r *http.Request) {
	backlog, err := a.Store.CommittedBacklog(r.Context())
	if err != nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "Committed telemetry status unavailable"})
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"pending": backlog.Pending, "oldest_age_seconds": backlog.OldestAgeSeconds,
		"publication_failures_since_start": a.committedFailures.Load(),
	})
}
