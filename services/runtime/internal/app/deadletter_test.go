package app

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

func TestRetryDelayBacksOffToAMinute(t *testing.T) {
	for delivered, want := range map[uint64]time.Duration{0: 3 * time.Second, 1: 3 * time.Second, 2: 6 * time.Second, 3: 12 * time.Second, 5: 48 * time.Second, 6: time.Minute, 1000: time.Minute} {
		if got := retryDelay(delivered); got != want {
			t.Errorf("retryDelay(%d) = %s, want %s", delivered, got, want)
		}
	}
}

func TestOnlyUnfixableFailuresArePermanent(t *testing.T) {
	permanentErrors := []error{
		permanent(errors.New("invalid character")),
		fmt.Errorf("deploy: %w", storage.ErrRejected),
		&controlStatusError{Method: "POST", Path: "/events", Status: 400},
		&controlStatusError{Method: "POST", Path: "/events", Status: 409},
		fmt.Errorf("wrapped: %w", &controlStatusError{Method: "POST", Path: "/events", Status: 422}),
	}
	for _, err := range permanentErrors {
		if !isPermanent(err) {
			t.Errorf("%v should be dead-lettered", err)
		}
	}
	transient := []error{
		errors.New("database unavailable"),
		fmt.Errorf("control-plane connection failed: %w", errors.New("connection refused")),
	}
	for _, status := range []int{401, 403, 404, 408, 425, 429, 500, 502, 503} {
		transient = append(transient, &controlStatusError{Method: "POST", Path: "/events", Status: status})
	}
	for _, err := range transient {
		if isPermanent(err) {
			t.Errorf("%v should be retried", err)
		}
	}
	if permanent(nil) != nil {
		t.Error("permanent(nil) must stay nil")
	}
}

func TestSettleDeadLettersPermanentFailuresAndKeepsOrder(t *testing.T) {
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
	a := &Application{JS: js, NATS: nc, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err = a.ensureDeadLetterStream(); err != nil {
		t.Fatal(err)
	}
	name := "SETTLE_TEST_" + nats.NewInbox()[7:]
	consumer := "settle-test-" + nats.NewInbox()[7:]
	if _, err = js.AddStream(&nats.StreamConfig{Name: name, Subjects: []string{name}, Storage: nats.MemoryStorage}); err != nil {
		t.Fatal(err)
	}
	defer js.DeleteStream(name)
	defer js.PurgeStream(DeadLetterStream, &nats.StreamPurgeRequest{Subject: deadLetterSubject + consumer})

	var mu sync.Mutex
	handled := []string{}
	done := make(chan struct{})
	sub, err := js.Subscribe(name, func(m *nats.Msg) {
		var failure error
		switch payload := string(m.Data); {
		case payload == "poison":
			failure = permanent(errors.New("undecodable payload"))
		case payload == "flaky" && deliveries(m) == 1:
			failure = errors.New("control plane unavailable")
		default:
			mu.Lock()
			handled = append(handled, payload)
			if payload == "last" {
				close(done)
			}
			mu.Unlock()
		}
		a.settle(consumer, m, failure)
	}, nats.Durable(consumer), nats.ManualAck(), nats.AckExplicit(), nats.MaxAckPending(1), nats.DeliverAll())
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Unsubscribe()
	for _, payload := range []string{"first", "poison", "flaky", "last"} {
		if _, err = js.Publish(name, []byte(payload)); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("consumer stayed blocked behind a failing message")
	}
	mu.Lock()
	if fmt.Sprint(handled) != "[first flaky last]" {
		t.Fatalf("handled %v, want transient retry in order and the poison message skipped", handled)
	}
	mu.Unlock()

	letters, err := js.SubscribeSync(deadLetterSubject+consumer, nats.BindStream(DeadLetterStream), nats.DeliverAll())
	if err != nil {
		t.Fatal(err)
	}
	defer letters.Unsubscribe()
	letter, err := letters.NextMsg(5 * time.Second)
	if err != nil {
		t.Fatal("poison message was not dead-lettered", err)
	}
	if string(letter.Data) != "poison" || letter.Header.Get("Iot-Original-Subject") != name || letter.Header.Get("Iot-Consumer") != consumer ||
		letter.Header.Get("Iot-Stream") != name || letter.Header.Get("Iot-Stream-Sequence") != "2" || letter.Header.Get("Iot-Error") != "undecodable payload" {
		t.Fatalf("dead letter lost its context: %q %v", letter.Data, letter.Header)
	}
	if extra, err := letters.NextMsg(500 * time.Millisecond); err == nil {
		t.Fatalf("unexpected extra dead letter %q", extra.Data)
	}
	if a.deadLetters.Load() != 1 {
		t.Fatalf("dead-letter count %d, want 1", a.deadLetters.Load())
	}
}
