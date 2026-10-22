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
			var batch struct {
				Data []devices.Event `json:"data"`
			}
			if e := a.Control.request(ctx, "POST", "/outbox/claim", map[string]any{}, &batch); e != nil {
				a.Logger.Debug("control outbox unavailable", "error", e)
			} else {
				for _, ev := range batch.Data {
					raw, e := json.Marshal(ev)
					if e != nil {
						continue
					}
					m := nats.NewMsg("iot.control." + ev.Type)
					m.Data = raw
					m.Header.Set(nats.MsgIdHdr, ev.UUID)
					if _, e = a.JS.PublishMsg(m); e != nil {
						a.Logger.Warn("control event publication failed", "error", e)
						break
					}
					if e = a.Control.request(ctx, "POST", "/outbox/"+ev.UUID+"/ack", map[string]string{"lease_token": ev.LeaseToken}, nil); e != nil {
						a.Logger.Warn("control outbox acknowledgement failed", "error", e)
					}
				}
			}
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
	}{{"IOT_DEVICE_CONTROL", "iot.control.>", "IOT_NATS_CONTROL_MAX_BYTES", 64 << 20}, {"IOT_DEVICE_EVENTS", "iot.runtime.>", "IOT_NATS_EVENTS_MAX_BYTES", 256 << 20}, {"IOT_DEVICE_TELEMETRY", "iot.telemetry.>", "IOT_NATS_TELEMETRY_MAX_BYTES", 768 << 20}} {
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
		{"iot.control.>", "devices-control", func(m *nats.Msg) error {
			var ev devices.Event
			if e := storage.Decode(m.Data, &ev); e != nil {
				return permanent(e)
			}
			return a.handleControl(ev)
		}},
		{"iot.runtime.>", "devices-control-inbox", func(m *nats.Msg) error {
			var ev devices.Event
			if e := storage.Decode(m.Data, &ev); e != nil {
				return permanent(e)
			}
			return a.Control.request(a.ctx, "POST", "/events", ev, nil)
		}},
		{"iot.telemetry.>", "devices-storage", func(m *nats.Msg) error {
			var telemetry devices.Telemetry
			if e := storage.Decode(m.Data, &telemetry); e != nil {
				return permanent(e)
			}
			unlock := a.lockDevice(telemetry.Definition.DeviceUUID)
			defer unlock()
			a.mu.Lock()
			definition, enabled := a.definitions[telemetry.Definition.DeviceUUID]
			generation := a.generations[telemetry.Definition.DeviceUUID]
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
		}},
	}
	for _, h := range handlers {
		handler := h
		sub, e := a.JS.Subscribe(handler.subject, func(m *nats.Msg) {
			a.settle(handler.durable, m, handler.handle(m))
		}, nats.Durable(handler.durable), nats.ManualAck(), nats.AckExplicit(), nats.MaxAckPending(1), nats.DeliverAll())
		if e != nil {
			return e
		}
		a.subscriptions = append(a.subscriptions, sub)
	}
	return nil
}
