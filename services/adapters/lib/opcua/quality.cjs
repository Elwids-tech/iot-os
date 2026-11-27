// An OPC UA status code as the platform's quality: good, uncertain or bad, and for a
// bad value the plain reason a person reads (spec 038, research R4).
const { getStatusCodeFromCode } = require("node-opcua-status-code");

const REASONS = {
  BadNoCommunication: "No communication with the device",
  BadSensorFailure: "Sensor failure",
  BadNotConnected: "Not connected",
  BadOutOfService: "Out of service",
  BadDeviceFailure: "Device failure",
  BadConfigurationError: "Configuration error",
};

// A status code given as node-opcua's StatusCode, its number or its name.
function codeOf(status) {
  if (status === undefined || status === null) return { value: 0, name: "Good" };
  if (typeof status === "number") return { value: status >>> 0, name: getStatusCodeFromCode(status >>> 0).name };
  if (typeof status === "string") {
    const name = status.replace(/_/g, "");
    return { value: name.startsWith("Good") ? 0 : name.startsWith("Uncertain") ? 0x40000000 : 0x80000000, name };
  }
  return { value: status.value >>> 0, name: status.name };
}

function quality(status) {
  const { value, name } = codeOf(status);
  const severity = value >>> 30; // 0 good, 1 uncertain, 2 or 3 bad
  if (severity === 0) return { quality: "good", reason: null, code: name };
  if (severity === 1) return { quality: "uncertain", reason: `Uncertain value (${name})`, code: name };
  return { quality: "bad", reason: REASONS[name] || `Bad value (${name})`, code: name };
}

module.exports = { REASONS, quality };
