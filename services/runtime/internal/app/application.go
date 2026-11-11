package app

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/telemetry"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/nats-io/nats.go"
	"google.golang.org/protobuf/proto"
)

type pendingCommand struct {
	Request             devices.Command
	SentAt              time.Time
	Sent, Observed      bool
	Outcome, Diagnostic string
}
type broker struct {
	Connection     devices.Connection
	Client         mqtt.Client
	StateTimestamp *atomic.Int64
}
type rebirthRequest struct{ Connection, Group, Edge string }
type reportedPresence struct{ Presence, Diagnostic string }

// heldActivation is an activation waiting for its source's birth: the edge node is
// online but has not announced the source in its current session yet (R19).
type heldActivation struct {
	Definition devices.Definition
	Generation int
	Birth      []devices.Metric
	Operation  string
	Deadline   time.Time
}

// rebirthInterval is the least time between rebirth requests to one edge node.
const rebirthInterval = 30 * time.Second

// birthWait bounds a held activation. An SDK gateway re-announces 512 devices in
// about 26 s at 20 births per second, and a queued rebirth can restart that up to
// rebirthInterval after the last one.
const birthWait = 90 * time.Second

type Application struct {
	captures          *telemetry.Manager
	committedFailures atomic.Uint64
	// broadcaster fans committed events out to open telemetry streams; streamsOpen
	// counts them (spec 030).
	broadcaster    committedBroadcaster
	streamsOpen    atomic.Int64
	deadLetters    atomic.Uint64
	rulesHealthy   atomic.Bool
	rulesFault     atomic.Pointer[ruleFault]
	rulesRetry     chan struct{}
	fences         sync.Map
	releaseRuntime func()
	ctx            context.Context
	mu             sync.Mutex
	Store          *storage.Store
	Control        *ControlClient
	JS             nats.JetStreamContext
	NATS           *nats.Conn
	Logger         *slog.Logger
	Engine         *sparkplug.Engine
	definitions    map[string]devices.Definition
	generations    map[string]int
	// appliedGeneration is the generation each applied definition came with; a refused
	// activation advances generations and leaves it (ADR-027).
	appliedGeneration map[string]int
	activeSince       map[string]time.Time
	latest            map[string]map[string]devices.Reading
	sessions          map[string]string
	compatible        map[string]bool
	reviewRequired    map[string]bool
	brokers           map[string]*broker
	pending           map[string]*pendingCommand
	rebirth           map[string]time.Time
	rebirthPending    map[string]rebirthRequest
	// usageFinalThrough is the final_through of the last usage report written; only
	// the usage reporter's loop touches it (spec 029 US3).
	usageFinalThrough time.Time
	held              map[string]heldActivation // by device
	heldFor           time.Duration             // bounds a hold; birthWait when zero
	presenceAt        map[string]time.Time
	reported          map[string]reportedPresence
	connectivity      *connectivityTracker
	subscriptions     []*nats.Subscription
	tlsConfig         *tls.Config
}

func New(ctx context.Context, store *storage.Store, logger *slog.Logger) (*Application, error) {
	token := os.Getenv("DEVICE_RUNTIME_TOKEN")
	if len(token) < 32 {
		return nil, errors.New("DEVICE_RUNTIME_TOKEN must contain at least 32 characters")
	}
	roots, e := x509.SystemCertPool()
	if e != nil {
		roots = x509.NewCertPool()
	}
	if file := os.Getenv("DEVICE_MQTT_CA_FILE"); file != "" {
		raw, e := os.ReadFile(file)
		if e != nil {
			return nil, e
		}
		if !roots.AppendCertsFromPEM(raw) {
			return nil, errors.New("invalid MQTT CA certificate")
		}
	}
	releaseRuntime, e := store.ExclusiveRuntime(ctx)
	if e != nil {
		return nil, e
	}
	started := false
	defer func() {
		if !started {
			releaseRuntime()
		}
	}()
	a := &Application{releaseRuntime: releaseRuntime, ctx: ctx, Store: store, Logger: logger, Control: &ControlClient{URL: env("DEVICE_CONTROL_URL", "http://api:8000/api/internal/devices"), Token: token, Client: &http.Client{Timeout: 10 * time.Second}}, Engine: sparkplug.NewEngine(), definitions: map[string]devices.Definition{}, generations: map[string]int{}, appliedGeneration: map[string]int{}, latest: map[string]map[string]devices.Reading{}, sessions: map[string]string{}, compatible: map[string]bool{}, reviewRequired: map[string]bool{}, brokers: map[string]*broker{}, pending: map[string]*pendingCommand{}, rebirth: map[string]time.Time{}, rebirthPending: map[string]rebirthRequest{}, presenceAt: map[string]time.Time{}, tlsConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}, rulesRetry: make(chan struct{}, 1)}
	nc, e := nats.Connect(env("NATS_URL", "nats://nats:4222"), nats.Name("iot-devices-runtime"), nats.MaxReconnects(-1))
	if e != nil {
		return nil, e
	}
	a.NATS = nc
	a.JS, e = nc.JetStream(nats.PublishAsyncMaxPending(256))
	if e != nil {
		nc.Close()
		return nil, e
	}
	if e = store.RecoverCommands(ctx); e != nil {
		nc.Close()
		return nil, e
	}
	saved, e := store.SavedDevices(ctx)
	if e != nil {
		return nil, e
	}
	for _, state := range saved {
		a.generations[state.UUID] = state.Generation
		a.reviewRequired[state.UUID] = state.ReviewRequired
		if state.Applied != nil {
			a.definitions[state.UUID] = *state.Applied
			a.appliedGeneration[state.UUID] = state.AppliedGeneration
			if a.activeSince == nil {
				a.activeSince = map[string]time.Time{}
			}
			a.activeSince[state.UUID] = time.Now().UTC()
		}
	}
	// Offline detection resumes from its stored rows; silence counts from now (D3).
	a.connectivity = newConnectivityTracker(time.Now().UTC(), a.Engine.NodeOnline)
	rows, e := store.LoadConnectivity(ctx)
	if e != nil {
		nc.Close()
		return nil, e
	}
	a.connectivity.load(rows)
	for _, d := range a.definitions {
		a.connectivity.define(d, time.Now().UTC())
	}
	if e = a.subscribe(); e != nil {
		nc.Close()
		return nil, e
	}
	if e = awaitControlPlane(ctx, logger, controlPlaneStartupWait, startupDelay, a.syncState); e != nil {
		nc.Close()
		return nil, e
	}
	if e = a.startRuleConsumer(ctx); e != nil {
		// Devices, history and commands stay available; workflows wait for recovery.
		a.pauseRules(ctx, e)
	}
	go a.relay(ctx)
	go a.relayCommitted(ctx)
	go a.maintenance(ctx)
	go a.reportUsageEvery(ctx, time.Minute)
	go a.seedConnectivity(ctx)
	started = true
	return a, nil
}

// Every device operation, persistence boundary, and acknowledgement uses this fence.
func (a *Application) lockDevice(uuid string) func() {
	value, _ := a.fences.LoadOrStore(uuid, &sync.Mutex{})
	mutex := value.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func (a *Application) syncState() error {
	var state devices.ControlState
	if e := a.Control.request(a.ctx, "GET", "/state", nil, &state); e != nil {
		return e
	}
	for _, connection := range state.Connections {
		// Its gateways' offline episodes belong to its organization (spec 031).
		a.connectivity.organize(connection.UUID, connection.OrganizationUUID)
		a.mu.Lock()
		existing := a.brokers[connection.UUID]
		a.mu.Unlock()
		if existing == nil {
			if e := a.connect(connection); e != nil {
				a.Logger.Warn("MQTT connection pending", "connection", connection.UUID, "error", e)
			}
		}
	}
	for _, d := range state.Devices {
		settings := devices.DefaultConnectivity()
		if d.Connectivity != nil {
			settings = *d.Connectivity
		}
		a.connectivity.configure(d.UUID, settings, time.Now().UTC())
		a.mu.Lock()
		generation := a.generations[d.UUID]
		a.mu.Unlock()

		if d.DeploymentStatus == "pending" && d.Generation >= generation {
			if d.Desired != nil {
				_ = a.activate(*d.Desired, d.Generation, d.BirthMetrics, d.OperationUUID)
			} else {
				_ = a.deactivate(d.UUID, d.OrganizationUUID, d.Generation, d.OperationUUID)
			}
		}
	}
	return nil
}
func (a *Application) connect(c devices.Connection) error {
	if len(c.BrokerURL) < 6 || c.BrokerURL[:6] != "ssl://" {
		return errors.New("MQTT connections require TLS (ssl://)")
	}
	timestamp := time.Now().UnixMilli()
	stateTimestamp := &atomic.Int64{}
	stateTimestamp.Store(timestamp)
	will, _ := json.Marshal(map[string]any{"online": false, "timestamp": timestamp})
	options := mqtt.NewClientOptions().AddBroker(c.BrokerURL).SetClientID(c.HostID).SetUsername(c.Username).SetPassword(c.Password).SetTLSConfig(a.tlsConfig.Clone()).SetAutoReconnect(true).SetConnectRetry(true).SetConnectRetryInterval(2*time.Second).SetCleanSession(true).SetOrderMatters(true).SetKeepAlive(20*time.Second).SetConnectTimeout(5*time.Second).SetWill("spBv1.0/STATE/"+c.HostID, string(will), 1, true)
	options.SetConnectionLostHandler(func(_ mqtt.Client, e error) { a.connectionLost(c.UUID, e) })
	options.SetReconnectingHandler(func(_ mqtt.Client, opts *mqtt.ClientOptions) {
		next := time.Now().UnixMilli()
		stateTimestamp.Store(next)
		payload, _ := json.Marshal(map[string]any{"online": false, "timestamp": next})
		opts.SetWill("spBv1.0/STATE/"+c.HostID, string(payload), 1, true)
	})
	options.SetOnConnectHandler(func(client mqtt.Client) {
		topics := map[string]byte{"spBv1.0/STATE/" + c.HostID: 1}
		for _, kind := range []string{"NBIRTH", "NDATA", "NDEATH"} {
			topics["spBv1.0/"+c.GroupID+"/"+kind+"/+"] = 0
		}
		for _, kind := range []string{"DBIRTH", "DDATA", "DDEATH"} {
			topics["spBv1.0/"+c.GroupID+"/"+kind+"/+/+"] = 0
		}
		token := client.SubscribeMultiple(topics, func(_ mqtt.Client, message mqtt.Message) {
			if message.Topic() == "spBv1.0/STATE/"+c.HostID {
				return
			}
			a.packet(c, message.Topic(), message.Payload())
		})
		go func() {
			if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
				a.Logger.Error("Sparkplug subscriptions failed", "connection", c.UUID)
				return
			}
			online, _ := json.Marshal(map[string]any{"online": true, "timestamp": stateTimestamp.Load()})
			client.Publish("spBv1.0/STATE/"+c.HostID, 1, true, online)
			a.connectivity.connect(c.UUID, time.Now().UTC())
			a.mu.Lock()
			defs := []devices.Definition{}
			for _, d := range a.definitions {
				if d.Source.ConnectionUUID == c.UUID {
					defs = append(defs, d)
				}
			}
			a.mu.Unlock()
			for _, d := range defs {
				a.requestRebirth(c.UUID, d.Source.GroupID, d.Source.EdgeNodeID)
			}
		}()
	})
	client := mqtt.NewClient(options)
	a.mu.Lock()
	a.brokers[c.UUID] = &broker{Connection: c, Client: client, StateTimestamp: stateTimestamp}
	a.mu.Unlock()
	token := client.Connect()
	if !token.WaitTimeout(6 * time.Second) {
		return errors.New("MQTT connection timed out")
	}
	return token.Error()
}
func (a *Application) requestRebirth(connection, group, edge string) {
	a.mu.Lock()
	b := a.brokers[connection]
	key := connection + "/" + edge
	if time.Since(a.rebirth[key]) < rebirthInterval || b == nil || !b.Client.IsConnectionOpen() {
		a.rebirthPending[key] = rebirthRequest{connection, group, edge}
		a.mu.Unlock()
		return
	}
	delete(a.rebirthPending, key)
	a.rebirth[key] = time.Now()
	a.mu.Unlock()
	b.Client.Publish("spBv1.0/"+group+"/NCMD/"+edge, 0, false, rebirthPayload(time.Now()))
}

// rebirthPayload is the NCMD that asks an edge node for every birth again, stamped at.
func rebirthPayload(at time.Time) []byte {
	metric := &pb.Payload_Metric{Name: proto.String("Node Control/Rebirth"), Datatype: proto.Uint32(uint32(pb.DataType_Boolean)), Value: &pb.Payload_Metric_BooleanValue{BooleanValue: true}}
	raw, _ := proto.Marshal(&pb.Payload{Timestamp: proto.Uint64(uint64(at.UnixMilli())), Metrics: []*pb.Payload_Metric{metric}})
	return raw
}
func (a *Application) packet(c devices.Connection, topic string, raw []byte) {
	received := time.Now().UTC()
	parsed, e := sparkplug.ParseTopic(topic)
	if e != nil || parsed.Group != c.GroupID {
		return
	}
	// Any packet shows its source is alive, before validation; a death counts once the
	// engine has matched it to the session (D2).
	death := parsed.Kind == "NDEATH" || parsed.Kind == "DDEATH"
	if !death {
		a.connectivity.heard(c.UUID, c.GroupID, parsed.Edge, parsed.Device, received)
	}
	captures := a.captureManager()
	captureID := ""
	if captures.Watching(c.OrganizationUUID, c.UUID, parsed.Edge, parsed.Device) {
		captureID = storage.UUID()
		sample := telemetry.Sample{ID: captureID, Topic: topic, Kind: parsed.Kind, SourceDevice: parsed.Device, Received: received, Size: len(raw), Status: "received", Metrics: []devices.Metric{}, Outcomes: []telemetry.Outcome{}}
		if len(raw) <= 32<<10 {
			sample.Wire = base64.StdEncoding.EncodeToString(raw)
		} else {
			sample.Diagnostic = "Wire payload omitted: exceeds 32 KiB capture limit."
		}
		var payload pb.Payload
		if len(raw) <= 32<<10 && proto.Unmarshal(raw, &payload) == nil {
			sample.Seq = payload.Seq
			for _, metric := range payload.Metrics {
				if metric.GetName() == "bdSeq" {
					value := metric.GetLongValue()
					if metric.GetDatatype() == uint32(pb.DataType_UInt32) {
						value = uint64(metric.GetIntValue())
					}
					sample.BdSeq = &value
				}
			}
		}
		captures.Record(c.OrganizationUUID, c.UUID, parsed.Edge, sample)
	}
	p, e := a.Engine.Accept(c.UUID, topic, raw, received)
	switch {
	case death && e == nil && p.Death:
		a.connectivity.died(c.UUID, c.GroupID, parsed.Edge, parsed.Device, received)
	case death:
		a.connectivity.heard(c.UUID, c.GroupID, parsed.Edge, parsed.Device, received)
	case e == nil && parsed.Kind == "NBIRTH":
		a.connectivity.adapterBorn(c.UUID, c.GroupID, parsed.Edge, received)
	}
	if captureID != "" {
		captures.Update(captureID, func(s *telemetry.Sample) {
			if e != nil {
				s.Status = "rejected"
				s.Diagnostic = e.Error()
				if errors.Is(e, sparkplug.ErrDuplicate) {
					s.Status = "duplicate"
				}
			} else {
				s.Status = "decoded"
				s.Metrics = p.Metrics
				s.Session = p.Session
			}
		})
	}
	if e != nil {
		if errors.Is(e, sparkplug.ErrDuplicate) {
			return
		}
		a.Logger.Warn("Sparkplug packet rejected", "connection", c.UUID, "edge", parsed.Edge, "reason", e)
		a.rejectedPresence(c, p, e.Error())
		a.requestRebirth(c.UUID, c.GroupID, parsed.Edge)
		return
	}
	// Keep gateway and unassigned discovery health current without activating sources.
	presenceKey := "source:" + c.UUID + "/" + p.Topic.Edge + "/" + p.Topic.Device
	a.mu.Lock()
	reportSource := p.Birth || p.Death || time.Since(a.presenceAt[presenceKey]) >= 5*time.Second
	if reportSource {
		a.presenceAt[presenceKey] = time.Now()
	}
	a.mu.Unlock()
	if reportSource && !p.Birth && p.Topic.Kind != "NDEATH" {
		presence := "online"
		if p.Death {
			presence = "offline"
		}
		a.emit("discovery.presence.v1", map[string]any{"connection_uuid": c.UUID, "edge_node_id": p.Topic.Edge, "device_id": p.Topic.Device, "session_id": p.Session, "received_at": p.Received, "presence": presence})
	}
	if p.Birth {
		a.emit("discovery.birth.v1", map[string]any{"connection_uuid": c.UUID, "edge_node_id": p.Topic.Edge, "device_id": p.Topic.Device, "session_id": p.Session, "received_at": p.Received, "metrics": p.Metrics})
	}
	if p.Death {
		presence := "offline"
		if p.Topic.Kind == "NDEATH" {
			a.emit("gateway.presence.v1", map[string]any{"connection_uuid": c.UUID, "edge_node_id": p.Topic.Edge, "session_id": p.Session, "presence": presence, "last_seen_at": p.Received})
		}
	}
	if p.Birth && p.Topic.Device != "" {
		a.releaseHeld(c.UUID, p.Topic.Edge, p.Topic.Device, p.Received)
	}
	a.mu.Lock()
	definitions := []devices.Definition{}
	packetGenerations := map[string]int{}
	for _, d := range a.definitions {
		if d.Source.ConnectionUUID == c.UUID && d.Source.EdgeNodeID == p.Topic.Edge && (d.Source.DeviceID == p.Topic.Device || p.Topic.Kind == "NDEATH") {
			definitions = append(definitions, d)
			packetGenerations[d.DeviceUUID] = a.generations[d.DeviceUUID]
		}
	}
	a.mu.Unlock()
	for _, d := range definitions {
		func() {
			unlock := a.lockDevice(d.DeviceUUID)
			defer unlock()
			a.mu.Lock()
			current, enabled := a.definitions[d.DeviceUUID]
			generation := a.generations[d.DeviceUUID]
			applied := a.appliedGeneration[d.DeviceUUID]
			activeSince := a.activeSince[d.DeviceUUID]
			a.mu.Unlock()
			if !enabled || current.ConfigurationUUID != d.ConfigurationUUID || packetGenerations[d.DeviceUUID] != generation || received.Before(activeSince) {
				return
			}

			if p.Death {
				// An adapter's node death is a redeploy, restart or pause, never its devices' (D3).
				if adapterGroup(c.GroupID) && p.Topic.Kind == "NDEATH" {
					a.devicePresence(d, "unknown", adapterRestarting, time.Time{}, true)
					return
				}
				a.devicePresence(d, "offline", "Source sent a death certificate.", p.Received, true)
				return
			}
			session, metrics, online := a.Engine.Snapshot(d.Source)
			if !online {
				return
			}
			_, compatibleError := devices.Preview(d, metrics)
			if compatibleError != nil {
				a.mu.Lock()
				a.compatible[d.DeviceUUID] = false
				a.reviewRequired[d.DeviceUUID] = true
				a.mu.Unlock()
				if e := a.Store.RequireReview(a.ctx, d); e != nil {
					a.Logger.Warn("configuration review persistence deferred", "error", e)
				}
				captures.Outcome(captureID, telemetry.Outcome{Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Status: "rejected", Diagnostic: compatibleError.Error()})
				a.devicePresence(d, "online", "Source changed: "+compatibleError.Error(), p.Received, true)
				return
			}
			// Review follows the current birth: one that matches the applied configuration
			// again restores controls before its readings reach automations (ADR-025).
			a.mu.Lock()
			review := a.reviewRequired[d.DeviceUUID]
			a.mu.Unlock()
			if review {
				if e := a.Store.ClearReview(a.ctx, d); e != nil {
					a.Logger.Warn("configuration review clearance deferred", "error", e)
				} else {
					a.mu.Lock()
					a.reviewRequired[d.DeviceUUID] = false
					a.mu.Unlock()
				}
			}
			profile, e := devices.ParseProfile(d)
			if e != nil {
				return
			}
			readings, ok := a.handOn(d, profile, applied, session, p.Metrics, p.Received, captureID)
			if !ok {
				return
			}
			a.connectivity.readings(d.DeviceUUID, p.Topic.Kind == "DDATA", p.Received, observedTimes(readings))
			a.mu.Lock()
			review = a.reviewRequired[d.DeviceUUID]
			a.mu.Unlock()
			if review {
				a.devicePresence(d, "unknown", "A source birth changed approved metrics. Review and activate a configuration to restore controls.", p.Received, p.Birth)
			} else {
				a.devicePresence(d, "online", "", p.Received, p.Birth)
			}
		}()
	}
}

// handOn turns a source's metrics, received at received, into d's readings, keeps them
// as its latest values and hands them to storage at the applied generation. It returns
// the readings and whether the device may be reported present: not while its ingestion
// is suspended, nor after a failed handoff.
func (a *Application) handOn(d devices.Definition, profile devices.Profile, applied int, session string, metrics []devices.Metric, received time.Time, captureID string) ([]devices.Reading, bool) {
	captures := a.captureManager()
	suspended := captures.Suspended(d.OrganizationUUID, d.DeviceUUID)
	a.mu.Lock()
	latest := a.latest[d.DeviceUUID]
	if latest == nil || a.sessions[d.DeviceUUID] != session {
		latest = map[string]devices.Reading{}
	}
	if !suspended {
		a.latest[d.DeviceUUID] = latest
		a.sessions[d.DeviceUUID] = session
		a.compatible[d.DeviceUUID] = !a.reviewRequired[d.DeviceUUID]
	}
	var stages []devices.ReadingTrace
	var trace *[]devices.ReadingTrace
	if captureID != "" {
		trace = &stages
	}
	readings := devices.ReadingsTraced(d, profile, metrics, latest, received, trace)
	if suspended {
		a.mu.Unlock()
		captures.Outcome(captureID, telemetry.Outcome{Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Status: "suspended", Diagnostic: "Production ingestion suspended for this device; these samples will not be replayed.", Stages: stages, Readings: readings})
		return nil, false
	}
	for _, r := range readings {
		if !r.Historical {
			if r.Quality != "good" {
				if previous, ok := latest[r.ParameterUUID]; ok {
					r.Value = previous.Value
					r.ObservedAt = previous.ObservedAt
				} else {
					r.Value = nil
				}
			}
			latest[r.ParameterUUID] = r
		}
	}
	a.mu.Unlock()
	if len(readings) > 0 {
		captures.Outcome(captureID, telemetry.Outcome{Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Status: "pending", Stages: stages, Readings: readings})
		telemetry := devices.Telemetry{CaptureID: captureID, UUID: storage.UUID(), Definition: d, Generation: applied, SessionID: session, Readings: readings}
		data, e := json.Marshal(telemetry)
		if e == nil {
			message := nats.NewMsg("iot.telemetry.device")
			message.Data = data
			message.Header.Set(nats.MsgIdHdr, telemetry.UUID)
			_, e = a.JS.PublishMsg(message)
		}
		if e != nil {
			captures.Stored(captureID, d.DeviceUUID, "handoff_failed", e.Error())
			a.Logger.Error("telemetry durable handoff failed", "device", d.DeviceUUID, "error", e)
			a.mu.Lock()
			a.compatible[d.DeviceUUID] = false
			a.mu.Unlock()
			a.devicePresence(d, "unknown", "Telemetry handoff failed; a data gap may exist.", received, true)
			return nil, false
		}
	}
	return readings, true
}

// observedTimes are the observed times of readings not marked historical (D16).
func observedTimes(readings []devices.Reading) []time.Time {
	times := []time.Time{}
	for _, r := range readings {
		if !r.Historical && !r.ObservedAt.IsZero() {
			times = append(times, r.ObservedAt)
		}
	}
	return times
}

// devicePresence reports a device's presence. at is when its packet was received;
// a zero at (presence derived from the broker connection) omits last_seen_at, so
// the control plane keeps the last time the device was actually seen.
func (a *Application) devicePresence(d devices.Definition, presence, diagnostic string, at time.Time, force bool) {
	a.mu.Lock()
	if !force && time.Since(a.presenceAt[d.DeviceUUID]) < 5*time.Second {
		a.mu.Unlock()
		return
	}
	a.presenceAt[d.DeviceUUID] = time.Now()
	if a.reported == nil {
		a.reported = map[string]reportedPresence{}
	}
	a.reported[d.DeviceUUID] = reportedPresence{presence, diagnostic}
	generation := a.generations[d.DeviceUUID]
	a.mu.Unlock()
	payload := map[string]any{"organization_uuid": d.OrganizationUUID, "device_uuid": d.DeviceUUID, "configuration_uuid": d.ConfigurationUUID, "generation": generation, "presence": presence, "diagnostic": diagnostic}
	if !at.IsZero() {
		payload["last_seen_at"] = at
	}
	a.emit("device.presence.v1", payload)
}
func (a *Application) connectionPresence(connection, presence, diagnostic string) {
	a.emit("connection.presence.v1", map[string]any{"connection_uuid": connection, "presence": presence, "diagnostic": diagnostic})
	a.mu.Lock()
	defs := []devices.Definition{}
	for _, d := range a.definitions {
		if d.Source.ConnectionUUID == connection {
			defs = append(defs, d)
			a.compatible[d.DeviceUUID] = false
		}
	}
	a.mu.Unlock()
	for _, d := range defs {
		a.devicePresence(d, presence, diagnostic, time.Time{}, true)
	}
}
func (a *Application) connectionLost(connection string, e error) {
	a.Engine.Disconnect(connection)
	a.connectivity.disconnect(connection, time.Now().UTC())
	a.Logger.Warn("MQTT connection lost", "connection", connection, "error", e)
	a.connectionPresence(connection, "unknown", "Broker connection was lost; waiting for fresh birth certificates.")
}

// rejectedPresence reports what a rejected packet cost, and nothing more: other
// edges on the connection keep their presence. A sequence gap or a bad birth, alias,
// metric or datatype drops the edge's whole session in the engine; data from a
// device with no birth drops only that device; a packet the engine ignored (bad
// protobuf, a stale death) changes nothing. The edge keeps sending until its
// rebirth arrives, so each device is reported once, not once per packet.
func (a *Application) rejectedPresence(c devices.Connection, p sparkplug.Packet, diagnostic string) {
	edgeOnline := a.Engine.NodeOnline(c.UUID, p.Topic.Edge)
	// Only the packet that ended a session carries it; a rejected NBIRTH's session was never announced.
	if !edgeOnline && p.Session != "" && p.Topic.Kind != "NBIRTH" {
		a.emit("gateway.presence.v1", map[string]any{"connection_uuid": c.UUID, "edge_node_id": p.Topic.Edge, "session_id": p.Session, "presence": "unknown", "last_seen_at": p.Received})
	}
	a.mu.Lock()
	defs := []devices.Definition{}
	for _, d := range a.definitions {
		if d.Source.ConnectionUUID != c.UUID || d.Source.EdgeNodeID != p.Topic.Edge || edgeOnline && d.Source.DeviceID != p.Topic.Device {
			continue
		}
		if _, _, online := a.Engine.Snapshot(d.Source); online {
			continue
		}
		a.compatible[d.DeviceUUID] = false
		if a.reported[d.DeviceUUID] != (reportedPresence{"unknown", diagnostic}) {
			defs = append(defs, d)
		}
	}
	a.mu.Unlock()
	for _, d := range defs {
		a.devicePresence(d, "unknown", diagnostic, time.Time{}, true)
	}
}

// activate applies d at generation. birth is the source's last stored birth, which an
// adapter-fed source is validated against when it has no live one (ADR-027).
func (a *Application) activate(d devices.Definition, generation int, birth []devices.Metric, operation ...string) error {
	op := ""
	if len(operation) > 0 {
		op = operation[0]
	}
	return a.transition(d, generation, birth, op, time.Time{})
}

// transition applies or refuses an activation, or holds it for a birth that is due.
// bornAt is the receipt of the birth that released a held activation, zero otherwise.
func (a *Application) transition(d devices.Definition, generation int, birth []devices.Metric, op string, bornAt time.Time) error {
	unlock := a.lockDevice(d.DeviceUUID)
	defer unlock()
	a.mu.Lock()
	previous := a.generations[d.DeviceUUID]
	a.mu.Unlock()
	if generation < previous {
		return nil
	}
	if generation == previous {
		return a.Store.ReplayOutcome(a.ctx, d.DeviceUUID, generation)
	}
	session, metrics, online := a.Engine.Snapshot(d.Source)
	// Hold for a due birth. It can land between the two snapshots, unseen by releaseHeld.
	if !online && (d.Adapter == nil || len(birth) == 0) && a.holdForBirth(d, generation, birth, op) {
		if session, metrics, online = a.Engine.Snapshot(d.Source); !online {
			return nil
		}
	}
	var e error
	switch {
	case online:
		_, e = devices.Preview(d, metrics)
	// The platform's own adapter announces an adapter-fed source and defines its
	// metrics, so the last birth stands in until the vendor device reports again.
	case d.Adapter != nil && len(birth) > 0:
		_, e = devices.Preview(d, birth)
	default:
		e = errors.New("Source is offline or needs a fresh birth certificate. Review the source before retrying.")
	}
	if e != nil {
		if err := a.Store.FailTransition(a.ctx, d, generation, op, e.Error()); err != nil {
			return err
		}
		a.mu.Lock()
		a.generations[d.DeviceUUID] = generation
		a.settleHeld(d.DeviceUUID, generation)
		a.mu.Unlock()
		return nil
	}
	if e = a.Store.Apply(a.ctx, d, generation, "device.applied.v1", map[string]any{"operation_uuid": op}); e != nil {
		return e
	}
	appliedAt := time.Now().UTC()
	a.mu.Lock()
	a.definitions[d.DeviceUUID] = d
	if a.activeSince == nil {
		a.activeSince = map[string]time.Time{}
	}
	a.activeSince[d.DeviceUUID] = appliedAt
	if !bornAt.IsZero() {
		a.activeSince[d.DeviceUUID] = bornAt
	}
	a.generations[d.DeviceUUID] = generation
	a.settleHeld(d.DeviceUUID, generation)
	if a.appliedGeneration == nil {
		a.appliedGeneration = map[string]int{}
	}
	a.appliedGeneration[d.DeviceUUID] = generation
	a.latest[d.DeviceUUID] = map[string]devices.Reading{}
	a.sessions[d.DeviceUUID] = session
	a.compatible[d.DeviceUUID] = true
	a.reviewRequired[d.DeviceUUID] = false
	delete(a.reported, d.DeviceUUID) // the control plane resets presence on device.applied.v1
	a.mu.Unlock()
	a.connectivity.define(d, appliedAt)
	// A released activation's birth carries the source's state, and packet() hands it on
	// as the first readings. One applied at once hands on the live state it was checked
	// against; only a source without one (an adapter-fed source's stored birth) asks for
	// a rebirth.
	if bornAt.IsZero() && !a.handOnLive(d, generation, appliedAt) {
		a.requestRebirth(d.Source.ConnectionUUID, d.Source.GroupID, d.Source.EdgeNodeID)
	}
	return nil
}

// handOnLive hands a live source's current state on as the first readings of an
// activation applied at since, instead of asking for a rebirth (R19): a rebirth makes the
// whole edge node announce again, and a paced gateway's devices refuse commands until
// their births are back. Metrics received from since on are packet()'s to hand on. It
// reports false when the source has no live birth that matches d.
func (a *Application) handOnLive(d devices.Definition, generation int, since time.Time) bool {
	session, metrics, online := a.Engine.Snapshot(d.Source)
	if !online {
		return false
	}
	// The birth can change after the activation's check; a rebirth lets packet() review it.
	if _, e := devices.Preview(d, metrics); e != nil {
		return false
	}
	profile, e := devices.ParseProfile(d)
	if e != nil {
		return false
	}
	state := []devices.Metric{}
	var seen time.Time
	for _, m := range metrics {
		if m.ReceivedAt.Before(since) {
			state = append(state, m)
			if m.ReceivedAt.After(seen) {
				seen = m.ReceivedAt
			}
		}
	}
	if _, ok := a.handOn(d, profile, generation, session, state, since, ""); ok {
		a.devicePresence(d, "online", "", seen, true)
	}
	return true
}

// holdForBirth holds an activation whose source's birth is due, and reports whether
// it is held. The birth releases it (releaseHeld); at its deadline it is refused.
// Retries at the same generation (syncState) keep the deadline. A rebirth is asked
// for only when the node is not announcing already, as one restarts the announcement.
func (a *Application) holdForBirth(d devices.Definition, generation int, birth []devices.Metric, op string) bool {
	born, due := a.Engine.BirthDue(d.Source)
	if !due {
		return false
	}
	now := time.Now()
	a.mu.Lock()
	if h, held := a.held[d.DeviceUUID]; held && h.Generation == generation {
		a.mu.Unlock()
		return now.Before(h.Deadline)
	}
	wait := birthWait
	if a.heldFor > 0 {
		wait = a.heldFor
	}
	if a.held == nil {
		a.held = map[string]heldActivation{}
	}
	a.held[d.DeviceUUID] = heldActivation{Definition: d, Generation: generation, Birth: birth, Operation: op, Deadline: now.Add(wait)}
	announcing := now.Sub(a.rebirth[d.Source.ConnectionUUID+"/"+d.Source.EdgeNodeID]) < rebirthInterval || now.Sub(born) < rebirthInterval
	a.mu.Unlock()
	time.AfterFunc(wait, func() { a.resumeHeld(d.DeviceUUID, generation, time.Time{}) })
	if !announcing {
		a.requestRebirth(d.Source.ConnectionUUID, d.Source.GroupID, d.Source.EdgeNodeID)
	}
	return true
}

// settleHeld drops a hold that generation answered or superseded. Callers hold a.mu.
func (a *Application) settleHeld(device string, generation int) {
	if h, held := a.held[device]; held && h.Generation <= generation {
		delete(a.held, device)
	}
}

// releaseHeld applies the activations held for a source whose birth arrived at bornAt,
// before packet() hands that birth on.
func (a *Application) releaseHeld(connection, edge, device string, bornAt time.Time) {
	a.mu.Lock()
	released := []heldActivation{}
	for _, h := range a.held {
		if s := h.Definition.Source; s.ConnectionUUID == connection && s.EdgeNodeID == edge && s.DeviceID == device {
			released = append(released, h)
		}
	}
	a.mu.Unlock()
	for _, h := range released {
		a.resumeHeld(h.Definition.DeviceUUID, h.Generation, bornAt)
	}
}

// resumeHeld retries a held activation: on its source's birth, or with a zero bornAt
// at its deadline. A failed retry keeps the hold, and syncState retries it.
func (a *Application) resumeHeld(device string, generation int, bornAt time.Time) {
	a.mu.Lock()
	h, held := a.held[device]
	a.mu.Unlock()
	if !held || h.Generation != generation {
		return
	}
	if e := a.transition(h.Definition, h.Generation, h.Birth, h.Operation, bornAt); e != nil {
		a.Logger.Warn("held activation deferred", "device", device, "generation", generation, "error", e)
	}
}
func (a *Application) deactivate(device, org string, generation int, operation ...string) error {
	unlock := a.lockDevice(device)
	defer unlock()
	a.mu.Lock()
	previous := a.generations[device]
	a.mu.Unlock()
	if generation < previous {
		return nil
	}
	if generation == previous {
		return a.Store.ReplayOutcome(a.ctx, device, generation)
	}
	op := ""
	if len(operation) > 0 {
		op = operation[0]
	}
	// Dispatch owns the same fence, so no command can enter the send window here.
	outstanding, err := a.Store.Outstanding(a.ctx)
	if err != nil {
		return err
	}
	uncertain := []string{}
	for _, c := range outstanding {
		if c.DeviceUUID != device {
			continue
		}
		uncertain = append(uncertain, c.UUID)
		if err = a.Store.CommandStatus(a.ctx, c, "uncertain", "Device deactivated before a definitive command outcome.", nil); err != nil {
			return err
		}
	}
	d := devices.Definition{DeviceUUID: device, OrganizationUUID: org}
	if err = a.Store.Apply(a.ctx, d, generation, "device.deactivated.v1", map[string]any{"operation_uuid": op, "uncertain_command_uuids": uncertain}); err != nil {
		return err
	}
	a.mu.Lock()
	delete(a.definitions, device)
	delete(a.appliedGeneration, device)
	delete(a.latest, device)
	delete(a.sessions, device)
	delete(a.compatible, device)
	delete(a.reviewRequired, device)
	delete(a.presenceAt, device)
	delete(a.reported, device)
	a.generations[device] = generation
	a.settleHeld(device, generation)
	for id, pending := range a.pending {
		if pending.Request.DeviceUUID == device {
			delete(a.pending, id)
		}
	}
	a.mu.Unlock()
	a.connectivity.remove(device, stopDeactivated)
	return nil
}
func (a *Application) handleControl(ev devices.Event) error {
	switch ev.Type {
	case "workflow.deploy.v2":
		var request storage.DAGDeployment
		if err := storage.Decode(ev.Payload, &request); err != nil {
			return permanent(err)
		}
		return a.Store.DeployDAG(a.ctx, request, time.Now().UTC())
	case "workflow.deploy.v1":
		var request rules.Deployment
		if err := storage.Decode(ev.Payload, &request); err != nil {
			return permanent(err)
		}
		return a.Store.DeployRule(a.ctx, request, time.Now().UTC())
	case "connection.changed.v1":
		return a.syncState()
	case "settings.retention.changed.v1":
		return nil
	case "device.command.v1":
		var c devices.Command
		if e := storage.Decode(ev.Payload, &c); e != nil {
			return permanent(e)
		}
		return a.dispatch(c)
	case "device.activate.v1":
		var request struct {
			Definition    devices.Definition `json:"definition"`
			Generation    int                `json:"generation"`
			OperationUUID string             `json:"operation_uuid"`
			BirthMetrics  []devices.Metric   `json:"birth_metrics"`
		}
		if e := storage.Decode(ev.Payload, &request); e != nil {
			return permanent(e)
		}
		return a.activate(request.Definition, request.Generation, request.BirthMetrics, request.OperationUUID)
	case "device.deactivate.v1":
		var request struct {
			DeviceUUID       string `json:"device_uuid"`
			OrganizationUUID string `json:"organization_uuid"`
			Generation       int    `json:"generation"`
			OperationUUID    string `json:"operation_uuid"`
		}
		if e := storage.Decode(ev.Payload, &request); e != nil {
			return permanent(e)
		}
		return a.deactivate(request.DeviceUUID, request.OrganizationUUID, request.Generation, request.OperationUUID)
	}
	return permanent(fmt.Errorf("unsupported control event %s", ev.Type))
}
func (a *Application) maintenance(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	count := 0
	nextCleanup := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			count++
			a.expireCommands()
			a.evaluateConnectivity(time.Now().UTC())
			a.mu.Lock()
			rebirths := []rebirthRequest{}
			for _, request := range a.rebirthPending {
				rebirths = append(rebirths, request)
			}
			a.mu.Unlock()
			for _, request := range rebirths {
				a.requestRebirth(request.Connection, request.Group, request.Edge)
			}
			if count%2 == 0 {
				a.emit("runtime.heartbeat.v1", map[string]any{"at": time.Now().UTC()})
			}
			if count%6 == 0 {
				if e := a.syncState(); e != nil {
					a.Logger.Warn("control state refresh failed", "error", e)
				}
			}
			if time.Now().After(nextCleanup) {
				if e := a.cleanup(); e != nil {
					a.Logger.Warn("retention cleanup deferred", "error", e)
					nextCleanup = time.Now().Add(time.Minute)
				} else {
					nextCleanup = time.Now().Add(24 * time.Hour)
				}
			}
		}
	}
}

// reportUsageEvery reports usage on its own ticker, so a long retention cleanup in the
// maintenance loop never holds reports back (spec 029 plan: reporter every 60 s).
func (a *Application) reportUsageEvery(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.reportUsage(time.Now().UTC())
		}
	}
}

// reportUsage sends the stored-reading counts that changed or became final (spec 029
// US3). A failure is logged and retried on the next tick: counts are cumulative, so
// nothing is lost.
func (a *Application) reportUsage(now time.Time) {
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	finalThrough, e := a.Store.ReportUsage(ctx, now, a.usageFinalThrough)
	if e != nil {
		a.Logger.Warn("usage report deferred", "error", e)
		return
	}
	a.usageFinalThrough = finalThrough
}

func (a *Application) cleanup() error {
	var state devices.ControlState
	if e := a.Control.request(a.ctx, "GET", "/state", nil, &state); e != nil {
		return e
	}
	var failures []error
	if active := a.connectivity.active(); active != nil {
		if pruned, e := a.Store.PruneConnectivity(a.ctx, active); e != nil {
			failures = append(failures, fmt.Errorf("connectivity pruning: %w", e))
		} else if pruned > 0 {
			a.Logger.Info("connectivity rows pruned", "deleted_rows", pruned)
		}
	}
	if pruned, e := a.Store.PruneUsage(a.ctx, time.Now().UTC()); e != nil {
		failures = append(failures, fmt.Errorf("usage pruning: %w", e))
	} else if pruned > 0 {
		a.Logger.Info("usage buckets pruned", "deleted_rows", pruned)
	}
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	pruned, e := a.Store.PruneLedgers(ctx, time.Now().UTC())
	cancel()
	if pruned > 0 {
		a.Logger.Info("runtime ledgers pruned", "deleted_rows", pruned, "complete", e == nil)
	}
	if e != nil {
		failures = append(failures, fmt.Errorf("ledger pruning: %w", e))
	}
	for _, retention := range state.Retention {
		if retention.Days < 1 {
			return errors.New("invalid effective retention")
		}
		// Deleting a day of compressed observations decompresses the tenant's batches.
		ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
		deleted, e := a.Store.Cleanup(ctx, retention.OrganizationUUID, time.Now().UTC().AddDate(0, 0, -retention.Days))
		cancel()
		status, diagnostic := "completed", ""
		if e != nil {
			status = "failed"
			diagnostic = e.Error()
			if errors.Is(e, storage.ErrCleanupIncomplete) {
				status = "pending"
			}
		}
		a.emit("retention.cleanup.v1", map[string]any{"organization_uuid": retention.OrganizationUUID, "status": status, "deleted_rows": deleted, "diagnostic": diagnostic})
		if e != nil {
			failures = append(failures, e)
		}
	}
	return errors.Join(failures...)
}
func (a *Application) Close() {
	defer a.releaseRuntime()
	a.mu.Lock()
	brokers := []*broker{}
	for _, b := range a.brokers {
		brokers = append(brokers, b)
	}
	a.mu.Unlock()
	for _, b := range brokers {
		offline, _ := json.Marshal(map[string]any{"online": false, "timestamp": b.StateTimestamp.Load()})
		token := b.Client.Publish("spBv1.0/STATE/"+b.Connection.HostID, 1, true, offline)
		token.WaitTimeout(time.Second)
		b.Client.Disconnect(250)
	}
	a.NATS.Close()
}
