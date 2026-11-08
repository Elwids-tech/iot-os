package app

import (
	"sync"
	"sync/atomic"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// StreamEvent is one committed event as the telemetry stream carries it, with the
// identity the broadcaster filters by (spec 030, research R3).
type StreamEvent struct {
	Organization string
	Device       string
	Sequence     int64
	Reading      devices.StreamReading
}

// committedBroadcaster fans committed events out to the open telemetry streams in
// this process. A subscriber names its organization and device set and receives the
// events of those devices in publication order. A subscriber whose buffer is full is
// closed and counted: its stream ends, and the client resumes from its last position
// with catch-up from the outbox, so nothing is lost and a slow reader never holds the
// relay. The zero value is ready to use.
type committedBroadcaster struct {
	mu          sync.Mutex
	subscribers map[*streamSubscriber]struct{}
	dropped     atomic.Uint64
}

type streamSubscriber struct {
	organization string
	devices      map[string]struct{}
	events       chan StreamEvent
}

// Subscribe registers a subscriber and returns its channel and a cancel function. The
// channel is closed by cancel, or by Publish when the buffer is full.
func (b *committedBroadcaster) Subscribe(organization string, deviceSet map[string]struct{}, buffer int) (<-chan StreamEvent, func()) {
	subscriber := &streamSubscriber{organization: organization, devices: deviceSet, events: make(chan StreamEvent, buffer)}
	b.mu.Lock()
	if b.subscribers == nil {
		b.subscribers = map[*streamSubscriber]struct{}{}
	}
	b.subscribers[subscriber] = struct{}{}
	b.mu.Unlock()
	return subscriber.events, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.remove(subscriber)
	}
}

// remove deletes and closes a subscriber once; the caller holds the lock.
func (b *committedBroadcaster) remove(subscriber *streamSubscriber) {
	if _, present := b.subscribers[subscriber]; !present {
		return
	}
	delete(b.subscribers, subscriber)
	close(subscriber.events)
}

// Publish hands each event to every subscriber of its organization that names its
// device, in order.
func (b *committedBroadcaster) Publish(events []StreamEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, event := range events {
		for subscriber := range b.subscribers {
			if subscriber.organization != event.Organization {
				continue
			}
			if _, named := subscriber.devices[event.Device]; !named {
				continue
			}
			select {
			case subscriber.events <- event:
			default:
				b.remove(subscriber)
				b.dropped.Add(1)
			}
		}
	}
}

// Subscribers is the number of open subscriptions.
func (b *committedBroadcaster) Subscribers() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subscribers)
}

// Dropped is the number of subscribers closed for falling behind since start.
func (b *committedBroadcaster) Dropped() uint64 {
	return b.dropped.Load()
}
