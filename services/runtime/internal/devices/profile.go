package devices

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

func ParseProfile(d Definition) (Profile, error) {
	var p Profile
	hash := sha256.Sum256([]byte(d.ProfileCanonicalJSON))
	if hex.EncodeToString(hash[:]) != d.ProfileHash {
		return p, errors.New("profile artifact hash mismatch")
	}
	decoder := json.NewDecoder(strings.NewReader(d.ProfileCanonicalJSON))
	decoder.UseNumber()
	if err := decoder.Decode(&p); err != nil {
		return p, err
	}
	if p.SchemaVersion != "device-profile.v1" || d.SchemaVersion != "device-configuration.v1" {
		return p, errors.New("unsupported definition version")
	}
	return p, nil
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func ValidateValue(p Parameter, v any) error {
	valid := false
	switch p.DataType {
	case "boolean":
		_, valid = v.(bool)
	case "integer":
		n, ok := Number(v)
		valid = ok && math.Trunc(n) == n && math.Abs(n) <= 9007199254740991
	case "number":
		_, valid = Number(v)
	case "string":
		s, ok := v.(string)
		valid = ok && len(s) <= 65536
	case "timestamp":
		s, ok := v.(string)
		if ok {
			_, e := time.Parse(time.RFC3339Nano, s)
			valid = e == nil
		}
	case "bytes":
		s, ok := v.(string)
		if ok {
			_, e := base64.StdEncoding.DecodeString(s)
			valid = e == nil
		}
	}
	if p.Format != nil && *p.Format == "hex_color" {
		s, ok := v.(string)
		valid = valid && ok && colorPattern.MatchString(s)
	}
	if !valid {
		return errors.New("value does not match the profile type or format")
	}
	if p.Validation != nil {
		result, e := Evaluate(p.Validation.Rule, map[string]any{"value": v})
		if e != nil {
			return e
		}
		if !truth(result) {
			if p.Validation.Message != "" {
				return errors.New(p.Validation.Message)
			}
			return errors.New("profile validation failed")
		}
	}
	return nil
}
func Preview(d Definition, metrics []Metric) ([]Reading, error) {
	p, e := ParseProfile(d)
	if e != nil {
		return nil, e
	}
	params := map[string]Parameter{}
	for _, parameter := range p.Parameters {
		params[parameter.UUID] = parameter
	}
	byName := map[string]Metric{}
	for _, m := range metrics {
		byName[m.Name] = m
	}
	for _, mapping := range d.Mappings {
		parameter, ok := params[mapping.ParameterUUID]
		if !ok || !parameter.ReportsState || parameter.Kind == "derived" {
			return nil, errors.New("mapping references an unknown or nonreported parameter")
		}
		m, ok := byName[mapping.Metric]
		if !ok || m.Datatype != mapping.Datatype {
			return nil, fmt.Errorf("metric %s is missing or its datatype changed", mapping.Metric)
		}
		if mapping.CommandMetric != nil {
			target, exists := byName[*mapping.CommandMetric]
			if !exists || !parameter.AcceptsCommand || !parameter.ReportsState || mapping.CommandDatatype == nil || target.Datatype != *mapping.CommandDatatype {
				return nil, errors.New("invalid command target")
			}
		}
	}
	return Readings(d, p, metrics, map[string]Reading{}, time.Now().UTC()), nil
}

func Readings(d Definition, p Profile, metrics []Metric, latest map[string]Reading, received time.Time) []Reading {
	params := map[string]Parameter{}
	for _, parameter := range p.Parameters {
		params[parameter.UUID] = parameter
	}
	source := map[string]Metric{}
	for _, metric := range metrics {
		source[metric.Name] = metric
	}
	updates := map[string]Reading{}
	for _, mapping := range d.Mappings {
		metric, ok := source[mapping.Metric]
		if !ok {
			continue
		}
		parameter := params[mapping.ParameterUUID]
		observed := received
		if metric.Timestamp != nil {
			observed = *metric.Timestamp
		}
		r := Reading{ParameterUUID: parameter.UUID, Key: parameter.Key, Label: parameter.Label, DataType: parameter.DataType, Unit: parameter.Unit, Value: metric.Value, Quality: "good", ObservedAt: observed, ReceivedAt: received, Historical: metric.Historical}
		if observed.After(received.Add(5 * time.Minute)) {
			r.ObservedAt = received
			r.Diagnostic = "source clock is ahead; receipt time used"
		}
		err := ValidateValue(parameter, metric.Value)
		if metric.IsNull {
			err = errors.New("source reported a null value")
		}
		if metric.Diagnostic != "" {
			err = errors.New(metric.Diagnostic)
		}
		if metric.Datatype != mapping.Datatype {
			err = errors.New("source datatype changed; review the mapping")
		}
		if parameter.Counter != nil && parameter.Counter.Monotonic && err == nil {
			previous, ok := latest[parameter.UUID]
			if ok {
				a, aok := Number(previous.Value)
				b, bok := Number(metric.Value)
				if aok && bok && b < a {
					err = errors.New("counter decreased; reset requires review")
				}
			}
		}
		if err != nil {
			r.Quality = "invalid"
			r.Diagnostic = err.Error()
		}
		updates[parameter.UUID] = r
	}
	// Process the dependency graph only when inputs change; source-quality failures propagate.
	pending := append([]Calculation(nil), p.Calculations...)
	for len(pending) > 0 {
		progress := false
		next := []Calculation{}
		for _, calculation := range pending {
			ready := true
			changed := false
			context := map[string]any{}
			invalid := ""
			historical := false
			for _, input := range calculation.Inputs {
				r, ok := updates[input.ParameterUUID]
				if ok {
					changed = true
				} else {
					r, ok = latest[input.ParameterUUID]
				}
				if !ok {
					if params[input.ParameterUUID].Kind == "derived" {
						ready = false
					}
					invalid = "calculation input is unavailable"
					continue
				}
				context[input.Alias] = r.Value
				historical = historical || r.Historical
				if r.Quality != "good" {
					invalid = "calculation input is not valid"
				}
				if hint := params[input.ParameterUUID].Reporting; hint != nil && hint.StaleAfterSeconds > 0 && received.Sub(r.ReceivedAt) > time.Duration(hint.StaleAfterSeconds)*time.Second {
					invalid = "calculation input is stale"
				}
			}
			if !ready {
				next = append(next, calculation)
				continue
			}
			progress = true
			if !changed {
				continue
			}
			parameter := params[calculation.TargetParameterUUID]
			r := Reading{ParameterUUID: parameter.UUID, Key: parameter.Key, Label: parameter.Label, DataType: parameter.DataType, Unit: parameter.Unit, Quality: "good", ReceivedAt: received, ObservedAt: received, Historical: historical}
			var err error
			if invalid != "" {
				err = errors.New(invalid)
			} else {
				r.Value, err = Evaluate(calculation.Expression, context)
				if err == nil {
					err = ValidateValue(parameter, r.Value)
				}
			}
			if err != nil {
				r.Quality = "invalid"
				r.Diagnostic = err.Error()
			}
			updates[parameter.UUID] = r
		}
		if !progress {
			break
		}
		pending = next
	}
	result := []Reading{}
	for _, parameter := range p.Parameters {
		if r, ok := updates[parameter.UUID]; ok {
			result = append(result, r)
		}
	}
	return result
}
