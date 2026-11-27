// Status codes as the platform's quality (spec 038, research R4).
const assert = require("node:assert/strict");
const test = require("node:test");
const { StatusCodes } = require("node-opcua-status-code");
const { quality } = require("../lib/opcua/quality.cjs");
const { convert } = require("../lib/opcua/collect.cjs");

test("good, uncertain and bad", () => {
  assert.deepEqual(quality(StatusCodes.Good), { quality: "good", reason: null, code: "Good" });
  assert.equal(quality(undefined).quality, "good");
  assert.deepEqual(quality(StatusCodes.UncertainLastUsableValue), {
    quality: "uncertain", reason: "Uncertain value (UncertainLastUsableValue)", code: "UncertainLastUsableValue",
  });
  assert.equal(quality(StatusCodes.BadNoCommunication).quality, "bad");
});

test("bad values carry the reason a person reads", () => {
  const reasons = {
    BadNoCommunication: "No communication with the device",
    BadSensorFailure: "Sensor failure",
    BadNotConnected: "Not connected",
    BadOutOfService: "Out of service",
    BadDeviceFailure: "Device failure",
    BadConfigurationError: "Configuration error",
  };
  for (const [name, reason] of Object.entries(reasons)) {
    assert.equal(quality(StatusCodes[name]).reason, reason, name);
    assert.equal(quality(StatusCodes[name].value).reason, reason, `${name} as a number`);
  }
  assert.equal(quality(StatusCodes.BadNodeIdUnknown).reason, "Bad value (BadNodeIdUnknown)");
  assert.equal(quality("Bad_SensorFailure").reason, "Sensor failure");
});

test("values become the reading's data type, scaled", () => {
  assert.equal(convert({ data_type: "number", scale: 0.1, offset: -40 }, 650), 25);
  assert.equal(convert({ data_type: "number" }, 21.5), 21.5);
  assert.equal(convert({ data_type: "number" }, Number.NaN), null);
  assert.equal(convert({ data_type: "boolean" }, 1), true);
  assert.equal(convert({ data_type: "state" }, 2), 2);
  assert.equal(convert({ data_type: "text" }, { text: "Running" }), "Running");
  assert.equal(convert({ data_type: "number" }, null), null);
});
