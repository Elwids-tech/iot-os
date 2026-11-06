package app

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

// Offline detection on a fake clock (spec 018, T010, T028, T031). Every event the
// tracker stores is checked against device.connectivity.v1 as a producer.

var trackerStart = time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)

type trackerFixture struct {
	t      *testing.T
	tr     *connectivityTracker
	now    time.Time
	org    string
	conn   string
	direct string
	events []connectivityEvent
}

func newTrackerFixture(t *testing.T) *trackerFixture {
	t.Helper()
	return newTrackerFixtureAt(t, trackerStart)
}

func newTrackerFixtureAt(t *testing.T, start time.Time) *trackerFixture {
	t.Helper()
	org := storage.UUID()
	f := &trackerFixture{t: t, tr: newConnectivityTracker(start, nil), now: start, org: org, conn: storage.UUID(), direct: "onboarding-" + org}
	f.tr.finishSeeding()
	f.tr.connect(f.conn, start)
	return f
}

func (f *trackerFixture) adapterGroup() string { return "adapters-" + f.org }

func settingsWith(style string, offlineAfter int) devices.ConnectivitySettings {
	s := devices.DefaultConnectivity()
	s.Style = style
	if offlineAfter > 0 {
		s.OfflineAfterSeconds = &offlineAfter
	}
	return s
}

// device monitors a definition for the source group/edge/source with settings.
func (f *trackerFixture) device(group, edge, source string, settings devices.ConnectivitySettings) string {
	f.t.Helper()
	d := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: f.org, ConfigurationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: f.conn, GroupID: group, EdgeNodeID: edge, DeviceID: source}}
	f.tr.define(d, f.now)
	f.tr.configure(d.DeviceUUID, settings, f.now)
	return d.DeviceUUID
}

// report is a data packet from a direct source whose reading was observed at the receipt time.
func (f *trackerFixture) report(edge, source, device string) {
	f.tr.heard(f.conn, f.direct, edge, source, f.now)
	f.tr.readings(device, true, f.now, []time.Time{f.now})
}

// run advances the clock by span in steps, evaluating and storing every change as the
// maintenance tick does.
func (f *trackerFixture) run(span, step time.Duration) {
	f.t.Helper()
	for end := f.now.Add(span); f.now.Before(end); {
		f.now = f.now.Add(min(step, end.Sub(f.now)))
		for _, change := range f.tr.evaluate(f.now) {
			if change.event != nil {
				f.produced(change)
				f.events = append(f.events, *change.event)
			}
			f.tr.commit(change)
		}
	}
}

// produced checks a transition as the outbox carries it.
func (f *trackerFixture) produced(change connectivityChange) {
	f.t.Helper()
	raw, err := json.Marshal(devices.Event{UUID: storage.ConnectivityEventUUID(change.row.SubjectKey, change.event.Episode, change.transition), Type: "device.connectivity.v1", Payload: mustJSON(f.t, change.event)})
	if err != nil {
		f.t.Fatal(err)
	}
	var envelope map[string]any
	if err = json.Unmarshal(raw, &envelope); err != nil {
		f.t.Fatal(err)
	}
	contractstest.AssertProduced(f.t, "device.connectivity.v1", envelope)
	if change.transition != change.event.Transition {
		f.t.Fatalf("change %s carries a %s event", change.transition, change.event.Transition)
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// summary is each event as "<subject kind> <transition> <cause or stop reason>".
func (f *trackerFixture) summary() []string {
	lines := []string{}
	for _, ev := range f.events {
		reason := ""
		if ev.Cause != nil {
			reason = *ev.Cause
		}
		if ev.StopReason != nil {
			reason = *ev.StopReason
		}
		lines = append(lines, ev.Subject.Kind+" "+ev.Transition+" "+reason)
	}
	return lines
}

func (f *trackerFixture) expect(want ...string) {
	f.t.Helper()
	if got := f.summary(); !slices.Equal(got, want) {
		f.t.Fatalf("events %q, want %q", got, want)
	}
}

func (f *trackerFixture) state(device string) connectivityState {
	f.t.Helper()
	states := f.tr.state(f.org, []string{device}, f.now)
	if len(states) != 1 {
		f.t.Fatalf("no state for %s: %v", device, states)
	}
	return states[0]
}

func (f *trackerFixture) last() connectivityEvent {
	f.t.Helper()
	if len(f.events) == 0 {
		f.t.Fatal("no events")
	}
	return f.events[len(f.events)-1]
}

func at(t *testing.T, value *time.Time, want time.Time, field string) {
	t.Helper()
	if value == nil || !value.Equal(want) {
		t.Fatalf("%s = %v, want %s", field, value, want)
	}
}

const tick = 5 * time.Second

func TestDeathOpensAfterTheGraceAndTheReturnClearsAfterIt(t *testing.T) {
	f := newTrackerFixture(t)
	box := f.device(f.direct, "box-1", "", settingsWith(styleStaysConnected, 3600))
	f.run(time.Minute, tick)
	if state := f.state(box); state.State != "waiting" {
		t.Fatalf("state %s before the first packet, want waiting", state.State)
	}
	f.report("box-1", "", box)
	f.run(time.Minute, tick)
	died := f.now
	f.tr.died(f.conn, f.direct, "box-1", "", died)
	f.run(115*time.Second, tick)
	f.expect()
	if state := f.state(box); state.State != "pending" {
		t.Fatalf("state %s inside the grace period, want pending", state.State)
	}
	f.run(5*time.Second, tick)
	f.expect("device opened death_certificate")
	opened := f.last()
	at(t, opened.OfflineSince, died, "offline_since")
	at(t, timePointer(opened.At), died.Add(2*time.Minute), "at")
	at(t, opened.LastHeardAt, died, "last_heard_at")
	if opened.Episode != 1 || *opened.Subject.DeviceUUID != box || !slices.Equal(opened.AffectedDeviceUUIDs, []string{box}) || *opened.OfflineAfterSeconds != 3600 || *opened.OfflineAfterAutomatic {
		t.Fatalf("opened event %+v", opened)
	}

	f.run(time.Minute, tick)
	back := f.now
	f.tr.heard(f.conn, f.direct, "box-1", "", back)
	f.run(115*time.Second, tick)
	if state := f.state(box); state.State != "recovering" {
		t.Fatalf("state %s while coming back, want recovering", state.State)
	}
	f.expect("device opened death_certificate")
	f.run(5*time.Second, tick)
	f.expect("device opened death_certificate", "device cleared death_certificate")
	at(t, timePointer(f.last().At), back, "cleared at")
	if f.last().Episode != 1 {
		t.Fatalf("cleared episode %d", f.last().Episode)
	}
}

func TestADropShorterThanTheGraceOpensNothing(t *testing.T) {
	f := newTrackerFixture(t)
	box := f.device(f.direct, "box-1", "", settingsWith(styleStaysConnected, 3600))
	f.report("box-1", "", box)
	f.run(time.Minute, tick)
	f.tr.died(f.conn, f.direct, "box-1", "", f.now)
	f.run(time.Minute, tick)
	f.tr.heard(f.conn, f.direct, "box-1", "", f.now)
	f.run(10*time.Minute, tick)
	f.expect()
	// A death that comes back during an open episode's return restarts it.
	f.tr.died(f.conn, f.direct, "box-1", "", f.now)
	f.run(3*time.Minute, tick)
	f.tr.heard(f.conn, f.direct, "box-1", "", f.now)
	f.run(time.Minute, tick)
	f.tr.died(f.conn, f.direct, "box-1", "", f.now)
	f.run(5*time.Minute, tick)
	f.expect("device opened death_certificate")
}

func TestSilencePastOfflineAfterIsAMissedCheckIn(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 600))
	f.report("edge-1", "meter", meter)
	last := f.now
	f.run(10*time.Minute+115*time.Second, tick)
	f.expect()
	f.run(5*time.Second, tick)
	f.expect("device opened missed_check_in")
	at(t, f.last().OfflineSince, last.Add(10*time.Minute), "offline_since")
	at(t, f.last().LastObservedAt, last, "last_observed_at")
}

func TestConnectsToReportIgnoresDeathsAndAReportClearsAtOnce(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "meter-7", "", settingsWith(styleConnectsReport, 600))
	for range 3 {
		f.report("meter-7", "", meter)
		f.tr.died(f.conn, f.direct, "meter-7", "", f.now.Add(time.Second))
		f.run(4*time.Minute, tick)
	}
	f.expect()
	f.run(15*time.Minute, tick)
	f.expect("device opened missed_check_in")
	f.report("meter-7", "", meter)
	back := f.now
	f.run(tick, tick)
	f.expect("device opened missed_check_in", "device cleared missed_check_in")
	at(t, timePointer(f.last().At), back, "cleared at")
}

func TestAutomaticOfflineAfterLearnsFromThreeReadingsWhileDeathsCount(t *testing.T) {
	f := newTrackerFixture(t)
	box := f.device(f.direct, "box-2", "", settingsWith(styleStaysConnected, 0))
	f.report("box-2", "", box)
	f.run(time.Minute, tick)
	f.report("box-2", "", box)
	if state := f.state(box); state.State != "learning" || state.ReadingsCounted != 2 || state.OfflineAfterSeconds != nil || state.ReportingIntervalSeconds != nil {
		t.Fatalf("after two readings %+v", state)
	}
	// Two readings are not enough to judge silence...
	f.run(6*time.Hour, time.Minute)
	f.expect()
	// ...but a death still counts.
	f.tr.died(f.conn, f.direct, "box-2", "", f.now)
	f.run(3*time.Minute, tick)
	f.expect("device opened death_certificate")
	if ev := f.last(); ev.OfflineAfterSeconds != nil || ev.OfflineAfterAutomatic == nil || !*ev.OfflineAfterAutomatic {
		t.Fatalf("a learning device's threshold: %v %v", ev.OfflineAfterSeconds, ev.OfflineAfterAutomatic)
	}
	f.report("box-2", "", box)
	f.run(3*time.Minute, tick)
	// Gaps of 1 minute and 6 hours 3 minutes: their median is 3 hours 2 minutes.
	if state := f.state(box); state.State != "monitored" || *state.OfflineAfterSeconds != 3*10920 || *state.ReportingIntervalSeconds != 10920 || !state.OfflineAfterAutomatic {
		t.Fatalf("after three readings %+v", state)
	}
}

func TestAutomaticThresholdFormula(t *testing.T) {
	for _, c := range []struct{ interval, poll, want time.Duration }{
		{time.Minute, 0, 15 * time.Minute},
		{2 * time.Minute, 5 * time.Minute, 15 * time.Minute},
		{5 * time.Minute, 15 * time.Minute, 30 * time.Minute},
		{10 * time.Minute, 5 * time.Minute, 35 * time.Minute},
		{7*time.Minute + time.Second, 0, 22 * time.Minute},
		{24 * time.Hour, time.Hour, 73 * time.Hour},
		{3 * 24 * time.Hour, 0, 7 * 24 * time.Hour},
	} {
		if got := automaticThreshold(c.interval, c.poll); got != c.want {
			t.Errorf("automaticThreshold(%s, %s) = %s, want %s", c.interval, c.poll, got, c.want)
		}
	}
}

func TestReportingIntervalIsTheMedianOfRecentObservedGaps(t *testing.T) {
	now := trackerStart
	d := &deviceTrack{seeded: true}
	for _, offset := range []time.Duration{0, time.Minute, 2 * time.Minute, 62 * time.Minute} {
		d.observe(now.Add(offset))
	}
	// Repeated and older observed times are gaps of zero or less.
	d.observe(now.Add(62 * time.Minute))
	d.observe(now.Add(30 * time.Minute))
	if interval, ok := d.interval(now.Add(time.Hour)); !ok || interval != time.Minute || len(d.times) != 4 {
		t.Fatalf("median of 1, 1, 60 minutes = %s %v (%d times)", interval, ok, len(d.times))
	}
	d.observe(now.Add(64 * time.Minute))
	if interval, _ := d.interval(now.Add(time.Hour)); interval != 90*time.Second {
		t.Fatalf("median of 1, 1, 2, 60 minutes = %s", interval)
	}
	// At most 64 gaps are kept, and none older than seven days.
	for i := range 100 {
		d.observe(now.Add(2*time.Hour + time.Duration(i)*time.Minute))
	}
	if len(d.times) != storage.SeedLimit {
		t.Fatalf("kept %d times", len(d.times))
	}
	if _, ok := d.interval(now.Add(8 * 24 * time.Hour)); ok || len(d.times) != 0 {
		t.Fatalf("times older than seven days kept: %d", len(d.times))
	}
}

func TestASilenceInProgressNeverBecomesAGap(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 0))
	for range 10 {
		f.report("edge-1", "meter", meter)
		f.run(time.Minute, tick)
	}
	f.run(16*time.Minute, tick)
	f.expect("device opened missed_check_in")
	if ev := f.last(); *ev.OfflineAfterSeconds != 900 || *ev.ReportingIntervalSeconds != 60 {
		t.Fatalf("threshold %d from interval %d", *ev.OfflineAfterSeconds, *ev.ReportingIntervalSeconds)
	}
	f.run(3*time.Hour, time.Minute)
	if state := f.state(meter); *state.ReportingIntervalSeconds != 60 {
		t.Fatalf("a silence moved the interval to %d", *state.ReportingIntervalSeconds)
	}
}

func TestASlowerDeviceRaisesItsThresholdOnlyAsGapsComplete(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 0))
	for range 5 {
		f.report("edge-1", "meter", meter)
		f.run(10*time.Minute, time.Minute)
	}
	if state := f.state(meter); *state.OfflineAfterSeconds != 30*60 {
		t.Fatalf("every 10 minutes: %d", *state.OfflineAfterSeconds)
	}
	for range 6 {
		f.report("edge-1", "meter", meter)
		before := *f.state(meter).OfflineAfterSeconds
		f.run(25*time.Minute, time.Minute)
		if during := *f.state(meter).OfflineAfterSeconds; during != before {
			t.Fatalf("threshold moved from %d to %d during a silence", before, during)
		}
	}
	f.report("edge-1", "meter", meter)
	if state := f.state(meter); *state.OfflineAfterSeconds != 75*60 {
		t.Fatalf("every 25 minutes now: %d", *state.OfflineAfterSeconds)
	}
	f.expect()
}

func TestDeactivationDisablingAndRemovalStopAnOpenEpisode(t *testing.T) {
	f := newTrackerFixture(t)
	box := f.device(f.direct, "box-1", "", settingsWith(styleStaysConnected, 3600))
	other := f.device(f.direct, "box-2", "", settingsWith(styleStaysConnected, 3600))
	for _, edge := range []string{"box-1", "box-2"} {
		f.tr.heard(f.conn, f.direct, edge, "", f.now)
		f.tr.died(f.conn, f.direct, edge, "", f.now.Add(time.Second))
	}
	f.run(3*time.Minute, tick)
	f.expect("device opened death_certificate", "device opened death_certificate")

	f.tr.remove(box, stopDeactivated)
	disabled := settingsWith(styleStaysConnected, 3600)
	disabled.Enabled = false
	f.tr.configure(other, disabled, f.now)
	f.run(tick, tick)
	got := f.summary()[2:]
	slices.Sort(got)
	if !slices.Equal(got, []string{"device stopped device_deactivated", "device stopped monitoring_disabled"}) {
		t.Fatalf("stops %q", got)
	}
	if states := f.tr.state(f.org, []string{box}, f.now); len(states) != 0 {
		t.Fatalf("a deactivated device is still reported: %v", states)
	}
	if state := f.state(other); state.State != "disabled" {
		t.Fatalf("state %s", state.State)
	}
	// Turning offline alerts on again starts monitoring afresh.
	f.tr.configure(other, settingsWith(styleStaysConnected, 3600), f.now)
	if state := f.state(other); state.State != "waiting" {
		t.Fatalf("state %s after enabling, want waiting", state.State)
	}

	// An episode stored open for a device the runtime no longer monitors ends at start.
	g := newTrackerFixture(t)
	gone := storage.UUID()
	since := trackerStart.Add(-time.Hour)
	g.tr.load([]storage.ConnectivityRow{{SubjectKey: "device:" + gone, OrganizationUUID: g.org, Kind: "device", MonitoringSince: since, HeardSinceMonitoring: true, Episode: 3, Open: true, OfflineSince: &since, OpenedAt: &since, Cause: causeSilence, AffectedDeviceUUIDs: []string{gone}}})
	g.run(tick, tick)
	g.run(time.Minute, tick)
	g.expect("device stopped definition_removed")
	if ev := g.last(); ev.Episode != 3 || *ev.Subject.DeviceUUID != gone {
		t.Fatalf("orphan stop %+v", ev)
	}
}

func TestANewConfigurationNeitherOpensClearsNorMovesTheAnchor(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 900))
	f.report("edge-1", "meter", meter)
	last := f.now
	f.run(10*time.Minute, tick)
	activate := func() {
		d := devices.Definition{DeviceUUID: meter, OrganizationUUID: f.org, ConfigurationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: f.conn, GroupID: f.direct, EdgeNodeID: "edge-1", DeviceID: "meter"}}
		f.tr.define(d, f.now)
		f.tr.configure(meter, settingsWith(styleStaysConnected, 900), f.now)
	}
	activate()
	f.run(7*time.Minute, tick)
	f.expect("device opened missed_check_in")
	at(t, f.last().OfflineSince, last.Add(15*time.Minute), "offline_since")
	activate()
	f.run(time.Hour, time.Minute)
	f.expect("device opened missed_check_in")
}

func TestADeviceSilentWhenMonitoringStartsWaitsForItsNextPacket(t *testing.T) {
	f := newTrackerFixture(t)
	parked := f.device(f.direct, "parked", "", settingsWith(styleStaysConnected, 900))
	f.run(3*24*time.Hour, time.Hour)
	f.expect()
	if state := f.state(parked); state.State != "waiting" || state.LastHeardAt != nil {
		t.Fatalf("%+v", state)
	}
}

// --- No false alarms from the platform (US3) ---

func TestARuntimeRestartAnchorsSilenceAtItsStartNotALaterActivation(t *testing.T) {
	f := newTrackerFixture(t)
	device := storage.UUID()
	monitored := trackerStart.Add(-48 * time.Hour)
	f.tr = newConnectivityTracker(trackerStart, nil)
	f.tr.load([]storage.ConnectivityRow{{SubjectKey: "device:" + device, OrganizationUUID: f.org, Kind: "device", MonitoringSince: monitored, HeardSinceMonitoring: true, Episode: 2}})
	define := func() {
		f.tr.define(devices.Definition{DeviceUUID: device, OrganizationUUID: f.org, ConfigurationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: f.conn, GroupID: f.direct, EdgeNodeID: "box", DeviceID: ""}}, f.now)
		f.tr.configure(device, settingsWith(styleStaysConnected, 1800), f.now)
	}
	define()
	f.tr.finishSeeding()
	f.tr.connect(f.conn, trackerStart)
	f.run(time.Hour/2-time.Minute, time.Minute)
	define() // an activation after the restart does not restart silence (FR-010)
	f.run(3*time.Minute, tick)
	f.expect("device opened missed_check_in")
	if ev := f.last(); ev.Episode != 3 || !ev.OfflineSince.Equal(trackerStart.Add(30*time.Minute)) {
		t.Fatalf("episode %d offline since %s", ev.Episode, ev.OfflineSince)
	}
}

func TestALostBrokerConnectionFreezesAndAnchorsAtItsRestoration(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 900))
	box := f.device(f.direct, "box", "", settingsWith(styleStaysConnected, 900))
	f.report("edge-1", "meter", meter)
	f.report("box", "", box)
	f.run(5*time.Minute, tick)
	f.tr.died(f.conn, f.direct, "box", "", f.now)
	f.tr.disconnect(f.conn, f.now)
	f.run(time.Hour, tick)
	f.expect()
	if state := f.state(meter); state.State != "interrupted" || *state.Interruption != interruptConnection {
		t.Fatalf("%+v", state)
	}
	restored := f.now
	f.tr.connect(f.conn, restored)
	// What happened while it was down is unknown: the death is forgotten, silence counts from now.
	f.run(15*time.Minute+115*time.Second, tick)
	f.expect()
	f.run(5*time.Second, tick)
	got := f.summary()
	if !slices.Equal(got, []string{"device opened missed_check_in", "device opened missed_check_in"}) {
		t.Fatalf("events %q", got)
	}
	at(t, f.last().OfflineSince, restored.Add(15*time.Minute), "offline_since")
}

func TestAnOpenEpisodeStaysOpenThroughInterruptions(t *testing.T) {
	f := newTrackerFixture(t)
	box := f.device(f.direct, "box", "", settingsWith(styleStaysConnected, 900))
	f.report("box", "", box)
	f.tr.died(f.conn, f.direct, "box", "", f.now.Add(time.Second))
	f.run(3*time.Minute, tick)
	f.expect("device opened death_certificate")
	f.tr.disconnect(f.conn, f.now)
	f.run(10*time.Minute, tick)
	f.tr.connect(f.conn, f.now)
	f.run(2*time.Hour, time.Minute)
	f.expect("device opened death_certificate")
	f.tr.heard(f.conn, f.direct, "box", "", f.now)
	f.run(2*time.Minute, tick)
	f.expect("device opened death_certificate", "device cleared death_certificate")
}

// adapterDevice is a tracker behind an adapter edge with seeded readings every interval
// up to now, the adapter born just before.
func (f *trackerFixture) adapterDevice(edge, source string, interval time.Duration, poll int) string {
	f.t.Helper()
	settings := settingsWith(styleConnectsReport, 0)
	if poll > 0 {
		settings.PollIntervalSeconds = &poll
	}
	device := f.device(f.adapterGroup(), edge, source, settings)
	f.tr.adapterBorn(f.conn, f.adapterGroup(), edge, f.now.Add(-time.Second))
	for i := 4; i >= 1; i-- {
		f.tr.readings(device, true, f.now, []time.Time{f.now.Add(-time.Duration(i) * interval)})
	}
	f.tr.readings(device, true, f.now, []time.Time{f.now})
	return device
}

func TestAnAdapterDeathIsAnInterruptionThatLeavesItsDownTimeOutOfSilence(t *testing.T) {
	f := newTrackerFixture(t)
	tracker := f.adapterDevice("adapter-1", "TRK-1", 10*time.Minute, 0)
	last := f.now
	f.run(5*time.Minute, tick)
	f.tr.died(f.conn, f.adapterGroup(), "adapter-1", "", f.now)
	if state := f.state(tracker); state.State != "interrupted" || *state.Interruption != interruptAdapter {
		t.Fatalf("%+v", state)
	}
	f.run(2*time.Hour, tick)
	f.expect()
	f.tr.adapterBorn(f.conn, f.adapterGroup(), "adapter-1", f.now)
	// The adapter was down for two hours; the tracker had been silent for five minutes.
	f.run(25*time.Minute+115*time.Second, tick)
	f.expect()
	f.run(5*time.Second, tick)
	f.expect("device opened missed_check_in")
	at(t, f.last().OfflineSince, last.Add(2*time.Hour+30*time.Minute), "offline_since")
	at(t, f.last().LastHeardAt, last, "last_heard_at")
}

func TestTenRedeploysDoNotPostponeADailyDevicesAlertBeyondItsDownTime(t *testing.T) {
	f := newTrackerFixture(t)
	tracker := f.adapterDevice("adapter-1", "TRK-1", 24*time.Hour, 3600)
	last := f.now
	threshold := 73 * time.Hour // 3 × 1 day + the hourly poll
	for range 10 {
		f.run(6*time.Hour, time.Minute)
		f.tr.died(f.conn, f.adapterGroup(), "adapter-1", "", f.now)
		f.run(time.Minute, 5*time.Second)
		f.tr.adapterBorn(f.conn, f.adapterGroup(), "adapter-1", f.now)
		// The publisher announces its stored birth again: not a new reading.
		f.tr.readings(tracker, false, f.now, []time.Time{last})
	}
	f.run(threshold+10*time.Minute+2*time.Minute-60*time.Hour-10*time.Minute, time.Minute)
	f.expect("device opened missed_check_in")
	at(t, f.last().OfflineSince, last.Add(threshold+10*time.Minute), "offline_since")
	at(t, f.last().LastHeardAt, last, "last_heard_at")
}

func TestAPausedAdapterKeepsItsDevicesUnevaluated(t *testing.T) {
	f := newTrackerFixture(t)
	tracker := f.adapterDevice("adapter-1", "TRK-1", 10*time.Minute, 0)
	f.tr.died(f.conn, f.adapterGroup(), "adapter-1", "", f.now)
	f.run(10*24*time.Hour, time.Hour)
	f.expect()
	if state := f.state(tracker); state.State != "interrupted" {
		t.Fatalf("%+v", state)
	}
}

func TestRepeatedBirthsAndHistoryAreNotHeardOnAdapterEdges(t *testing.T) {
	f := newTrackerFixture(t)
	tracker := f.adapterDevice("adapter-1", "TRK-1", 10*time.Minute, 0)
	heard := f.state(tracker).LastHeardAt
	f.run(10*time.Minute, tick)
	// The adapter's own packets and births it announces again prove nothing about the device.
	f.tr.heard(f.conn, f.adapterGroup(), "adapter-1", "", f.now)
	f.tr.heard(f.conn, f.adapterGroup(), "adapter-1", "TRK-1", f.now)
	f.tr.readings(tracker, false, f.now, []time.Time{f.now})
	// A data packet whose readings are all historical carries no observed time to count.
	f.tr.readings(tracker, true, f.now, nil)
	if state := f.state(tracker); !state.LastHeardAt.Equal(*heard) {
		t.Fatalf("last heard moved from %s to %s", heard, state.LastHeardAt)
	}
	f.tr.readings(tracker, true, f.now, []time.Time{f.now.Add(-time.Minute)})
	at(t, f.state(tracker).LastHeardAt, f.now, "last heard after a new reading")
}

// An adapter-fed tracker stayed silent for six days and online, because presence came
// only from births; it went offline only when an adapter restart left it out of the
// adapter's births file. Offline detection judges it by its own silence, whatever the
// adapter does.
func TestAnAdapterFedTrackerIsJudgedByItsOwnSilenceWhateverTheAdapterDoes(t *testing.T) {
	f := newTrackerFixture(t)
	tracker := f.adapterDevice("adapter-1", "TRK-6", time.Hour, 300)
	last := f.now
	for range 3 {
		f.run(40*time.Minute, time.Minute)
		f.tr.died(f.conn, f.adapterGroup(), "adapter-1", "", f.now)
		f.run(10*time.Second, 5*time.Second)
		f.tr.adapterBorn(f.conn, f.adapterGroup(), "adapter-1", f.now)
		f.tr.readings(tracker, false, f.now, []time.Time{last})
	}
	f.run(6*24*time.Hour, time.Minute)
	f.expect("device opened missed_check_in")
	// 3 × 1 hour + a 5-minute poll, plus the 30 seconds the adapter was down.
	at(t, f.last().OfflineSince, last.Add(3*time.Hour+5*time.Minute+30*time.Second), "offline_since")
}

func TestAfterALongOutageADeviceOpensOnlyAfterItsFullThreshold(t *testing.T) {
	f := newTrackerFixture(t)
	meter := f.device(f.direct, "edge-1", "meter", settingsWith(styleStaysConnected, 3600))
	f.report("edge-1", "meter", meter)
	f.tr.disconnect(f.conn, f.now)
	f.run(6*time.Hour, time.Minute)
	f.tr.connect(f.conn, f.now)
	restored := f.now
	f.run(time.Hour+time.Minute, tick)
	f.expect()
	f.run(time.Minute, tick)
	f.expect("device opened missed_check_in")
	at(t, f.last().OfflineSince, restored.Add(time.Hour), "offline_since")
}

// --- One gateway alert, not hundreds (US4) ---

type gatewayFixture struct {
	*trackerFixture
	meter, light string
}

func newGatewayFixture(t *testing.T, lightStyle string) gatewayFixture {
	f := newTrackerFixture(t)
	g := gatewayFixture{trackerFixture: f}
	g.meter = f.device(f.direct, "gw", "meter", settingsWith(styleStaysConnected, 900))
	g.light = f.device(f.direct, "gw", "light", settingsWith(lightStyle, 1800))
	f.tr.heard(f.conn, f.direct, "gw", "", f.now)
	g.both()
	return g
}

func (g gatewayFixture) both() {
	g.report("gw", "meter", g.meter)
	g.report("gw", "light", g.light)
}

func TestAGatewayDeathOpensOneEpisodeListingItsDevices(t *testing.T) {
	g := newGatewayFixture(t, styleStaysConnected)
	g.run(time.Minute, tick)
	died := g.now
	g.tr.died(g.conn, g.direct, "gw", "", died)
	g.run(3*time.Minute, tick)
	g.expect("gateway opened death_certificate")
	ev := g.last()
	want := []string{g.meter, g.light}
	slices.Sort(want)
	if *ev.Subject.ConnectionUUID != g.conn || *ev.Subject.EdgeNodeID != "gw" || !slices.Equal(ev.AffectedDeviceUUIDs, want) || ev.LastObservedAt != nil {
		t.Fatalf("gateway event %+v", ev)
	}
	at(t, ev.OfflineSince, died, "offline_since")
	if state := g.state(g.meter); !state.SuppressedByGateway {
		t.Fatalf("%+v", state)
	}
	// Its devices open nothing while it is offline.
	g.run(2*time.Hour, time.Minute)
	g.expect("gateway opened death_certificate")

	// It comes back with only the meter: the light is judged from the return.
	back := g.now
	g.tr.heard(g.conn, g.direct, "gw", "", back)
	g.report("gw", "meter", g.meter)
	g.run(2*time.Minute, tick)
	g.expect("gateway opened death_certificate", "gateway cleared death_certificate")
	at(t, timePointer(g.last().At), back, "cleared at")
	for g.now.Before(back.Add(30*time.Minute + 2*time.Minute)) {
		g.report("gw", "meter", g.meter)
		g.run(5*time.Minute, tick)
	}
	g.expect("gateway opened death_certificate", "gateway cleared death_certificate", "device opened missed_check_in")
	if ev := g.last(); *ev.Subject.DeviceUUID != g.light || !ev.OfflineSince.Equal(back.Add(30*time.Minute)) {
		t.Fatalf("light %+v since %s", ev.Subject, ev.OfflineSince)
	}
}

func TestAGatewayWhoseNodeAndDevicesFallSilentOpensOneEpisode(t *testing.T) {
	g := newGatewayFixture(t, styleStaysConnected)
	last := g.now
	g.run(35*time.Minute, tick)
	// The meter's 15 minutes passed long ago, but the gateway is silent too: one episode at the light's 30.
	g.expect("gateway opened missed_check_in")
	at(t, g.last().OfflineSince, last.Add(30*time.Minute), "offline_since")
	if *g.last().OfflineAfterSeconds != 1800 {
		t.Fatalf("gateway threshold %d", *g.last().OfflineAfterSeconds)
	}
}

func TestADeviceSilentBehindALiveGatewayOpensItsOwnAndKeepsIt(t *testing.T) {
	g := newGatewayFixture(t, styleStaysConnected)
	for range 4 {
		g.report("gw", "light", g.light)
		g.run(5*time.Minute, tick)
	}
	g.expect("device opened missed_check_in")
	if *g.last().Subject.DeviceUUID != g.meter {
		t.Fatal("the wrong device opened")
	}
	g.tr.died(g.conn, g.direct, "gw", "", g.now)
	g.run(3*time.Minute, tick)
	g.expect("device opened missed_check_in", "gateway opened death_certificate")
	g.run(time.Hour, time.Minute)
	g.expect("device opened missed_check_in", "gateway opened death_certificate")
}

func TestConnectsToReportDevicesDoNotMakeAGateway(t *testing.T) {
	g := newGatewayFixture(t, styleConnectsReport)
	g.run(time.Minute, tick)
	g.tr.died(g.conn, g.direct, "gw", "", g.now)
	g.run(3*time.Minute, tick)
	// One device that stays connected: its edge's death is its gateway's.
	g.expect("device opened gateway_offline")
	if *g.last().Subject.DeviceUUID != g.meter {
		t.Fatal("the light ignores deaths")
	}
}

func TestAdapterEdgesAreNeverGateways(t *testing.T) {
	f := newTrackerFixture(t)
	one := f.adapterDevice("adapter-1", "TRK-1", 10*time.Minute, 0)
	two := f.adapterDevice("adapter-1", "TRK-2", 10*time.Minute, 0)
	f.run(32*time.Minute, tick)
	f.expect("device opened missed_check_in", "device opened missed_check_in")
	got := []string{*f.events[0].Subject.DeviceUUID, *f.events[1].Subject.DeviceUUID}
	slices.Sort(got)
	want := []string{one, two}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("opened %v", got)
	}
}

func TestEventIdentitiesDeriveFromSubjectEpisodeAndTransition(t *testing.T) {
	first := storage.ConnectivityEventUUID("device:"+trackerStart.Format(time.RFC3339), 1, "opened")
	if again := storage.ConnectivityEventUUID("device:"+trackerStart.Format(time.RFC3339), 1, "opened"); again != first {
		t.Fatal("not deterministic")
	}
	for _, other := range []string{storage.ConnectivityEventUUID("device:x", 1, "opened"), storage.ConnectivityEventUUID("device:"+trackerStart.Format(time.RFC3339), 2, "opened"), storage.ConnectivityEventUUID("device:"+trackerStart.Format(time.RFC3339), 1, "cleared")} {
		if other == first {
			t.Fatal("collision")
		}
	}
	if first[14] != '5' {
		t.Fatalf("%s is not a version 5 UUID", first)
	}
	// RFC 9562 test vector: the DNS namespace and "www.example.com".
	if got := storage.UUIDv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"); got != "2ed6657d-e927-568b-95e1-2665a8aea6a2" {
		t.Fatalf("UUIDv5 = %s", got)
	}
}
