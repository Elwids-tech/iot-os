package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

type ControlClient struct {
	URL, Token string
	Client     *http.Client
}

func (c *ControlClient) request(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		raw, e := json.Marshal(input)
		if e != nil {
			return e
		}
		body = bytes.NewReader(raw)
	}
	req, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.URL, "/")+path, body)
	if e != nil {
		return e
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	response, e := c.Client.Do(req)
	if e != nil {
		return fmt.Errorf("control-plane connection failed: %w", e)
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return &controlStatusError{Method: method, Path: path, Status: response.StatusCode}
	}
	if output != nil {
		decoder := json.NewDecoder(io.LimitReader(response.Body, 32<<20))
		decoder.UseNumber()
		return decoder.Decode(output)
	}
	return nil
}

// A deploy recreates the control plane alongside the runtime, so its name may
// not resolve yet. Exiting restarts the container and two restarts trip the
// ContainerFailure alert; giving up after this wait still lets a real outage
// show as restarts.
const controlPlaneStartupWait = 2 * time.Minute

// startupDelay backs off from 500 ms to a 10 s ceiling between attempts.
func startupDelay(attempt int) time.Duration {
	delay := 500 * time.Millisecond
	for i := 1; i < attempt && delay < 10*time.Second; i++ {
		delay *= 2
	}
	return min(delay, 10*time.Second)
}

// awaitControlPlane retries fetch until it succeeds, fails permanently, the
// wait runs out or ctx ends.
func awaitControlPlane(ctx context.Context, logger *slog.Logger, wait time.Duration, delay func(int) time.Duration, fetch func() error) error {
	deadline := time.Now().Add(wait)
	for attempt := 1; ; attempt++ {
		e := fetch()
		if e == nil {
			if attempt > 1 {
				logger.Info("control plane reachable", "attempts", attempt)
			}
			return nil
		}
		if isPermanent(e) || ctx.Err() != nil {
			return e
		}
		pause := delay(attempt)
		if time.Now().Add(pause).After(deadline) {
			return fmt.Errorf("control plane unreachable after %d attempts: %w", attempt, e)
		}
		logger.Warn("control plane not ready, retrying", "attempt", attempt, "retry_in", pause.String(), "error", e)
		timer := time.NewTimer(pause)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// relay publishes the runtime's own events to JetStream on their way to the control
// plane. Control rows have a loop of their own (claimControl), so an apply that takes
// seconds never holds events back.
func (a *Application) relay(ctx context.Context) {
	ticker := time.NewTimer(0)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Idle/error polling remains bounded. A full acknowledged batch can
			// resume promptly, without imposing a 100-events/second recovery cap.
			ticker.Reset(time.Second)
			events, e := a.Store.Outbox(ctx)
			if e != nil {
				a.Logger.Warn("runtime outbox unavailable", "error", e)
				continue
			}
			published := 0
			for _, ev := range events {
				var identity struct {
					DeviceUUID string `json:"device_uuid"`
				}
				_ = storage.Decode(ev.Payload, &identity)
				unlock := a.lockDevice(identity.DeviceUUID)
				raw, _ := json.Marshal(ev)
				m := nats.NewMsg("iot.runtime." + ev.Type)
				m.Data = raw
				m.Header.Set(nats.MsgIdHdr, ev.UUID)
				if _, e = a.JS.PublishMsg(m); e != nil {
					a.Logger.Warn("runtime event publication failed", "error", e)
					unlock()
					break
				}
				unlock()
				if e = a.Store.Ack(ctx, ev.UUID); e != nil {
					a.Logger.Warn("runtime outbox acknowledgement failed", "error", e)
				} else {
					published++
				}
			}
			if published == 100 {
				ticker.Reset(10 * time.Millisecond)
			}
		}
	}
}
func (a *Application) emit(kind string, payload any) {
	if e := a.Store.Emit(a.ctx, kind, payload); e != nil {
		a.Logger.Error("runtime event could not be persisted", "type", kind, "error", e)
	}
}
func (a *Application) subscribe() error {
	if err := a.ensureCommittedStream(); err != nil {
		return err
	}
	if err := a.ensureDeadLetterStream(); err != nil {
		return err
	}
	for _, stream := range []struct {
		Name, Subject, CapacityEnv string
		Bytes                      int64
	}{{controlStream, "iot.control.>", "IOT_NATS_CONTROL_MAX_BYTES", 64 << 20}, {eventsStream, "iot.runtime.>", "IOT_NATS_EVENTS_MAX_BYTES", 256 << 20}, {"IOT_DEVICE_TELEMETRY", "iot.telemetry.>", "IOT_NATS_TELEMETRY_MAX_BYTES", 768 << 20}} {
		capacity, err := streamCapacity(stream.CapacityEnv, stream.Bytes)
		if err != nil {
			return err
		}
		cfg := &nats.StreamConfig{Name: stream.Name, Subjects: []string{stream.Subject}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, MaxAge: 7 * 24 * time.Hour, MaxBytes: capacity, Discard: nats.DiscardNew}
		if err = a.ensureStream(cfg); err != nil {
			return err
		}
	}
	handlers := []struct {
		subject, durable string
		handle           func(*nats.Msg) error
	}{
		// Nothing is published to the control stream any more; this consumer only applies
		// what an earlier runtime left there, before the first claim (ADR-043).
		{"iot.control.>", controlConsumer, func(m *nats.Msg) error {
			var ev devices.Event
			if e := storage.Decode(m.Data, &ev); e != nil {
				return permanent(e)
			}
			return a.handleControl(ev)
		}},
		{"iot.telemetry.>", storageConsumer, a.storeTelemetry},
	}
	for _, h := range handlers {
		if e := a.consume(h.subject, h.durable, h.handle); e != nil {
			return e
		}
	}
	return a.subscribeInbox()
}

// storageConsumer stores the telemetry handed on by the ingest path.
const storageConsumer = "devices-storage"

// consume subscribes a durable consumer that handles one message at a time, in
// stream order, and settles each before the next.
func (a *Application) consume(subject, durable string, handle func(*nats.Msg) error) error {
	sub, e := a.JS.Subscribe(subject, func(m *nats.Msg) {
		a.settle(durable, m, handle(m))
	}, nats.Durable(durable), nats.ManualAck(), nats.AckExplicit(), nats.MaxAckPending(1), nats.DeliverAll())
	if e != nil {
		return e
	}
	a.subscriptions = append(a.subscriptions, sub)
	return nil
}

// storeTelemetry stores one handed-on message, unless its device's configuration
// changed since.
func (a *Application) storeTelemetry(m *nats.Msg) error {
	var telemetry devices.Telemetry
	if e := storage.Decode(m.Data, &telemetry); e != nil {
		return permanent(e)
	}
	unlock := a.lockDevice(telemetry.Definition.DeviceUUID)
	defer unlock()
	a.mu.Lock()
	definition, enabled := a.definitions[telemetry.Definition.DeviceUUID]
	generation := a.appliedGeneration[telemetry.Definition.DeviceUUID]
	a.mu.Unlock()
	if !enabled || telemetry.Generation != generation || definition.ConfigurationUUID != telemetry.Definition.ConfigurationUUID {
		a.captureManager().Stored(telemetry.CaptureID, telemetry.Definition.DeviceUUID, "discarded", "Configuration changed before persistence.")
		return nil
	}
	stored, e := a.Store.PersistResult(a.ctx, telemetry)
	if e != nil {
		a.captureManager().Stored(telemetry.CaptureID, telemetry.Definition.DeviceUUID, "storage_retry", "Storage failed; durable delivery will retry.")
		return e
	}
	if stored {
		a.captureManager().Stored(telemetry.CaptureID, telemetry.Definition.DeviceUUID, "stored", "")
	} else {
		a.captureManager().Stored(telemetry.CaptureID, telemetry.Definition.DeviceUUID, "discarded", "Storage did not accept this generation or an empty reading batch.")
	}
	a.observe(telemetry)
	return nil
}
