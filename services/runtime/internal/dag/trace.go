package dag

// Explain evidence without changing evaluator state or trigger semantics.
func traceOutcome(outputs map[string]Value) (string, string) {
	known := false
	for _, value := range outputs {
		known = known || value.Known
	}
	if !known {
		return "waiting", "Waiting for usable input; inspect the output reasons."
	}
	if len(outputs) == 1 {
		for _, value := range outputs {
			if b, ok := value.Value.(bool); ok && value.Known {
				if b {
					return "matched", "Condition is true."
				}
				return "not_matched", "Condition is false."
			}
		}
	}
	return "evaluated", "Produced usable evidence."
}
