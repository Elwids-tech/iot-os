package storage

// Scope is the set of broker connections a runtime owns (ADR-046). One runtime owns
// every connection, which is the zero value and the only scope in use; the sweeps
// that act on what a runtime owns take it, so that a runtime sharded by connection
// later cannot settle another's commands or delete another's rows.
type Scope struct {
	// Connections limits the scope to these connection UUIDs. Nil is every connection.
	Connections []string
}

// connections is the query argument: NULL for every connection.
func (s Scope) connections() any {
	if s.Connections == nil {
		return nil
	}
	return s.Connections
}

// scopedDevices selects the devices whose applied definition reports through the
// connections in $1.
const scopedDevices = `SELECT device_uuid FROM device_runtime.devices WHERE definition->'source'->>'connection_uuid' = ANY($1::text[])`

// scopedSubjects is true for a connectivity subject in the scope $1: a gateway
// (gateway:<connection>/<edge>, with @<organization> for a hosted one) by its
// connection, a device (device:<uuid>) by its applied definition. A device without an
// applied definition belongs to no connection, so only a runtime that owns every
// connection loads or prunes its row.
const scopedSubjects = `($1::text[] IS NULL
 OR kind='gateway' AND split_part(substr(subject_key, 9), '/', 1) = ANY($1::text[])
 OR kind='device' AND substr(subject_key, 8) IN (SELECT device_uuid::text FROM device_runtime.devices WHERE definition->'source'->>'connection_uuid' = ANY($1::text[])))`
