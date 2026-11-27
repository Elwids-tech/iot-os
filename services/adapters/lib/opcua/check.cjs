// The review check for a point map (spec 038 US3 scenario 7, research R11): every point
// found and read once, with each problem a person must fix before the map is deployed.
// Bad quality is shown, not a problem: a controller that is offline today is still
// mapped correctly.
const { read } = require("./browse.cjs");
const { fromNodeId } = require("./nodes.cjs");
const { pointCount, problems: ruleProblems } = require("./point-map.cjs");
const { resolveMap } = require("./resolve.cjs");

const READ_PAGE = 200;
const RULES = {
  duplicate_reading_key: "Two readings have the same key",
  duplicate_source_id: "Two equipment items have the same path",
  unknown_reading: "An equipment item names a reading the map does not have",
  overridden_and_missing: "A reading is both overridden and marked missing",
  mixed_addressing: "Readings mix tag patterns and paths of names",
};
const COMPATIBLE = {
  number: ["number"],
  boolean: ["boolean"],
  state: ["state", "number", "boolean"],
  text: ["text", "state"],
};

/** Rows a day at least: every point reports once per rhythm even when nothing changes. */
function rowsPerDay(map) {
  return pointCount(map) * Math.ceil(86_400 / map.rhythm_seconds);
}

async function check(connection, map) {
  const problems = ruleProblems(map).map(({ rule, at }) => ({ source_id: null, key: null, at, problem: RULES[rule] ?? rule }));
  for (const reading of map.readings)
    if (reading.data_type === "number" && !reading.unit)
      problems.push({ source_id: null, key: reading.key, problem: "Give this number a unit, for example %, °C or count" });

  const resolved = problems.some((p) => p.at) ? [] : await resolveMap(connection, map);
  const readings = new Map(map.readings.map((r) => [r.key, r]));
  const points = [];
  const seen = new Map();
  const equipment = resolved.map((entry) => {
    const meta = map.equipment.find((e) => e.source_id === entry.source_id);
    for (const p of entry.problems) problems.push({ source_id: entry.source_id, key: p.key, problem: p.problem });
    const rows = Object.entries(entry.points).map(([key, node]) => {
      const row = { key, value: null, unit: readings.get(key)?.unit ?? null, data_type: null, quality: null, status: null, reason: null, source_time: null, problem: node ? null : "Not found on this equipment" };
      if (node) {
        const id = node.toString();
        if (seen.has(id)) {
          row.problem = `The same point as ${seen.get(id)}`;
          problems.push({ source_id: entry.source_id, key, problem: row.problem });
        } else seen.set(id, `${entry.source_id} ${key}`);
        points.push({ row, address: fromNodeId(node, connection.namespaces), expects: readings.get(key)?.data_type, source_id: entry.source_id });
      }
      return row;
    });
    return { source_id: entry.source_id, display_name: meta?.display_name ?? entry.source_id, readings: rows };
  });

  for (let start = 0; start < points.length; start += READ_PAGE) {
    const page = points.slice(start, start + READ_PAGE);
    const values = await read(connection, page.map((p) => p.address));
    values.forEach((value, k) => {
      const { row, expects, source_id } = page[k];
      Object.assign(row, { value: value.value ?? null, data_type: value.data_type ?? null, quality: value.quality ?? null, status: value.status ?? null, reason: value.reason ?? null, source_time: value.source_time ?? null });
      if (!row.problem && !value.storable) row.problem = value.not_storable || "The platform cannot store this point";
      else if (!row.problem && value.data_type && expects && !(COMPATIBLE[expects] || []).includes(value.data_type))
        row.problem = `The point holds ${value.data_type === "text" ? "text" : `a ${value.data_type}`}, not a ${expects}`;
      if (row.problem && !problems.some((p) => p.source_id === source_id && p.key === row.key)) problems.push({ source_id, key: row.key, problem: row.problem });
    });
  }

  return {
    valid: problems.length === 0,
    equipment,
    problems,
    totals: { devices: map.equipment.length, readings: map.readings.length, points: pointCount(map), rows_per_day: rowsPerDay(map) },
  };
}

module.exports = { check, rowsPerDay };
