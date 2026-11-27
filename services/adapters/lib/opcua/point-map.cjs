// The point map rules no schema states (contracts/pointmaps/v1/point-map.v1.rules.json,
// the same cases as tooling/verify-devices-contracts.py): unique reading keys and source
// ids, overrides and missing that name readings of the map, and one way of addressing.
function problems(map) {
  const found = [];
  const keys = new Set();
  map.readings.forEach((reading, index) => {
    if (keys.has(reading.key)) found.push({ rule: "duplicate_reading_key", at: `/readings/${index}/key` });
    keys.add(reading.key);
  });
  const patterned = map.readings.map((r) => r.address.relative_path.some((segment) => "pattern" in segment));
  if (patterned.some(Boolean) && !patterned.every(Boolean)) {
    const index = patterned.findIndex((p) => p !== patterned[0]);
    found.push({ rule: "mixed_addressing", at: `/readings/${index}/address/relative_path` });
  }
  const sources = new Set();
  map.equipment.forEach((equipment, index) => {
    if (sources.has(equipment.source_id)) found.push({ rule: "duplicate_source_id", at: `/equipment/${index}/source_id` });
    sources.add(equipment.source_id);
    const missing = equipment.missing || [];
    for (const key of Object.keys(equipment.overrides || {})) {
      if (!keys.has(key)) found.push({ rule: "unknown_reading", at: `/equipment/${index}/overrides/${key}` });
      else if (missing.includes(key)) found.push({ rule: "overridden_and_missing", at: `/equipment/${index}/overrides/${key}` });
    }
    missing.forEach((key, position) => {
      if (!keys.has(key)) found.push({ rule: "unknown_reading", at: `/equipment/${index}/missing/${position}` });
    });
  });
  return found;
}

// Readings × equipment, less what is missing: the point count checked against the limit.
function pointCount(map) {
  return map.equipment.reduce((total, e) => total + map.readings.length - (e.missing || []).length, 0);
}

module.exports = { pointCount, problems };
