// Package committedconsumer provides a deliberately small, file-backed example
// projection. Production consumers should use their own transactional store.
package committedconsumer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// Stream identifies the committed stream a checkpoint belongs to. ID is the
// runtime's stream ID metadata (devices.StreamIDMetadata). Created is the broker's
// creation time, which NATS can rewrite, so it only proves the stream for state
// saved before streams carried an ID.
type Stream struct {
	ID      string
	Created string
}

type State struct {
	Consumer           string                                `json:"consumer"`
	StreamID           string                                `json:"stream_id,omitempty"`
	StreamCreated      string                                `json:"stream_created"`
	LastStreamSequence uint64                                `json:"last_stream_sequence"`
	Events             map[string]devices.CommittedTelemetry `json:"events"`
}

type Checkpoint struct {
	Path  string
	State State
	lock  *os.File
}

func Open(path, consumer string, stream Stream) (*Checkpoint, error) {
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("checkpoint is already in use: %w", err)
	}
	c := &Checkpoint{Path: path, lock: lock, State: State{Consumer: consumer, StreamID: stream.ID, StreamCreated: stream.Created, Events: map[string]devices.CommittedTelemetry{}}}
	raw, err := os.ReadFile(path)
	if err == nil {
		var saved State
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		err = decoder.Decode(&saved)
		if err == nil && (saved.Consumer != consumer || !saved.belongsTo(stream) || saved.Events == nil) {
			err = fmt.Errorf("checkpoint belongs to a different consumer/stream or is invalid")
		}
		if err == nil {
			c.State = saved
			// State saved before streams carried an ID adopts it while the creation
			// time still proves the stream is the same one.
			if saved.StreamID == "" && stream.ID != "" {
				c.State.StreamID = stream.ID
				err = c.save()
			}
		}
	}
	if err != nil && !os.IsNotExist(err) {
		c.Close()
		return nil, err
	}
	return c, nil
}

func (s State) belongsTo(stream Stream) bool {
	if s.StreamID != "" {
		return s.StreamID == stream.ID
	}
	return s.StreamCreated == stream.Created
}

func (c *Checkpoint) Close() error { return c.lock.Close() }

// Apply must finish before acknowledging the broker. Saving both the projection
// and checkpoint in one fsync/rename prevents an acknowledged but missing event.
func (c *Checkpoint) Apply(event devices.CommittedTelemetry, streamSequence uint64) (bool, error) {
	if event.SchemaVersion != devices.CommittedTelemetryVersion || event.EventID == "" || event.EventID != event.TelemetryID || event.OrganizationUUID == "" || event.DeviceUUID == "" || len(event.Readings) == 0 {
		return false, fmt.Errorf("unsupported or incomplete committed telemetry event")
	}
	if seq, err := strconv.ParseUint(event.Sequence, 10, 64); err != nil || seq == 0 {
		return false, fmt.Errorf("invalid event sequence")
	}
	oldSequence := c.State.LastStreamSequence
	previous, exists := c.State.Events[event.EventID]
	if exists {
		old, _ := json.Marshal(previous)
		incoming, _ := json.Marshal(event)
		if string(old) != string(incoming) {
			return false, fmt.Errorf("event identity reused with different contents")
		}
	}
	c.State.Events[event.EventID] = event
	c.State.LastStreamSequence = max(oldSequence, streamSequence)
	if err := c.save(); err != nil {
		c.State.LastStreamSequence = oldSequence
		if !exists {
			delete(c.State.Events, event.EventID)
		}
		return false, err
	}
	return !exists, nil
}

func (c *Checkpoint) save() error {
	raw, err := json.Marshal(c.State)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(c.Path), ".committed-checkpoint-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), c.Path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(c.Path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
