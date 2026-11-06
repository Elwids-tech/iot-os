package app

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

// Offline detection (spec 018). The tracker keeps, for every monitored device and
// every gateway, when the platform last heard from it and judges it on the
// maintenance tick: a death certificate (for devices that stay connected) or a
// silence longer than its Offline after opens an episode once the grace period has
// passed, and the subject being back for the grace period clears it. Silence is
// counted by receipt from an anchor that platform-side interruptions move forward
// (D3): the runtime's start, a restored broker connection, and an adapter's node
// death, whose down time is left out of its devices' silence. Times passed in are
// receipt times in UTC; the tracker never reads the clock itself.

const (
	styleStaysConnected  = "stays_connected"
	styleConnectsReport  = "connects_to_report"
	causeDeath           = "death_certificate"
	causeSilence         = "missed_check_in"
	causeGateway         = "gateway_offline"
	stopDeactivated      = "device_deactivated"
	stopDisabled         = "monitoring_disabled"
	stopRemoved          = "definition_removed"
	connectivityWindow   = 7 * 24 * time.Hour
	automaticMinimum     = 15 * time.Minute
	automaticMaximum     = 7 * 24 * time.Hour
	adapterRestarting    = "Adapter restarting; waiting for it to reconnect."
	interruptConnection  = "connection"
	interruptAdapter     = "adapter"
	connectivityKindDev  = "device"
	connectivityKindGate = "gateway"
)

// adapterGroup reports whether a Sparkplug group is an organization's managed adapters
// (adapters-<organization uuid>), whose births and deaths are the platform's (D2, D3).
func adapterGroup(group string) bool { return strings.HasPrefix(group, "adapters-") }

// episodeTrack is what every subject keeps about its episodes.
type episodeTrack struct {
	key, organization, kind string
	monitoringSince         time.Time
	heard                   bool // heard since monitoring started (D13)
	stored                  *storage.ConnectivityRow
	generation              int64
	episode                 int
	open                    bool
	cause                   string
	offlineSince, openedAt  time.Time
	affected                []string
	// pendingSince is when an offline condition began that has not lasted the grace
	// period yet; backSince is when an open episode's subject came back.
	pendingSince time.Time
	pendingCause string
	backSince    time.Time
	removed      string // a stop reason once the subject is no longer monitored
}

// step applies one evaluation: cause is the subject's offline condition now ("" for
// none) and since when it holds. It returns the transition due, if any.
func (s *episodeTrack) step(now time.Time, cause string, since time.Time, grace time.Duration, clearAtOnce bool) string {
	if !s.open {
		if cause == "" {
			s.pendingSince, s.pendingCause, s.backSince = time.Time{}, "", time.Time{}
			return ""
		}
		if s.pendingSince.IsZero() {
			s.pendingSince, s.pendingCause = since, cause
		}
		if now.Sub(s.pendingSince) >= grace {
			return "opened"
		}
		return ""
	}
	if cause != "" {
		s.backSince = time.Time{}
		return ""
	}
	if !s.backSince.IsZero() && (clearAtOnce || now.Sub(s.backSince) >= grace) {
		return "cleared"
	}
	return ""
}

// back records a packet: it ends a pending condition and starts an open episode's return.
func (s *episodeTrack) back(at time.Time) {
	if s.open || !s.pendingSince.IsZero() {
		if s.backSince.IsZero() {
			s.backSince = at
		}
	}
	s.pendingSince, s.pendingCause = time.Time{}, ""
}

func (s *episodeTrack) freeze() {
	s.pendingSince, s.pendingCause, s.backSince = time.Time{}, "", time.Time{}
}

func (s *episodeTrack) row() storage.ConnectivityRow {
	row := storage.ConnectivityRow{SubjectKey: s.key, OrganizationUUID: s.organization, Kind: s.kind, MonitoringSince: s.monitoringSince, HeardSinceMonitoring: s.heard, SettingsGeneration: s.generation, Episode: s.episode, Open: s.open, Cause: s.cause, AffectedDeviceUUIDs: s.affected}
	if s.open {
		since, opened := s.offlineSince, s.openedAt
		row.OfflineSince, row.OpenedAt = &since, &opened
	}
	return row
}

// changed reports whether the stored row differs from the subject's state.
func (s *episodeTrack) changed() bool {
	if s.stored == nil {
		return true
	}
	stored := *s.stored
	return stored.MonitoringSince != s.monitoringSince || stored.HeardSinceMonitoring != s.heard || stored.SettingsGeneration != s.generation || stored.Episode != s.episode || stored.Open != s.open
}

func (s *episodeTrack) restore(row storage.ConnectivityRow) {
	stored := row
	s.stored = &stored
	s.monitoringSince, s.heard, s.generation, s.episode, s.open, s.cause = row.MonitoringSince, row.HeardSinceMonitoring, row.SettingsGeneration, row.Episode, row.Open, row.Cause
	s.affected = slices.Clone(row.AffectedDeviceUUIDs)
	if row.OfflineSince != nil {
		s.offlineSince = *row.OfflineSince
	}
	if row.OpenedAt != nil {
		s.openedAt = *row.OpenedAt
	}
}

type deviceTrack struct {
	episodeTrack
	def          devices.Definition
	settings     devices.ConnectivitySettings
	adapter      bool
	lastHeard    time.Time
	lastObserved time.Time
	anchor       time.Time
	deadAt       time.Time // its own death certificate, until it is heard again
	// times are the distinct observed times of its recent readings, oldest first:
	// at most 65 (64 gaps), none older than 7 days (D16).
	times  []time.Time
	seeded bool
}

func (d *deviceTrack) edgeKey() string {
	return d.def.Source.ConnectionUUID + "/" + d.def.Source.EdgeNodeID
}

func (d *deviceTrack) silenceStart() time.Time { return latest(d.lastHeard, d.anchor) }

func (d *deviceTrack) hear(at time.Time) {
	if at.After(d.lastHeard) {
		d.lastHeard = at
	}
	if !d.deadAt.IsZero() && at.After(d.deadAt) {
		d.deadAt = time.Time{}
	}
	if !d.heard && !at.Before(d.monitoringSince) {
		d.heard = true
	}
	d.back(at)
}

// observe adds a reading's observed time. Times not newer than the newest are gaps of
// zero or less, which are ignored.
func (d *deviceTrack) observe(at time.Time) {
	at = at.UTC()
	if n := len(d.times); n > 0 && !at.After(d.times[n-1]) {
		return
	}
	d.times = append(d.times, at)
	if len(d.times) > storage.SeedLimit {
		d.times = append(d.times[:0:0], d.times[len(d.times)-storage.SeedLimit:]...)
	}
	if at.After(d.lastObserved) {
		d.lastObserved = at
	}
}

// window drops observed times older than seven days and returns those left.
func (d *deviceTrack) window(now time.Time) []time.Time {
	cutoff := now.Add(-connectivityWindow)
	first := sort.Search(len(d.times), func(i int) bool { return !d.times[i].Before(cutoff) })
	if first > 0 {
		d.times = append(d.times[:0:0], d.times[first:]...)
	}
	return d.times
}

// interval is the median gap between the device's recent observed times, once it has
// three readings and its history is read.
func (d *deviceTrack) interval(now time.Time) (time.Duration, bool) {
	times := d.window(now)
	if !d.seeded || len(times) < 3 {
		return 0, false
	}
	gaps := make([]time.Duration, 0, len(times)-1)
	for i := 1; i < len(times); i++ {
		gaps = append(gaps, times[i].Sub(times[i-1]))
	}
	slices.Sort(gaps)
	middle := len(gaps) / 2
	if len(gaps)%2 == 1 {
		return gaps[middle], true
	}
	return (gaps[middle-1] + gaps[middle]) / 2, true
}

func (d *deviceTrack) poll() time.Duration {
	if d.settings.PollIntervalSeconds == nil {
		return 0
	}
	return time.Duration(*d.settings.PollIntervalSeconds) * time.Second
}

// threshold is the Offline after in effect: set, or automatic once the device's
// reporting interval is known (D16). ok is false while it is still learning.
func (d *deviceTrack) threshold(now time.Time) (time.Duration, bool) {
	if d.settings.OfflineAfterSeconds != nil {
		return time.Duration(*d.settings.OfflineAfterSeconds) * time.Second, true
	}
	interval, ok := d.interval(now)
	if !ok {
		return 0, false
	}
	return automaticThreshold(interval, d.poll()), true
}

// automaticThreshold is clamp(ceil_to_minute(3 × interval + poll), 15 minutes, 7 days).
func automaticThreshold(interval, poll time.Duration) time.Duration {
	value := 3*interval + poll
	value = time.Duration(math.Ceil(value.Minutes())) * time.Minute
	return min(max(value, automaticMinimum), automaticMaximum)
}

func (d *deviceTrack) grace() time.Duration {
	return time.Duration(d.settings.GraceSeconds) * time.Second
}

type gatewayTrack struct {
	episodeTrack
	connection, edge string
	// grace and the threshold fields the last evaluation used, for its events.
	grace            time.Duration
	threshold        *deviceTrack
	thresholdValue   time.Duration
	thresholdApplies bool
	affectedNow      []string
	lastHeard        time.Time // the edge's, as the last evaluation saw it
}

type edgeTrack struct {
	connection, group, edge string
	adapter                 bool
	lastHeard, anchor       time.Time
	nodeDeadAt              time.Time // a death certificate from the edge node, until it is heard again
	adapterDown             bool
	adapterDownSince        time.Time
}

func (e *edgeTrack) silenceStart() time.Time { return latest(e.lastHeard, e.anchor) }

// connectivityChange is a row to store and, for a transition, its event. The tracker
// applies it (commit) once it is stored.
type connectivityChange struct {
	row        storage.ConnectivityRow
	transition string
	event      *connectivityEvent
}

type connectivitySubject struct {
	Kind           string  `json:"kind"`
	DeviceUUID     *string `json:"device_uuid"`
	ConnectionUUID *string `json:"connection_uuid"`
	EdgeNodeID     *string `json:"edge_node_id"`
	AdapterUUID    *string `json:"adapter_uuid"`
}

// connectivityEvent is the device.connectivity.v1 payload.
type connectivityEvent struct {
	OrganizationUUID         string              `json:"organization_uuid"`
	Subject                  connectivitySubject `json:"subject"`
	Episode                  int                 `json:"episode"`
	Transition               string              `json:"transition"`
	Cause                    *string             `json:"cause"`
	OfflineSince             *time.Time          `json:"offline_since"`
	At                       time.Time           `json:"at"`
	LastHeardAt              *time.Time          `json:"last_heard_at"`
	LastObservedAt           *time.Time          `json:"last_observed_at"`
	OfflineAfterSeconds      *int                `json:"offline_after_seconds"`
	OfflineAfterAutomatic    *bool               `json:"offline_after_automatic"`
	ReportingIntervalSeconds *int                `json:"reporting_interval_seconds"`
	PollIntervalSeconds      *int                `json:"poll_interval_seconds"`
	GraceSeconds             int                 `json:"grace_seconds"`
	SettingsGeneration       int64               `json:"settings_generation"`
	AffectedDeviceUUIDs      []string            `json:"affected_device_uuids"`
	StopReason               *string             `json:"stop_reason"`
}

// connectivityState is one device in GET /internal/connectivity.
type connectivityState struct {
	DeviceUUID               string     `json:"device_uuid"`
	State                    string     `json:"state"`
	MonitoringSince          *time.Time `json:"monitoring_since"`
	LastHeardAt              *time.Time `json:"last_heard_at"`
	LastObservedAt           *time.Time `json:"last_observed_at"`
	AnchorAt                 *time.Time `json:"anchor_at"`
	ReportingIntervalSeconds *int       `json:"reporting_interval_seconds"`
	ReadingsCounted          int        `json:"readings_counted"`
	PollIntervalSeconds      *int       `json:"poll_interval_seconds"`
	OfflineAfterSeconds      *int       `json:"offline_after_seconds"`
	OfflineAfterAutomatic    bool       `json:"offline_after_automatic"`
	SuppressedByGateway      bool       `json:"suppressed_by_gateway"`
	Interruption             *string    `json:"interruption"`
}

type connectivityTracker struct {
	mu         sync.Mutex
	started    time.Time
	nodeOnline func(connection, edge string) bool
	devices    map[string]*deviceTrack  // by device uuid
	gateways   map[string]*gatewayTrack // by subject key
	edges      map[string]*edgeTrack    // by connection/edge
	sources    map[string][]string      // device uuids by connection/edge/device id
	members    map[string][]string      // device uuids by connection/edge
	connected  map[string]bool          // broker connections that are up
	settings   map[string]devices.ConnectivitySettings
	loaded     map[string]storage.ConnectivityRow // stored rows not yet claimed by a subject
	seedDone   bool
}

func newConnectivityTracker(started time.Time, nodeOnline func(connection, edge string) bool) *connectivityTracker {
	if nodeOnline == nil {
		nodeOnline = func(string, string) bool { return false }
	}
	return &connectivityTracker{started: started, nodeOnline: nodeOnline, devices: map[string]*deviceTrack{}, gateways: map[string]*gatewayTrack{}, edges: map[string]*edgeTrack{}, sources: map[string][]string{}, members: map[string][]string{}, connected: map[string]bool{}, settings: map[string]devices.ConnectivitySettings{}, loaded: map[string]storage.ConnectivityRow{}}
}

// load resumes from the stored rows. Call before define.
func (t *connectivityTracker) load(rows []storage.ConnectivityRow) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, row := range rows {
		t.loaded[row.SubjectKey] = row
	}
}

func (t *connectivityTracker) edge(connection, group, edge string) *edgeTrack {
	key := connection + "/" + edge
	e := t.edges[key]
	if e == nil {
		e = &edgeTrack{connection: connection, group: group, edge: edge, adapter: adapterGroup(group), anchor: t.started}
		// An adapter is evaluated only from its node birth; one already online counts as born.
		if e.adapter && !t.nodeOnline(connection, edge) {
			e.adapterDown, e.adapterDownSince = true, t.started
		}
		t.edges[key] = e
	}
	return e
}

// define monitors a device's applied definition. A device already monitored keeps
// its state: a new configuration neither opens nor clears an episode nor moves its
// anchor (FR-010).
func (t *connectivityTracker) define(d devices.Definition, now time.Time) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	track := t.devices[d.DeviceUUID]
	if track != nil {
		t.unindex(track)
		track.def, track.removed = d, ""
	} else {
		key := "device:" + d.DeviceUUID
		track = &deviceTrack{episodeTrack: episodeTrack{key: key, organization: d.OrganizationUUID, kind: connectivityKindDev, monitoringSince: now}, def: d, anchor: t.started, seeded: t.seedDone, settings: devices.DefaultConnectivity()}
		if row, ok := t.loaded[key]; ok {
			track.restore(row)
			delete(t.loaded, key)
		}
		if settings, ok := t.settings[d.DeviceUUID]; ok {
			track.settings = settings
			delete(t.settings, d.DeviceUUID)
		}
		t.devices[d.DeviceUUID] = track
	}
	track.adapter = adapterGroup(d.Source.GroupID)
	t.edge(d.Source.ConnectionUUID, d.Source.GroupID, d.Source.EdgeNodeID)
	source := d.Source.Key()
	t.sources[source] = append(t.sources[source], d.DeviceUUID)
	t.members[track.edgeKey()] = append(t.members[track.edgeKey()], d.DeviceUUID)
}

func (t *connectivityTracker) unindex(d *deviceTrack) {
	remove := func(index map[string][]string, key string) {
		index[key] = slices.DeleteFunc(index[key], func(device string) bool { return device == d.def.DeviceUUID })
		if len(index[key]) == 0 {
			delete(index, key)
		}
	}
	remove(t.sources, d.def.Source.Key())
	remove(t.members, d.edgeKey())
}

// remove stops monitoring a device; an open episode is stopped with reason.
func (t *connectivityTracker) remove(device, reason string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if d := t.devices[device]; d != nil && d.removed == "" {
		t.unindex(d)
		d.removed = reason
	}
	delete(t.settings, device)
}

// configure applies a device's settings unless they are older than those it holds.
// Turning monitoring back on starts it again at now (D13).
func (t *connectivityTracker) configure(device string, settings devices.ConnectivitySettings, now time.Time) {
	if t == nil {
		return
	}
	if settings.Style == "" {
		settings.Style = styleStaysConnected
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	d := t.devices[device]
	if d == nil {
		if held, ok := t.settings[device]; !ok || settings.Generation >= held.Generation {
			t.settings[device] = settings
		}
		return
	}
	if settings.Generation < d.settings.Generation {
		return
	}
	if settings.Enabled && !d.settings.Enabled {
		d.monitoringSince, d.heard = now, false
		d.freeze()
	}
	d.settings = settings
	d.generation = settings.Generation
}

// connect records a broker connection that is up. Its subjects' silence counts from
// now, and what they did while it was down is unknown: deaths are forgotten (D3).
func (t *connectivityTracker) connect(connection string, at time.Time) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.connected[connection] = true
	for _, e := range t.edges {
		if e.connection != connection {
			continue
		}
		e.anchor, e.nodeDeadAt = latest(e.anchor, at), time.Time{}
		for _, device := range t.members[e.connection+"/"+e.edge] {
			d := t.devices[device]
			d.anchor, d.deadAt = latest(d.anchor, at), time.Time{}
			d.freeze()
		}
		if g := t.gateways["gateway:"+e.connection+"/"+e.edge]; g != nil {
			g.freeze()
		}
	}
}

// disconnect records a lost broker connection: its subjects are not evaluated until
// it is back, and its adapters count as down until their next node birth.
func (t *connectivityTracker) disconnect(connection string, at time.Time) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.connected[connection] = false
	for _, e := range t.edges {
		if e.connection == connection && e.adapter && !e.adapterDown {
			e.adapterDown, e.adapterDownSince = true, at
		}
	}
}

// heard records a packet received on a Sparkplug edge outside adapter groups, before
// it is validated: a rejected packet still shows the source is alive (D2). device is
// "" for node packets.
func (t *connectivityTracker) heard(connection, group, edge, device string, at time.Time) {
	if t == nil || adapterGroup(group) {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hearEdge(connection, group, edge, at)
	for _, uuid := range t.sources[connection+"/"+edge+"/"+device] {
		t.devices[uuid].hear(at)
	}
}

func (t *connectivityTracker) hearEdge(connection, group, edge string, at time.Time) *edgeTrack {
	e := t.edge(connection, group, edge)
	if at.After(e.lastHeard) {
		e.lastHeard = at
	}
	if !e.nodeDeadAt.IsZero() && at.After(e.nodeDeadAt) {
		e.nodeDeadAt = time.Time{}
	}
	if g := t.gateways["gateway:"+connection+"/"+edge]; g != nil {
		if !g.heard && !at.Before(g.monitoringSince) {
			g.heard = true
		}
		g.back(at)
	}
	return e
}

// died records an accepted death certificate (device "" for the edge node's). On an
// adapter edge the node's death is the platform's: its devices are not evaluated
// until the next node birth (D3).
func (t *connectivityTracker) died(connection, group, edge, device string, at time.Time) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if adapterGroup(group) {
		if e := t.edge(connection, group, edge); device == "" && !e.adapterDown {
			e.adapterDown, e.adapterDownSince = true, at
			for _, uuid := range t.members[connection+"/"+edge] {
				t.devices[uuid].freeze()
			}
		}
		return
	}
	e := t.hearEdge(connection, group, edge, at)
	for _, uuid := range t.sources[connection+"/"+edge+"/"+device] {
		t.devices[uuid].hear(at)
	}
	if device == "" {
		e.nodeDeadAt = at
		if g := t.gateways["gateway:"+connection+"/"+edge]; g != nil {
			g.backSince = time.Time{}
		}
		for _, uuid := range t.members[connection+"/"+edge] {
			if d := t.devices[uuid]; d.settings.Style != styleConnectsReport {
				d.backSince = time.Time{}
			}
		}
		return
	}
	for _, uuid := range t.sources[connection+"/"+edge+"/"+device] {
		if d := t.devices[uuid]; d.settings.Style != styleConnectsReport {
			d.deadAt, d.backSince = at, time.Time{}
		}
	}
}

// adapterBorn ends an adapter's interruption at its node birth: each of its devices'
// silence leaves out the time the adapter was down, counted from the later of its
// death and the device's own silence start (D3).
func (t *connectivityTracker) adapterBorn(connection, group, edge string, at time.Time) {
	if t == nil || !adapterGroup(group) {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.edge(connection, group, edge)
	if !e.adapterDown {
		return
	}
	for _, uuid := range t.members[connection+"/"+edge] {
		d := t.devices[uuid]
		start := d.silenceStart()
		if from := latest(e.adapterDownSince, start); at.After(from) {
			d.anchor = start.Add(at.Sub(from))
		}
		d.freeze()
	}
	e.adapterDown, e.adapterDownSince = false, time.Time{}
}

// readings records the observed times of a device's readings that are not marked
// historical. On an adapter edge only a data packet's new readings count as hearing
// from the device; births it announces again do not (D2).
func (t *connectivityTracker) readings(device string, data bool, received time.Time, observed []time.Time) {
	if t == nil || len(observed) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	d := t.devices[device]
	if d == nil || d.removed != "" {
		return
	}
	if d.adapter {
		if !data {
			return
		}
		e := t.edges[d.edgeKey()]
		if received.After(e.lastHeard) {
			e.lastHeard = received
		}
		d.hear(received)
	}
	sorted := slices.Clone(observed)
	slices.SortFunc(sorted, func(a, b time.Time) int { return a.Compare(b) })
	for _, at := range sorted {
		d.observe(at)
	}
}

// seed merges a device's stored readings, read at start, and ends its learning from
// them. Its newest reading's receipt is when it was last heard, which alerts show; its
// silence still counts from the runtime's start (D3).
func (t *connectivityTracker) seed(history map[string]storage.SeedHistory, batch []string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, device := range batch {
		d := t.devices[device]
		if d == nil {
			continue
		}
		stored := history[device]
		if stored.LastReceived.After(d.lastHeard) {
			d.lastHeard = stored.LastReceived
			if e := t.edges[d.edgeKey()]; e != nil && !d.adapter && d.lastHeard.After(e.lastHeard) {
				e.lastHeard = d.lastHeard
			}
		}
		merged := append(slices.Clone(stored.Observed), d.times...)
		slices.SortFunc(merged, func(a, b time.Time) int { return a.Compare(b) })
		merged = slices.CompactFunc(merged, func(a, b time.Time) bool { return a.Equal(b) })
		if len(merged) > storage.SeedLimit {
			merged = merged[len(merged)-storage.SeedLimit:]
		}
		d.times, d.seeded = merged, true
		if n := len(merged); n > 0 && merged[n-1].After(d.lastObserved) {
			d.lastObserved = merged[n-1]
		}
	}
}

// seeding lists the devices whose history is still to be read; finishSeeding marks
// the seed done, so devices defined later learn from their own readings.
func (t *connectivityTracker) seeding() []storage.SeedDevice {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	result := []storage.SeedDevice{}
	for uuid, d := range t.devices {
		if !d.seeded {
			result = append(result, storage.SeedDevice{OrganizationUUID: d.organization, DeviceUUID: uuid})
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DeviceUUID < result[j].DeviceUUID })
	return result
}

func (t *connectivityTracker) finishSeeding() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seedDone = true
	for _, d := range t.devices {
		d.seeded = true
	}
}

// evaluate judges every subject at now and returns the rows and transitions to store.
// Nothing about episodes changes until commit applies a stored change.
func (t *connectivityTracker) evaluate(now time.Time) []connectivityChange {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	changes := []connectivityChange{}
	gateways := map[string]bool{}
	for edgeKey, uuids := range t.members {
		e := t.edges[edgeKey]
		if e == nil || e.adapter {
			continue
		}
		members := []*deviceTrack{}
		staying := 0
		for _, uuid := range uuids {
			if d := t.devices[uuid]; d.removed == "" && d.settings.Enabled {
				members = append(members, d)
				if d.settings.Style != styleConnectsReport {
					staying++
				}
			}
		}
		// Two or more devices that stay connected behind one edge make it a gateway (D4).
		if staying < 2 {
			continue
		}
		key := "gateway:" + edgeKey
		gateways[key] = true
		g := t.gateways[key]
		if g == nil {
			g = &gatewayTrack{episodeTrack: episodeTrack{key: key, organization: members[0].organization, kind: connectivityKindGate, monitoringSince: now}, connection: e.connection, edge: e.edge}
			if row, ok := t.loaded[key]; ok {
				g.restore(row)
				delete(t.loaded, key)
			} else {
				// A gateway is monitored as long as its devices are.
				for _, d := range members {
					g.heard = g.heard || d.heard
					if d.monitoringSince.Before(g.monitoringSince) {
						g.monitoringSince = d.monitoringSince
					}
				}
			}
			t.gateways[key] = g
		}
		g.removed = ""
		changes = append(changes, t.evaluateGateway(g, e, members, now)...)
	}
	for key, g := range t.gateways {
		if gateways[key] {
			continue
		}
		if !g.open {
			delete(t.gateways, key)
			continue
		}
		g.removed = stopRemoved
		changes = append(changes, t.stop(&g.episodeTrack, g.event("stopped", now, stopRemoved), now))
	}
	for uuid, d := range t.devices {
		if change, ok := t.evaluateDevice(d, now); ok {
			changes = append(changes, change)
		} else if d.removed != "" && !d.open {
			delete(t.devices, uuid)
		}
	}
	// Stored rows no subject claimed belong to subjects that are gone: an open episode
	// is stopped, and the rest are forgotten, so a device defined later starts afresh.
	for key, row := range t.loaded {
		if !row.Open || len(row.AffectedDeviceUUIDs) == 0 {
			delete(t.loaded, key)
			continue
		}
		orphan := &episodeTrack{}
		orphan.restore(row)
		orphan.key, orphan.organization, orphan.kind = key, row.OrganizationUUID, row.Kind
		changes = append(changes, t.stop(orphan, orphanEvent(row, now), now))
	}
	return changes
}

func (t *connectivityTracker) stop(s *episodeTrack, ev connectivityEvent, now time.Time) connectivityChange {
	row := s.row()
	row.Open, row.OfflineSince, row.OpenedAt = false, nil, nil
	return connectivityChange{row: row, transition: "stopped", event: &ev}
}

func orphanEvent(row storage.ConnectivityRow, now time.Time) connectivityEvent {
	ev := connectivityEvent{OrganizationUUID: row.OrganizationUUID, Episode: row.Episode, Transition: "stopped", At: now, GraceSeconds: 0, SettingsGeneration: row.SettingsGeneration, AffectedDeviceUUIDs: row.AffectedDeviceUUIDs}
	ev.Subject = subjectOf(row.SubjectKey)
	ev.Cause = text(row.Cause)
	ev.OfflineSince = row.OfflineSince
	ev.StopReason = text(stopRemoved)
	return ev
}

// subjectOf is the event subject of a subject key.
func subjectOf(key string) connectivitySubject {
	kind, rest, _ := strings.Cut(key, ":")
	switch kind {
	case "gateway":
		connection, edge, _ := strings.Cut(rest, "/")
		return connectivitySubject{Kind: kind, ConnectionUUID: &connection, EdgeNodeID: &edge}
	case "source":
		return connectivitySubject{Kind: kind, AdapterUUID: &rest}
	}
	return connectivitySubject{Kind: connectivityKindDev, DeviceUUID: &rest}
}

// interruption says why a device is not evaluated now, or "".
func (t *connectivityTracker) interruption(d *deviceTrack) string {
	if !t.connected[d.def.Source.ConnectionUUID] {
		return interruptConnection
	}
	if e := t.edges[d.edgeKey()]; e != nil && e.adapter && e.adapterDown {
		return interruptAdapter
	}
	return ""
}

func (t *connectivityTracker) evaluateDevice(d *deviceTrack, now time.Time) (connectivityChange, bool) {
	if d.removed != "" {
		if !d.open {
			return connectivityChange{}, false
		}
		return t.stop(&d.episodeTrack, t.deviceEvent(d, "stopped", now, d.removed), now), true
	}
	if !d.settings.Enabled {
		d.freeze()
		if d.open {
			return t.stop(&d.episodeTrack, t.deviceEvent(d, "stopped", now, stopDisabled), now), true
		}
		return t.save(&d.episodeTrack)
	}
	if t.interruption(d) != "" || !d.heard {
		d.freeze()
		return t.save(&d.episodeTrack)
	}
	e := t.edges[d.edgeKey()]
	g := t.gateways["gateway:"+d.edgeKey()]
	gateway := g != nil && g.removed == ""
	cause, since := t.deviceCondition(d, e, gateway, now)
	// While its gateway is offline, or going offline, a device opens nothing of its own (D4).
	if gateway && !d.open && (g.open || !g.pendingSince.IsZero()) {
		d.freeze()
		return t.save(&d.episodeTrack)
	}
	switch d.step(now, cause, since, d.grace(), d.settings.Style == styleConnectsReport) {
	case "opened":
		ev := t.deviceEvent(d, "opened", d.pendingSince.Add(d.grace()), "")
		ev.Episode = d.episode + 1
		ev.Cause, ev.OfflineSince = text(d.pendingCause), timePointer(d.pendingSince)
		row := d.row()
		row.Episode, row.Open, row.Cause = ev.Episode, true, d.pendingCause
		row.OfflineSince, row.OpenedAt = timePointer(d.pendingSince), timePointer(ev.At)
		row.AffectedDeviceUUIDs = []string{d.def.DeviceUUID}
		return connectivityChange{row: row, transition: "opened", event: &ev}, true
	case "cleared":
		ev := t.deviceEvent(d, "cleared", d.backSince, "")
		row := d.row()
		row.Open, row.OfflineSince, row.OpenedAt = false, nil, nil
		return connectivityChange{row: row, transition: "cleared", event: &ev}, true
	}
	return t.save(&d.episodeTrack)
}

// deviceCondition is a device's offline condition now: a death certificate for a
// device that stays connected (its own, or its edge node's when the edge is not a
// gateway; never an adapter's), else a silence past its threshold. Behind a gateway,
// silence counts only while the gateway itself is heard; otherwise the gateway's
// silence is judged as one (D4).
func (t *connectivityTracker) deviceCondition(d *deviceTrack, e *edgeTrack, gateway bool, now time.Time) (string, time.Time) {
	if d.settings.Style != styleConnectsReport && !d.adapter {
		if !d.deadAt.IsZero() {
			return causeDeath, d.deadAt
		}
		if !gateway && !e.nodeDeadAt.IsZero() {
			if d.def.Source.DeviceID == "" {
				return causeDeath, e.nodeDeadAt
			}
			return causeGateway, e.nodeDeadAt
		}
	}
	threshold, ok := d.threshold(now)
	if !ok {
		return "", time.Time{}
	}
	start := d.silenceStart()
	if now.Sub(start) < threshold || gateway && now.Sub(e.silenceStart()) >= threshold {
		return "", time.Time{}
	}
	return causeSilence, start.Add(threshold)
}

func (t *connectivityTracker) evaluateGateway(g *gatewayTrack, e *edgeTrack, members []*deviceTrack, now time.Time) []connectivityChange {
	g.grace, g.threshold, g.thresholdValue, g.thresholdApplies, g.lastHeard = 0, nil, 0, false, e.lastHeard
	g.affectedNow = make([]string, 0, len(members))
	for _, d := range members {
		g.affectedNow = append(g.affectedNow, d.def.DeviceUUID)
		g.grace = max(g.grace, d.grace())
		if !d.heard {
			continue
		}
		if threshold, ok := d.threshold(now); ok && (g.threshold == nil || threshold > g.thresholdValue) {
			g.threshold, g.thresholdValue, g.thresholdApplies = d, threshold, true
		}
	}
	slices.Sort(g.affectedNow)
	if !t.connected[e.connection] || !g.heard {
		g.freeze()
		if change, ok := t.save(&g.episodeTrack); ok {
			return []connectivityChange{change}
		}
		return nil
	}
	cause, since := "", time.Time{}
	switch {
	case !e.nodeDeadAt.IsZero():
		cause, since = causeDeath, e.nodeDeadAt
	case g.thresholdApplies && now.Sub(e.silenceStart()) >= g.thresholdValue:
		cause, since = causeSilence, e.silenceStart().Add(g.thresholdValue)
	}
	switch g.step(now, cause, since, g.grace, false) {
	case "opened":
		ev := g.event("opened", g.pendingSince.Add(g.grace), "")
		ev.Episode = g.episode + 1
		ev.Cause, ev.OfflineSince = text(g.pendingCause), timePointer(g.pendingSince)
		row := g.row()
		row.Episode, row.Open, row.Cause, row.AffectedDeviceUUIDs = ev.Episode, true, g.pendingCause, g.affectedNow
		row.OfflineSince, row.OpenedAt = timePointer(g.pendingSince), timePointer(ev.At)
		return []connectivityChange{{row: row, transition: "opened", event: &ev}}
	case "cleared":
		ev := g.event("cleared", g.backSince, "")
		row := g.row()
		row.Open, row.OfflineSince, row.OpenedAt = false, nil, nil
		return []connectivityChange{{row: row, transition: "cleared", event: &ev}}
	}
	if change, ok := t.save(&g.episodeTrack); ok {
		return []connectivityChange{change}
	}
	return nil
}

// save proposes storing a subject whose monitoring changed.
func (t *connectivityTracker) save(s *episodeTrack) (connectivityChange, bool) {
	if !s.changed() {
		return connectivityChange{}, false
	}
	return connectivityChange{row: s.row()}, true
}

func (t *connectivityTracker) deviceEvent(d *deviceTrack, transition string, at time.Time, stop string) connectivityEvent {
	device := d.def.DeviceUUID
	ev := connectivityEvent{OrganizationUUID: d.organization, Subject: connectivitySubject{Kind: connectivityKindDev, DeviceUUID: &device}, Episode: d.episode, Transition: transition, Cause: text(d.cause), At: at.UTC(),
		LastHeardAt: timePointer(d.lastHeard), LastObservedAt: timePointer(d.lastObserved), PollIntervalSeconds: d.settings.PollIntervalSeconds, GraceSeconds: d.settings.GraceSeconds, SettingsGeneration: d.settings.Generation, AffectedDeviceUUIDs: []string{device}, StopReason: text(stop)}
	if d.open {
		ev.OfflineSince = timePointer(d.offlineSince)
	}
	automatic := d.settings.OfflineAfterSeconds == nil
	ev.OfflineAfterAutomatic = &automatic
	if threshold, ok := d.threshold(at); ok {
		ev.OfflineAfterSeconds = seconds(threshold)
	}
	if interval, ok := d.interval(at); ok {
		ev.ReportingIntervalSeconds = seconds(interval)
	}
	return ev
}

func (g *gatewayTrack) event(transition string, at time.Time, stop string) connectivityEvent {
	connection, edge := g.connection, g.edge
	affected := g.affected
	if transition == "opened" || len(affected) == 0 {
		affected = g.affectedNow
	}
	ev := connectivityEvent{OrganizationUUID: g.organization, Subject: connectivitySubject{Kind: connectivityKindGate, ConnectionUUID: &connection, EdgeNodeID: &edge}, Episode: g.episode, Transition: transition, Cause: text(g.cause), At: at.UTC(),
		LastHeardAt: timePointer(g.lastHeard), GraceSeconds: int(g.grace / time.Second), AffectedDeviceUUIDs: affected, StopReason: text(stop)}
	if g.open {
		ev.OfflineSince = timePointer(g.offlineSince)
	}
	if g.thresholdApplies {
		d := g.threshold
		automatic := d.settings.OfflineAfterSeconds == nil
		ev.OfflineAfterSeconds, ev.OfflineAfterAutomatic, ev.PollIntervalSeconds, ev.SettingsGeneration = seconds(g.thresholdValue), &automatic, d.settings.PollIntervalSeconds, d.settings.Generation
		if interval, ok := d.interval(at); ok {
			ev.ReportingIntervalSeconds = seconds(interval)
		}
	}
	return ev
}

// commit applies a stored change. When a gateway's episode clears, its devices are
// judged from its return (FR-012).
func (t *connectivityTracker) commit(change connectivityChange) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := change.row.SubjectKey
	var s *episodeTrack
	if strings.HasPrefix(key, "device:") {
		if d := t.devices[strings.TrimPrefix(key, "device:")]; d != nil {
			s = &d.episodeTrack
		}
	} else if g := t.gateways[key]; g != nil {
		s = &g.episodeTrack
		if change.transition == "cleared" {
			for _, uuid := range t.members[g.connection+"/"+g.edge] {
				d := t.devices[uuid]
				d.anchor = latest(d.anchor, g.backSince)
				d.freeze()
			}
		}
		if change.transition == "opened" {
			for _, uuid := range t.members[g.connection+"/"+g.edge] {
				if d := t.devices[uuid]; !d.open {
					d.freeze()
				}
			}
		}
	}
	delete(t.loaded, key)
	stored := change.row
	if s == nil {
		return
	}
	s.stored = &stored
	s.heard = s.heard || stored.HeardSinceMonitoring
	switch change.transition {
	case "opened":
		s.episode, s.open, s.cause, s.affected = stored.Episode, true, stored.Cause, slices.Clone(stored.AffectedDeviceUUIDs)
		s.offlineSince, s.openedAt = *stored.OfflineSince, *stored.OpenedAt
		s.pendingSince, s.pendingCause = time.Time{}, ""
		// A packet heard while the episode was being stored already started its return.
		if !s.backSince.IsZero() && !s.backSince.After(s.offlineSince) {
			s.backSince = time.Time{}
		}
	case "cleared", "stopped":
		s.open, s.offlineSince, s.openedAt, s.affected = false, time.Time{}, time.Time{}, nil
		s.freeze()
		stored.AffectedDeviceUUIDs = nil
		if change.transition == "stopped" && s.removed != "" {
			if strings.HasPrefix(key, "device:") {
				delete(t.devices, strings.TrimPrefix(key, "device:"))
			} else {
				delete(t.gateways, key)
			}
		}
	}
}

// active lists the subjects being monitored, whose rows the daily cleanup keeps.
func (t *connectivityTracker) active() []string {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	keys := []string{}
	for _, d := range t.devices {
		keys = append(keys, d.key)
	}
	for key := range t.gateways {
		keys = append(keys, key)
	}
	return keys
}

// state reports the organization's devices for GET /internal/connectivity. A device
// the runtime does not monitor is left out.
func (t *connectivityTracker) state(organization string, uuids []string, now time.Time) []connectivityState {
	result := []connectivityState{}
	if t == nil {
		return result
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, uuid := range uuids {
		d := t.devices[uuid]
		if d == nil || d.organization != organization || d.removed != "" {
			continue
		}
		state := connectivityState{DeviceUUID: uuid, MonitoringSince: timePointer(d.monitoringSince), LastHeardAt: timePointer(d.lastHeard), LastObservedAt: timePointer(d.lastObserved), ReadingsCounted: len(d.window(now)), PollIntervalSeconds: d.settings.PollIntervalSeconds, OfflineAfterAutomatic: d.settings.OfflineAfterSeconds == nil}
		if d.heard {
			state.AnchorAt = timePointer(d.silenceStart())
		}
		if interval, ok := d.interval(now); ok {
			state.ReportingIntervalSeconds = seconds(interval)
		}
		threshold, known := d.threshold(now)
		if known {
			state.OfflineAfterSeconds = seconds(threshold)
		}
		if g := t.gateways["gateway:"+d.edgeKey()]; g != nil && g.removed == "" && (g.open || !g.pendingSince.IsZero()) {
			state.SuppressedByGateway = true
		}
		interruption := t.interruption(d)
		if interruption != "" {
			state.Interruption = &interruption
		}
		switch {
		case !d.settings.Enabled:
			state.State = "disabled"
		case d.open && !d.backSince.IsZero():
			state.State = "recovering"
		case d.open:
			state.State = "offline"
		case interruption != "":
			state.State = "interrupted"
		case !d.heard:
			state.State = "waiting"
		case !d.pendingSince.IsZero():
			state.State = "pending"
		case !known:
			state.State = "learning"
		default:
			state.State = "monitored"
		}
		result = append(result, state)
	}
	return result
}

func latest(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func timePointer(at time.Time) *time.Time {
	if at.IsZero() {
		return nil
	}
	utc := at.UTC()
	return &utc
}

func text(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func seconds(d time.Duration) *int {
	value := max(1, int(math.Round(d.Seconds())))
	return &value
}

// evaluateConnectivity judges every subject on the maintenance tick and stores what
// changed: each transition with its event in one transaction, then the tracker
// applies it. A change that fails to store is proposed again on the next tick.
func (a *Application) evaluateConnectivity(now time.Time) {
	saves := []connectivityChange{}
	for _, change := range a.connectivity.evaluate(now) {
		if change.event == nil {
			saves = append(saves, change)
			continue
		}
		raw, e := json.Marshal(change.event)
		if e != nil {
			a.Logger.Error("connectivity event could not be encoded", "subject", change.row.SubjectKey, "error", e)
			continue
		}
		ev := devices.Event{UUID: storage.ConnectivityEventUUID(change.row.SubjectKey, change.event.Episode, change.transition), Type: "device.connectivity.v1", Payload: raw}
		if _, e = a.Store.TransitionConnectivity(a.ctx, change.row, ev); e != nil {
			a.Logger.Warn("connectivity transition deferred", "subject", change.row.SubjectKey, "transition", change.transition, "error", e)
			continue
		}
		a.connectivity.commit(change)
	}
	if len(saves) == 0 {
		return
	}
	rows := make([]storage.ConnectivityRow, len(saves))
	for i, change := range saves {
		rows[i] = change.row
	}
	if e := a.Store.SaveConnectivity(a.ctx, rows); e != nil {
		a.Logger.Warn("connectivity rows deferred", "rows", len(rows), "error", e)
		return
	}
	for _, change := range saves {
		a.connectivity.commit(change)
	}
}

// seedBatch is how many devices one reporting-interval seed query reads.
const seedBatch = 500

// seedConnectivity reads the devices' recent observed times after start, in batches,
// without holding up ingestion; until its batch is read a device with an automatic
// Offline after is learning (D16). A failed batch learns from its own readings.
func (a *Application) seedConnectivity(ctx context.Context) {
	pending := a.connectivity.seeding()
	since := time.Now().UTC().Add(-connectivityWindow)
	for start := 0; start < len(pending); start += seedBatch {
		batch := pending[start:min(start+seedBatch, len(pending))]
		history, e := a.Store.ReportingSeed(ctx, batch, since)
		if e != nil {
			if ctx.Err() != nil {
				return
			}
			a.Logger.Warn("reporting interval seed failed; devices learn from new readings", "devices", len(batch), "error", e)
		}
		uuids := make([]string, len(batch))
		for i, d := range batch {
			uuids[i] = d.DeviceUUID
		}
		a.connectivity.seed(history, uuids)
	}
	a.connectivity.finishSeeding()
}

// connectivityHTTP answers GET /internal/connectivity?organization=<uuid>&devices=<uuid,…>
// with the monitoring state of at most 500 of the organization's devices.
func (a *Application) connectivityHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	organization := query.Get("organization")
	if organization == "" {
		respond(w, 422, map[string]string{"message": "organization is required"})
		return
	}
	uuids := []string{}
	for key, values := range query {
		if key != "devices" && !strings.HasPrefix(key, "devices[") {
			continue
		}
		for _, value := range values {
			for _, uuid := range strings.Split(value, ",") {
				if uuid = strings.TrimSpace(uuid); uuid != "" {
					uuids = append(uuids, uuid)
				}
			}
		}
	}
	if len(uuids) > 500 {
		respond(w, 422, map[string]string{"message": "at most 500 devices"})
		return
	}
	respond(w, 200, map[string]any{"devices": a.connectivity.state(organization, uuids, time.Now().UTC())})
}
