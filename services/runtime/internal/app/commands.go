package app

import (
	"errors"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"google.golang.org/protobuf/proto"
)

func (a *Application) commandCheck(c devices.Command) (map[string]any, devices.Mapping, error) {
	a.mu.Lock()
	d, exists := a.definitions[c.DeviceUUID]
	compatible := a.compatible[c.DeviceUUID]
	a.mu.Unlock()
	var mapping devices.Mapping
	if !exists || d.OrganizationUUID != c.OrganizationUUID || d.ConfigurationUUID != c.ConfigurationUUID {
		return nil, mapping, errors.New("device configuration is no longer applied")
	}
	session, metrics, online := a.Engine.Snapshot(d.Source)
	if !online || !compatible {
		return nil, mapping, errors.New("device needs a current compatible birth certificate")
	}
	profile, e := devices.ParseProfile(d)
	if e != nil {
		return nil, mapping, e
	}
	var parameter *devices.Parameter
	for _, p := range profile.Parameters {
		if p.UUID == c.ParameterUUID {
			copy := p
			parameter = &copy
		}
	}
	for _, m := range d.Mappings {
		if m.ParameterUUID == c.ParameterUUID {
			mapping = m
		}
	}
	if parameter == nil || !parameter.AcceptsCommand || !parameter.ReportsState || mapping.CommandMetric == nil || mapping.CommandDatatype == nil {
		return nil, mapping, errors.New("no approved state-setting command mapping")
	}
	if e = devices.ValidateValue(*parameter, c.Value); e != nil {
		return nil, mapping, e
	}
	if _, e = sparkplug.EncodeMetric(*mapping.CommandMetric, *mapping.CommandDatatype, c.Value); e != nil {
		return nil, mapping, e
	}
	already := false
	maxAge := 30 * time.Second
	if parameter.Reporting != nil && parameter.Reporting.StaleAfterSeconds > 0 {
		maxAge = time.Duration(parameter.Reporting.StaleAfterSeconds) * time.Second
	}
	for _, metric := range metrics {
		if metric.Name == mapping.Metric && !metric.ReceivedAt.IsZero() && time.Since(metric.ReceivedAt) <= maxAge && !metric.Historical && !metric.IsNull && metric.Diagnostic == "" && devices.ValidateValue(*parameter, metric.Value) == nil {
			already = targetEqual(mapping.Datatype, metric.Value, c.Value)
		}
	}
	return map[string]any{"session_id": session, "already_at_target": already}, mapping, nil
}
func targetEqual(datatype string, actual, target any) bool {
	if datatype == "Float" {
		a, aok := devices.Number(actual)
		b, bok := devices.Number(target)
		return aok && bok && float32(a) == float32(b)
	}
	return devices.Equal(actual, target)
}
func (a *Application) dispatch(c devices.Command) error {
	unlock := a.lockDevice(c.DeviceUUID)
	defer unlock()

	claimed, e := a.Store.ClaimCommand(a.ctx, c)
	if e != nil {
		return e
	}
	if !claimed {
		return nil
	}
	fail := func(status, reason string) error { return a.Store.CommandStatus(a.ctx, c, status, reason, nil) }
	a.mu.Lock()
	generation := a.generations[c.DeviceUUID]
	_, enabled := a.definitions[c.DeviceUUID]
	a.mu.Unlock()
	if !enabled || c.Generation != generation {
		return fail("cancelled", "Command belongs to an inactive or superseded device generation.")
	}
	if !c.ExpiresAt.After(time.Now()) {
		return fail("timed_out", "The command expired before dispatch.")
	}
	check, mapping, e := a.commandCheck(c)
	if e != nil {
		return fail("failed", e.Error())
	}
	if check["session_id"] != c.SessionID {
		return fail("failed", "The source session changed after confirmation.")
	}
	if check["already_at_target"] == true {
		return fail("failed", "The target state changed before dispatch. No command was sent.")
	}
	a.mu.Lock()
	d := a.definitions[c.DeviceUUID]
	b := a.brokers[d.Source.ConnectionUUID]
	a.mu.Unlock()
	if b == nil || !b.Client.IsConnectionOpen() {
		return fail("failed", "The broker connection is unavailable.")
	}
	metric, e := sparkplug.EncodeMetric(*mapping.CommandMetric, *mapping.CommandDatatype, c.Value)
	if e != nil {
		return fail("failed", e.Error())
	}
	raw, e := proto.Marshal(&pb.Payload{Timestamp: proto.Uint64(uint64(time.Now().UnixMilli())), Metrics: []*pb.Payload_Metric{metric}})
	if e != nil {
		return fail("failed", e.Error())
	}
	topic := "spBv1.0/" + d.Source.GroupID + "/NCMD/" + d.Source.EdgeNodeID
	if d.Source.DeviceID != "" {
		topic = "spBv1.0/" + d.Source.GroupID + "/DCMD/" + d.Source.EdgeNodeID + "/" + d.Source.DeviceID
	}
	sentAt := time.Now().UTC()
	pending := &pendingCommand{Request: c, SentAt: sentAt}
	a.mu.Lock()
	a.pending[c.UUID] = pending
	a.mu.Unlock()
	token := b.Client.Publish(topic, 0, false, raw)
	if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
		a.mu.Lock()
		pending.Outcome = "uncertain"
		pending.Diagnostic = "The broker send outcome is unknown. This command will not be replayed."
		a.mu.Unlock()
	} else {
		a.mu.Lock()
		pending.Sent = true
		a.mu.Unlock()
	}
	a.expireCommands()
	return nil
}

func (a *Application) observe(telemetry devices.Telemetry) {
	a.mu.Lock()
	for _, p := range a.pending {
		c := p.Request
		if p.Outcome != "" || c.DeviceUUID != telemetry.Definition.DeviceUUID || c.ConfigurationUUID != telemetry.Definition.ConfigurationUUID || c.SessionID != telemetry.SessionID {
			continue
		}
		for _, r := range telemetry.Readings {
			if r.ParameterUUID != c.ParameterUUID || r.Historical || r.Quality != "good" || !r.ReceivedAt.After(p.SentAt) || r.ReceivedAt.After(c.ExpiresAt) {
				continue
			}
			datatype := ""
			for _, mapping := range telemetry.Definition.Mappings {
				if mapping.ParameterUUID == c.ParameterUUID {
					datatype = mapping.Datatype
				}
			}
			if targetEqual(datatype, r.Value, c.Value) {
				p.Observed = true
			}
		}
	}
	a.mu.Unlock()
	a.expireCommands()
}

// Persist decisions before removing them from memory. Failed writes are retried, never sends.
func (a *Application) expireCommands() {
	type outcome struct {
		command            *pendingCommand
		status, diagnostic string
	}
	a.mu.Lock()
	outcomes := []outcome{}
	for _, p := range a.pending {
		status, diagnostic := p.Outcome, p.Diagnostic
		if status == "" && p.Sent && p.Observed {
			status, diagnostic = "observed", "The device subsequently reported the requested state."
		}
		if status == "" && !p.Request.ExpiresAt.After(time.Now()) {
			status, diagnostic = "uncertain", "No definitive send outcome was persisted before the deadline."
			if p.Sent {
				status, diagnostic = "timed_out", "No matching live state was observed before the execution deadline."
			}
		}
		if status != "" {
			p.Outcome, p.Diagnostic = status, diagnostic
		} else if p.Sent {
			status = "sent"
		}
		if status != "" {
			outcomes = append(outcomes, outcome{p, status, diagnostic})
		}
	}
	a.mu.Unlock()
	for _, result := range outcomes {
		p := result.command
		if e := a.Store.CommandStatus(a.ctx, p.Request, result.status, result.diagnostic, &p.SentAt); e != nil {
			a.Logger.Warn("command outcome persistence deferred", "error", e)
			continue
		}
		if result.status != "sent" {
			a.mu.Lock()
			if a.pending[p.Request.UUID] == p {
				delete(a.pending, p.Request.UUID)
			}
			a.mu.Unlock()
		}
	}
	a.mu.Lock()
	tracked := map[string]bool{}
	for id := range a.pending {
		tracked[id] = true
	}
	a.mu.Unlock()
	// Reconcile abandoned durable claims without ever publishing a command again.
	persisted, e := a.Store.Outstanding(a.ctx)
	if e != nil {
		return
	}
	for _, c := range persisted {
		if c.ExpiresAt.After(time.Now()) || tracked[c.UUID] {
			continue
		}
		_ = a.Store.CommandStatus(a.ctx, c, "uncertain", "The execution deadline elapsed without a durable terminal outcome; no replay is permitted.", nil)
	}
}
