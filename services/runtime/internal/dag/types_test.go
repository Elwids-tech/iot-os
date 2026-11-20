package dag

import (
	"encoding/json"
	"strings"
	"testing"
)

// The API stores workflows through PHP, which writes a node without settings as
// "config": [] (an automation with a bare branch node was stuck pending on this).
func TestANodeWithoutSettingsReadsFromPHPsEmptyArray(t *testing.T) {
	object := `{"schema_version":"automation-workflow.v2","uuid":"` + org + `","version_uuid":"` + configuration + `","organization_uuid":"` + org + `",
		"bindings":[{"role":"sensor","device_uuid":"` + device + `","configuration_uuid":"` + configuration + `","generation":1,"parameter_uuid":"` + parameter + `","data_type":"boolean","unit":"","fresh_seconds":600}],
		"nodes":[{"id":"input","type":"source.parameter.v1","config":{"binding":"sensor"}},{"id":"off","type":"branch.v1","config":{}},{"id":"off_30m","type":"sustained.v1","config":{"seconds":1800}},{"id":"alert","type":"action.alert.v1","config":{"title":"Off for 30 minutes"}}],
		"edges":[{"source":"input","source_port":"out","target":"off","target_port":"in"},{"source":"off","source_port":"false","target":"off_30m","target_port":"in"},{"source":"off_30m","source_port":"out","target":"alert","target_port":"in"}]}`
	var fromObject, fromArray Workflow
	if err := json.Unmarshal([]byte(object), &fromObject); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(strings.Replace(object, `"config":{}`, `"config":[]`, 1)), &fromArray); err != nil {
		t.Fatalf("PHP's empty array: %v", err)
	}
	a, b := compiled(t, fromObject), compiled(t, fromArray)
	if a.Hash != b.Hash {
		t.Fatalf("hash changed: %s != %s", a.Hash, b.Hash)
	}
	if err := json.Unmarshal([]byte(`{"id":"x","type":"branch.v1","config":[1]}`), &Node{}); err == nil {
		t.Fatal("a non-empty array must still be refused")
	}
}
