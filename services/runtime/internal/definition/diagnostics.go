package definition

import (
	"sort"
	"strings"
)

type diagnosticCollector struct {
	items []Diagnostic
}

func (collector *diagnosticCollector) error(code, path, message string) {
	collector.items = append(collector.items, Diagnostic{
		Severity: "error",
		Code:     code,
		Path:     path,
		Message:  message,
	})
}

func (collector *diagnosticCollector) warning(code, path, message string) {
	collector.items = append(collector.items, Diagnostic{
		Severity: "warning",
		Code:     code,
		Path:     path,
		Message:  message,
	})
}

func (collector *diagnosticCollector) info(code, path, message string) {
	collector.items = append(collector.items, Diagnostic{
		Severity: "info",
		Code:     code,
		Path:     path,
		Message:  message,
	})
}

func (collector *diagnosticCollector) hasErrors() bool {
	for _, diagnostic := range collector.items {
		if diagnostic.Severity == "error" {
			return true
		}
	}

	return false
}

func (collector *diagnosticCollector) sorted() []Diagnostic {
	result := append([]Diagnostic(nil), collector.items...)
	sort.SliceStable(result, func(left, right int) bool {
		if result[left].Path != result[right].Path {
			return result[left].Path < result[right].Path
		}
		if result[left].Code != result[right].Code {
			return result[left].Code < result[right].Code
		}

		return result[left].Message < result[right].Message
	})
	if result == nil {
		return []Diagnostic{}
	}

	return result
}

func celDiagnosticCode(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "undeclared reference") ||
		strings.Contains(message, "no matching overload") ||
		strings.Contains(message, "reserved identifier") {
		return "CEL_UNSUPPORTED_SYMBOL"
	}

	return "CEL_INVALID_EXPRESSION"
}
