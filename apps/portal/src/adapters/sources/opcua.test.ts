import { describe, expect, it } from "vitest";
import { ApiError, type AdapterConnection, type OpcuaEndpoint } from "@iot-os/api-client";
import { emptyForm, failureOf, formatValue, formIssues, inputOf, nextStep, strongestEndpoint, unencrypted } from "./opcua";

const endpoint = (policy: string, mode: string, strength: number, refused: string | null = null): OpcuaEndpoint => ({ policy, mode, label: `${policy}/${mode}`, strength, refused, server_certificate: null });
const connection = (change: Partial<AdapterConnection> = {}): AdapterConnection => ({
  uuid: "c", name: "BMS", protocol: "opcua", endpoint_url: "opc.tcp://bms.example.com:4840", runs_at: "platform",
  security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", security_label: "Encrypted (Basic256Sha256)", unencrypted_confirmed_by: null,
  identity: "username", username: "operator", has_password: true, has_user_certificate: false, client_certificate: { fingerprint: "ab", expires_at: null },
  server_certificate: null, pending_server_certificate: null, state: "draft", status: null, refused_points: [], created_at: null, updated_at: null, ...change,
});

describe("the OPC UA connection form", () => {
  it("asks for what is missing, and keeps a saved password", () => {
    expect(formIssues(emptyForm)).toEqual(["Name the connection.", "Enter the server address, for example opc.tcp://bms.example.com:4840."]);
    const form = { ...emptyForm, name: "BMS", endpoint_url: "opc.tcp://bms.example.com:4840", identity: "username" as const, username: "operator" };
    expect(formIssues(form)).toEqual(["Enter the password."]);
    expect(formIssues(form, connection())).toEqual([]);
    expect(formIssues({ ...form, endpoint_url: "opc.tcp://user:pass@bms.example.com" })).toContain("Enter the server address, for example opc.tcp://bms.example.com:4840.");
  });

  it("sends the strongest security for a new connection and only the secrets typed", () => {
    const form = { ...emptyForm, name: " BMS ", endpoint_url: "opc.tcp://bms.example.com:4840", identity: "username" as const, username: "operator", password: "" };
    expect(inputOf(form)).toEqual({ name: "BMS", endpoint_url: "opc.tcp://bms.example.com:4840", identity: "username", username: "operator", security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt" });
    expect(inputOf({ ...form, password: "p" }, connection())).toEqual({ name: "BMS", endpoint_url: "opc.tcp://bms.example.com:4840", identity: "username", username: "operator", password: "p" });
  });

  it("picks the strongest endpoint the platform will use", () => {
    expect(strongestEndpoint([endpoint("None", "None", 0), endpoint("Basic256Sha256", "Sign", 22), endpoint("Aes256_Sha256_RsaPss", "SignAndEncrypt", 40, "refused")])?.mode).toBe("Sign");
    expect(strongestEndpoint([])).toBeNull();
    expect(unencrypted({ policy: "None", mode: "None" })).toBe(true);
    expect(unencrypted(connection())).toBe(false);
  });

  it("reads a failure's reason and fix from a 422", () => {
    expect(failureOf(new ApiError(422, { message: "m", reason: "sign_in_refused", fix: "f" }))).toEqual({ message: "m", reason: "sign_in_refused", fix: "f" });
    expect(failureOf(new ApiError(422, { message: "m", errors: { name: ["x"] } }))).toBeNull();
    expect(failureOf(new Error("x"))).toBeNull();
  });

  it("says what comes next", () => {
    expect(nextStep(null, false)).toBe("save");
    expect(nextStep(connection(), false)).toBe("choose_security");
    expect(nextStep(connection({ pending_server_certificate: { subject: "", fingerprint: "f", valid_from: null, valid_to: null, application_uri: null } }), true)).toBe("review_certificate");
    const trusted = { subject: "", fingerprint: "f", valid_from: null, valid_to: null, application_uri: null };
    expect(nextStep(connection({ server_certificate: trusted }), true)).toBe("test");
    expect(nextStep(connection({ server_certificate: trusted, status: { reason: "client_certificate_untrusted" } }), true)).toBe("trust_platform");
    expect(nextStep(connection({ state: "connected", server_certificate: trusted }), true)).toBe("browse");
    expect(nextStep(connection({ state: "paused" }), true)).toBe("paused");
  });

  it("formats values with their unit and states", () => {
    const point = { node_id: "n", namespace_uri: "u", status: "Good", quality: "good" as const };
    expect(formatValue({ ...point, value: 22.5, unit: "°C" })).toBe("22.5 °C");
    expect(formatValue({ ...point, value: 1, states: { "1": "Occupied" } })).toBe("Occupied");
    expect(formatValue({ ...point, value: [1, 2, 3] })).toBe("3 values");
    expect(formatValue({ ...point, value: null })).toBe("—");
    expect(formatValue(undefined)).toBe("");
  });
});
