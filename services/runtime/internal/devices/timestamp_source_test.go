package devices

import (
	"testing"
	"time"
)

func TestTimestampProvenanceSurvivesCommittedProjection(t *testing.T) {
	now := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	p := Profile{Parameters: []Parameter{{UUID: "latitude", Key: "location.latitude", DataType: "number"}}}
	d := Definition{Mappings: []Mapping{{ParameterUUID: "latitude", Metric: "Latitude", Datatype: "Double"}}}
	past, future := now.Add(-time.Second), now.Add(6*time.Minute)
	for _, c := range []struct {
		timestamp *time.Time
		source    string
		observed  time.Time
	}{
		{nil, "receipt", now}, {&past, "source", past}, {&future, "corrected_future", now},
	} {
		readings := Readings(d, p, []Metric{{Name: "Latitude", Datatype: "Double", Value: 51.0, Timestamp: c.timestamp}}, nil, now)
		if len(readings) != 1 || readings[0].TimestampSource != c.source || !readings[0].ObservedAt.Equal(c.observed) {
			t.Fatal(readings)
		}
		event := ProjectCommitted(Telemetry{Readings: readings})
		if event.Readings[0].TimestampSource != c.source {
			t.Fatal("projection lost timestamp provenance")
		}
	}
}
