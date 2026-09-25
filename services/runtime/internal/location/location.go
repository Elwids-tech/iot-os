// Package location resolves one explicitly paired source fix. It has no latest-
// value cache, geofence evaluation, side effects or live rule state.
package location

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

type Binding struct {
	SchemaVersion          string  `json:"schema_version"`
	UUID                   string  `json:"uuid"`
	Revision               int     `json:"revision"`
	OrganizationUUID       string  `json:"organization_uuid"`
	DeviceUUID             string  `json:"device_uuid"`
	ConfigurationUUID      string  `json:"configuration_uuid"`
	Generation             int     `json:"generation"`
	LatitudeParameterUUID  string  `json:"latitude_parameter_uuid"`
	LongitudeParameterUUID string  `json:"longitude_parameter_uuid"`
	AccuracyParameterUUID  *string `json:"accuracy_parameter_uuid"`
	Pairing                string  `json:"pairing"`
	MaxAgeSeconds          int     `json:"max_age_seconds"`
	MaxFutureSkewSeconds   int     `json:"max_future_skew_seconds"`
	AllowUnknownAccuracy   bool    `json:"allow_unknown_accuracy"`
}

type Point struct {
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	AccuracyMetres *float64 `json:"accuracy_metres"`
}

type Fix struct {
	SchemaVersion     string     `json:"schema_version"`
	BindingUUID       string     `json:"binding_uuid"`
	BindingRevision   int        `json:"binding_revision"`
	EventID           string     `json:"event_id"`
	OrganizationUUID  string     `json:"organization_uuid"`
	DeviceUUID        string     `json:"device_uuid"`
	ConfigurationUUID string     `json:"configuration_uuid"`
	Generation        int        `json:"generation"`
	EvaluatedAt       time.Time  `json:"evaluated_at"`
	ObservedAt        *time.Time `json:"observed_at"`
	ReceivedAt        *time.Time `json:"received_at"`
	TimestampSource   string     `json:"timestamp_source"`
	Historical        bool       `json:"historical"`
	Status            string     `json:"status"`
	Reason            string     `json:"reason"`
	LiveEligible      bool       `json:"live_eligible"`
	Point             *Point     `json:"point"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (b Binding) Validate() error {
	if b.SchemaVersion != "location-binding.v1" || b.Pairing != "same_event" || b.Revision < 1 || b.Generation < 1 {
		return fmt.Errorf("unsupported binding version, pairing or revision")
	}
	ids := []string{b.UUID, b.OrganizationUUID, b.DeviceUUID, b.ConfigurationUUID, b.LatitudeParameterUUID, b.LongitudeParameterUUID}
	if b.AccuracyParameterUUID != nil {
		ids = append(ids, *b.AccuracyParameterUUID)
	}
	for _, id := range ids {
		if !uuidPattern.MatchString(id) {
			return fmt.Errorf("binding identities must be UUIDs")
		}
	}
	if b.LatitudeParameterUUID == b.LongitudeParameterUUID || (b.AccuracyParameterUUID != nil && (*b.AccuracyParameterUUID == b.LatitudeParameterUUID || *b.AccuracyParameterUUID == b.LongitudeParameterUUID)) {
		return fmt.Errorf("location parameters must be distinct")
	}
	if b.MaxAgeSeconds < 1 || b.MaxAgeSeconds > 86400 || b.MaxFutureSkewSeconds < 0 || b.MaxFutureSkewSeconds > 300 {
		return fmt.Errorf("invalid location timing policy")
	}
	return nil
}

// Resolve is deterministic for (binding, event, evaluatedAt). same_event is an
// explicit adapter assertion that the paired parameters describe one source fix;
// packet membership alone cannot establish this for an arbitrary batch adapter.
func Resolve(b Binding, e devices.CommittedTelemetry, at time.Time) (Fix, error) {
	if err := b.Validate(); err != nil {
		return Fix{}, err
	}
	if at.IsZero() || e.SchemaVersion != devices.CommittedTelemetryVersion || !uuidPattern.MatchString(e.EventID) || e.EventID != e.TelemetryID || len(e.Readings) == 0 || len(e.Readings) > 2000 || e.Generation < 1 {
		return Fix{}, fmt.Errorf("invalid committed event or evaluation time")
	}
	for _, id := range []string{e.OrganizationUUID, e.DeviceUUID, e.ConfigurationUUID} {
		if !uuidPattern.MatchString(id) {
			return Fix{}, fmt.Errorf("invalid committed event identity")
		}
	}
	if seq, err := strconv.ParseUint(e.Sequence, 10, 64); err != nil || seq == 0 {
		return Fix{}, fmt.Errorf("invalid committed event sequence")
	}
	f := Fix{SchemaVersion: "location-fix.v1", BindingUUID: b.UUID, BindingRevision: b.Revision, EventID: e.EventID, OrganizationUUID: e.OrganizationUUID, DeviceUUID: e.DeviceUUID, ConfigurationUUID: e.ConfigurationUUID, Generation: e.Generation, EvaluatedAt: at, TimestampSource: "unknown", Status: "unknown", Reason: "scope_mismatch"}
	if e.OrganizationUUID != b.OrganizationUUID || e.DeviceUUID != b.DeviceUUID || e.ConfigurationUUID != b.ConfigurationUUID || e.Generation != b.Generation {
		return f, nil
	}
	readings := map[string]devices.CommittedReading{}
	for _, r := range e.Readings {
		if r.ParameterUUID != b.LatitudeParameterUUID && r.ParameterUUID != b.LongitudeParameterUUID && (b.AccuracyParameterUUID == nil || r.ParameterUUID != *b.AccuracyParameterUUID) {
			continue
		}
		if _, exists := readings[r.ParameterUUID]; exists {
			f.Reason = "ambiguous_parameters"
			return f, nil
		}
		readings[r.ParameterUUID] = r
	}
	lat, latOK := readings[b.LatitudeParameterUUID]
	lon, lonOK := readings[b.LongitudeParameterUUID]
	if !latOK || !lonOK {
		f.Reason = "incomplete_fix"
		return f, nil
	}
	if !lat.ObservedAt.Equal(lon.ObservedAt) || !lat.ReceivedAt.Equal(lon.ReceivedAt) || lat.Historical != lon.Historical || lat.TimestampSource != lon.TimestampSource {
		f.Reason = "incoherent_fix"
		return f, nil
	}
	f.ObservedAt = &lat.ObservedAt
	f.ReceivedAt = &lat.ReceivedAt
	f.Historical = lat.Historical
	if lat.TimestampSource != "" {
		f.TimestampSource = lat.TimestampSource
	}
	if lat.Quality != "good" || lon.Quality != "good" {
		f.Reason = "invalid_quality"
		return f, nil
	}
	latitude, okLat := numeric(lat)
	longitude, okLon := numeric(lon)
	if !okLat || !okLon {
		f.Reason = "invalid_coordinates"
		return f, nil
	}
	if lat.Unit == nil || lon.Unit == nil || *lat.Unit != "deg" || *lon.Unit != "deg" {
		f.Reason = "invalid_units"
		return f, nil
	}
	if latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
		f.Reason = "invalid_coordinates"
		return f, nil
	}
	if lat.ObservedAt.IsZero() || lat.ReceivedAt.IsZero() {
		f.Reason = "invalid_time"
		return f, nil
	}
	// The receipt boundary is trusted. Future receipts cannot be simulated as live.
	if lat.ReceivedAt.After(at) || lat.ObservedAt.After(lat.ReceivedAt.Add(time.Duration(b.MaxFutureSkewSeconds)*time.Second)) || lat.ObservedAt.After(at) {
		f.Reason = "future_time"
		return f, nil
	}
	if lat.TimestampSource != "source" {
		f.Reason = "untrusted_time"
		return f, nil
	}
	point := Point{Latitude: latitude, Longitude: longitude}
	if b.AccuracyParameterUUID != nil {
		if accuracy, ok := readings[*b.AccuracyParameterUUID]; ok {
			if !accuracy.ObservedAt.Equal(lat.ObservedAt) || !accuracy.ReceivedAt.Equal(lat.ReceivedAt) || accuracy.Historical != lat.Historical || accuracy.TimestampSource != lat.TimestampSource {
				f.Reason = "incoherent_accuracy"
				return f, nil
			}
			value, valid := numeric(accuracy)
			if accuracy.Quality != "good" || !valid || value < 0 || accuracy.Unit == nil || *accuracy.Unit != "m" {
				f.Reason = "invalid_accuracy"
				return f, nil
			}
			point.AccuracyMetres = &value
		}
	}
	if point.AccuracyMetres == nil && !b.AllowUnknownAccuracy {
		f.Reason = "accuracy_required"
		return f, nil
	}
	if lat.Historical {
		f.Status = "valid"
		f.Reason = "historical"
		f.Point = &point
		return f, nil
	}
	maxAge := time.Duration(b.MaxAgeSeconds) * time.Second
	if at.Sub(lat.ObservedAt) > maxAge || at.Sub(lat.ReceivedAt) > maxAge {
		f.Reason = "stale_fix"
		return f, nil
	}
	f.Status = "valid"
	f.Reason = "eligible"
	f.LiveEligible = true
	f.Point = &point
	return f, nil
}

func numeric(r devices.CommittedReading) (float64, bool) {
	if r.DataType != "number" && r.DataType != "integer" {
		return 0, false
	}
	var value float64
	switch n := r.Value.(type) {
	case json.Number:
		v, err := n.Float64()
		if err != nil {
			return 0, false
		}
		value = v
	case float64:
		value = n
	case int:
		value = float64(n)
	case int64:
		value = float64(n)
	default:
		return 0, false
	}
	return value, !math.IsNaN(value) && !math.IsInf(value, 0)
}
