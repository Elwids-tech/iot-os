package definition

// SharedVocabulary mirrors the language-neutral enum definitions in the
// versioned Device Domain common schema. The parity test prevents silent drift.
var SharedVocabulary = map[string][]string{
	"DataType":              {"float64", "int64", "uint64", "boolean", "string", "bytes", "state"},
	"PropertyScope":         {"platform", "desired", "reported"},
	"EventMode":             {"stateless", "stateful"},
	"EventSeverity":         {"info", "notice", "warning", "critical"},
	"EventState":            {"opened", "updated", "closed"},
	"CommandMode":           {"one_way", "two_way"},
	"CommandRisk":           {"low", "medium", "high"},
	"CommandFieldDirection": {"input", "output"},
	"CommandOfflinePolicy":  {"reject", "queue_until_expiry"},
	"CommandStatus":         {"accepted", "running", "succeeded", "failed"},
	"BindingPurpose":        {"telemetry", "reported_properties", "desired_properties", "event", "command_request", "command_response"},
	"BindingDirection":      {"device_to_platform", "platform_to_device"},
	"PathScope":             {"payload", "record"},
	"MissingPolicy":         {"reject_message", "omit_value", "use_default"},
	"TimestampFormat":       {"rfc3339", "unix_seconds", "unix_milliseconds"},
	"DefinitionState":       {"draft", "published", "retired"},
	"DeviceLifecycleState":  {"draft", "registered", "archived"},
}
