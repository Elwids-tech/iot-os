import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterConnection, OpcuaEndpoint, OpcuaTestResult } from "@iot-os/api-client";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { ChoiceCard } from "@iot-os/ui/components/choice-card";
import { CopyText } from "@iot-os/ui/components/copy-text";
import { FieldGroup } from "@iot-os/ui/components/field";
import { CheckboxField, SelectField, TextareaField, TextField } from "@iot-os/ui/components/form-fields";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { RadioGroup } from "@iot-os/ui/components/radio-group";
import { Status } from "@iot-os/ui/components/status-mark";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { DownloadIcon, PlugZapIcon, ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { fieldError, RequestError } from "../../components/forms";
import { api } from "../../lib/api";
import { AddressTree } from "../pointmap/AddressTree";
import {
  emptyForm,
  endpointKey,
  failureOf,
  failureTitle,
  formIssues,
  formOf,
  inputOf,
  strongestEndpoint,
  unencrypted,
  type ConnectionForm,
} from "./opcua";

const NEW = "new";

/**
 * Connecting to an OPC UA server (spec 038, US2): the address and sign-in, the security
 * the server offers with the strongest chosen, the server certificate to review, the
 * platform certificate to trust on the server, then a test and the address space.
 */
export function OpcuaConnection({
  org,
  canEdit,
  value,
  onChange,
  children,
}: {
  org: string;
  canEdit: boolean;
  /** The connection a data source uses; the first one when left out. */
  value?: string | null;
  onChange?: (uuid: string | null) => void;
  /** What follows once the connection works; the address tree by default. */
  children?: (connection: AdapterConnection) => ReactNode;
}) {
  const client = useQueryClient();
  const connections = useQuery({ queryKey: ["adapter-connections", org], queryFn: () => api.adapterConnections(org) });
  const [own, setOwn] = useState<string>(NEW);
  const chosen = value ?? own;
  const setChosen = (uuid: string) => {
    setOwn(uuid);
    onChange?.(uuid === NEW ? null : uuid);
  };
  useEffect(() => {
    if (!value && own === NEW && connections.data?.length) setChosen(connections.data[0].uuid);
  }, [connections.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const connection = connections.data?.find((c) => c.uuid === chosen) ?? null;
  const refresh = (next?: AdapterConnection) => {
    if (next) client.setQueryData<AdapterConnection[]>(["adapter-connections", org], (list) => (list ?? []).some((c) => c.uuid === next.uuid) ? list!.map((c) => (c.uuid === next.uuid ? next : c)) : [...(list ?? []), next]);
    return client.invalidateQueries({ queryKey: ["adapter-connections", org] });
  };

  return (
    <div className="flex flex-col gap-4">
      {!!connections.data?.length && (
        <Panel>
          <PanelContent>
            <SelectField
              label="Connection"
              value={chosen}
              onChange={setChosen}
              options={[
                ...connections.data.map((c) => ({ value: c.uuid, label: `${c.name} · ${c.endpoint_url}` })),
                ...(canEdit ? [{ value: NEW, label: "New connection" }] : []),
              ]}
              help="A building’s server is connected once; its data sources share the connection."
            />
          </PanelContent>
        </Panel>
      )}
      <RequestError error={connections.error} />
      <ServerPanel
        key={connection?.uuid ?? NEW}
        org={org}
        connection={connection}
        canEdit={canEdit}
        onSaved={(saved) => {
          void refresh(saved);
          setChosen(saved.uuid);
        }}
        onDeleted={() => {
          setChosen(NEW);
          void refresh();
        }}
      />
      {connection && (
        <>
          <SecurityPanel org={org} connection={connection} canEdit={canEdit} onChange={refresh} />
          <TestPanel org={org} connection={connection} canEdit={canEdit} onChange={refresh} />
          {connection.state === "connected" && (children ? children(connection) : <AddressTree org={org} connection={connection.uuid} />)}
        </>
      )}
    </div>
  );
}

function ServerPanel({
  org,
  connection,
  canEdit,
  onSaved,
  onDeleted,
}: {
  org: string;
  connection: AdapterConnection | null;
  canEdit: boolean;
  onSaved: (connection: AdapterConnection) => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<ConnectionForm>(() => (connection ? formOf(connection) : emptyForm));
  const [shown, setShown] = useState(false);
  const set = (change: Partial<ConnectionForm>) => setForm((current) => ({ ...current, ...change }));
  const issues = formIssues(form, connection);
  const save = useMutation({
    mutationFn: () => (connection ? api.saveAdapterConnection(org, connection.uuid, inputOf(form, connection)) : api.createAdapterConnection(org, inputOf(form))),
    onSuccess: (saved) => {
      set({ password: "", user_certificate: "", user_private_key: "" });
      toast.success(connection ? "Connection saved." : "Connection saved. Next, choose how it is secured.");
      onSaved(saved);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAdapterConnection(org, connection!.uuid),
    onSuccess: () => {
      toast.success("Connection deleted.");
      onDeleted();
    },
  });
  const error = save.error;
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>OPC UA server</PanelTitle>
        <PanelDescription>
          You need the server’s address, how it signs people in, and someone who can trust a certificate on the server.
        </PanelDescription>
        {connection && (
          <PanelActions>
            <Status value={connection.state} domain="opcua_connection" />
          </PanelActions>
        )}
      </PanelHeader>
      <PanelContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setShown(true);
            if (!issues.length) save.mutate();
          }}
        >
          <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
            <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={!canEdit} placeholder="Example Tower BMS" error={fieldError(error, "name")} />
            <TextField
              label="Server address"
              value={form.endpoint_url}
              onChange={(e) => set({ endpoint_url: e.target.value })}
              disabled={!canEdit}
              placeholder="opc.tcp://bms.example.com:4840"
              help="As the building’s integrator gives it, starting opc.tcp://."
              error={fieldError(error, "endpoint_url")}
              spellCheck={false}
            />
            <SelectField
              label="Sign-in"
              value={form.identity}
              onChange={(identity) => set({ identity: identity as ConnectionForm["identity"] })}
              disabled={!canEdit}
              options={[
                { value: "anonymous", label: "No sign-in (anonymous)" },
                { value: "username", label: "User name and password" },
                { value: "certificate", label: "User certificate" },
              ]}
            />
          </FieldGroup>
          {form.identity === "username" && (
            <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
              <TextField label="User name" value={form.username} onChange={(e) => set({ username: e.target.value })} disabled={!canEdit} autoComplete="off" error={fieldError(error, "username")} />
              <TextField
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                disabled={!canEdit}
                autoComplete="new-password"
                placeholder={connection?.has_password ? "Saved; type to replace" : undefined}
                error={fieldError(error, "password")}
              />
            </FieldGroup>
          )}
          {form.identity === "certificate" && (
            <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
              <TextareaField
                label="User certificate (PEM)"
                value={form.user_certificate}
                onChange={(e) => set({ user_certificate: e.target.value })}
                disabled={!canEdit}
                rows={4}
                placeholder={connection?.has_user_certificate ? "Saved; paste to replace" : "-----BEGIN CERTIFICATE-----"}
              />
              <TextareaField
                label="Private key (PEM)"
                value={form.user_private_key}
                onChange={(e) => set({ user_private_key: e.target.value })}
                disabled={!canEdit}
                rows={4}
                placeholder={connection?.has_user_certificate ? "Saved; paste to replace" : "-----BEGIN PRIVATE KEY-----"}
              />
            </FieldGroup>
          )}
          {shown && issues.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>{issues.join(" ")}</AlertDescription>
            </Alert>
          )}
          {error && !fieldError(error, "name") && !fieldError(error, "endpoint_url") && <RequestError error={error} />}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {connection ? "Save connection" : "Save and continue"}
              </Button>
              {connection && (
                <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Delete connection
                </Button>
              )}
            </div>
          )}
          <RequestError error={remove.error} />
        </form>
      </PanelContent>
    </Panel>
  );
}

function SecurityPanel({
  org,
  connection,
  canEdit,
  onChange,
}: {
  org: string;
  connection: AdapterConnection;
  canEdit: boolean;
  onChange: (connection?: AdapterConnection) => void;
}) {
  const [endpoints, setEndpoints] = useState<OpcuaEndpoint[] | null>(null);
  const [choice, setChoice] = useState(endpointKey({ policy: connection.security_policy, mode: connection.security_mode }));
  const [confirmed, setConfirmed] = useState(connection.unencrypted_confirmed_by !== null);
  const ask = useMutation({
    mutationFn: () => api.adapterConnectionEndpoints(org, connection.uuid),
    onSuccess: ({ endpoints: offered, connection: next }) => {
      setEndpoints(offered);
      const current = offered.find((e) => endpointKey(e) === endpointKey({ policy: next.security_policy, mode: next.security_mode }) && !e.refused);
      setChoice(endpointKey(current ?? strongestEndpoint(offered) ?? { policy: "", mode: "" }));
      onChange(next);
    },
  });
  const chosen = endpoints?.find((e) => endpointKey(e) === choice) ?? null;
  const changed = chosen && endpointKey(chosen) !== endpointKey({ policy: connection.security_policy, mode: connection.security_mode });
  const use = useMutation({
    mutationFn: () => api.saveAdapterConnection(org, connection.uuid, { security_policy: chosen!.policy as never, security_mode: chosen!.mode as never, ...(unencrypted(chosen!) ? { unencrypted_confirmed: confirmed } : {}) }),
    onSuccess: (next) => {
      toast.success(`Security set to ${next.security_label}.`);
      onChange(next);
      ask.mutate();
    },
  });
  const accept = useMutation({
    mutationFn: (fingerprint: string) => api.acceptServerCertificate(org, connection.uuid, fingerprint),
    onSuccess: (next) => {
      toast.success("Server certificate trusted.");
      onChange(next);
    },
  });
  const pending = connection.pending_server_certificate;
  const failure = failureOf(ask.error);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Security and certificates</PanelTitle>
        <PanelDescription>
          {connection.security_label}. The strongest security the server offers is chosen for you.
        </PanelDescription>
        {canEdit && (
          <PanelActions>
            <Button variant="outline" size="sm" disabled={ask.isPending || connection.state === "paused"} onClick={() => ask.mutate()}>
              <PlugZapIcon />
              {ask.isPending ? "Asking…" : "Ask the server"}
            </Button>
          </PanelActions>
        )}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-5">
        {failure ? <FailureAlert reason={failure.reason} message={failure.message} fix={failure.fix} /> : <RequestError error={ask.error} />}
        {endpoints && (
          <div className="flex flex-col gap-3">
            <RadioGroup value={choice} onValueChange={(next) => next && setChoice(next)} aria-label="Security" disabled={!canEdit} className="flex flex-col gap-2">
              {endpoints.map((endpoint) => (
                <ChoiceCard
                  key={endpointKey(endpoint)}
                  value={endpointKey(endpoint)}
                  checked={choice === endpointKey(endpoint)}
                  disabled={!canEdit || Boolean(endpoint.refused)}
                  icon={unencrypted(endpoint) ? <ShieldAlertIcon /> : undefined}
                  title={endpoint.label}
                  description={endpoint.refused ?? endpoint.warning ?? (endpoint === strongestEndpoint(endpoints) ? "The strongest the server offers." : undefined)}
                />
              ))}
            </RadioGroup>
            {chosen && unencrypted(chosen) && (
              <Alert>
                <ShieldAlertIcon />
                <AlertTitle>Not encrypted</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <span>Values and any password travel in the clear. Use it only on a network you control, and only when the server offers nothing else.</span>
                  <CheckboxField label="I understand values and sign-in travel unencrypted" checked={confirmed} onCheckedChange={setConfirmed} disabled={!canEdit} />
                </AlertDescription>
              </Alert>
            )}
            {canEdit && changed && (
              <div>
                <Button disabled={use.isPending || (unencrypted(chosen) && !confirmed)} onClick={() => use.mutate()}>
                  Use {chosen.label}
                </Button>
              </div>
            )}
            <RequestError error={use.error} />
          </div>
        )}
        {pending && (
          <Alert>
            <AlertTitle>{connection.server_certificate ? "The server presented a different certificate" : "Review the server’s certificate"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>Check the fingerprint with the building’s integrator before you trust it.</span>
              <CertificateFacts certificate={pending} />
              {canEdit && (
                <div>
                  <Button disabled={accept.isPending} onClick={() => accept.mutate(pending.fingerprint)}>
                    Trust this certificate
                  </Button>
                </div>
              )}
              <RequestError error={accept.error} />
            </AlertDescription>
          </Alert>
        )}
        {connection.server_certificate && !pending && (
          <div className="flex flex-col gap-2">
            <h3 className="text-heading">Server certificate</h3>
            <CertificateFacts certificate={connection.server_certificate} />
          </div>
        )}
        {!unencrypted(connection) && (
          <div className="flex flex-col gap-2">
            <h3 className="text-heading">The platform’s certificate</h3>
            <p className="text-body text-muted-foreground">
              Add this certificate to the server’s trusted list (often under Security, Certificates or PKI, as “trusted”), then test. Many servers place a new client’s certificate under “rejected” on the first attempt; moving it to “trusted” does the same.
            </p>
            <PropertyList
              items={[
                { label: "Fingerprint (SHA-256)", value: connection.client_certificate.fingerprint ? <CopyText value={connection.client_certificate.fingerprint} label="Copy fingerprint" mono /> : "—" },
                { label: "Expires", value: connection.client_certificate.expires_at ? formatDateTime(connection.client_certificate.expires_at) : "—" },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={api.adapterConnectionCertificateUrl(org, connection.uuid, "der")} download>
                  <DownloadIcon />
                  Download (.der)
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={api.adapterConnectionCertificateUrl(org, connection.uuid, "pem")} download>
                  <DownloadIcon />
                  Download (.pem)
                </a>
              </Button>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

function CertificateFacts({ certificate }: { certificate: NonNullable<AdapterConnection["server_certificate"]> }) {
  return (
    <PropertyList
      items={[
        { label: "Subject", value: certificate.subject || "—" },
        { label: "Fingerprint (SHA-256)", value: <CopyText value={certificate.fingerprint} label="Copy fingerprint" mono /> },
        { label: "Application", value: certificate.application_uri ?? "—" },
        { label: "Valid until", value: certificate.valid_to ? formatDateTime(certificate.valid_to) : "—" },
      ]}
    />
  );
}

function TestPanel({
  org,
  connection,
  canEdit,
  onChange,
}: {
  org: string;
  connection: AdapterConnection;
  canEdit: boolean;
  onChange: (connection?: AdapterConnection) => void;
}) {
  const [result, setResult] = useState<OpcuaTestResult | null>(null);
  const test = useMutation({
    mutationFn: () => api.testOpcuaConnection(org, connection.uuid),
    onSuccess: (next) => {
      setResult(next);
      onChange(next.connection);
    },
  });
  const pause = useMutation({
    mutationFn: () => (connection.state === "paused" ? api.resumeAdapterConnection(org, connection.uuid) : api.pauseAdapterConnection(org, connection.uuid)),
    onSuccess: (next) => onChange(next),
  });
  const status = connection.status;
  const shown = result ?? (status?.reason ? { connected: false, reason: status.reason, message: status.message ?? "", fix: status.fix ?? null } : null);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Test</PanelTitle>
        <PanelDescription>
          Opens a session with these settings and signs in.
          {status?.checked_at && (
            <>
              {" "}Last checked <RelativeTime at={status.checked_at} />.
            </>
          )}
        </PanelDescription>
        {canEdit && (
          <PanelActions>
            <Button variant="outline" size="sm" disabled={pause.isPending} onClick={() => pause.mutate()}>
              {connection.state === "paused" ? "Resume" : "Pause"}
            </Button>
          </PanelActions>
        )}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        {shown && !shown.connected && shown.reason && <FailureAlert reason={shown.reason} message={shown.message ?? ""} fix={shown.fix ?? null} />}
        {connection.state === "connected" && (
          <PropertyList
            items={[
              { label: "Security", value: status?.security?.label ?? connection.security_label },
              { label: "Clock difference", value: status?.clock_difference_ms != null ? `${(status.clock_difference_ms / 1000).toFixed(1)} s` : "—" },
              { label: "Points per read", value: status?.limits?.MaxNodesPerRead?.toLocaleString() ?? "No limit given" },
            ]}
          />
        )}
        <RequestError error={test.error ?? pause.error} />
        {canEdit && (
          <div>
            <Button disabled={test.isPending || connection.state === "paused"} onClick={() => test.mutate()}>
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

function FailureAlert({ reason, message, fix }: { reason: Parameters<typeof failureTitle>[0]; message: string; fix: string | null }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{failureTitle(reason)}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {message && <span>{message}</span>}
        {fix && <span className="font-medium">{fix}</span>}
      </AlertDescription>
    </Alert>
  );
}
