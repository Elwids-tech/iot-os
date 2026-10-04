package dag

import (
	"testing"
	"time"
)

func multiCommandFixture() Workflow {
	w := fixture()
	b := w.Bindings[0]
	b.Role, b.Parameter, b.DataType, b.Unit = "power", "55555555-5555-4555-a555-555555555555", "boolean", ""
	w.Bindings = append(w.Bindings, b)
	w.Nodes[2] = Node{"alert", "action.command.v1", map[string]any{"settings": map[string]any{"sensor": float64(0), "power": true}, "cooldown_seconds": float64(60), "ttl_seconds": float64(30)}}
	return w
}
func TestSelectedSettingsProduceIndependentIdempotentCommands(t *testing.T) {
	p := compiled(t, multiCommandFixture())
	at := time.Unix(1800000000, 0).UTC()
	r, err := p.Step(p.Initial(at), reading("one", float64(40), at), at)
	if err != nil || len(r.Intents) != 2 {
		t.Fatalf("expected two commands: %+v %v", r.Intents, err)
	}
	if r.Intents[0].ID == r.Intents[1].ID {
		t.Fatal("settings share an idempotency key")
	}
	for _, intent := range r.Intents {
		if intent.Node != "alert" || intent.Config["binding"] == nil || intent.Config["settings"] != nil {
			t.Fatalf("invalid projected command: %+v", intent)
		}
	}
	again, _ := p.Step(r.State, reading("two", float64(40), at.Add(time.Second)), at.Add(time.Second))
	if len(again.Intents) != 0 {
		t.Fatal("staying true repeats settings")
	}
	cleared, _ := p.Step(again.State, reading("three", float64(0), at.Add(61*time.Second)), at.Add(61*time.Second))
	entered, _ := p.Step(cleared.State, reading("four", float64(40), at.Add(62*time.Second)), at.Add(62*time.Second))
	if len(entered.Intents) != 2 || entered.Intents[0].ID == r.Intents[0].ID {
		t.Fatal("new entry must have new command identities")
	}
}
func TestRejectInvalidSettingGroups(t *testing.T) {
	for _, kind := range []string{"empty", "mixed", "wrong_type", "cross_device", "duplicate_parameter"} {
		t.Run(kind, func(t *testing.T) {
			w := multiCommandFixture()
			switch kind {
			case "empty":
				w.Nodes[2].Config["settings"] = map[string]any{}
			case "mixed":
				w.Nodes[2].Config["binding"] = "sensor"
			case "wrong_type":
				w.Nodes[2].Config["settings"].(map[string]any)["power"] = "true"
			case "cross_device":
				w.Bindings[1].Device = "66666666-6666-4666-a666-666666666666"
			case "duplicate_parameter":
				w.Bindings[1].Parameter = w.Bindings[0].Parameter
			}
			if _, diagnostics := Compile(w); len(diagnostics) == 0 {
				t.Fatal("unsafe settings accepted")
			}
		})
	}
}
