package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

// controlPlane is the control plane's outbox as the runtime sees it: claims hand out
// the queued batches in turn, and every acknowledgement request is kept.
type controlPlane struct {
	mu      sync.Mutex
	claims  [][]devices.Event
	acks    [][]string
	ackCode int // answers the batch acknowledgement with this status when set
	singles []string
	server  *httptest.Server
}

func newControlPlane(t *testing.T, claims ...[]devices.Event) (*controlPlane, *ControlClient) {
	t.Helper()
	plane := &controlPlane{claims: claims}
	plane.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		plane.mu.Lock()
		defer plane.mu.Unlock()
		switch {
		case r.URL.Path == "/outbox/claim":
			rows := []devices.Event{}
			if len(plane.claims) > 0 {
				rows, plane.claims = plane.claims[0], plane.claims[1:]
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": rows})
		case r.URL.Path == "/outbox/ack":
			if plane.ackCode != 0 {
				w.WriteHeader(plane.ackCode)
				return
			}
			var body struct {
				Rows []acknowledgedRow `json:"rows"`
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			ids, results := []string{}, []map[string]any{}
			for _, row := range body.Rows {
				ids = append(ids, row.UUID)
				results = append(results, map[string]any{"uuid": row.UUID, "acknowledged": row.LeaseToken == "lease-"+row.UUID})
			}
			plane.acks = append(plane.acks, ids)
			_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
		case strings.HasSuffix(r.URL.Path, "/ack"):
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/outbox/"), "/ack")
			plane.singles = append(plane.singles, id)
			if id == "stale" {
				w.WriteHeader(http.StatusConflict)
				return
			}
			_, _ = io.WriteString(w, `{"ok":true}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(plane.server.Close)
	return plane, &ControlClient{URL: plane.server.URL, Token: strings.Repeat("t", 32), Client: plane.server.Client()}
}

func (p *controlPlane) acknowledged() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return fmt.Sprint(p.acks)
}

func row(id string) devices.Event {
	return devices.Event{UUID: id, Type: "connection.changed.v1", Payload: json.RawMessage(`{}`), LeaseToken: "lease-" + id}
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestClaimedRowsApplyInOrderAndARowThatFailsForNowIsRetriedInPlace(t *testing.T) {
	plane, control := newControlPlane(t)
	handled, failures := []string{}, 2
	a := &Application{Control: control, Logger: quiet(), controlRetryDelay: func(uint64) time.Duration { return time.Millisecond }}
	a.applyControl = func(ev devices.Event) error {
		handled = append(handled, ev.UUID)
		if ev.UUID == "second" && failures > 0 {
			failures--
			if a.controlRetrying.Load() != uint64(2-failures-1) {
				t.Errorf("status reports %d attempts before attempt %d", a.controlRetrying.Load(), 2-failures)
			}
			return errors.New("database unavailable")
		}
		return nil
	}
	a.applyClaim(context.Background(), []devices.Event{row("first"), row("second"), row("third")})

	if fmt.Sprint(handled) != "[first second second second third]" {
		t.Fatalf("handled %v: the failing row must be retried before the row behind it", handled)
	}
	// The row applied before the failure is acknowledged without waiting for the retry;
	// the rest of the claim goes in one request.
	if plane.acknowledged() != "[[first] [second third]]" {
		t.Fatalf("acknowledged %s", plane.acknowledged())
	}
	if a.controlRetrying.Load() != 0 {
		t.Fatalf("status still reports a retry after the claim was applied")
	}
}

func TestARowHeldAtShutdownIsLeftUnacknowledged(t *testing.T) {
	plane, control := newControlPlane(t)
	ctx, cancel := context.WithCancel(context.Background())
	handled := []string{}
	a := &Application{Control: control, Logger: quiet(), controlRetryDelay: func(uint64) time.Duration { return time.Hour }}
	a.applyControl = func(ev devices.Event) error {
		handled = append(handled, ev.UUID)
		if ev.UUID == "second" {
			cancel()
			return errors.New("database unavailable")
		}
		return nil
	}
	a.applyClaim(ctx, []devices.Event{row("first"), row("second"), row("third")})
	if fmt.Sprint(handled) != "[first second]" || plane.acknowledged() != "[[first]]" {
		t.Fatalf("handled %v, acknowledged %s: the failing row and the one behind it wait for the next claim", handled, plane.acknowledged())
	}
}

func TestAcknowledgementReportsRowsClaimedAgainAndFallsBackToOneRowAtATime(t *testing.T) {
	plane, control := newControlPlane(t)
	taken := row("taken")
	taken.LeaseToken = "an-earlier-lease"
	stale, err := control.acknowledge(context.Background(), []devices.Event{row("kept"), taken})
	if err != nil || fmt.Sprint(stale) != "[taken]" {
		t.Fatalf("stale %v, error %v", stale, err)
	}

	// A control plane from before ADR-043 has no batch endpoint.
	plane.ackCode = http.StatusNotFound
	stale, err = control.acknowledge(context.Background(), []devices.Event{row("kept"), row("stale")})
	if err != nil || fmt.Sprint(stale) != "[stale]" || fmt.Sprint(plane.singles) != "[kept stale]" {
		t.Fatalf("stale %v, single acknowledgements %v, error %v", stale, plane.singles, err)
	}

	// Anything else is an outage: the rows stay unacknowledged and come back as repeats.
	plane.ackCode = http.StatusServiceUnavailable
	if _, err = control.acknowledge(context.Background(), []devices.Event{row("kept")}); err == nil {
		t.Fatal("a failed acknowledgement must be reported")
	}
}

func testJetStream(t *testing.T) (*nats.Conn, nats.JetStreamContext) {
	t.Helper()
	url := os.Getenv("DEVICE_TEST_NATS_URL")
	if url == "" {
		t.Skip("Requires isolated test broker")
	}
	nc, err := nats.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	js, err := nc.JetStream()
	if err != nil {
		t.Fatal(err)
	}
	return nc, js
}

func TestARowThatCanNeverApplyIsDeadLetteredAndAcknowledged(t *testing.T) {
	nc, js := testJetStream(t)
	plane, control := newControlPlane(t)
	a := &Application{JS: js, NATS: nc, Control: control, Logger: quiet()}
	if err := a.ensureDeadLetterStream(); err != nil {
		t.Fatal(err)
	}
	purge := func() {
		_ = js.PurgeStream(DeadLetterStream, &nats.StreamPurgeRequest{Subject: deadLetterSubject + controlConsumer})
	}
	purge()
	defer purge()
	poison := devices.Event{UUID: storage.UUID(), Type: "device.activate.v9", Payload: json.RawMessage(`{"device_uuid":"d"}`), LeaseToken: "lease"}
	poison.LeaseToken = "lease-" + poison.UUID
	handled := []string{}
	a.applyControl = func(ev devices.Event) error {
		handled = append(handled, ev.UUID)
		if ev.UUID == poison.UUID {
			return permanent(errors.New("unsupported control event device.activate.v9"))
		}
		return nil
	}
	a.applyClaim(context.Background(), []devices.Event{row("first"), poison, row("last")})

	if fmt.Sprint(handled) != fmt.Sprint([]string{"first", poison.UUID, "last"}) || plane.acknowledged() != fmt.Sprint([][]string{{"first", poison.UUID, "last"}}) {
		t.Fatalf("handled %v, acknowledged %s: the poison row is set aside once and the claim goes on", handled, plane.acknowledged())
	}
	letters, err := js.SubscribeSync(deadLetterSubject+controlConsumer, nats.BindStream(DeadLetterStream), nats.DeliverAll())
	if err != nil {
		t.Fatal(err)
	}
	defer letters.Unsubscribe()
	letter, err := letters.NextMsg(5 * time.Second)
	if err != nil {
		t.Fatal("poison row was not dead-lettered", err)
	}
	var kept devices.Event
	if err = json.Unmarshal(letter.Data, &kept); err != nil {
		t.Fatal(err)
	}
	if kept.UUID != poison.UUID || kept.Type != poison.Type || string(kept.Payload) != string(poison.Payload) || kept.LeaseToken != "" ||
		letter.Header.Get("Iot-Consumer") != controlConsumer || letter.Header.Get("Iot-Original-Subject") != "iot.control.device.activate.v9" ||
		letter.Header.Get("Iot-Outbox-Uuid") != poison.UUID || letter.Header.Get("Iot-Error") != "unsupported control event device.activate.v9" {
		t.Fatalf("dead letter lost its context: %s %v", letter.Data, letter.Header)
	}
	if a.deadLetters.Load() != 1 {
		t.Fatalf("dead-letter count %d, want 1", a.deadLetters.Load())
	}
}

// An upgrade finds control messages an earlier runtime published and had not applied.
// They are applied first, a failing one included, and only then is anything claimed.
func TestTheControlStreamOfAnEarlierRuntimeIsAppliedBeforeTheFirstClaim(t *testing.T) {
	nc, js := testJetStream(t)
	_ = js.DeleteStream(controlStream)
	if _, err := js.AddStream(&nats.StreamConfig{Name: controlStream, Subjects: []string{"iot.control.>"}, Storage: nats.MemoryStorage}); err != nil {
		t.Fatal(err)
	}
	defer js.DeleteStream(controlStream)
	plane, control := newControlPlane(t, []devices.Event{row("claimed")})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &Application{ctx: ctx, JS: js, NATS: nc, Control: control, Logger: quiet()}
	if err := a.ensureDeadLetterStream(); err != nil {
		t.Fatal(err)
	}
	if drained, err := a.controlStreamDrained(); err != nil || !drained {
		t.Fatalf("a stream without the consumer has nothing to apply: %v %v", drained, err)
	}

	var mu sync.Mutex
	handled, failed := []string{}, false
	done := make(chan struct{})
	record := func(id string) error {
		mu.Lock()
		defer mu.Unlock()
		if id == "left-1" && !failed {
			failed = true
			return errors.New("database unavailable")
		}
		handled = append(handled, id)
		if id == "claimed" {
			close(done)
		}
		return nil
	}
	a.applyControl = func(ev devices.Event) error { return record(ev.UUID) }
	for _, id := range []string{"left-1", "left-2"} {
		raw, _ := json.Marshal(devices.Event{UUID: id, Type: "connection.changed.v1", Payload: json.RawMessage(`{}`)})
		if _, err := js.Publish("iot.control.connection.changed.v1", raw); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.consume("iot.control.>", controlConsumer, func(m *nats.Msg) error {
		var ev devices.Event
		if e := storage.Decode(m.Data, &ev); e != nil {
			return permanent(e)
		}
		return record(ev.UUID)
	}); err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, sub := range a.subscriptions {
			_ = sub.Unsubscribe()
		}
	}()
	go a.claimControl(ctx)

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("the claim never started")
	}
	mu.Lock()
	defer mu.Unlock()
	if fmt.Sprint(handled) != "[left-1 left-2 claimed]" {
		t.Fatalf("handled %v: the stream's messages come first, in order", handled)
	}
	for deadline := time.Now().Add(5 * time.Second); plane.acknowledged() != "[[claimed]]"; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("acknowledged %s", plane.acknowledged())
		}
	}
}

// A command row applied but not acknowledged is claimed again. The runtime's command
// ledger takes a command once, so the repeat changes nothing and reports nothing.
func TestACommandRowClaimedAgainAfterALostAcknowledgementIsHandledOnce(t *testing.T) {
	a := driftApplication(t)
	a.Logger = quiet()
	example := consumable(t, driftCommand)[0]
	payload := decoded(t, example.Data)
	device, command := payload["device_uuid"].(string), payload["command_uuid"].(string)
	generation, _ := payload["generation"].(json.Number).Int64()
	purgeDevice(t, a.Store, device)
	forget := func() {
		purgeDevice(t, a.Store, device)
		_, _ = a.Store.Pool.Exec(a.ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'command_uuid'=$1", command)
	}
	forget()
	t.Cleanup(forget)
	a.definitions[device] = devices.Definition{DeviceUUID: device, OrganizationUUID: payload["organization_uuid"].(string), ConfigurationUUID: payload["configuration_uuid"].(string)}
	a.generations[device] = int(generation)

	claimed := devices.Event{UUID: storage.UUID(), Type: "device.command.v1", Payload: example.Data}
	claimed.LeaseToken = "lease-" + claimed.UUID
	plane, control := newControlPlane(t)
	a.Control = control
	plane.ackCode = http.StatusServiceUnavailable // the acknowledgement is lost
	a.applyClaim(a.ctx, []devices.Event{claimed})
	plane.mu.Lock()
	plane.ackCode = 0
	plane.mu.Unlock()
	a.applyClaim(a.ctx, []devices.Event{claimed})

	var status string
	var reports int
	if err := a.Store.Pool.QueryRow(a.ctx, "SELECT status FROM device_runtime.commands WHERE command_uuid=$1", command).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Pool.QueryRow(a.ctx, "SELECT count(*) FROM device_runtime.outbox WHERE event->>'type'='command.status.v1' AND event->'payload'->>'command_uuid'=$1", command).Scan(&reports); err != nil {
		t.Fatal(err)
	}
	// The fixture's command expired long ago, so the one time it is taken it times out.
	if status != "timed_out" || reports != 1 || plane.acknowledged() != fmt.Sprint([][]string{{claimed.UUID}}) {
		t.Fatalf("status %s, %d status reports, acknowledged %s: the repeat must change nothing", status, reports, plane.acknowledged())
	}
}
