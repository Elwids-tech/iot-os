package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

// Runtime events reach the control plane in batches, in stream order (ADR-031).
// The consumer lets inboxWindow events be delivered unacknowledged; one goroutine
// posts whatever has arrived, up to inboxBatch events, and settles every event of a
// batch before it posts the next. A batch the control plane cannot take yet is
// retried in place, so no later event overtakes it, as when events went one at a time.
const (
	eventsStream    = "IOT_DEVICE_EVENTS"
	inboxConsumer   = "devices-control-inbox"
	inboxBatch      = 100
	inboxBatchBytes = 1 << 20
	inboxWindow     = 2 * inboxBatch
	// inboxProgress is how often a held batch tells the broker it is still being worked on,
	// well inside the consumer's 30 s acknowledgement wait.
	inboxProgress = 10 * time.Second
)

// eventResult is the control plane's answer for one event of a batch.
type eventResult struct {
	Status  int    `json:"status"`
	Message string `json:"message"`
}

// err is nil for an accepted event. The control plane answers an event on its own
// only when it will never accept it; anything it would retry fails the whole batch.
func (r eventResult) err() error {
	if r.Status >= 200 && r.Status < 300 {
		return nil
	}
	return permanent(fmt.Errorf("%w: %s", &controlStatusError{Method: "POST", Path: "/events/batch", Status: r.Status}, r.Message))
}

// postEvents sends one batch and returns an answer per event, in order.
func (c *ControlClient) postEvents(ctx context.Context, events []devices.Event) ([]eventResult, error) {
	var response struct {
		Results []eventResult `json:"results"`
	}
	if e := c.request(ctx, "POST", "/events/batch", map[string]any{"events": events}, &response); e != nil {
		return nil, e
	}
	if len(response.Results) != len(events) {
		return nil, fmt.Errorf("control plane answered %d of %d events", len(response.Results), len(events))
	}
	return response.Results, nil
}

// inbox holds the events the broker has delivered and the deliverer has not taken yet.
type inbox struct {
	mu      sync.Mutex
	queued  []*nats.Msg
	arrived chan struct{}
}

func (q *inbox) push(m *nats.Msg) {
	q.mu.Lock()
	q.queued = append(q.queued, m)
	q.mu.Unlock()
	select {
	case q.arrived <- struct{}{}:
	default:
	}
}

// take removes the next batch: at most inboxBatch events and inboxBatchBytes, and at least one.
func (q *inbox) take() []*nats.Msg {
	q.mu.Lock()
	defer q.mu.Unlock()
	n, size := 0, 0
	for n < len(q.queued) && n < inboxBatch && (n == 0 || size+len(q.queued[n].Data) <= inboxBatchBytes) {
		size += len(q.queued[n].Data)
		n++
	}
	batch := append([]*nats.Msg(nil), q.queued[:n]...)
	q.queued = q.queued[n:]
	return batch
}

func (q *inbox) waiting() []*nats.Msg {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]*nats.Msg(nil), q.queued...)
}

func (a *Application) subscribeInbox() error {
	if err := a.widenInbox(); err != nil {
		return err
	}
	q := &inbox{arrived: make(chan struct{}, 1)}
	sub, err := a.JS.Subscribe("iot.runtime.>", q.push, nats.Durable(inboxConsumer), nats.ManualAck(), nats.AckExplicit(), nats.MaxAckPending(inboxWindow), nats.DeliverAll())
	if err != nil {
		return err
	}
	a.subscriptions = append(a.subscriptions, sub)
	go a.deliverInbox(q)
	return nil
}

// widenInbox raises the window of a consumer created when events went one at a time;
// the client refuses to subscribe with a window the consumer does not have.
func (a *Application) widenInbox() error {
	info, err := a.JS.ConsumerInfo(eventsStream, inboxConsumer)
	if errors.Is(err, nats.ErrConsumerNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Config.MaxAckPending == inboxWindow {
		return nil
	}
	config := info.Config
	config.MaxAckPending = inboxWindow
	if _, err = a.JS.UpdateConsumer(eventsStream, &config); err != nil {
		return fmt.Errorf("widen %s to %d unacknowledged events: %w", inboxConsumer, inboxWindow, err)
	}
	a.Logger.Info("event consumer widened for batches", "consumer", inboxConsumer, "max_ack_pending", inboxWindow)
	return nil
}

func (a *Application) deliverInbox(q *inbox) {
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-q.arrived:
		}
		for batch := q.take(); len(batch) > 0 && a.ctx.Err() == nil; batch = q.take() {
			a.deliverBatch(q, batch)
		}
	}
}

// deliverBatch posts one batch and settles each event by its answer.
func (a *Application) deliverBatch(q *inbox, batch []*nats.Msg) {
	messages := make([]*nats.Msg, 0, len(batch))
	events := make([]devices.Event, 0, len(batch))
	for _, m := range batch {
		var ev devices.Event
		if e := storage.Decode(m.Data, &ev); e != nil {
			a.settle(inboxConsumer, m, permanent(e))
			continue
		}
		messages, events = append(messages, m), append(events, ev)
	}
	for attempt := uint64(1); len(events) > 0; attempt++ {
		results, err := a.Control.postEvents(a.ctx, events)
		if err == nil {
			for i, m := range messages {
				a.settle(inboxConsumer, m, results[i].err())
			}
			return
		}
		if isPermanent(err) {
			if len(messages) == 1 {
				a.settle(inboxConsumer, messages[0], err)
				return
			}
			// The control plane refused the batch itself; one event at a time, only the event at fault is set aside.
			for _, m := range messages {
				a.deliverBatch(q, []*nats.Msg{m})
			}
			return
		}
		if attempt%10 == 0 {
			a.Logger.Error("durable consumer blocked by a failing batch", "consumer", inboxConsumer, "events", len(events), "attempts", attempt, "error", err)
		} else {
			a.Logger.Warn("runtime events deferred", "consumer", inboxConsumer, "events", len(events), "attempts", attempt, "error", err)
		}
		if !a.holdInbox(q, messages, retryDelay(attempt)) {
			return // unacknowledged, so the broker delivers them again after a restart
		}
	}
}

// holdInbox waits before a retry, telling the broker that the held batch and the
// events queued behind it are still being worked on, so it does not deliver them again.
func (a *Application) holdInbox(q *inbox, held []*nats.Msg, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	ticker := time.NewTicker(inboxProgress)
	defer ticker.Stop()
	for {
		for _, m := range held {
			_ = m.InProgress()
		}
		for _, m := range q.waiting() {
			_ = m.InProgress()
		}
		select {
		case <-a.ctx.Done():
			return false
		case <-timer.C:
			return true
		case <-ticker.C:
		}
	}
}
