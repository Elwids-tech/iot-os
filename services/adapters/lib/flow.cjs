function flowNodes(body, source, upstream, callbackUrl) {
  const tab = "adapter-" + body.adapter_uuid;
  const nodeId = (kind) => tab + "-" + kind;
  const secretFields = ["username", "password", "ca_certificate", "api_key", "token"];
  const sourceCredentials = Object.fromEntries(
    secretFields.filter((field) => source[field] != null).map((field) => [field, source[field]]),
  );
  const upstreamCredentials = {
    username: upstream.username,
    password: upstream.password,
    ca_certificate: upstream.ca_certificate,
  };
  source = { ...source };
  upstream = { ...upstream };
  for (const field of secretFields) delete source[field];
  // An OPC UA source keeps the connection's secrets as one credential (spec 038).
  const opcua = source.type === "opcua";
  if (opcua) {
    sourceCredentials.opcua_secrets = JSON.stringify(source.secrets || {});
    delete source.secrets;
  }
  for (const field of ["username", "password", "ca_certificate"]) delete upstream[field];
  if (body.action === "pause") return [];
  return [
    { id: tab, type: "tab", label: body.name, disabled: false },
    {
      id: nodeId("source"),
      z: tab,
      type: "iot-adapter-source",
      name: { webhook: "Webhook source", poll: "HTTP polling source", opcua: "OPC UA source" }[source.type] || "MQTT source",
      adapter_uuid: body.adapter_uuid,
      revision_uuid: body.revision_uuid,
      source,
      ...(source.type === "poll" ? { cursor: body.cursor || {} } : {}),
      // No decoder: the source shapes its results by the device type itself.
      ...(opcua ? { profile: body.profile } : {}),
      credentials: sourceCredentials,
      wires: [[nodeId(opcua ? "publisher" : "decoder")], [nodeId("reporter")]],
    },
    ...(opcua ? [] : [{
      id: nodeId("decoder"),
      z: tab,
      type: "iot-adapter-decoder",
      name: "Bounded JavaScript decoder",
      adapter_uuid: body.adapter_uuid,
      code: body.code,
      profile: body.profile,
      wires: [[nodeId("publisher")], [nodeId("reporter")]],
    }]),
    {
      id: nodeId("publisher"),
      z: tab,
      type: "iot-adapter-publisher",
      name: "Managed Sparkplug B publisher",
      adapter_uuid: body.adapter_uuid,
      revision_uuid: body.revision_uuid,
      upstream,
      credentials: upstreamCredentials,
      bindings: body.bindings || [],
      retention_days: body.retention_days || null,
      wires: [[nodeId("reporter")]],
    },
    {
      id: nodeId("reporter"),
      z: tab,
      type: "iot-adapter-reporter",
      name: "Platform diagnostics",
      callback_url: callbackUrl,
      adapter_uuid: body.adapter_uuid,
      tenant_uuid: body.tenant.uuid,
      credentials: { runtime_token: body.tenant.runtime_token },
      wires: [],
    },
  ];
}
function replaceFlow(current, body, nodes) {
  const tab = "adapter-" + body.adapter_uuid;
  return [...current.filter((n) => n.id !== tab && n.z !== tab), ...nodes];
}
module.exports = { flowNodes, replaceFlow };
