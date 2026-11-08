package app

import (
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func streamEvent(organization, device string, sequence int64) StreamEvent {
	return StreamEvent{Organization: organization, Device: device, Sequence: sequence, Reading: devices.StreamReading{SchemaVersion: devices.StreamReadingVersion, Position: devices.ProjectStream(devices.CommittedTelemetry{}, sequence).Position, DeviceUUID: device}}
}

func receive(t *testing.T, events <-chan StreamEvent) (StreamEvent, bool) {
	t.Helper()
	select {
	case event, open := <-events:
		return event, open
	case <-time.After(2 * time.Second):
		t.Fatal("no event within two seconds")
		return StreamEvent{}, false
	}
}

func expectNothing(t *testing.T, events <-chan StreamEvent) {
	t.Helper()
	select {
	case event, open := <-events:
		if open {
			t.Fatalf("unexpected event %d for %s", event.Sequence, event.Device)
		}
		t.Fatal("channel closed unexpectedly")
	case <-time.After(50 * time.Millisecond):
	}
}

// A subscriber receives the events of its organization and device set only, in
// publication order; another organization's event for the same device UUID never
// crosses over.
func TestBroadcasterFiltersByOrganizationAndDeviceInOrder(t *testing.T) {
	var broadcaster committedBroadcaster
	org, other := storage.UUID(), storage.UUID()
	pump, valve, fan := storage.UUID(), storage.UUID(), storage.UUID()
	events, cancel := broadcaster.Subscribe(org, map[string]struct{}{pump: {}, valve: {}}, 8)
	defer cancel()
	broadcaster.Publish([]StreamEvent{
		streamEvent(org, pump, 1), streamEvent(org, fan, 2), streamEvent(other, pump, 3), streamEvent(org, valve, 4), streamEvent(org, pump, 5),
	})
	for _, want := range []int64{1, 4, 5} {
		event, open := receive(t, events)
		if !open || event.Sequence != want {
			t.Fatalf("expected sequence %d, got %d (open %v)", want, event.Sequence, open)
		}
	}
	expectNothing(t, events)
	if broadcaster.Subscribers() != 1 || broadcaster.Dropped() != 0 {
		t.Fatalf("one subscriber, none dropped: %d %d", broadcaster.Subscribers(), broadcaster.Dropped())
	}
}

// Cancel closes the channel once and removes the subscription; cancelling twice is
// harmless, and publishing to no subscriber is harmless.
func TestBroadcasterCancelClosesOnce(t *testing.T) {
	var broadcaster committedBroadcaster
	org, device := storage.UUID(), storage.UUID()
	events, cancel := broadcaster.Subscribe(org, map[string]struct{}{device: {}}, 1)
	cancel()
	cancel()
	if _, open := <-events; open {
		t.Fatal("expected a closed channel after cancel")
	}
	broadcaster.Publish([]StreamEvent{streamEvent(org, device, 1)})
	if broadcaster.Subscribers() != 0 {
		t.Fatalf("expected no subscribers, got %d", broadcaster.Subscribers())
	}
}

// A subscriber that cannot keep up is closed and counted, and the others keep flowing.
func TestBroadcasterClosesAFullSubscriberAndCountsIt(t *testing.T) {
	var broadcaster committedBroadcaster
	org, device := storage.UUID(), storage.UUID()
	slow, cancelSlow := broadcaster.Subscribe(org, map[string]struct{}{device: {}}, 2)
	defer cancelSlow()
	quick, cancelQuick := broadcaster.Subscribe(org, map[string]struct{}{device: {}}, 8)
	defer cancelQuick()
	broadcaster.Publish([]StreamEvent{streamEvent(org, device, 1), streamEvent(org, device, 2), streamEvent(org, device, 3)})
	for _, want := range []int64{1, 2} {
		if event, open := receive(t, slow); !open || event.Sequence != want {
			t.Fatalf("slow subscriber keeps what it buffered: got %d (open %v)", event.Sequence, open)
		}
	}
	if _, open := receive(t, slow); open {
		t.Fatal("the slow subscriber must be closed after its buffer overflowed")
	}
	for _, want := range []int64{1, 2, 3} {
		if event, open := receive(t, quick); !open || event.Sequence != want {
			t.Fatalf("quick subscriber: expected %d, got %d (open %v)", want, event.Sequence, open)
		}
	}
	if broadcaster.Dropped() != 1 || broadcaster.Subscribers() != 1 {
		t.Fatalf("expected one dropped and one remaining subscriber, got %d and %d", broadcaster.Dropped(), broadcaster.Subscribers())
	}
}
