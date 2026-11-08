package app

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// The internal telemetry stream (spec 030, research R3):
// GET /internal/telemetry/stream?organization=<uuid>&devices=<uuid>,<uuid>&after=<position>
// answers server-sent events: `open`, then `reading` frames (catch-up from the committed
// outbox when `after` is given, then live events from the broadcaster), `reset` when
// the position is no longer retained, and `: keepalive` comments while nothing happens.
// Laravel resolves the grant and relays the frames; the runtime never decides a grant.

var (
	// streamBuffer is how many live events a stream may fall behind by before the
	// broadcaster closes it and the client resumes with catch-up.
	streamBuffer = 1000
	// streamPage is how many outbox rows one catch-up query returns.
	streamPage = 500
	// streamKeepalive is the silence after which a keepalive comment is written.
	streamKeepalive = 60 * time.Second
	// streamMaxDevices matches the connectivity endpoint's ceiling.
	streamMaxDevices = 1000
)

var positionShape = regexp.MustCompile(`^(0|[1-9][0-9]{0,19})$`)

// telemetryStreamHTTP serves one stream until the client, the application or the
// broadcaster ends it. The server's write deadline is lifted for this handler only.
func (a *Application) telemetryStreamHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	org := q.Get("organization")
	ids, devicesOK := streamDevices(q)
	after, resume, afterOK := streamAfter(q.Get("after"))
	if !uuidShape.MatchString(org) || !devicesOK || !afterOK {
		respond(w, 400, map[string]string{"message": "invalid stream request: organization, 1 to 1000 distinct devices and an optional position"})
		return
	}
	ctx := r.Context()
	position := after
	if resume {
		floor, hasFloor, err := a.Store.CommittedFloor(ctx, org)
		if err != nil {
			respond(w, 503, map[string]string{"message": "telemetry storage is unavailable"})
			return
		}
		if hasFloor && after < floor {
			head, err := a.Store.CommittedHead(ctx, org)
			if err != nil {
				respond(w, 503, map[string]string{"message": "telemetry storage is unavailable"})
				return
			}
			// The position is older than anything retained: the client takes a new
			// snapshot and reconnects from the head. Nothing else is sent.
			sse := newSSEWriter(w)
			_ = sse.event("reset", "", devices.NewStreamReset(strconv.FormatInt(head, 10)))
			return
		}
	} else {
		head, err := a.Store.CommittedHead(ctx, org)
		if err != nil {
			respond(w, 503, map[string]string{"message": "telemetry storage is unavailable"})
			return
		}
		position = head
	}

	deviceSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		deviceSet[id] = struct{}{}
	}
	// Subscribe before catching up, so no event falls between the last page and the
	// first live frame; the join below drops what catch-up already wrote.
	live, cancel := a.broadcaster.Subscribe(org, deviceSet, streamBuffer)
	defer cancel()
	a.streamsOpen.Add(1)
	defer a.streamsOpen.Add(-1)
	logger := a.log().With("organization", org, "devices", len(ids), "resume", resume)
	logger.Info("telemetry stream opened")
	defer logger.Info("telemetry stream closed")

	sse := newSSEWriter(w)
	if sse.event("open", "", devices.NewStreamOpen(strconv.FormatInt(position, 10), len(ids), time.Now().UTC())) != nil {
		return
	}
	last := position
	if resume {
		for {
			rows, err := a.Store.CommittedAfter(ctx, org, ids, last, streamPage)
			if err != nil {
				// The connection drops; Laravel reports runtime_unavailable and the
				// client resumes from the last position it received.
				logger.Warn("telemetry stream catch-up failed", "error", err)
				return
			}
			for _, row := range rows {
				if sse.event("reading", row.Event.Sequence, devices.ProjectStream(row.Event, row.Sequence)) != nil {
					return
				}
				last = row.Sequence
			}
			if len(rows) < streamPage {
				break
			}
		}
	}
	// The join: a live event catch-up already wrote (or that the client already holds,
	// for a fresh stream the snapshot covers) is dropped. The bound stays where catch-up
	// ended, so a row committed late and published out of order afterwards is still
	// delivered rather than lost.
	joined := last
	keepalive := time.NewTimer(streamKeepalive)
	defer keepalive.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopping():
			return
		case event, open := <-live:
			if !open {
				logger.Warn("telemetry stream fell behind and was closed")
				return
			}
			if event.Sequence <= joined {
				continue
			}
			if sse.event("reading", event.Reading.Position, event.Reading) != nil {
				return
			}
			keepalive.Reset(streamKeepalive)
		case <-keepalive.C:
			if sse.comment("keepalive") != nil {
				return
			}
			keepalive.Reset(streamKeepalive)
		}
	}
}

// streamDevices reads `devices` as a comma list, repeated, or as `devices[]`: 1 to
// 1000 distinct UUIDs.
func streamDevices(q url.Values) ([]string, bool) {
	ids := []string{}
	seen := map[string]bool{}
	for _, key := range []string{"devices", "devices[]"} {
		for _, raw := range q[key] {
			for _, id := range strings.Split(raw, ",") {
				id = strings.TrimSpace(id)
				if id == "" {
					continue
				}
				if seen[id] || !uuidShape.MatchString(id) {
					return nil, false
				}
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids, len(ids) >= 1 && len(ids) <= streamMaxDevices
}

// streamAfter parses the optional resume position: absent means a fresh stream.
func streamAfter(raw string) (after int64, resume bool, ok bool) {
	if raw == "" {
		return 0, false, true
	}
	if !positionShape.MatchString(raw) {
		return 0, false, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false, false
	}
	return value, true, true
}

// stopping is the application context's done channel; nil (blocking forever) when
// the application was built without one, as unit tests build it.
func (a *Application) stopping() <-chan struct{} {
	if a.ctx == nil {
		return nil
	}
	return a.ctx.Done()
}

// log is the application's logger, or the default one when none was configured.
func (a *Application) log() *slog.Logger {
	if a.Logger == nil {
		return slog.Default()
	}
	return a.Logger
}

// sseWriter writes server-sent event frames and flushes each one to the client.
type sseWriter struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func newSSEWriter(w http.ResponseWriter) *sseWriter {
	rc := http.NewResponseController(w)
	// The server's 10-second write deadline would end a stream; this handler lifts it.
	_ = rc.SetWriteDeadline(time.Time{})
	header := w.Header()
	header.Set("Content-Type", "text/event-stream; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	s := &sseWriter{w: w, rc: rc}
	_ = s.flush()
	return s
}

func (s *sseWriter) flush() error {
	if err := s.rc.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	return nil
}

func (s *sseWriter) write(frame string) error {
	if _, err := io.WriteString(s.w, frame); err != nil {
		return err
	}
	return s.flush()
}

// event writes `event:`, an optional `id:`, one `data:` line of JSON and a blank line.
func (s *sseWriter) event(name, id string, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	var frame strings.Builder
	frame.WriteString("event: " + name + "\n")
	if id != "" {
		frame.WriteString("id: " + id + "\n")
	}
	frame.WriteString("data: ")
	frame.Write(raw)
	frame.WriteString("\n\n")
	return s.write(frame.String())
}

func (s *sseWriter) comment(text string) error {
	return s.write(": " + text + "\n\n")
}
