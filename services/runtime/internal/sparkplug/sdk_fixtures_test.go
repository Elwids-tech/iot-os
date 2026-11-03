package sparkplug

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// The embedded SDK's payloads (firmware/sdk/tools/fixtures.c), replayed in the order the
// SDK sent them through the session with the pinned Tahu protobuf. Any change to how the
// runtime handles Sparkplug must keep these passing (constitution IV, ADR-029).
func TestSDKFixtures(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "..", "contracts", "sparkplug", "fixtures", "sdk")
	raw, err := os.ReadFile(filepath.Join(dir, "expected.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected struct {
		Messages []struct {
			File    string  `json:"file"`
			Topic   string  `json:"topic"`
			Seq     *uint64 `json:"seq"`
			Metrics []struct {
				Name     string      `json:"name"`
				Alias    *uint64     `json:"alias"`
				Datatype string      `json:"datatype"`
				Value    interface{} `json:"value"`
			} `json:"metrics"`
		} `json:"messages"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&expected); err != nil {
		t.Fatal(err)
	}
	if len(expected.Messages) < 260 {
		t.Fatalf("expected.json lists %d messages", len(expected.Messages))
	}

	engine := NewEngine()
	var birthBdSeq string
	wrapped := false
	for _, message := range expected.Messages {
		payload, err := os.ReadFile(filepath.Join(dir, message.File))
		if err != nil {
			t.Fatal(err)
		}
		p, err := engine.Accept("connection", message.Topic, payload, time.Now())
		if err != nil {
			t.Fatalf("%s: %v", message.File, err)
		}
		if message.Seq != nil && *message.Seq == 0 && p.Topic.Kind != "NBIRTH" {
			wrapped = true
		}
		if p.Death {
			if p.Topic.Kind == "NDEATH" && message.Metrics[0].Value.(json.Number).String() != birthBdSeq {
				t.Fatalf("%s: NDEATH bdSeq does not match the NBIRTH", message.File)
			}
			continue
		}
		if len(p.Metrics) != len(message.Metrics) {
			t.Fatalf("%s: %d metrics, expected %d", message.File, len(p.Metrics), len(message.Metrics))
		}
		for i, want := range message.Metrics {
			got := p.Metrics[i]
			if got.Diagnostic != "" {
				t.Fatalf("%s %s: diagnostic %q", message.File, want.Name, got.Diagnostic)
			}
			if got.Name != want.Name || got.Datatype != want.Datatype {
				t.Fatalf("%s: metric %d is %s %s, expected %s %s", message.File, i, got.Name, got.Datatype, want.Name, want.Datatype)
			}
			if (want.Alias == nil) != (got.Alias == nil) || want.Alias != nil && *want.Alias != *got.Alias {
				t.Fatalf("%s %s: alias does not match", message.File, want.Name)
			}
			if !sdkValueMatches(want.Datatype, want.Value, got.Value, got.IsNull) {
				t.Fatalf("%s %s: value %v, expected %v", message.File, want.Name, got.Value, want.Value)
			}
			if p.Topic.Kind == "NBIRTH" && want.Name == "bdSeq" {
				birthBdSeq = want.Value.(json.Number).String()
			}
		}
	}
	if !wrapped {
		t.Fatal("the fixtures never wrapped seq from 255 to 0")
	}
}

func sdkValueMatches(datatype string, want, got any, isNull bool) bool {
	if want == nil {
		return isNull && got == nil
	}
	switch datatype {
	case "Float", "Double":
		w, _ := strconv.ParseFloat(want.(json.Number).String(), 64)
		g, err := strconv.ParseFloat(got.(json.Number).String(), 64)
		return err == nil && w == g
	case "DateTime":
		ms, _ := want.(json.Number).Int64()
		return got == time.UnixMilli(ms).UTC().Format(time.RFC3339Nano)
	case "Boolean", "String", "Bytes":
		return want == got
	default:
		return got.(json.Number).String() == want.(json.Number).String()
	}
}
