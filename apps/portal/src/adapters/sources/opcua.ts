import {
  ApiError,
  type AdapterConnection,
  type AdapterConnectionInput,
  type OpcuaEndpoint,
  type OpcuaFailure,
  type OpcuaFailureReason,
  type OpcuaPoint,
} from "@iot-os/api-client";

/** What the person types; secrets stay empty unless they are being replaced. */
export type ConnectionForm = {
  name: string;
  endpoint_url: string;
  identity: "anonymous" | "username" | "certificate";
  username: string;
  password: string;
  user_certificate: string;
  user_private_key: string;
};

export const emptyForm: ConnectionForm = {
  name: "",
  endpoint_url: "opc.tcp://",
  identity: "anonymous",
  username: "",
  password: "",
  user_certificate: "",
  user_private_key: "",
};

export function formOf(connection: AdapterConnection): ConnectionForm {
  return {
    ...emptyForm,
    name: connection.name,
    endpoint_url: connection.endpoint_url,
    identity: connection.identity,
    username: connection.username ?? "",
  };
}

/** Saving a new connection asks for the strongest security; the server's offer refines it. */
export function inputOf(form: ConnectionForm, existing?: AdapterConnection | null): AdapterConnectionInput {
  const input: AdapterConnectionInput = {
    name: form.name.trim(),
    endpoint_url: form.endpoint_url.trim(),
    identity: form.identity,
  };
  if (!existing) {
    input.security_policy = "Basic256Sha256";
    input.security_mode = "SignAndEncrypt";
  }
  if (form.identity === "username") {
    input.username = form.username.trim();
    if (form.password) input.password = form.password;
  }
  if (form.identity === "certificate") {
    if (form.user_certificate.trim()) input.user_certificate = form.user_certificate.trim();
    if (form.user_private_key.trim()) input.user_private_key = form.user_private_key.trim();
  }
  return input;
}

/** What is missing before the form can be saved, in the order the fields appear. */
export function formIssues(form: ConnectionForm, existing?: AdapterConnection | null): string[] {
  const issues: string[] = [];
  if (!form.name.trim()) issues.push("Name the connection.");
  if (!/^opc\.tcp:\/\/[^\s/:@]+(:\d+)?(\/\S*)?$/.test(form.endpoint_url.trim()))
    issues.push("Enter the server address, for example opc.tcp://bms.example.com:4840.");
  if (form.identity === "username") {
    if (!form.username.trim()) issues.push("Enter the user name.");
    if (!form.password && !existing?.has_password) issues.push("Enter the password.");
  }
  if (form.identity === "certificate" && !existing?.has_user_certificate && (!form.user_certificate.trim() || !form.user_private_key.trim()))
    issues.push("Paste the user certificate and its private key.");
  return issues;
}

export const endpointKey = (endpoint: { policy: string; mode: string }) => `${endpoint.policy}|${endpoint.mode}`;

/** The endpoint the platform would pick: the strongest it will use. */
export function strongestEndpoint(endpoints: OpcuaEndpoint[]): OpcuaEndpoint | null {
  return [...endpoints].filter((e) => !e.refused).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0] ?? null;
}

/** An endpoint the server offers, or a saved connection's security. */
export function unencrypted(security: { policy: string; mode: string } | { security_policy: string; security_mode: string }): boolean {
  const [policy, mode] = "policy" in security ? [security.policy, security.mode] : [security.security_policy, security.security_mode];
  return policy === "None" || mode === "None";
}

/** The reason a call to the server failed, when it was the server and not the input. */
export function failureOf(error: unknown): OpcuaFailure | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const payload = error.payload as Partial<OpcuaFailure> | null;
  return payload?.reason ? { message: payload.message ?? "", reason: payload.reason, fix: payload.fix ?? null } : null;
}

const titles: Record<OpcuaFailureReason, string> = {
  unreachable: "The server did not answer",
  address_not_allowed: "That address is not allowed",
  no_shared_security: "No security both sides accept",
  server_certificate_changed: "The server’s certificate changed",
  client_certificate_untrusted: "The server does not trust the platform yet",
  sign_in_refused: "Sign-in refused",
  server_busy: "The server is busy",
  clock_difference: "The clocks disagree",
  timeout: "The server took too long",
};
export const failureTitle = (reason: OpcuaFailureReason) => titles[reason] ?? "The connection failed";

/** What the person does next, in the order the screen asks for it. */
export type ConnectionStep = "save" | "choose_security" | "review_certificate" | "trust_platform" | "test" | "browse" | "paused";
export function nextStep(connection: AdapterConnection | null, offered: boolean): ConnectionStep {
  if (!connection) return "save";
  if (connection.state === "paused") return "paused";
  if (connection.pending_server_certificate) return "review_certificate";
  if (connection.state === "connected") return "browse";
  if (!connection.server_certificate && !unencrypted(connection)) return offered ? "review_certificate" : "choose_security";
  if (connection.status?.reason === "client_certificate_untrusted") return "trust_platform";
  return "test";
}

/** "22.5 °C", "On", "3 values". */
export function formatValue(point: OpcuaPoint | undefined): string {
  if (!point) return "";
  const { value, unit, states } = point;
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `${value.length} values`;
  if (states && String(value) in states) return states[String(value)];
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    const shown = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
    return unit ? `${shown} ${unit}` : shown;
  }
  return unit ? `${value} ${unit}` : String(value);
}
