package app

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

// Durable consumers process one message at a time to keep per-stream order.
// A message that can never succeed would therefore block everything behind it,
// so permanent failures are copied to the dead-letter stream and terminated,
// while transient failures (database, broker or control plane unavailable) are
// retried with backoff for as long as it takes.
const (
	DeadLetterStream  = "IOT_DEAD_LETTERS"
	deadLetterSubject = "iot.deadletter."
)

func deadLetterStreamConfig() *nats.StreamConfig {
	// Discard old: a full dead-letter stream must never stall the live consumers.
	return &nats.StreamConfig{Name: DeadLetterStream, Subjects: []string{deadLetterSubject + ">"}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, MaxAge: 30 * 24 * time.Hour, MaxBytes: 256 << 20, Discard: nats.DiscardOld}
}

func (a *Application) ensureDeadLetterStream() error {
	cfg := deadLetterStreamConfig()
	capacity, err := streamCapacity("IOT_NATS_DEAD_LETTER_MAX_BYTES", cfg.MaxBytes)
	if err != nil {
		return err
	}
	cfg.MaxBytes = capacity
	return a.ensureStream(cfg)
}

type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

// permanent marks an error that retrying cannot fix, such as an undecodable
// payload or a request the receiver rejected as invalid or stale.
func permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err}
}

func isPermanent(err error) bool {
	var p permanentError
	if errors.As(err, &p) || errors.Is(err, storage.ErrRejected) {
		return true
	}
	var status *controlStatusError
	return errors.As(err, &status) && status.permanent()
}

// controlStatusError is a non-2xx response from the Laravel control plane.
type controlStatusError struct {
	Method, Path string
	Status       int
}

func (e *controlStatusError) Error() string {
	return fmt.Sprintf("control-plane request %s %s returned %d", e.Method, e.Path, e.Status)
}

// permanent reports whether the control plane rejected the request itself.
// Authentication, routing, timeouts, rate limits and server errors are
// operational problems that clear up, so those are retried.
func (e *controlStatusError) permanent() bool {
	switch e.Status {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests:
		return false
	}
	return e.Status >= 400 && e.Status < 500
}

// retryDelay backs off from 3 s to a 1 minute ceiling as deliveries accumulate.
func retryDelay(delivered uint64) time.Duration {
	delay := 3 * time.Second
	for i := uint64(1); i < delivered && delay < time.Minute; i++ {
		delay *= 2
	}
	return min(delay, time.Minute)
}

func deliveries(m *nats.Msg) uint64 {
	if meta, err := m.Metadata(); err == nil {
		return meta.NumDelivered
	}
	return 1
}

// deadLetter keeps the original payload with enough context to inspect and
// replay it. The message id makes a repeated attempt for the same delivery
// idempotent within the broker's duplicate window.
func (a *Application) deadLetter(consumer string, m *nats.Msg, cause error) error {
	letter := nats.NewMsg(deadLetterSubject + consumer)
	letter.Data = m.Data
	reason := cause.Error()
	if len(reason) > 1024 {
		reason = reason[:1024]
	}
	letter.Header.Set("Iot-Consumer", consumer)
	letter.Header.Set("Iot-Original-Subject", m.Subject)
	letter.Header.Set("Iot-Error", reason)
	if meta, err := m.Metadata(); err == nil {
		letter.Header.Set("Iot-Stream", meta.Stream)
		letter.Header.Set("Iot-Stream-Sequence", strconv.FormatUint(meta.Sequence.Stream, 10))
		letter.Header.Set("Iot-Delivered", strconv.FormatUint(meta.NumDelivered, 10))
		letter.Header.Set(nats.MsgIdHdr, fmt.Sprintf("%s:%s:%d", consumer, meta.Stream, meta.Sequence.Stream))
	}
	_, err := a.JS.PublishMsg(letter)
	return err
}

// settle acknowledges, dead-letters or schedules a retry for one delivery.
func (a *Application) settle(consumer string, m *nats.Msg, err error) {
	if err == nil {
		_ = m.Ack()
		return
	}
	delivered := deliveries(m)
	if isPermanent(err) {
		if e := a.deadLetter(consumer, m, err); e != nil {
			a.Logger.Error("message could not be dead-lettered; retrying", "consumer", consumer, "subject", m.Subject, "error", err, "dead_letter_error", e)
			_ = m.NakWithDelay(retryDelay(delivered))
			return
		}
		a.deadLetters.Add(1)
		a.Logger.Error("message dead-lettered", "consumer", consumer, "subject", m.Subject, "error", err)
		_ = m.Term()
		return
	}
	if delivered%10 == 0 {
		a.Logger.Error("durable consumer blocked by a failing message", "consumer", consumer, "subject", m.Subject, "deliveries", delivered, "error", err)
	} else {
		a.Logger.Warn("durable event deferred", "consumer", consumer, "subject", m.Subject, "deliveries", delivered, "error", err)
	}
	_ = m.NakWithDelay(retryDelay(delivered))
}
