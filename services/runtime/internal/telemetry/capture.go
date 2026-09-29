// Package telemetry holds bounded, ephemeral diagnostic captures, never production data.
package telemetry

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

const MaxSamples = 200
const MaxSampleBytes = 64 << 10

type Scope struct {
	Organization string  `json:"organization_uuid"`
	Connection   string  `json:"connection_uuid"`
	Gateway      string  `json:"gateway_uuid"`
	Edge         string  `json:"edge_node_id"`
	SourceDevice *string `json:"source_device_id"`
	Device       string  `json:"device_uuid,omitempty"`
	UserID       int     `json:"user_id"`
}
type Outcome struct {
	Device        string                 `json:"device_uuid"`
	Configuration string                 `json:"configuration_uuid"`
	Status        string                 `json:"status"`
	Diagnostic    string                 `json:"diagnostic,omitempty"`
	Stages        []devices.ReadingTrace `json:"stages"`
	Readings      []devices.Reading      `json:"readings"`
}
type Sample struct {
	ID           string           `json:"id"`
	Topic        string           `json:"topic"`
	Kind         string           `json:"kind"`
	SourceDevice string           `json:"source_device_id"`
	Received     time.Time        `json:"received_at"`
	Size         int              `json:"payload_bytes"`
	Wire         string           `json:"wire_base64"`
	Seq          *uint64          `json:"seq,omitempty"`
	BdSeq        *uint64          `json:"bd_seq,omitempty"`
	Session      string           `json:"birth_session,omitempty"`
	Status       string           `json:"status"`
	Diagnostic   string           `json:"diagnostic,omitempty"`
	Metrics      []devices.Metric `json:"metrics"`
	Outcomes     []Outcome        `json:"outcomes"`
}
type Session struct {
	ID        string    `json:"id"`
	Scope     Scope     `json:"scope"`
	Started   time.Time `json:"started_at"`
	Expires   time.Time `json:"expires_at"`
	PurgeAt   time.Time `json:"purge_at"`
	Stopped   bool      `json:"stopped"`
	Suspended bool      `json:"suspended"`
	Captured  int       `json:"captured"`
	Dropped   int       `json:"dropped"`
	Samples   []Sample  `json:"samples"`
}
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	now      func() time.Time
}

func New() *Manager { return &Manager{sessions: map[string]*Session{}, now: time.Now} }
func (m *Manager) prune() {
	now := m.now()
	for id, s := range m.sessions {
		if !now.Before(s.PurgeAt) {
			delete(m.sessions, id)
			continue
		}
		if !now.Before(s.Expires) {
			s.Stopped = true
			s.Suspended = false
		}
	}
}
func (m *Manager) Start(id string, scope Scope, seconds int) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	if seconds < 60 || seconds > 600 || scope.Organization == "" || scope.Connection == "" || scope.Edge == "" {
		return Session{}, errors.New("Choose a gateway and a capture duration from 60 to 600 seconds.")
	}
	count := 0
	for _, s := range m.sessions {
		if s.Scope.Organization == scope.Organization {
			count++
		}
	}
	if len(m.sessions) >= 32 || count >= 4 {
		return Session{}, errors.New("Capture limit reached. Delete an older capture before starting another.")
	}
	now := m.now().UTC()
	s := &Session{ID: id, Scope: scope, Started: now, Expires: now.Add(time.Duration(seconds) * time.Second), PurgeAt: now.Add(time.Duration(seconds)*time.Second + 30*time.Minute), Samples: []Sample{}}
	m.sessions[id] = s
	return *s, nil
}
func (m *Manager) Get(org, id string) (Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	s, ok := m.sessions[id]
	if !ok || s.Scope.Organization != org {
		return Session{}, false
	}
	// Deep-copy snapshots so callers never race with the capture writer.
	raw, _ := json.Marshal(s)
	var result Session
	_ = json.Unmarshal(raw, &result)
	return result, true
}
func (m *Manager) List(org string) []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	result := []Session{}
	for _, s := range m.sessions {
		if s.Scope.Organization == org {
			copy := *s
			copy.Samples = nil
			result = append(result, copy)
		}
	}
	return result
}
func (m *Manager) Change(org, id, action string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	s, ok := m.sessions[id]
	if !ok || s.Scope.Organization != org {
		return errors.New("Capture not found or expired.")
	}
	switch action {
	case "stop":
		s.Stopped = true
		s.Suspended = false
	case "delete":
		delete(m.sessions, id)
	case "resume":
		s.Suspended = false
	case "suspend":
		if s.Stopped || s.Scope.Device == "" || s.Scope.SourceDevice == nil {
			return errors.New("Only an active capture of one onboarded device can suspend ingestion.")
		}
		for _, other := range m.sessions {
			if other.ID != id && other.Scope.Device == s.Scope.Device && other.Suspended {
				return errors.New("This device is already suspended by another capture.")
			}
		}
		s.Suspended = true
	default:
		return errors.New("Unknown capture action.")
	}
	return nil
}
func (m *Manager) Suspended(org, device string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	for _, s := range m.sessions {
		if s.Scope.Organization == org && s.Scope.Device == device && s.Suspended && !s.Stopped {
			return true
		}
	}
	return false
}
func matches(s *Session, org, connection, edge, device string) bool {
	return !s.Stopped && s.Scope.Organization == org && s.Scope.Connection == connection && s.Scope.Edge == edge && (s.Scope.SourceDevice == nil || *s.Scope.SourceDevice == device || device == "")
}
func (m *Manager) Watching(org, connection, edge, device string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	for _, s := range m.sessions {
		if matches(s, org, connection, edge, device) {
			return true
		}
	}
	return false
}
func (m *Manager) Record(org, connection, edge string, sample Sample) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	raw, err := json.Marshal(sample)
	for _, s := range m.sessions {
		if !matches(s, org, connection, edge, sample.SourceDevice) {
			continue
		}
		s.Captured++
		if err != nil || len(raw) > MaxSampleBytes {
			s.Dropped++
			continue
		}
		if len(s.Samples) == MaxSamples {
			s.Samples = s.Samples[1:]
			s.Dropped++
		}
		s.Samples = append(s.Samples, sample)
	}
}
func (m *Manager) Update(id string, update func(*Sample)) {
	if id == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	for _, s := range m.sessions {
		for i := range s.Samples {
			if s.Samples[i].ID != id {
				continue
			}
			// Each capture owns its copy; outcomes may contain slices.
			raw, _ := json.Marshal(s.Samples[i])
			var next Sample
			_ = json.Unmarshal(raw, &next)
			update(&next)
			raw, err := json.Marshal(next)
			if err != nil || len(raw) > MaxSampleBytes {
				s.Samples = append(s.Samples[:i], s.Samples[i+1:]...)
				s.Dropped++
			} else {
				s.Samples[i] = next
			}
			break
		}
	}
}
func (m *Manager) Outcome(id string, result Outcome) {
	m.Update(id, func(s *Sample) {
		for i, old := range s.Outcomes {
			if old.Device == result.Device {
				s.Outcomes[i] = result
				return
			}
		}
		s.Outcomes = append(s.Outcomes, result)
	})
}
func (m *Manager) Stored(id, device, status, diagnostic string) {
	m.Update(id, func(s *Sample) {
		for i := range s.Outcomes {
			if s.Outcomes[i].Device == device {
				s.Outcomes[i].Status = status
				s.Outcomes[i].Diagnostic = diagnostic
			}
		}
	})
}
