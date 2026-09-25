package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/committedconsumer"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

func TestCommittedPublicationRecovery(t *testing.T) {
	db, broker := os.Getenv("DEVICE_TEST_DATABASE_URL"), os.Getenv("DEVICE_TEST_NATS_URL")
	if db == "" || broker == "" {
		t.Skip("Requires isolated Devices database and broker")
	}
	if !strings.Contains(db, "/iot_devices_test?") {
		t.Fatal("Refusing non-test database")
	}
	ctx := context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	store, err := storage.Open(ctx, db)
	must(err)
	defer store.Pool.Close()
	nc, err := nats.Connect(broker)
	must(err)
	defer nc.Close()
	js, err := nc.JetStream()
	must(err)
	// Never delete a pre-existing stream, even if the caller supplied the wrong broker.
	if _, err = js.StreamInfo(devices.CommittedTelemetryStream); err != nats.ErrStreamNotFound {
		t.Fatal("requires a fresh disposable committed stream", err)
	}
	a := &Application{Store: store, JS: js, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	must(a.ensureCommittedStream())
	defer js.DeleteStream(devices.CommittedTelemetryStream)
	info, err := js.StreamInfo(devices.CommittedTelemetryStream)
	must(err)
	cfg := info.Config
	cfg.Duplicates = 100 * time.Millisecond
	_, err = js.UpdateStream(&cfg)
	must(err)
	// Subscribe to legacy subjects: committed publication must never reach either.
	legacy, err := nc.SubscribeSync("iot.runtime.>")
	must(err)
	defer legacy.Unsubscribe()
	ingress, err := nc.SubscribeSync("iot.telemetry.>")
	must(err)
	defer ingress.Unsubscribe()
	must(nc.Flush())
	org := storage.UUID()
	defer func() {
		for _, table := range []string{"telemetry_outbox", "observations", "diagnostics", "latest", "devices"} {
			_, e := store.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", org)
			must(e)
		}
		_, e := store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1", org)
		must(e)
	}()
	d := devices.Definition{OrganizationUUID: org, DeviceUUID: storage.UUID(), ConfigurationUUID: storage.UUID()}
	must(store.Apply(ctx, d, 1, "device.applied.v1"))
	packet := func() devices.Telemetry {
		now := time.Now().UTC()
		return devices.Telemetry{UUID: storage.UUID(), Definition: d, Generation: 1, Readings: []devices.Reading{{ParameterUUID: storage.UUID(), Key: "value", DataType: "number", Value: 12, Quality: "good", ObservedAt: now, ReceivedAt: now}}}
	}
	first := packet()
	must(store.Persist(ctx, first))
	// An unavailable publisher leaves the database outbox pending.
	closed, err := nats.Connect(broker)
	must(err)
	offline, err := closed.JetStream()
	must(err)
	closed.Close()
	a.JS = offline
	if _, err = a.publishCommittedBatch(ctx); err == nil {
		t.Fatal("expected disconnected publisher failure")
	}
	backlog, err := store.CommittedBacklog(ctx)
	must(err)
	if backlog.Pending != 1 {
		t.Fatal("lost pending event", backlog)
	}
	a.JS = js
	// Publish, then simulate process loss BEFORE the outbox acknowledgement.
	pending, err := store.CommittedPending(ctx)
	must(err)
	if len(pending) != 1 {
		t.Fatal("unexpected pending records", len(pending))
	}
	raw, err := json.Marshal(pending[0])
	must(err)
	m := nats.NewMsg(devices.CommittedTelemetrySubject)
	m.Data = raw
	m.Header.Set(nats.MsgIdHdr, first.UUID)
	_, err = js.PublishMsg(m)
	must(err)
	sub, err := js.PullSubscribe(devices.CommittedTelemetrySubject, "recovery-test", nats.BindStream(devices.CommittedTelemetryStream), nats.ManualAck(), nats.AckExplicit(), nats.AckWait(100*time.Millisecond))
	must(err)
	statePath := filepath.Join(t.TempDir(), "projection.json")
	checkpoint, err := committedconsumer.Open(statePath, "recovery-test", info.Created.Format(time.RFC3339Nano))
	must(err)
	apply := func(message *nats.Msg) bool {
		t.Helper()
		var event devices.CommittedTelemetry
		must(storage.Decode(message.Data, &event))
		metadata, e := message.Metadata()
		must(e)
		fresh, e := checkpoint.Apply(event, metadata.Sequence.Stream)
		must(e)
		return fresh
	}
	messages, err := sub.Fetch(1, nats.MaxWait(time.Second))
	must(err)
	if !apply(messages[0]) {
		t.Fatal("first delivery not applied")
	}
	// Consumer dies after fsync and before ACK. Reopen its independent projection.
	must(checkpoint.Close())
	checkpoint, err = committedconsumer.Open(statePath, "recovery-test", info.Created.Format(time.RFC3339Nano))
	must(err)
	defer func() { checkpoint.Close() }()
	must(messages[0].Nak())
	messages, err = sub.Fetch(1, nats.MaxWait(time.Second))
	must(err)
	if apply(messages[0]) {
		t.Fatal("consumer restart duplicated projection")
	}
	must(messages[0].AckSync())
	// Expire broker deduplication: consumer identity must still handle another delivery.
	time.Sleep(150 * time.Millisecond)
	restarted := &Application{Store: store, JS: js}
	n, err := restarted.publishCommittedBatch(ctx)
	must(err)
	if n != 1 {
		t.Fatal("restart did not publish", n)
	}
	messages, err = sub.Fetch(1, nats.MaxWait(time.Second))
	must(err)
	if apply(messages[0]) {
		t.Fatal("broker redelivery duplicated projection")
	}
	must(messages[0].AckSync())
	if len(checkpoint.State.Events) != 1 {
		t.Fatal("projection count drifted")
	}
	// Full stream rejects new messages; publication resumes once capacity returns.
	info, err = js.StreamInfo(devices.CommittedTelemetryStream)
	must(err)
	cfg = info.Config
	cfg.MaxMsgs = int64(info.State.Msgs)
	_, err = js.UpdateStream(&cfg)
	must(err)
	second := packet()
	must(store.Persist(ctx, second))
	if _, err = restarted.publishCommittedBatch(ctx); err == nil {
		t.Fatal("expected capacity rejection")
	}
	backlog, err = store.CommittedBacklog(ctx)
	must(err)
	if backlog.Pending != 1 {
		t.Fatal("capacity failure dropped outbox")
	}
	cfg.MaxMsgs = -1
	_, err = js.UpdateStream(&cfg)
	must(err)
	n, err = restarted.publishCommittedBatch(ctx)
	must(err)
	if n != 1 {
		t.Fatal("capacity recovery failed")
	}
	messages, err = sub.Fetch(1, nats.MaxWait(time.Second))
	must(err)
	if !apply(messages[0]) {
		t.Fatal("second event missing")
	}
	must(messages[0].AckSync())
	backlog, err = store.CommittedBacklog(ctx)
	must(err)
	if backlog.Pending != 0 {
		t.Fatal("published work remained pending")
	}
	if n, _, err := legacy.Pending(); err != nil || n != 0 {
		t.Fatal("committed event entered runtime inbox", n, err)
	}
	if n, _, err := ingress.Pending(); err != nil || n != 0 {
		t.Fatal("committed event reentered ingestion", n, err)
	}
}
