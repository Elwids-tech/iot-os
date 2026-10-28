const protobuf = require("protobufjs");
const schema = `syntax = "proto2"; message Payload {
 optional uint64 timestamp=1; repeated Metric metrics=2; optional uint64 seq=3; optional string uuid=4; optional bytes body=5;
 message PropertyValue { optional uint32 type=1; optional bool is_null=2; optional uint32 int_value=3; optional uint64 long_value=4; optional float float_value=5; optional double double_value=6; optional bool boolean_value=7; optional string string_value=8; }
 message PropertySet { repeated string keys=1; repeated PropertyValue values=2; }
 message Metric { optional string name=1; optional uint64 alias=2; optional uint64 timestamp=3; optional uint32 datatype=4; optional bool is_historical=5; optional bool is_transient=6; optional bool is_null=7; optional PropertySet properties=9; optional uint32 int_value=10; optional uint64 long_value=11; optional float float_value=12; optional double double_value=13; optional bool boolean_value=14; optional string string_value=15; optional bytes bytes_value=16; }
}`;
const Payload = protobuf.parse(schema).root.lookupType("Payload");
const types = { Int64: 4, Double: 10, Boolean: 11, String: 12 };
// Adapter metrics carry their provenance and, for results without a decoder
// observedAt, `timestamp_source: receipt` so the runtime does not treat the receipt
// time as the device's (spec 020, FR-050).
function metric(name, datatype, value, timestamp, provenance, options = {}) {
  const result = { name, datatype: types[datatype], timestamp };
  if (value == null) result.isNull = true;
  else
    result[
      {
        Int64: "longValue",
        Double: "doubleValue",
        Boolean: "booleanValue",
        String: "stringValue",
      }[datatype]
    ] = value;
  if (options.historical) result.isHistorical = true;
  const keys = [];
  const values = [];
  if (provenance) {
    keys.push("installation_uuid", "adapter_revision_uuid");
    values.push(
      { type: 12, stringValue: provenance.installation_uuid },
      { type: 12, stringValue: provenance.adapter_revision_uuid },
    );
  }
  if (options.receipt) {
    keys.push("timestamp_source");
    values.push({ type: 12, stringValue: "receipt" });
  }
  if (keys.length) result.properties = { keys, values };
  return result;
}
function encode(seq, metrics = [], timestamp = Date.now()) {
  return Buffer.from(
    Payload.encode(Payload.create({ timestamp, seq, metrics })).finish(),
  );
}
module.exports = { Payload, metric, encode };
