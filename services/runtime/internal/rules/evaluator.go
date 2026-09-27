// Package rules implements a deterministic, side-effect-free geofence pipeline.
// Live activation and durable scheduling are separate integration boundaries.
package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
)

type NodeType struct {
	Type   string `json:"type"`
	Input  string `json:"input"`
	Output string `json:"output"`
}

func NodeTypes() []NodeType {
	return []NodeType{
		{"location.source.v1", "telemetry.committed.v1", "location-fix.v1"},
		{"geofence.membership.v1", "location-fix.v1", "spatial-condition.v1"},
		{"condition.sustained.v1", "spatial-condition.v1", "condition-state.v1"},
		{"alert.condition.v1", "condition-state.v1", "rule-transition.v1"},
	}
}

type Policy struct {
	OutsideForSeconds int     `json:"outside_for_seconds"`
	MaxGapSeconds     int     `json:"max_gap_seconds"`
	MinimumSamples    int     `json:"minimum_samples"`
	UncertaintyMetres float64 `json:"uncertainty_metres"`
}
type Definition struct {
	SchemaVersion    string           `json:"schema_version"`
	UUID             string           `json:"uuid"`
	VersionUUID      string           `json:"version_uuid"`
	EvaluatorVersion string           `json:"evaluator_version"`
	Pipeline         []string         `json:"pipeline"`
	Binding          location.Binding `json:"binding"`
	Geometry         Polygon          `json:"geometry"`
	Policy           Policy           `json:"policy"`
}
type Compiled struct {
	definition Definition
	Hash       string
	geometry   geometry
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func hash(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func Compile(d Definition) (*Compiled, error) {
	if d.SchemaVersion != "geofence-rule.v1" || d.EvaluatorVersion != "geofence.v1" || !uuidPattern.MatchString(d.UUID) || !uuidPattern.MatchString(d.VersionUUID) {
		return nil, fmt.Errorf("invalid rule identity or evaluator version")
	}
	if err := d.Binding.Validate(); err != nil {
		return nil, err
	}
	nodes := NodeTypes()
	if len(d.Pipeline) != len(nodes) {
		return nil, fmt.Errorf("v1 requires the typed geofence pipeline")
	}
	for i, node := range nodes {
		if d.Pipeline[i] != node.Type {
			return nil, fmt.Errorf("unsupported pipeline node or order")
		}
	}
	p := d.Policy
	if p.OutsideForSeconds < 0 || p.OutsideForSeconds > 86400 || p.MaxGapSeconds < 1 || p.MaxGapSeconds > d.Binding.MaxAgeSeconds || p.MinimumSamples < 1 || p.MinimumSamples > 1000 || !finite(p.UncertaintyMetres) || p.UncertaintyMetres < 0 || p.UncertaintyMetres > 100000 {
		return nil, fmt.Errorf("invalid sustained-condition policy")
	}
	if p.OutsideForSeconds > 0 && p.MinimumSamples < 2 {
		return nil, fmt.Errorf("a sustained condition requires at least two observations")
	}
	g, err := compilePolygon(d.Geometry)
	if err != nil {
		return nil, err
	}
	// Snapshot the definition so caller mutation cannot change compiled semantics.
	raw, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	var snapshot Definition
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	return &Compiled{definition: snapshot, Hash: hash(raw), geometry: g}, nil
}

type State struct {
	SchemaVersion  string     `json:"schema_version"`
	DefinitionHash string     `json:"definition_hash"`
	Condition      string     `json:"condition"`
	Active         bool       `json:"active"`
	Episode        int        `json:"episode"`
	OutsideSince   *time.Time `json:"outside_since"`
	Samples        int        `json:"samples"`
	LastObservedAt *time.Time `json:"last_observed_at"`
	LastEventID    string     `json:"last_event_id"`
	ExpiresAt      *time.Time `json:"expires_at"`
	EvaluatedAt    time.Time  `json:"evaluated_at"`
}
type Transition struct {
	SchemaVersion    string    `json:"schema_version"`
	ID               string    `json:"id"`
	Type             string    `json:"type"`
	RuleUUID         string    `json:"rule_uuid"`
	VersionUUID      string    `json:"version_uuid"`
	DefinitionHash   string    `json:"definition_hash"`
	OrganizationUUID string    `json:"organization_uuid"`
	DeviceUUID       string    `json:"device_uuid"`
	BindingUUID      string    `json:"binding_uuid"`
	BindingRevision  int       `json:"binding_revision"`
	Episode          int       `json:"episode"`
	EventID          string    `json:"event_id"`
	OccurredAt       time.Time `json:"occurred_at"`
}
type Result struct {
	State                State       `json:"state"`
	Reason               string      `json:"reason"`
	Transition           *Transition `json:"transition"`
	MembershipTransition *Transition `json:"membership_transition,omitempty"`
}

func (c *Compiled) Initial() State {
	return State{SchemaVersion: "geofence-state.v1", DefinitionHash: c.Hash, Condition: "unknown"}
}
func unknown(s *State) {
	s.Condition = "unknown"
	s.OutsideSince = nil
	s.Samples = 0
	s.ExpiresAt = nil
}

// Step accepts an observation or a timer tick (nil event). The caller must retain
// state and emitted transition atomically before acknowledging a live message.
func (c *Compiled) Step(previous State, event *devices.CommittedTelemetry, at time.Time) (Result, error) {
	if at.IsZero() || previous.DefinitionHash != c.Hash || previous.SchemaVersion != "geofence-state.v1" || at.Before(previous.EvaluatedAt) {
		return Result{}, fmt.Errorf("state/definition mismatch or evaluation time moved backwards")
	}
	if previous.Episode < 0 || previous.Samples < 0 || (previous.Active && previous.Episode == 0) ||
		(previous.Condition != "unknown" && previous.Condition != "inside" && previous.Condition != "outside") ||
		(previous.Condition == "outside" && (previous.OutsideSince == nil || previous.Samples == 0 || previous.LastObservedAt == nil || previous.ExpiresAt == nil)) ||
		(previous.Condition != "outside" && (previous.OutsideSince != nil || previous.Samples != 0)) {
		return Result{}, fmt.Errorf("invalid serialized rule state")
	}
	s := previous
	previousCondition := previous.Condition
	s.EvaluatedAt = at
	result := Result{State: s, Reason: "timer"}
	p := c.definition.Policy
	if s.ExpiresAt != nil && at.After(*s.ExpiresAt) {
		unknown(&s)
		result.Reason = "stale_evidence"
	}
	if event != nil {
		fix, err := location.Resolve(c.definition.Binding, *event, at)
		if err != nil {
			return Result{}, err
		}
		// Foreign bindings, history and reordered/duplicate observations cannot
		// change the condition or count as additional sustained evidence.
		ignored := ""
		if fix.Reason == "scope_mismatch" {
			ignored = "scope_mismatch"
		} else if fix.Historical {
			ignored = "historical"
		} else if event.EventID == s.LastEventID {
			ignored = "duplicate"
		} else if fix.ObservedAt != nil && s.LastObservedAt != nil && !fix.ObservedAt.After(*s.LastObservedAt) {
			ignored = "out_of_order"
		}
		if ignored != "" {
			result.State = s
			result.Reason = ignored
			return result, nil
		}
		if !fix.LiveEligible {
			unknown(&s)
			result.State = s
			result.Reason = fix.Reason
			return result, nil
		}
		if s.LastObservedAt != nil && fix.ObservedAt.Sub(*s.LastObservedAt) > time.Duration(p.MaxGapSeconds)*time.Second {
			unknown(&s)
		}
		condition := c.geometry.classify(fix.Point.Longitude, fix.Point.Latitude, p.UncertaintyMetres)
		if fix.Point.AccuracyMetres != nil && *fix.Point.AccuracyMetres > p.UncertaintyMetres {
			condition = c.geometry.classify(fix.Point.Longitude, fix.Point.Latitude, *fix.Point.AccuracyMetres)
		}
		s.LastEventID = event.EventID
		s.LastObservedAt = fix.ObservedAt
		expires := fix.ObservedAt.Add(time.Duration(c.definition.Binding.MaxAgeSeconds) * time.Second)
		for _, candidate := range []time.Time{fix.ReceivedAt.Add(time.Duration(c.definition.Binding.MaxAgeSeconds) * time.Second), fix.ReceivedAt.Add(time.Duration(p.MaxGapSeconds) * time.Second)} {
			if candidate.Before(expires) {
				expires = candidate
			}
		}
		s.ExpiresAt = &expires
		if condition == "unknown" {
			unknown(&s)
			result.Reason = "boundary_uncertainty"
		} else if condition == "inside" {
			s.Condition = "inside"
			s.OutsideSince = nil
			s.Samples = 0
			result.Reason = "inside"
			if s.Active {
				s.Active = false
				result.Transition = c.transition(s, "cleared", at)
			}
		} else {
			if s.Condition != "outside" || s.OutsideSince == nil {
				since := at
				s.OutsideSince = &since
				s.Samples = 0
			}
			s.Condition = "outside"
			s.Samples++
			result.Reason = "outside_pending"
		}
		if previousCondition == "inside" && s.Condition == "outside" {
			result.MembershipTransition = c.membershipTransition(s, "exited", at)
		} else if previousCondition == "outside" && s.Condition == "inside" {
			result.MembershipTransition = c.membershipTransition(s, "entered", at)
		}
	}
	if s.Condition == "outside" && !s.Active && s.OutsideSince != nil && s.Samples >= p.MinimumSamples && s.ExpiresAt != nil && !at.After(*s.ExpiresAt) {
		due := s.OutsideSince.Add(time.Duration(p.OutsideForSeconds) * time.Second)
		if !at.Before(due) {
			s.Active = true
			s.Episode++
			result.Transition = c.transition(s, "activated", at)
			result.Reason = "activated"
		}
	}
	if s.Active && s.Condition == "outside" && result.Transition == nil {
		result.Reason = "outside_active"
	}
	result.State = s
	return result, nil
}
func (c *Compiled) membershipTransition(s State, kind string, at time.Time) *Transition {
	d := c.definition
	return &Transition{SchemaVersion: "geofence-transition.v1", ID: hash([]byte(fmt.Sprintf("%s:%s:%s", c.Hash, s.LastEventID, kind))), Type: kind,
		RuleUUID: d.UUID, VersionUUID: d.VersionUUID, DefinitionHash: c.Hash, OrganizationUUID: d.Binding.OrganizationUUID,
		DeviceUUID: d.Binding.DeviceUUID, BindingUUID: d.Binding.UUID, BindingRevision: d.Binding.Revision,
		Episode: s.Episode, EventID: s.LastEventID, OccurredAt: at}
}
func (c *Compiled) transition(s State, kind string, at time.Time) *Transition {
	d := c.definition
	return &Transition{SchemaVersion: "rule-transition.v1", ID: hash([]byte(fmt.Sprintf("%s:%d:%s", c.Hash, s.Episode, kind))), Type: kind, RuleUUID: d.UUID, VersionUUID: d.VersionUUID, DefinitionHash: c.Hash, OrganizationUUID: d.Binding.OrganizationUUID, DeviceUUID: d.Binding.DeviceUUID, BindingUUID: d.Binding.UUID, BindingRevision: d.Binding.Revision, Episode: s.Episode, EventID: s.LastEventID, OccurredAt: at}
}
