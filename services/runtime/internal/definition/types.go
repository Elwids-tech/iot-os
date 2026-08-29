package definition

const (
	celEnvironment     = "cel-go-v0.26-restricted-v1"
	maximumCELCost     = 10_000
	maximumOutputBytes = 64 * 1024
)

// PathRef identifies a value inside the message, current record, or resolved route context.
type PathRef struct {
	Scope    string `json:"scope"`
	JSONPath string `json:"json_path"`
}

// Transform is the reusable CEL or preset transform primitive retained for the canonical compiler.
type Transform struct {
	Preset string `json:"preset,omitempty"`
	CEL    string `json:"cel,omitempty"`
}
