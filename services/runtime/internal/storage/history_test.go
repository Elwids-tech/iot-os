package storage

import (
	"testing"
	"time"
)

func TestStateSegmentsCarryUnknownCollapseAndConfigurationBoundaries(t *testing.T) {
	from := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	to := from.Add(10 * time.Minute)

	t.Run("unknown until first report", func(t *testing.T) {
		segments := stateSegments([]stateChange{{
			At: from.Add(2 * time.Minute), Value: false, Known: true,
			DataType: "boolean", ConfigurationUUID: "configuration-1",
		}}, from, to)
		if len(segments) != 2 || segments[0].Known || segments[0].From != from || segments[0].To != from.Add(2*time.Minute) {
			t.Fatalf("unexpected unknown carry segment: %#v", segments)
		}
		if !segments[1].Known || segments[1].Value != false || segments[1].To != to {
			t.Fatalf("unexpected final state: %#v", segments[1])
		}
		durations := stateDurations(segments, to.Sub(from))
		if len(durations) != 2 || durations[0].DurationMS != (8*time.Minute).Milliseconds() || durations[1].DurationMS != (2*time.Minute).Milliseconds() {
			t.Fatalf("unexpected duration totals: %#v", durations)
		}
	})

	t.Run("carry in repeated values and configuration changes", func(t *testing.T) {
		segments := stateSegments([]stateChange{
			{At: from.Add(-time.Minute), Value: "blink", Known: true, DataType: "enum", ConfigurationUUID: "configuration-1"},
			{At: from.Add(2 * time.Minute), Value: "blink", Known: true, DataType: "enum", ConfigurationUUID: "configuration-1"},
			{At: from.Add(4 * time.Minute), Value: "blink", Known: true, DataType: "enum", ConfigurationUUID: "configuration-2"},
			{At: from.Add(7 * time.Minute), Value: "solid", Known: true, DataType: "enum", ConfigurationUUID: "configuration-2"},
		}, from, to)
		if len(segments) != 3 {
			t.Fatalf("repeated value was not collapsed: %#v", segments)
		}
		if segments[0].From != from || segments[0].To != from.Add(4*time.Minute) || segments[0].ConfigurationUUID != "configuration-1" {
			t.Fatalf("carry-in state was not extended correctly: %#v", segments[0])
		}
		if segments[1].From != from.Add(4*time.Minute) || segments[1].ConfigurationUUID != "configuration-2" {
			t.Fatalf("configuration boundary was not retained: %#v", segments[1])
		}
		durations := stateDurations(segments, to.Sub(from))
		if len(durations) != 2 || durations[0].Value != "blink" || durations[0].DurationMS != (7*time.Minute).Milliseconds() {
			t.Fatalf("enum durations are incorrect: %#v", durations)
		}
	})

	t.Run("single carry report fills the range", func(t *testing.T) {
		segments := stateSegments([]stateChange{{
			At: from.Add(-time.Hour), Value: true, Known: true,
			DataType: "boolean", ConfigurationUUID: "configuration-1",
		}}, from, to)
		if len(segments) != 1 || segments[0].From != from || segments[0].To != to || segments[0].Value != true {
			t.Fatalf("unexpected single-report history: %#v", segments)
		}
	})
}

func TestSampleStateSegmentsIsBoundedChronologicalAndDeterministic(t *testing.T) {
	from := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	segments := make([]StateSegment, 0, 100)
	for index := 0; index < 100; index++ {
		segments = append(segments, StateSegment{
			From:  from.Add(time.Duration(index) * time.Second),
			To:    from.Add(time.Duration(index+1) * time.Second),
			Value: index % 2, Known: true, DataType: "enum", ConfigurationUUID: "configuration",
		})
	}

	sampled := sampleStateSegments(segments, from, from.Add(100*time.Second), 10)
	if len(sampled) > 10 || sampled[0].From != from || sampled[len(sampled)-1].To != from.Add(100*time.Second) {
		t.Fatalf("sampled timeline is not bounded: %#v", sampled)
	}
	for index := 1; index < len(sampled); index++ {
		if sampled[index-1].To != sampled[index].From {
			t.Fatalf("sampled timeline has a gap at %d: %#v", index, sampled)
		}
	}

	tie := sampleStateSegments(segments[:2], from, from.Add(2*time.Second), 1)
	if len(tie) != 1 || tie[0].Value != 0 {
		t.Fatalf("equal-duration bucket should consistently keep the first state: %#v", tie)
	}
}

func TestHistoryGapsFollowTheSeriesOwnSpacing(t *testing.T) {
	from := time.Date(2026, 10, 28, 19, 38, 54, 0, time.UTC)
	bucket := 87 * time.Second
	gaps := func(points []HistoryPoint) []time.Time {
		at := []time.Time{}
		for _, point := range points {
			if point.Value == nil {
				at = append(at, point.At)
			}
		}
		return at
	}

	// A sensor reporting every four to six minutes, charted over a day, then
	// silent for two hours.
	points := []HistoryPoint{}
	at := from
	for i := range 12 {
		points = append(points, HistoryPoint{At: at, Value: 25.5, Count: 1})
		at = at.Add(bucket * time.Duration(3+i%2))
	}
	last := points[len(points)-1].At
	points = append(points, HistoryPoint{At: last.Add(2 * time.Hour), Value: 25.75, Count: 1})
	got := gaps(withGaps(points, bucket))
	if len(got) != 1 || !got[0].Equal(last.Add(bucket)) {
		t.Fatalf("want one gap after the last report before the silence, got %v", got)
	}

	// A sample in every bucket stays joined across one missed bucket and breaks
	// after four.
	dense := []HistoryPoint{}
	for i := range 20 {
		if i != 5 && (i < 10 || i > 13) {
			dense = append(dense, HistoryPoint{At: from.Add(time.Duration(i) * bucket), Value: float64(i), Count: 1})
		}
	}
	got = gaps(withGaps(dense, bucket))
	if len(got) != 1 || !got[0].Equal(from.Add(10*bucket)) {
		t.Fatalf("want one gap for the four missing buckets, got %v", got)
	}
}
