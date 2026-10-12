// Package contracts validates messages against the JSON Schema contracts in the
// repository's contracts/ directory (contracts/README.md, ADR-015).
//
// A Registry loads both catalogues (contracts/internal/catalogue.json and
// contracts/ingestion/v1/catalogue.json) and every schema the contract checker
// (tooling/verify-devices-contracts.py) checks: each *.schema.json under a v<N>/
// directory or contracts/internal/, never contracts/openapi/. Schemas are compiled
// once, in two modes, and $ref resolves across files by $id (a schema without $id
// gets https://iot-os.local/contracts/<path>).
//
//   - Strict validates the schema as written. Producers are tested this way, and
//     readers of the canonical envelope family read this way.
//   - Tolerant drops the unknown-field rules (additionalProperties: false and
//     unevaluatedProperties: false) before compiling, the way the Python checker's
//     tolerant validator ignores them. Because the rules are removed rather than
//     their errors filtered afterwards, oneOf, anyOf, not and if are evaluated again
//     without them: a oneOf branch that failed only on an unknown field matches.
//
// Validation results are {keyword, instance_location} pairs, never values. Nothing
// in the runtime calls this package yet; the live checks arrive with spec 002 PR 9.
package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
)

const (
	// PathEnv names the contracts root; images set it to DefaultPath.
	PathEnv = "IOT_CONTRACTS_PATH"
	// DefaultPath is where the runtime image copies contracts/.
	DefaultPath = "/contracts"
	// IDBase prefixes a schema's path under contracts/ to form its $id.
	IDBase = "https://iot-os.local/contracts/"
	// Dialect is the only JSON Schema dialect contracts use.
	Dialect = "https://json-schema.org/draft/2020-12/schema"
)

// Mode selects how unknown fields are judged.
type Mode int

const (
	// Strict validates the closed schema as written.
	Strict Mode = iota
	// Tolerant ignores additionalProperties: false and unevaluatedProperties: false.
	Tolerant
)

func (m Mode) String() string {
	if m == Tolerant {
		return "tolerant"
	}
	return "strict"
}

// ParseMode reads a catalogue `reading` value.
func ParseMode(reading string) (Mode, error) {
	switch reading {
	case "strict":
		return Strict, nil
	case "tolerant":
		return Tolerant, nil
	}
	return Strict, fmt.Errorf("contracts: unknown reading %q", reading)
}

// Violation is one failing keyword. It never carries instance values: Missing
// lists required property names, which come from the schema.
type Violation struct {
	Keyword          string   `json:"keyword"`
	InstanceLocation string   `json:"instance_location"`
	Missing          []string `json:"missing,omitempty"`
}

func (v Violation) String() string {
	location := v.InstanceLocation
	if location == "" {
		location = "(root)"
	}
	text := v.Keyword + " at " + location
	if len(v.Missing) > 0 {
		text += " (missing " + strings.Join(v.Missing, ", ") + ")"
	}
	return text
}

// Entry is one catalogue entry (contracts/internal/catalogue.schema.json).
type Entry struct {
	ID            string   `json:"id"`
	Group         string   `json:"group"`
	Schema        string   `json:"schema"`
	Producer      string   `json:"producer"`
	Consumer      string   `json:"consumer"`
	Dedup         string   `json:"dedup"`
	Fences        []string `json:"fences"`
	Reading       string   `json:"reading"`
	LiveCheck     string   `json:"live_check"`
	ProducerTests []string `json:"producer_tests"`
	ConsumerTests []string `json:"consumer_tests"`
}

var (
	// ErrDisabled is returned by a registry whose contracts root is missing or
	// failed to load.
	ErrDisabled = errors.New("contracts: registry disabled")
	// ErrUnknownContract is returned for a reference that names no catalogue
	// entry, schema path or $id.
	ErrUnknownContract = errors.New("contracts: unknown contract")
)

type schema struct {
	path     string // under contracts/
	id       string
	strict   *jsonschema.Schema
	tolerant *jsonschema.Schema
}

// Registry holds the compiled contracts. It is immutable after Load and safe for
// concurrent use. A nil *Registry behaves as a disabled one.
type Registry struct {
	root    string
	enabled bool
	entries map[string]Entry
	schemas map[string]*schema // by $id
	paths   map[string]string  // path under contracts/ → $id
}

// PathFromEnv returns IOT_CONTRACTS_PATH, or DefaultPath when it is unset.
func PathFromEnv() string {
	if value := strings.TrimSpace(os.Getenv(PathEnv)); value != "" {
		return value
	}
	return DefaultPath
}

// Load reads and compiles the contracts under root. It never returns a nil
// registry: a missing root yields a disabled registry and no error, so a process
// without contract files starts normally, and a root that fails to load yields a
// disabled registry together with the reason.
func Load(root string) (*Registry, error) {
	disabled := &Registry{root: root}
	info, err := os.Stat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return disabled, nil
	}
	if err != nil {
		return disabled, fmt.Errorf("contracts: %w", err)
	}
	if !info.IsDir() {
		return disabled, fmt.Errorf("contracts: %s is not a directory", root)
	}
	registry, err := load(root)
	if err != nil {
		return disabled, err
	}
	return registry, nil
}

var versionDirectory = regexp.MustCompile(`^v[0-9]+$`)

// checked mirrors the contract checker's discovery: contracts/openapi/ has its own
// gate (`php artisan contract:check`), and contract schemas live under a v<N>/
// directory or contracts/internal/.
func checked(directory string) bool {
	parts := strings.Split(directory, "/")
	if parts[0] == "openapi" {
		return false
	}
	if parts[0] == "internal" {
		return true
	}
	for _, part := range parts {
		if versionDirectory.MatchString(part) {
			return true
		}
	}
	return false
}

func load(root string) (*Registry, error) {
	var schemaPaths, cataloguePaths []string
	err := filepath.WalkDir(root, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if entry.IsDir() {
			if relative == "openapi" {
				return filepath.SkipDir
			}
			return nil
		}
		directory := path.Dir(relative)
		switch {
		case strings.HasSuffix(relative, ".schema.json") && checked(directory):
			schemaPaths = append(schemaPaths, relative)
		case path.Base(relative) == "catalogue.json":
			cataloguePaths = append(cataloguePaths, relative)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("contracts: %w", err)
	}
	sort.Strings(schemaPaths)
	sort.Strings(cataloguePaths)

	registry := &Registry{
		root:    root,
		enabled: true,
		entries: map[string]Entry{},
		schemas: map[string]*schema{},
		paths:   map[string]string{},
	}
	strictCompiler, tolerantCompiler := newCompiler(), newCompiler()
	for _, relative := range schemaPaths {
		document, err := readJSON(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return nil, fmt.Errorf("contracts: %s: %w", relative, err)
		}
		object, ok := document.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("contracts: %s: a schema is a JSON object", relative)
		}
		if dialect, ok := object["$schema"]; ok && dialect != Dialect {
			return nil, fmt.Errorf("contracts: %s: $schema must be %s", relative, Dialect)
		}
		id := IDBase + relative
		if declared, ok := object["$id"].(string); ok {
			id = declared
		}
		if other, ok := registry.schemas[id]; ok {
			return nil, fmt.Errorf("contracts: %s: $id %s is also used by %s", relative, id, other.path)
		}
		if err := strictCompiler.AddResource(id, object); err != nil {
			return nil, fmt.Errorf("contracts: %s: %w", relative, err)
		}
		if err := tolerantCompiler.AddResource(id, withoutUnknownFieldRules(object, false)); err != nil {
			return nil, fmt.Errorf("contracts: %s: %w", relative, err)
		}
		registry.schemas[id] = &schema{path: relative, id: id}
		registry.paths[relative] = id
	}
	for _, compiled := range registry.schemas {
		if compiled.strict, err = strictCompiler.Compile(compiled.id); err != nil {
			return nil, fmt.Errorf("contracts: %s: %w", compiled.path, err)
		}
		if compiled.tolerant, err = tolerantCompiler.Compile(compiled.id); err != nil {
			return nil, fmt.Errorf("contracts: %s (tolerant): %w", compiled.path, err)
		}
	}
	for _, relative := range cataloguePaths {
		raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return nil, fmt.Errorf("contracts: %w", err)
		}
		var entries []Entry
		if err := json.Unmarshal(raw, &entries); err != nil {
			return nil, fmt.Errorf("contracts: %s: %w", relative, err)
		}
		for _, entry := range entries {
			if _, ok := registry.entries[entry.ID]; ok {
				return nil, fmt.Errorf("contracts: %s: %s is listed more than once", relative, entry.ID)
			}
			if _, ok := registry.paths[entry.Schema]; !ok {
				return nil, fmt.Errorf("contracts: %s: %s names schema %s, which does not exist", relative, entry.ID, entry.Schema)
			}
			if _, err := ParseMode(entry.Reading); err != nil {
				return nil, fmt.Errorf("contracts: %s: %s: %w", relative, entry.ID, err)
			}
			registry.entries[entry.ID] = entry
		}
	}
	return registry, nil
}

func readJSON(file string) (any, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(raw))
}

// noLoader keeps compilation inside the registry: every schema is added as a
// resource first, so a $ref to anything else is an error, never a file or network
// read.
type noLoader struct{}

func (noLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("%s is not a schema under the contracts root", url)
}

func newCompiler() *jsonschema.Compiler {
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	compiler.AssertFormat()
	compiler.UseLoader(noLoader{})
	return compiler
}

// Under these keywords the keys are names, not keywords, and under the data keywords
// the values are instances, not schemas (the contract checker walks schemas the same
// way).
var (
	namedChildren = map[string]bool{"properties": true, "patternProperties": true, "$defs": true, "dependentSchemas": true}
	dataKeywords  = map[string]bool{"const": true, "enum": true, "examples": true, "default": true}
	// Tolerated lists the unknown-field keywords tolerant readers ignore (FR-030).
	tolerated = map[string]bool{"additionalProperties": true, "unevaluatedProperties": true}
)

// IsUnknownFieldKeyword reports whether tolerant readers ignore keyword.
func IsUnknownFieldKeyword(keyword string) bool { return tolerated[keyword] }

// withoutUnknownFieldRules copies a schema document without the boolean false form
// of additionalProperties and unevaluatedProperties. names is true for the object
// under properties, patternProperties, $defs or dependentSchemas, whose keys are
// names and whose values are schemas.
func withoutUnknownFieldRules(node any, names bool) any {
	switch value := node.(type) {
	case map[string]any:
		copied := make(map[string]any, len(value))
		for key, child := range value {
			switch {
			case names:
				copied[key] = withoutUnknownFieldRules(child, false)
			case tolerated[key] && child == false:
				continue
			case dataKeywords[key]:
				copied[key] = child
			default:
				copied[key] = withoutUnknownFieldRules(child, namedChildren[key])
			}
		}
		return copied
	case []any:
		copied := make([]any, len(value))
		for index, child := range value {
			copied[index] = withoutUnknownFieldRules(child, false)
		}
		return copied
	}
	return node
}

// Enabled reports whether contracts were loaded.
func (r *Registry) Enabled() bool { return r != nil && r.enabled }

// Root returns the contracts root the registry was loaded from.
func (r *Registry) Root() string {
	if r == nil {
		return ""
	}
	return r.root
}

// Entries returns the catalogue entries of both catalogues, ordered by id.
func (r *Registry) Entries() []Entry {
	if !r.Enabled() {
		return nil
	}
	entries := make([]Entry, 0, len(r.entries))
	for _, entry := range r.entries {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries
}

// Entry returns the catalogue entry for a contract id.
func (r *Registry) Entry(id string) (Entry, bool) {
	if !r.Enabled() {
		return Entry{}, false
	}
	entry, ok := r.entries[id]
	return entry, ok
}

// Schemas returns the path under contracts/ of every compiled schema, sorted.
func (r *Registry) Schemas() []string {
	if !r.Enabled() {
		return nil
	}
	paths := make([]string, 0, len(r.paths))
	for relative := range r.paths {
		paths = append(paths, relative)
	}
	sort.Strings(paths)
	return paths
}

// lookup resolves a reference: a catalogue id (device.applied.v1), a schema path
// under contracts/ (devices/v1/command.schema.json) or a schema $id.
func (r *Registry) lookup(reference string) (*schema, error) {
	if !r.Enabled() {
		return nil, ErrDisabled
	}
	if entry, ok := r.entries[reference]; ok {
		reference = entry.Schema
	}
	if id, ok := r.paths[reference]; ok {
		reference = id
	}
	if compiled, ok := r.schemas[reference]; ok {
		return compiled, nil
	}
	return nil, fmt.Errorf("%w %q", ErrUnknownContract, reference)
}

// SchemaPath returns the schema's path under contracts/ for a reference.
func (r *Registry) SchemaPath(reference string) (string, error) {
	compiled, err := r.lookup(reference)
	if err != nil {
		return "", err
	}
	return compiled.path, nil
}

// Reading returns how a contract is read: its catalogue `reading`, otherwise
// strict under ingestion/ and tolerant elsewhere, as the contract checker judges
// schemas no catalogue lists.
func (r *Registry) Reading(reference string) (Mode, error) {
	compiled, err := r.lookup(reference)
	if err != nil {
		return Strict, err
	}
	for _, entry := range r.entries {
		if entry.Schema == compiled.path {
			return ParseMode(entry.Reading)
		}
	}
	if strings.HasPrefix(compiled.path, "ingestion/") {
		return Strict, nil
	}
	return Tolerant, nil
}

// Validate checks a Go value against a contract. The value is encoded with
// encoding/json first, so structs are judged by their JSON form; a json.RawMessage
// is used as is.
func (r *Registry) Validate(reference string, value any, mode Mode) ([]Violation, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("contracts: encode value: %w", err)
	}
	return r.ValidateJSON(reference, raw, mode)
}

// ValidateJSON checks encoded JSON against a contract. An empty result means the
// value conforms.
func (r *Registry) ValidateJSON(reference string, raw []byte, mode Mode) ([]Violation, error) {
	compiled, err := r.lookup(reference)
	if err != nil {
		return nil, err
	}
	instance, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("contracts: decode value: %w", err)
	}
	target := compiled.strict
	if mode == Tolerant {
		target = compiled.tolerant
	}
	err = target.Validate(instance)
	if err == nil {
		return nil, nil
	}
	var failure *jsonschema.ValidationError
	if !errors.As(err, &failure) {
		return nil, fmt.Errorf("contracts: validate: %w", err)
	}
	collected := collect(failure, nil)
	sort.SliceStable(collected, func(i, j int) bool {
		if collected[i].InstanceLocation != collected[j].InstanceLocation {
			return collected[i].InstanceLocation < collected[j].InstanceLocation
		}
		return collected[i].Keyword < collected[j].Keyword
	})
	violations := collected[:0]
	seen := map[string]bool{}
	for _, violation := range collected {
		if key := violation.String(); !seen[key] {
			seen[key] = true
			violations = append(violations, violation)
		}
	}
	return violations, nil
}

// collect flattens the library's error tree into violations. Leaves are always
// reported. Of the inner nodes only oneOf, anyOf, contains and minContains are
// reported, as the Python checker reports them; the others ($ref, allOf, groups)
// only wrap their causes there and are passed through.
func collect(failure *jsonschema.ValidationError, violations []Violation) []Violation {
	keyword := keywordOf(failure.ErrorKind)
	switch failure.ErrorKind.(type) {
	case *kind.OneOf, *kind.AnyOf, *kind.Contains, *kind.MinContains:
		violations = append(violations, violation(failure, keyword))
	default:
		if len(failure.Causes) == 0 && keyword != "" {
			violations = append(violations, violation(failure, keyword))
		}
	}
	for _, cause := range failure.Causes {
		violations = collect(cause, violations)
	}
	return violations
}

func violation(failure *jsonschema.ValidationError, keyword string) Violation {
	location := failure.InstanceLocation
	if _, ok := failure.ErrorKind.(*kind.FalseSchema); ok && len(location) > 0 {
		// The library reports `unevaluatedProperties: false` (and unevaluatedItems) as
		// a false schema at each property; the contract checker and the cases files
		// name the keyword at the object, once.
		for _, unevaluated := range []string{"unevaluatedProperties", "unevaluatedItems"} {
			if strings.HasSuffix(failure.SchemaURL, "/"+unevaluated) {
				keyword, location = unevaluated, location[:len(location)-1]
			}
		}
	}
	result := Violation{Keyword: keyword, InstanceLocation: pointer(location)}
	switch detail := failure.ErrorKind.(type) {
	case *kind.Required:
		result.Missing = append([]string(nil), detail.Missing...)
	case *kind.DependentRequired:
		result.Missing = append([]string(nil), detail.Missing...)
	}
	return result
}

func keywordOf(errorKind jsonschema.ErrorKind) string {
	switch errorKind.(type) {
	case *kind.Schema, *kind.Group:
		return ""
	case *kind.Not:
		return "not"
	case *kind.FalseSchema:
		return "false"
	case *kind.RefCycle:
		return "$ref"
	case *kind.Dependency:
		return "dependencies"
	}
	if path := errorKind.KeywordPath(); len(path) > 0 {
		return path[0]
	}
	return ""
}

func pointer(tokens []string) string {
	var builder strings.Builder
	for _, token := range tokens {
		builder.WriteByte('/')
		builder.WriteString(strings.ReplaceAll(strings.ReplaceAll(token, "~", "~0"), "/", "~1"))
	}
	return builder.String()
}
