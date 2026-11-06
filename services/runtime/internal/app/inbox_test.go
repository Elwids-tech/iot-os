package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/nats-io/nats.go"
)

func TestInboxTakesBatchesInArrivalOrderWithinTheirLimits(t *testing.T) {
	q := &inbox{arrived: make(chan struct{}, 1)}
	for i := range 250 {
		q.push(&nats.Msg{Data: []byte(fmt.Sprint(i))})
	}
	sizes := []int{}
	next := 0
	for batch := q.take(); len(batch) > 0; batch = q.take() {
		sizes = append(sizes, len(batch))
		for _, m := range batch {
			if string(m.Data) != fmt.Sprint(next) {
				t.Fatalf("took %s, want %d", m.Data, next)
			}
			next++
		}
	}
	if fmt.Sprint(sizes) != "[100 100 50]" {
		t.Fatalf("batches %v, want at most %d events each", sizes, inboxBatch)
	}

	// A batch stays under 1 MiB, but an event larger than that still goes, on its own.
	for _, size := range []int{600 << 10, 600 << 10, 2 << 20, 10} {
		q.push(&nats.Msg{Data: make([]byte, size)})
	}
	sizes = sizes[:0]
	for batch := q.take(); len(batch) > 0; batch = q.take() {
		sizes = append(sizes, len(batch))
	}
	if fmt.Sprint(sizes) != "[1 1 1 1]" {
		t.Fatalf("batches %v, want each large event alone", sizes)
	}
}

func TestEventsArePostedAsOneBatchWithAnAnswerEach(t *testing.T) {
	var answers string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Events []devices.Event `json:"events"`
		}
		if r.URL.Path != "/events/batch" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("t", 32) || json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Events) != 2 || body.Events[1].UUID != "second" || string(body.Events[1].Payload) != `{"presence":"online"}` {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, answers)
	}))
	defer server.Close()
	control := &ControlClient{URL: server.URL, Token: strings.Repeat("t", 32), Client: server.Client()}
	events := []devices.Event{{UUID: "first", Type: "device.presence.v1", Payload: json.RawMessage(`{}`)}, {UUID: "second", Type: "device.presence.v1", Payload: json.RawMessage(`{"presence":"online"}`)}}

	answers = `{"results":[{"status":200,"ok":true},{"status":422,"message":"The runtime event payload is malformed."}]}`
	results, err := control.postEvents(context.Background(), events)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].err() != nil || !isPermanent(results[1].err()) || !strings.Contains(results[1].err().Error(), "returned 422: The runtime event payload is malformed.") {
		t.Fatalf("answers %v: an accepted event must be acknowledged and a rejected one dead-lettered", results)
	}

	// An answer that does not cover every event is not trusted: the batch goes again.
	answers = `{"results":[{"status":200}]}`
	if _, err = control.postEvents(context.Background(), events); err == nil || isPermanent(err) {
		t.Fatalf("a short answer must be retried, got %v", err)
	}
}

func TestInboxDeliversEventsInOrderAndRetriesABatchInPlace(t *testing.T) {
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
	_ = js.DeleteStream(eventsStream)
	if _, err = js.AddStream(&nats.StreamConfig{Name: eventsStream, Subjects: []string{"iot.runtime.>"}, Storage: nats.MemoryStorage}); err != nil {
		t.Fatal(err)
	}
	defer js.DeleteStream(eventsStream)
	defer js.PurgeStream(DeadLetterStream, &nats.StreamPurgeRequest{Subject: deadLetterSubject + inboxConsumer})
	// The consumer as an earlier runtime left it: one event at a time.
	if _, err = js.AddConsumer(eventsStream, &nats.ConsumerConfig{Durable: inboxConsumer, DeliverSubject: nats.NewInbox(), DeliverPolicy: nats.DeliverAllPolicy, AckPolicy: nats.AckExplicitPolicy, MaxAckPending: 1, FilterSubject: "iot.runtime.>"}); err != nil {
		t.Fatal(err)
	}
	published := []string{}
	for i := range 150 {
		id := fmt.Sprintf("event-%03d", i)
		switch i {
		case 40:
			id = "poison" // the control plane cannot read any batch that holds it
		case 120:
			id = "refused" // the control plane answers it on its own with 409
		}
		raw, _ := json.Marshal(devices.Event{UUID: id, Type: "device.presence.v1", Payload: json.RawMessage(`{}`)})
		if _, err = js.Publish("iot.runtime.device.presence.v1", raw); err != nil {
			t.Fatal(err)
		}
		published = append(published, id)
	}

	var mu sync.Mutex
	posts := [][]string{}
	accepted := []string{}
	failedFirst := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Events []devices.Event `json:"events"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		ids := []string{}
		for _, ev := range body.Events {
			ids = append(ids, ev.UUID)
		}
		mu.Lock()
		defer mu.Unlock()
		posts = append(posts, ids)
		if !failedFirst {
			failedFirst = true
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if slices.Contains(ids, "poison") {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		results := []map[string]any{}
		for _, id := range ids {
			if id == "refused" {
				results = append(results, map[string]any{"status": 409, "message": "stale"})
				continue
			}
			accepted = append(accepted, id)
			results = append(results, map[string]any{"status": 200})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &Application{ctx: ctx, JS: js, NATS: nc, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Control: &ControlClient{URL: server.URL, Client: server.Client()}}
	if err = a.ensureDeadLetterStream(); err != nil {
		t.Fatal(err)
	}
	if err = a.subscribeInbox(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		info, err := js.ConsumerInfo(eventsStream, inboxConsumer)
		if err != nil {
			t.Fatal(err)
		}
		if info.AckFloor.Stream == 150 {
			if info.Config.MaxAckPending != inboxWindow {
				t.Fatalf("max ack pending %d, want the consumer widened to %d", info.Config.MaxAckPending, inboxWindow)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("acknowledged up to %d of 150; posts %v", info.AckFloor.Stream, posts)
		}
		time.Sleep(100 * time.Millisecond)
	}
	cancel()

	mu.Lock()
	defer mu.Unlock()
	want := slices.DeleteFunc(slices.Clone(published), func(id string) bool { return id == "poison" || id == "refused" })
	if !slices.Equal(accepted, want) {
		t.Fatalf("accepted %v,\nwant every other event once, in stream order", accepted)
	}
	if len(posts) < 2 || !slices.Equal(posts[0], posts[1]) {
		t.Fatalf("posts %v: the batch that failed must be sent again before anything after it", posts)
	}
	letters, err := js.SubscribeSync(deadLetterSubject+inboxConsumer, nats.BindStream(DeadLetterStream), nats.DeliverAll())
	if err != nil {
		t.Fatal(err)
	}
	defer letters.Unsubscribe()
	for _, id := range []string{"poison", "refused"} {
		letter, err := letters.NextMsg(5 * time.Second)
		if err != nil {
			t.Fatalf("%s was not dead-lettered: %v", id, err)
		}
		var ev devices.Event
		if json.Unmarshal(letter.Data, &ev) != nil || ev.UUID != id {
			t.Fatalf("dead letter %s, want %s", letter.Data, id)
		}
	}
}
