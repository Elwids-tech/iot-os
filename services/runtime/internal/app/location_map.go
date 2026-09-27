package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/jackc/pgx/v5"
)

type locationMapItem struct {
	Binding       location.Binding `json:"binding"`
	OperationUUID *string          `json:"operation_uuid"`
	DeviceName    string           `json:"device_name"`
}

func (a *Application) locationMap(w http.ResponseWriter, r *http.Request) {
	var input struct {
		OrganizationUUID string            `json:"organization_uuid"`
		Items            []locationMapItem `json:"items"`
		From             time.Time         `json:"from"`
		To               time.Time         `json:"to"`
		IncludeTrails    bool              `json:"include_trails"`
		MaxPoints        int               `json:"max_points"`
		RetentionDays    int               `json:"retention_days"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if input.OrganizationUUID == "" || len(input.Items) < 1 || len(input.Items) > 100 || input.From.IsZero() || input.To.IsZero() ||
		!input.To.After(input.From) || input.To.Sub(input.From) > 7*24*time.Hour || input.MaxPoints < 10 || input.MaxPoints > 200 ||
		input.RetentionDays < 1 || input.RetentionDays > 36500 {
		respond(w, 422, map[string]string{"message": "invalid location map request"})
		return
	}
	now := time.Now().UTC()
	devicesResult := make([]map[string]any, 0, len(input.Items))
	for _, item := range input.Items {
		if item.Binding.Validate() != nil || item.Binding.OrganizationUUID != input.OrganizationUUID {
			respond(w, 422, map[string]string{"message": "invalid location map binding"})
			return
		}
		latestEvent, err := a.Store.LatestCommittedEvent(r.Context(), input.OrganizationUUID, item.Binding.DeviceUUID, now.AddDate(0, 0, -input.RetentionDays), now)
		if err != nil {
			respond(w, 503, map[string]string{"message": "location evidence unavailable"})
			return
		}
		var latest *location.Fix
		if latestEvent != nil {
			fix, resolveErr := location.Resolve(item.Binding, *latestEvent, now)
			if resolveErr != nil {
				respond(w, 503, map[string]string{"message": "location evidence invalid"})
				return
			}
			latest = &fix
		}
		condition := "unknown"
		active := false
		var geometry any
		if item.OperationUUID != nil {
			var definitionRaw, stateRaw []byte
			err = a.Store.Pool.QueryRow(r.Context(), `SELECT definition,state FROM device_runtime.rule_executions
			 WHERE operation_uuid::text=$1 AND organization_uuid::text=$2`, *item.OperationUUID, input.OrganizationUUID).Scan(&definitionRaw, &stateRaw)
			if err == nil {
				var definition rules.Definition
				var state rules.State
				if json.Unmarshal(definitionRaw, &definition) == nil && json.Unmarshal(stateRaw, &state) == nil {
					condition, active, geometry = state.Condition, state.Active, definition.Geometry
				}
			} else if !errors.Is(err, pgx.ErrNoRows) {
				respond(w, 503, map[string]string{"message": "rule execution unavailable"})
				return
			}
		}
		if latest == nil || !latest.LiveEligible {
			condition = "unknown"
		}
		trail := map[string]any{"segments": [][]location.Point{}, "sampled": false}
		if input.IncludeTrails {
			events, sampled, historyErr := a.Store.CommittedEvents(r.Context(), input.OrganizationUUID, item.Binding.DeviceUUID, input.From, input.To, input.MaxPoints)
			if historyErr != nil {
				respond(w, 503, map[string]string{"message": "location trail unavailable"})
				return
			}
			segments := make([][]map[string]any, 0)
			segment := make([]map[string]any, 0)
			var previous *time.Time
			for _, event := range events {
				at := eventTime(event)
				fix, resolveErr := location.Resolve(item.Binding, event, at)
				if resolveErr != nil || fix.Point == nil || fix.Status != "valid" {
					if len(segment) > 0 {
						segments = append(segments, segment)
						segment = nil
					}
					previous = nil
					continue
				}
				if previous != nil && fix.ObservedAt != nil && fix.ObservedAt.Sub(*previous) > time.Duration(item.Binding.MaxAgeSeconds*2)*time.Second {
					if len(segment) > 0 {
						segments = append(segments, segment)
					}
					segment = nil
				}
				segment = append(segment, map[string]any{"event_id": fix.EventID, "observed_at": fix.ObservedAt,
					"received_at": fix.ReceivedAt, "historical": fix.Historical, "point": fix.Point})
				previous = fix.ObservedAt
			}
			if len(segment) > 0 {
				segments = append(segments, segment)
			}
			trail = map[string]any{"segments": segments, "sampled": sampled}
		}
		devicesResult = append(devicesResult, map[string]any{"device_uuid": item.Binding.DeviceUUID, "device_name": item.DeviceName,
			"binding_uuid": item.Binding.UUID, "latest": latest, "condition": condition, "active": active,
			"geometry": geometry, "trail": trail})
	}
	respond(w, 200, map[string]any{"devices": devicesResult, "evaluated_at": now})
}

func eventTime(event devices.CommittedTelemetry) time.Time {
	var latest time.Time
	for _, reading := range event.Readings {
		if reading.ReceivedAt.After(latest) {
			latest = reading.ReceivedAt
		}
	}
	if latest.IsZero() {
		return time.Now().UTC()
	}
	return latest
}
