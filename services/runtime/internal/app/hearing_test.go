package app

import (
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// Spec 038, research R5: a report of an adapter device counts as hearing from it only
// when a reading in it is neither historical nor bad. Before this rule an all-null data
// packet counted; a native device is still heard by its packets.
func TestBadReadingsAreNotHearingFromAnAdapterDevice(t *testing.T) {
	now := time.Now().UTC()
	bad := devices.Reading{Quality: "invalid", ObservedAt: now, SourceBad: true}
	good := devices.Reading{Quality: "good", ObservedAt: now}
	history := devices.Reading{Quality: "good", ObservedAt: now.Add(-time.Hour), Historical: true}
	if got := observedTimes([]devices.Reading{bad, bad}, true); len(got) != 0 {
		t.Fatal("a dead controller's bad values were heard", got)
	}
	if got := observedTimes([]devices.Reading{bad, good}, true); len(got) != 1 {
		t.Fatal("one good value is hearing from the device", got)
	}
	if got := observedTimes([]devices.Reading{bad}, false); len(got) != 1 {
		t.Fatal("a native device's readings keep their observed times", got)
	}
	if !onlySourceBad([]devices.Reading{bad, history}) || onlySourceBad([]devices.Reading{bad, good}) || onlySourceBad([]devices.Reading{history}) {
		t.Fatal("onlySourceBad")
	}
}
