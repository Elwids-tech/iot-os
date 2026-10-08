function flowNodes(body, source, upstream, callbackUrl) {
  const tab = "adapter-" + body.adapter_uuid;
  const nodeId = (kind) => tab + "-" + kind;
  const sourceCredentials = {
    username: source.username,
    password: source.password,
    ca_certificate: source.ca_certificate,
  };
  const upstreamCredentials = {
    username: upstream.username,
    password: upstream.password,
    ca_certificate: upstream.ca_certificate,
  };
  source = { ...source };
  upstream = { ...upstream };
  for (const field of ["username", "password", "ca_certificate"]) {
    delete source[field];
    delete upstream[field];
  }
  if (body.action === "pause") return [];
  return [
    { id: tab, type: "tab", label: body.name, disabled: false },
    {
      id: nodeId("source"),
      z: tab,
      type: "iot-adapter-source",
      name: "MQTT source",
      adapter_uuid: body.adapter_uuid,
      source,
      credentials: sourceCredentials,
      wires: [[nodeId("decoder")], [nodeId("reporter")]],
    },
    {
      id: nodeId("decoder"),
      z: tab,
      type: "iot-adapter-decoder",
      name: "Bounded JavaScript decoder",
      adapter_uuid: body.adapter_uuid,
      code: body.code,
      profile: body.profile,
      wires: [[nodeId("publisher")], [nodeId("reporter")]],
    },
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
