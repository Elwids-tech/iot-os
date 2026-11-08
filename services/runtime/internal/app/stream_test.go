package app

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

const streamTestToken = "stream-test-token-stream-test-token"

// sseFrame is one parsed server-sent event, or a comment (Event == "").
type sseFrame struct {
	Event, ID, Data, Comment string
}

// sseReader reads frames from a live response body with a deadline per frame.
type sseReader struct {
	frames chan sseFrame
	done   chan struct{}
}

func readSSE(body io.ReadCloser) *sseReader {
	reader := &sseReader{frames: make(chan sseFrame, 64), done: make(chan struct{})}
	go func() {
		defer close(reader.done)
		scanner := bufio.NewScanner(body)
		scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
		frame := sseFrame{}
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case line == "":
				if frame != (sseFrame{}) {
					reader.frames <- frame
					frame = sseFrame{}
				}
			case strings.HasPrefix(line, ": "):
				frame.Comment = strings.TrimPrefix(line, ": ")
			case strings.HasPrefix(line, "event: "):
				frame.Event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "id: "):
				frame.ID = strings.TrimPrefix(line, "id: ")
			case strings.HasPrefix(line, "data: "):
				frame.Data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return reader
}

func (r *sseReader) next(t *testing.T, within time.Duration) sseFrame {
	t.Helper()
	select {
	case frame := <-r.frames:
		return frame
	case <-r.done:
		t.Fatal("the stream ended before the expected frame")
	case <-time.After(within):
		t.Fatal("no frame within " + within.String())
	}
	return sseFrame{}
}

func (r *sseReader) ended(t *testing.T, within time.Duration) {
	t.Helper()
	select {
	case <-r.done:
	case <-time.After(within):
		t.Fatal("the stream did not end within " + within.String())
	}
}

func (r *sseReader) quiet(t *testing.T, during time.Duration) {
	t.Helper()
	select {
	case frame := <-r.frames:
		t.Fatalf("unexpected frame %+v", frame)
	case <-r.done:
		t.Fatal("the stream ended unexpectedly")
	case <-time.After(during):
	}
}

func openStream(t *testing.T, server *httptest.Server, token, query string) (*http.Response, *sseReader) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/internal/telemetry/stream?"+query, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	if response.StatusCode != 200 {
		return response, nil
	}
	return response, readSSE(response.Body)
}

func streamServer(t *testing.T, a *Application) *httptest.Server {
	t.Helper()
	a.Control = &ControlClient{Token: streamTestToken}
	server := httptest.NewServer(a.Handler())
	t.Cleanup(server.Close)
	return server
}

// persistStreamEvents stores n telemetry packets for the device and returns their
// outbox sequences in storage order.
func persistStreamEvents(t *testing.T, a *Application, d devices.Definition, n int) []int64 {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	for i := 0; i < n; i++ {
		if err := a.Store.Persist(ctx, devices.Telemetry{UUID: storage.UUID(), Definition: d, Generation: 1, Readings: []devices.Reading{{ParameterUUID: storage.UUID(), Key: "flow", DataType: "number", Value: i, Quality: "good", ObservedAt: now, ReceivedAt: now}}}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := a.Store.CommittedAfter(ctx, d.OrganizationUUID, []string{d.DeviceUUID}, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	sequences := make([]int64, 0, len(rows))
	for _, row := range rows {
		sequences = append(sequences, row.Sequence)
	}
	return sequences
}

func liveEvent(org, device string, sequence int64) StreamEvent {
	reading := devices.ProjectStream(devices.CommittedTelemetry{EventID: storage.UUID(), DeviceUUID: device, ConfigurationUUID: storage.UUID(), Generation: 1, Readings: []devices.CommittedReading{{ParameterUUID: storage.UUID(), Key: "flow", DataType: "number", Value: 1, Quality: "good", ObservedAt: time.Now().UTC(), ReceivedAt: time.Now().UTC()}}}, sequence)
	return StreamEvent{Organization: org, Device: device, Sequence: sequence, Reading: reading}
}

// Without the control token the stream is refused; a malformed request is 400 before
// storage is touched (no store is configured here).
func TestTelemetryStreamRefusesUnauthenticatedAndMalformedRequests(t *testing.T) {
	server := streamServer(t, &Application{})
	org, device := storage.UUID(), storage.UUID()
	if response, _ := openStream(t, server, "", "organization="+org+"&devices="+device); response.StatusCode != 401 {
		t.Fatalf("expected 401 without the token, got %d", response.StatusCode)
	}
	many := make([]string, 1001)
	for i := range many {
		many[i] = storage.UUID()
	}
	for name, query := range map[string]string{
		"no organization":   "devices=" + device,
		"no devices":        "organization=" + org,
		"not a uuid":        "organization=" + org + "&devices=meter-001",
		"a repeat":          "organization=" + org + "&devices=" + device + "," + device,
		"1001 devices":      "organization=" + org + "&devices=" + strings.Join(many, ","),
		"a leading zero":    "organization=" + org + "&devices=" + device + "&after=042",
		"a negative after":  "organization=" + org + "&devices=" + device + "&after=-1",
		"too large a value": "organization=" + org + "&devices=" + device + "&after=99999999999999999999",
	} {
		if response, _ := openStream(t, server, streamTestToken, query); response.StatusCode != 400 {
			t.Fatalf("%s: expected 400, got %d", name, response.StatusCode)
		}
	}
}

// A fresh stream opens at the organization's head and then carries only live events of
// its devices; an organization with nothing retained opens at 0.
func TestTelemetryStreamFreshOpensAtTheHeadAndFollowsLiveEvents(t *testing.T) {
	a := driftApplication(t)
	server := streamServer(t, a)
	org := storage.UUID()
	pump := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: org, ConfigurationUUID: storage.UUID()}
	other := storage.UUID()
	t.Cleanup(func() { purgeDevice(t, a.Store, pump.DeviceUUID) })
	if err := a.Store.Apply(a.ctx, pump, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	sequences := persistStreamEvents(t, a, pump, 2)
	head := sequences[len(sequences)-1]

	response, stream := openStream(t, server, streamTestToken, "organization="+org+"&devices="+pump.DeviceUUID+","+other)
	if ct := response.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("stream headers: %v", response.Header)
	}
	open := stream.next(t, 2*time.Second)
	var opened devices.StreamOpen
	if err := json.Unmarshal([]byte(open.Data), &opened); err != nil || open.Event != "open" || open.ID != "" || opened.SchemaVersion != "telemetry-stream-open.v1" || opened.Position != strconv.FormatInt(head, 10) || opened.Devices != 2 || opened.OpenedAt.IsZero() {
		t.Fatalf("open frame: %+v (%v)", open, err)
	}
	if a.streamsOpen.Load() != 1 {
		t.Fatalf("one stream open, got %d", a.streamsOpen.Load())
	}
	// Retained events are not replayed on a fresh stream; a live event at or below the
	// head is covered by the snapshot the client takes; later ones arrive, in order,
	// for this organization's named devices only.
	a.broadcaster.Publish([]StreamEvent{liveEvent(org, pump.DeviceUUID, head), liveEvent(storage.UUID(), pump.DeviceUUID, head+5), liveEvent(org, storage.UUID(), head+6), liveEvent(org, pump.DeviceUUID, head+7), liveEvent(org, other, head+8)})
	for _, want := range []int64{head + 7, head + 8} {
		frame := stream.next(t, 2*time.Second)
		var reading devices.StreamReading
		if err := json.Unmarshal([]byte(frame.Data), &reading); err != nil || frame.Event != "reading" || frame.ID != strconv.FormatInt(want, 10) || reading.Position != frame.ID || reading.SchemaVersion != "telemetry-stream.v1" {
			t.Fatalf("expected reading %d, got %+v (%v)", want, frame, err)
		}
	}
	stream.quiet(t, 100*time.Millisecond)
	response.Body.Close()
	deadline := time.Now().Add(2 * time.Second)
	for a.streamsOpen.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if a.streamsOpen.Load() != 0 || a.broadcaster.Subscribers() != 0 {
		t.Fatalf("the stream must release its slot when the client leaves: %d open, %d subscribers", a.streamsOpen.Load(), a.broadcaster.Subscribers())
	}

	// An organization with nothing retained opens at 0 and follows live events.
	empty := storage.UUID()
	_, stream = openStream(t, server, streamTestToken, "organization="+empty+"&devices="+pump.DeviceUUID)
	if open := stream.next(t, 2*time.Second); open.Event != "open" || !strings.Contains(open.Data, `"position":"0"`) {
		t.Fatalf("expected open at 0, got %+v", open)
	}
	a.broadcaster.Publish([]StreamEvent{liveEvent(empty, pump.DeviceUUID, 1)})
	if frame := stream.next(t, 2*time.Second); frame.Event != "reading" || frame.ID != "1" {
		t.Fatalf("expected the first live reading, got %+v", frame)
	}
}

// A resumed stream replays the retained events after the position, in order, then
// joins the live feed without repeating what it replayed; a position older than the
// retained floor is answered with reset and nothing else.
func TestTelemetryStreamResumesFromAPositionAndResetsBelowTheFloor(t *testing.T) {
	a := driftApplication(t)
	server := streamServer(t, a)
	org := storage.UUID()
	pump := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: org, ConfigurationUUID: storage.UUID()}
	valve := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: org, ConfigurationUUID: storage.UUID()}
	t.Cleanup(func() {
		purgeDevice(t, a.Store, pump.DeviceUUID)
		purgeDevice(t, a.Store, valve.DeviceUUID)
	})
	for _, d := range []devices.Definition{pump, valve} {
		if err := a.Store.Apply(a.ctx, d, 1, "device.applied.v1"); err != nil {
			t.Fatal(err)
		}
	}
	pumpRows := persistStreamEvents(t, a, pump, 3)
	valveRows := persistStreamEvents(t, a, valve, 1)
	streamPage = 2 // exercise paging with few rows
	t.Cleanup(func() { streamPage = 500 })

	// Resume after the pump's first row, for the pump only: its two later rows come
	// first, the valve's row never, then live events above the join.
	_, stream := openStream(t, server, streamTestToken, "organization="+org+"&devices="+pump.DeviceUUID+"&after="+strconv.FormatInt(pumpRows[0], 10))
	if open := stream.next(t, 2*time.Second); open.Event != "open" || !strings.Contains(open.Data, `"position":"`+strconv.FormatInt(pumpRows[0], 10)+`"`) || !strings.Contains(open.Data, `"devices":1`) {
		t.Fatalf("open must carry the resume position: %+v", open)
	}
	for _, want := range pumpRows[1:] {
		frame := stream.next(t, 2*time.Second)
		var reading devices.StreamReading
		if err := json.Unmarshal([]byte(frame.Data), &reading); err != nil || frame.Event != "reading" || frame.ID != strconv.FormatInt(want, 10) || reading.DeviceUUID != pump.DeviceUUID || len(reading.Readings) != 1 {
			t.Fatalf("expected catch-up reading %d, got %+v (%v)", want, frame, err)
		}
	}
	last := pumpRows[len(pumpRows)-1]
	// A live event catch-up already wrote is dropped; a newer one arrives.
	a.broadcaster.Publish([]StreamEvent{liveEvent(org, pump.DeviceUUID, last), liveEvent(org, pump.DeviceUUID, last+1)})
	if frame := stream.next(t, 2*time.Second); frame.Event != "reading" || frame.ID != strconv.FormatInt(last+1, 10) {
		t.Fatalf("expected the live reading after the join, got %+v", frame)
	}
	stream.quiet(t, 100*time.Millisecond)

	// A position below the floor: reset with the head, then the stream ends.
	floor := pumpRows[0]
	if valveRows[0] < floor {
		floor = valveRows[0]
	}
	head := valveRows[0]
	if last > head {
		head = last
	}
	_, stream = openStream(t, server, streamTestToken, "organization="+org+"&devices="+pump.DeviceUUID+"&after="+strconv.FormatInt(floor-1, 10))
	reset := stream.next(t, 2*time.Second)
	var resetEvent devices.StreamReset
	if err := json.Unmarshal([]byte(reset.Data), &resetEvent); err != nil || reset.Event != "reset" || reset.ID != "" || resetEvent.SchemaVersion != "telemetry-stream-reset.v1" || resetEvent.Position != strconv.FormatInt(head, 10) {
		t.Fatalf("reset frame: %+v (%v)", reset, err)
	}
	stream.ended(t, 2*time.Second)

	// Resuming exactly at the floor is honoured: everything after it is replayed.
	_, stream = openStream(t, server, streamTestToken, "organization="+org+"&devices="+pump.DeviceUUID+","+valve.DeviceUUID+"&after="+strconv.FormatInt(floor, 10))
	if open := stream.next(t, 2*time.Second); open.Event != "open" {
		t.Fatalf("expected open, got %+v", open)
	}
	count := 0
	for {
		select {
		case frame := <-stream.frames:
			if frame.Event == "reading" {
				count++
			}
			continue
		case <-time.After(300 * time.Millisecond):
		}
		break
	}
	if count != 3 {
		t.Fatalf("expected the three rows after the floor, got %d", count)
	}
}

// A device that stops producing keeps its stream open with keepalive comments; the
// stream ends when the application stops, and when its subscriber falls behind.
func TestTelemetryStreamKeepsAliveAndEndsOnShutdownOrWhenBehind(t *testing.T) {
	a := driftApplication(t)
	ctx, stop := context.WithCancel(a.ctx)
	a.ctx = ctx
	t.Cleanup(stop)
	server := streamServer(t, a)
	streamKeepalive = 100 * time.Millisecond
	t.Cleanup(func() { streamKeepalive = 60 * time.Second })
	org, device := storage.UUID(), storage.UUID()

	_, stream := openStream(t, server, streamTestToken, "organization="+org+"&devices="+device)
	if open := stream.next(t, 2*time.Second); open.Event != "open" {
		t.Fatalf("expected open, got %+v", open)
	}
	for i := 0; i < 2; i++ {
		if frame := stream.next(t, 2*time.Second); frame.Comment != "keepalive" || frame.Event != "" {
			t.Fatalf("expected a keepalive comment, got %+v", frame)
		}
	}

	// A subscriber that falls behind is closed by the broadcaster and its stream ends.
	streamBuffer = 1
	t.Cleanup(func() { streamBuffer = 1000 })
	_, behind := openStream(t, server, streamTestToken, "organization="+org+"&devices="+device)
	if open := behind.next(t, 2*time.Second); open.Event != "open" {
		t.Fatalf("expected open, got %+v", open)
	}
	for a.broadcaster.Subscribers() < 2 {
		time.Sleep(5 * time.Millisecond)
	}
	// Published under one lock, so the handler cannot drain between the two.
	a.broadcaster.Publish([]StreamEvent{liveEvent(org, device, 1), liveEvent(org, device, 2), liveEvent(org, device, 3)})
	behind.ended(t, 2*time.Second)
	if a.broadcaster.Dropped() == 0 {
		t.Fatal("the dropped subscriber must be counted")
	}

	// Stopping the application ends every stream it serves.
	stop()
	stream.ended(t, 2*time.Second)
}
