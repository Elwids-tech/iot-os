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
type Application struct {
	captures          *telemetry.Manager
	committedFailures atomic.Uint64
	rulesHealthy      atomic.Bool
	fences            sync.Map
	releaseRuntime    func()
	ctx               context.Context
	mu                sync.Mutex
	Store             *storage.Store
	Control           *ControlClient
	JS                nats.JetStreamContext
	NATS              *nats.Conn
	Logger            *slog.Logger
	Engine            *sparkplug.Engine
	definitions       map[string]devices.Definition
	generations       map[string]int
	activeSince       map[string]time.Time
	latest            map[string]map[string]devices.Reading
	sessions          map[string]string
	compatible        map[string]bool
	reviewRequired    map[string]bool
	brokers           map[string]*broker
	pending           map[string]*pendingCommand
	rebirth           map[string]time.Time
	rebirthPending    map[string]rebirthRequest
	presenceAt        map[string]time.Time
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
	a := &Application{releaseRuntime: releaseRuntime, ctx: ctx, Store: store, Logger: logger, Control: &ControlClient{URL: env("DEVICE_CONTROL_URL", "http://api:8000/api/internal/devices"), Token: token, Client: &http.Client{Timeout: 10 * time.Second}}, Engine: sparkplug.NewEngine(), definitions: map[string]devices.Definition{}, generations: map[string]int{}, latest: map[string]map[string]devices.Reading{}, sessions: map[string]string{}, compatible: map[string]bool{}, reviewRequired: map[string]bool{}, brokers: map[string]*broker{}, pending: map[string]*pendingCommand{}, rebirth: map[string]time.Time{}, rebirthPending: map[string]rebirthRequest{}, presenceAt: map[string]time.Time{}, tlsConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}}
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
			if a.activeSince == nil {
				a.activeSince = map[string]time.Time{}
			}
			a.activeSince[state.UUID] = time.Now().UTC()
		}
	}
	if e = a.subscribe(); e != nil {
		nc.Close()
		return nil, e
	}
	if e = a.syncState(); e != nil {
		nc.Close()
		return nil, e
	}
	if e = a.startRuleConsumer(ctx); e != nil {
		nc.Close()
		return nil, e
	}
	go a.relay(ctx)
	go a.relayCommitted(ctx)
	go a.maintenance(ctx)
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
		a.mu.Lock()
		generation := a.generations[d.UUID]
		a.mu.Unlock()

		if d.DeploymentStatus == "pending" && d.Generation >= generation {
			if d.Desired != nil {
				_ = a.activate(*d.Desired, d.Generation, d.OperationUUID)
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
	options.SetConnectionLostHandler(func(_ mqtt.Client, e error) {
		a.Engine.Disconnect(c.UUID)
		a.Logger.Warn("MQTT connection lost", "connection", c.UUID, "error", e)
		a.connectionPresence(c.UUID, "unknown", "Broker connection was lost; waiting for fresh birth certificates.")
	})
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
	if time.Since(a.rebirth[key]) < 30*time.Second || b == nil || !b.Client.IsConnectionOpen() {
		a.rebirthPending[key] = rebirthRequest{connection, group, edge}
		a.mu.Unlock()
		return
	}
	delete(a.rebirthPending, key)
	a.rebirth[key] = time.Now()
	a.mu.Unlock()
	metric := &pb.Payload_Metric{Name: proto.String("Node Control/Rebirth"), Datatype: proto.Uint32(uint32(pb.DataType_Boolean)), Value: &pb.Payload_Metric_BooleanValue{BooleanValue: true}}
	raw, _ := proto.Marshal(&pb.Payload{Timestamp: proto.Uint64(uint64(time.Now().UnixMilli())), Metrics: []*pb.Payload_Metric{metric}})
	b.Client.Publish("spBv1.0/"+group+"/NCMD/"+edge, 0, false, raw)
}
func (a *Application) packet(c devices.Connection, topic string, raw []byte) {
	received := time.Now().UTC()
	parsed, e := sparkplug.ParseTopic(topic)
	if e != nil || parsed.Group != c.GroupID {
		return
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
		a.Logger.Warn("Sparkplug packet rejected", "edge", parsed.Edge, "reason", e)
		a.connectionPresence(c.UUID, "unknown", e.Error())
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
			activeSince := a.activeSince[d.DeviceUUID]
			a.mu.Unlock()
			if !enabled || current.ConfigurationUUID != d.ConfigurationUUID || packetGenerations[d.DeviceUUID] != generation || received.Before(activeSince) {
				return
			}

			if p.Death {
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
			profile, e := devices.ParseProfile(d)
			if e != nil {
				return
			}
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
			readings := devices.ReadingsTraced(d, profile, p.Metrics, latest, p.Received, trace)
			if suspended {
				a.mu.Unlock()
				captures.Outcome(captureID, telemetry.Outcome{Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Status: "suspended", Diagnostic: "Production ingestion suspended for this device; these samples will not be replayed.", Stages: stages, Readings: readings})
				return
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
				telemetry := devices.Telemetry{CaptureID: captureID, UUID: storage.UUID(), Definition: d, Generation: generation, SessionID: session, Readings: readings}
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
					a.devicePresence(d, "unknown", "Telemetry handoff failed; a data gap may exist.", p.Received, true)
					return
				}
			}
			a.mu.Lock()
			review := a.reviewRequired[d.DeviceUUID]
			a.mu.Unlock()
			if review {
				a.devicePresence(d, "unknown", "A source birth changed approved metrics. Review and activate a configuration to restore controls.", p.Received, p.Birth)
			} else {
				a.devicePresence(d, "online", "", p.Received, p.Birth)
			}
		}()
	}
}

func (a *Application) devicePresence(d devices.Definition, presence, diagnostic string, at time.Time, force bool) {
	a.mu.Lock()
	if !force && time.Since(a.presenceAt[d.DeviceUUID]) < 5*time.Second {
		a.mu.Unlock()
		return
	}
	a.presenceAt[d.DeviceUUID] = time.Now()
	generation := a.generations[d.DeviceUUID]
	a.mu.Unlock()
	a.emit("device.presence.v1", map[string]any{"organization_uuid": d.OrganizationUUID, "device_uuid": d.DeviceUUID, "configuration_uuid": d.ConfigurationUUID, "generation": generation, "presence": presence, "diagnostic": diagnostic, "last_seen_at": at})
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
		a.devicePresence(d, presence, diagnostic, time.Now().UTC(), true)
	}
}
func (a *Application) activate(d devices.Definition, generation int, operation ...string) error {
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
	op := ""
	if len(operation) > 0 {
		op = operation[0]
	}
	session, metrics, online := a.Engine.Snapshot(d.Source)
	var e error
	if !online {
		e = errors.New("Source is offline or needs a fresh birth certificate. Review the source before retrying.")
	} else {
		_, e = devices.Preview(d, metrics)
	}
	if e != nil {
		if err := a.Store.FailTransition(a.ctx, d, generation, op, e.Error()); err != nil {
			return err
		}
		a.mu.Lock()
		a.generations[d.DeviceUUID] = generation
		a.mu.Unlock()
		return nil
	}
	if e = a.Store.Apply(a.ctx, d, generation, "device.applied.v1", map[string]any{"operation_uuid": op}); e != nil {
		return e
	}
	a.mu.Lock()
	a.definitions[d.DeviceUUID] = d
	if a.activeSince == nil {
		a.activeSince = map[string]time.Time{}
	}
	a.activeSince[d.DeviceUUID] = time.Now().UTC()
	a.generations[d.DeviceUUID] = generation
	a.latest[d.DeviceUUID] = map[string]devices.Reading{}
	a.sessions[d.DeviceUUID] = session
	a.compatible[d.DeviceUUID] = true
	a.reviewRequired[d.DeviceUUID] = false
	a.mu.Unlock()
	a.requestRebirth(d.Source.ConnectionUUID, d.Source.GroupID, d.Source.EdgeNodeID)
	return nil
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
	delete(a.latest, device)
	delete(a.sessions, device)
	delete(a.compatible, device)
	delete(a.reviewRequired, device)
	delete(a.presenceAt, device)
	a.generations[device] = generation
	for id, pending := range a.pending {
		if pending.Request.DeviceUUID == device {
			delete(a.pending, id)
		}
	}
	a.mu.Unlock()
	return nil
}
func (a *Application) handleControl(ev devices.Event) error {
	switch ev.Type {
	case "workflow.deploy.v2":
		var request storage.DAGDeployment
		if err := storage.Decode(ev.Payload, &request); err != nil {
			return err
		}
		return a.Store.DeployDAG(a.ctx, request, time.Now().UTC())
	case "workflow.deploy.v1":
		var request rules.Deployment
		if err := storage.Decode(ev.Payload, &request); err != nil {
			return err
		}
		return a.Store.DeployRule(a.ctx, request, time.Now().UTC())
	case "connection.changed.v1":
		return a.syncState()
	case "settings.retention.changed.v1":
		return nil
	case "device.command.v1":
		var c devices.Command
		if e := storage.Decode(ev.Payload, &c); e != nil {
			return e
		}
		return a.dispatch(c)
	case "device.activate.v1":
		var request struct {
			Definition    devices.Definition `json:"definition"`
			Generation    int                `json:"generation"`
			OperationUUID string             `json:"operation_uuid"`
		}
		if e := storage.Decode(ev.Payload, &request); e != nil {
			return e
		}
		return a.activate(request.Definition, request.Generation, request.OperationUUID)
	case "device.deactivate.v1":
		var request struct {
			DeviceUUID       string `json:"device_uuid"`
			OrganizationUUID string `json:"organization_uuid"`
			Generation       int    `json:"generation"`
			OperationUUID    string `json:"operation_uuid"`
		}
		if e := storage.Decode(ev.Payload, &request); e != nil {
			return e
		}
		return a.deactivate(request.DeviceUUID, request.OrganizationUUID, request.Generation, request.OperationUUID)
	}
	return fmt.Errorf("unsupported control event %s", ev.Type)
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
func (a *Application) cleanup() error {
	var state devices.ControlState
	if e := a.Control.request(a.ctx, "GET", "/state", nil, &state); e != nil {
		return e
	}
	var failures []error
	for _, retention := range state.Retention {
		if retention.Days < 1 {
			return errors.New("invalid effective retention")
		}
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
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
