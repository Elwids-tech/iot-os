"""Generate deterministic, independently encoded Python fixtures for the Go host tests."""
from pathlib import Path
import json
import sparkplug_b_pb2 as sp
from sparkplug_simulator import metric

ROOT = Path(__file__).resolve().parents[2] / "contracts" / "sparkplug" / "fixtures"
ROOT.mkdir(parents=True, exist_ok=True)
TIME = 1712345000000


def write(name, seq, metrics):
    payload = sp.Payload(timestamp=TIME)
    if seq is not None:
        payload.seq = seq
    for m in metrics:
        m.timestamp = TIME
        payload.metrics.append(m)
    (ROOT / name).write_bytes(payload.SerializeToString(deterministic=True))


write("nbirth.bin", 0, [metric("bdSeq", sp.Int64, 1), metric("Node Control/Rebirth", sp.Boolean, False, 0), metric("Temperature", sp.Int32, -5, 1)])
write("dbirth-meter.bin", 1, [metric("Voltage L1", sp.Double, 230.0, 1), metric("Voltage L2", sp.Double, 231.0, 2), metric("Voltage L3", sp.Double, 229.0, 3)])
alias = metric("", sp.Double, 232.0, 1)
alias.ClearField("name")
alias.ClearField("datatype")
write("ddata-alias.bin", 2, [alias])
write("ndeath.bin", None, [metric("bdSeq", sp.Int64, 1)])
write("dcmd-light.bin", None, [metric("Brightness", sp.Int32, 8)])
(ROOT / "expected.json").write_text(json.dumps({"encoder": "official Tahu schema; Python protobuf 6.33.0", "timestamp_ms": TIME, "node_temperature": -5, "meter_alias_1": {"name": "Voltage L1", "datatype": "Double", "value": 232.0}, "light_command": {"name": "Brightness", "datatype": "Int32", "value": 8}}, indent=2) + "\n")
print("Wrote independent Sparkplug protobuf fixtures.")
