package app

import (
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

func TestStreamCapacityBounds(t *testing.T) {
	for _, value := range []string{"-1", "0", "1024", "12GB", "1099511627777"} {
		t.Setenv("TEST_STREAM_BYTES", value)
		if _, err := streamCapacity("TEST_STREAM_BYTES", 1<<20); err == nil {
			t.Fatalf("accepted invalid capacity %q", value)
		}
	}
	t.Setenv("TEST_STREAM_BYTES", "12884901888")
	if n, err := streamCapacity("TEST_STREAM_BYTES", 1<<20); err != nil || n != 12<<30 {
		t.Fatal(n, err)
	}
	t.Setenv("TEST_STREAM_BYTES", "")
	if n, err := streamCapacity("TEST_STREAM_BYTES", 1<<20); err != nil || n != 1<<20 {
		t.Fatal(n, err)
	}
}

func TestStreamCapacityExpansionPreservesMessages(t *testing.T) {
	url := os.Getenv("DEVICE_TEST_NATS_URL")
	if url == "" {
		t.Skip("Requires isolated test broker")
	}
	nc, err := nats.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	js, err := nc.JetStream()
	if err != nil {
		t.Fatal(err)
	}
	name := "CAPACITY_TEST_" + nats.NewInbox()[7:]
	cfg := &nats.StreamConfig{Name: name, Subjects: []string{name}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, MaxAge: 7 * 24 * time.Hour, MaxBytes: 1 << 20, Discard: nats.DiscardNew}
	a := &Application{JS: js}
	if err = a.ensureStream(cfg); err != nil {
		t.Fatal(err)
	}
	defer js.DeleteStream(name)
	if _, err = js.Publish(name, []byte("retain this message")); err != nil {
		t.Fatal(err)
	}
	cfg.MaxBytes = 2 << 20
	if err = a.ensureStream(cfg); err != nil {
		t.Fatal(err)
	}
	info, err := js.StreamInfo(name)
	if err != nil || info.State.Msgs != 1 || info.Config.MaxBytes != 2<<20 || info.Config.Compression != nats.S2Compression {
		t.Fatal(info, err)
	}
	cfg.MaxBytes = 1 << 20
	if err = a.ensureStream(cfg); err != nil {
		t.Fatal(err)
	}
	info, err = js.StreamInfo(name)
	if err != nil || info.State.Msgs != 1 || info.Config.MaxBytes != 2<<20 {
		t.Fatal("capacity was reduced", info, err)
	}
	cfg.Discard = nats.DiscardOld
	if err = a.ensureStream(cfg); err == nil {
		t.Fatal("accepted incompatible discard policy")
	}
}

func TestEnsureStreamLeavesAnExistingStreamsEncoding(t *testing.T) {
	url := os.Getenv("DEVICE_TEST_NATS_URL")
	if url == "" {
		t.Skip("Requires isolated test broker")
	}
	nc, err := nats.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	js, err := nc.JetStream()
	if err != nil {
		t.Fatal(err)
	}
	name := "ENCODING_TEST_" + nats.NewInbox()[7:]
	cfg := &nats.StreamConfig{Name: name, Subjects: []string{name}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, MaxAge: 7 * 24 * time.Hour, MaxBytes: 1 << 20, Discard: nats.DiscardNew}
	// A stream created before compression, holding a message.
	if _, err = js.AddStream(cfg); err != nil {
		t.Fatal(err)
	}
	defer js.DeleteStream(name)
	if _, err = js.Publish(name, []byte("retain this message")); err != nil {
		t.Fatal(err)
	}
	a := &Application{JS: js}
	if err = a.ensureStream(cfg); err != nil {
		t.Fatal(err)
	}
	info, err := js.StreamInfo(name)
	if err != nil || info.Config.Compression != nats.NoCompression || info.State.Msgs != 1 {
		t.Fatal("existing stream was changed", info, err)
	}
}
