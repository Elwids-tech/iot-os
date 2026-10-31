import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CreatedWebhookSecret,
  DeviceAdapter,
  WebhookAuth,
  WebhookSecret,
} from "@iot-os/api-client";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { ChoiceCard } from "@iot-os/ui/components/choice-card";
import { DataTable, ToolbarButton, type DataColumn } from "@iot-os/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog";
import { FieldGroup } from "@iot-os/ui/components/field";
import {
  SelectField,
  TextField,
  ValueField,
} from "@iot-os/ui/components/form-fields";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { RadioGroup } from "@iot-os/ui/components/radio-group";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { KeyRoundIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { api } from "../../lib/api";
import { RequestError } from "../../components/forms";
import { defaultAuth } from "../source";

const MAX_ACTIVE = 2;

/** The draft's authentication settings; only the chosen mode is saved. */
export function WebhookAuthentication({
  auth,
  onChange,
  disabled,
}: {
  auth: WebhookAuth;
  onChange: (auth: WebhookAuth) => void;
  disabled: boolean;
}) {
  // Each mode keeps what the person typed while they compare modes; only the chosen one is saved.
  const [memory, setMemory] = useState<Partial<Record<WebhookAuth["mode"], WebhookAuth>>>({});
  function choose(mode: WebhookAuth["mode"]) {
    if (mode === auth.mode) return;
    setMemory((current) => ({ ...current, [auth.mode]: auth }));
    onChange(memory[mode] ?? defaultAuth(mode));
  }
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Authentication</PanelTitle>
        <PanelDescription>
          How each delivery proves it comes from your vendor account.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <RadioGroup
          value={auth.mode}
          onValueChange={(value) => value && choose(value as WebhookAuth["mode"])}
          className="grid gap-3 lg:grid-cols-3"
          aria-label="Authentication mode"
          disabled={disabled}
        >
          <ChoiceCard
            value="hmac"
            checked={auth.mode === "hmac"}
            disabled={disabled}
            title="HMAC signature"
            badge={<Badge variant="success">Recommended</Badge>}
            description="The vendor signs the body with the shared secret; the secret itself never travels."
          />
          <ChoiceCard
            value="header"
            checked={auth.mode === "header"}
            disabled={disabled}
            title="Secret in a header"
            description="The vendor sends the secret in a header, Authorization: Bearer by default."
          />
          <ChoiceCard
            value="url"
            checked={auth.mode === "url"}
            disabled={disabled}
            title="Token in the URL"
            badge={<Badge variant="warning">Weakest</Badge>}
            description="For vendor clouds that cannot set headers. Anyone who sees the URL can send data."
          />
        </RadioGroup>
        {auth.mode === "hmac" && (
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Signature header"
              value={auth.signature_header}
              placeholder="x-signature"
              disabled={disabled}
              maxLength={64}
              help="The header that carries the HMAC-SHA256 of the raw body."
              onChange={(e) => onChange({ ...auth, signature_header: e.target.value })}
            />
            <SelectField
              label="Signature encoding"
              value={auth.encoding}
              disabled={disabled}
              options={[
                { value: "hex", label: "Hex" },
                { value: "base64", label: "Base64" },
              ]}
              onChange={(value) =>
                onChange({ ...auth, encoding: value as "hex" | "base64" })
              }
            />
            <TextField
              label="Signature prefix"
              optional
              value={auth.prefix ?? ""}
              placeholder="sha256="
              disabled={disabled}
              maxLength={32}
              help="Text before the signature, if the vendor adds one."
              onChange={(e) => onChange({ ...auth, prefix: e.target.value })}
            />
            <TextField
              label="Timestamp header"
              optional
              value={auth.timestamp_header ?? ""}
              placeholder="x-timestamp"
              disabled={disabled}
              maxLength={64}
              help="When set, the signed string is <timestamp>.<body> and the timestamp (epoch seconds or ISO 8601) must be within 5 minutes of the platform's clock, which refuses replayed deliveries."
              onChange={(e) => onChange({ ...auth, timestamp_header: e.target.value })}
            />
          </FieldGroup>
        )}
        {auth.mode === "header" && (
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Header name"
              value={auth.header}
              placeholder="authorization"
              disabled={disabled}
              maxLength={64}
              onChange={(e) => onChange({ ...auth, header: e.target.value })}
            />
            <SelectField
              label="Header value"
              value={auth.scheme}
              disabled={disabled}
              options={[
                { value: "Bearer", label: "Bearer <secret>" },
                { value: "", label: "The secret alone" },
              ]}
              onChange={(value) =>
                onChange({ ...auth, scheme: value === "Bearer" ? "Bearer" : "" })
              }
            />
          </FieldGroup>
        )}
        {auth.mode === "url" && (
          <Alert>
            <AlertTitle>The weakest mode</AlertTitle>
            <AlertDescription>
              The secret is a path segment of the ingest URL. It is removed before
              the decoder sees the path and redacted from platform logs, but proxies
              and screenshots on the vendor's side can expose it. Use it only when
              the vendor cloud cannot set headers.
            </AlertDescription>
          </Alert>
        )}
      </PanelContent>
    </Panel>
  );
}

const secretState = (secret: WebhookSecret) =>
  secret.revoked_at
    ? "revoked"
    : !secret.active
      ? "expired"
      : secret.expires_at
        ? "expiring"
        : "active";

type SecretDialog = "create" | "rotate" | "paste";

/** The saved adapter's ingest URL and secrets; secrets live outside revisions. */
export function WebhookSecrets({
  org,
  adapter,
  canManage,
}: {
  org: string;
  adapter: DeviceAdapter;
  canManage: boolean;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["adapter-webhook", org, adapter.uuid],
    queryFn: () => api.adapterWebhook(org, adapter.uuid),
    refetchInterval: 5000,
  });
  const [dialog, setDialog] = useState<SecretDialog | null>(null);
  const [created, setCreated] = useState<CreatedWebhookSecret | null>(null);
  const [revoking, setRevoking] = useState<WebhookSecret | null>(null);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const detail = query.data;
  const mode =
    detail?.auth?.mode ??
    (adapter.source.type === "webhook" ? adapter.source.auth.mode : "hmac");
  const ingestUrl = detail?.ingest_url ?? adapter.webhook?.ingest_url ?? null;
  const state = detail?.state ?? adapter.webhook?.state ?? null;
  const secrets = detail?.secrets;
  const active =
    secrets?.filter((s) => s.active).length ?? adapter.webhook?.active_secrets ?? 0;
  const full = active >= MAX_ACTIVE;
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["adapter-webhook", org, adapter.uuid] }),
      cache.invalidateQueries({ queryKey: ["adapter", org, adapter.uuid] }),
    ]);

  function open(kind: SecretDialog) {
    setDialog(kind);
    setLabel(kind === "rotate" ? `Rotated ${new Date().toLocaleDateString()}` : kind === "paste" ? "Vendor signing secret" : "Vendor cloud");
    setValue("");
    setError(null);
  }
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createWebhookSecret(org, adapter.uuid, {
        label: label.trim(),
        ...(dialog === "paste" ? { value } : {}),
      });
      setDialog(null);
      setValue("");
      if (result.value || mode === "url") setCreated(result);
      else toast.success(`Secret “${result.secret.label}” saved.`);
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeWebhookSecret(org, adapter.uuid, revoking.uuid);
      toast.success(`Secret “${revoking.label}” revoked.`);
      setRevoking(null);
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<DataColumn<WebhookSecret>[]>(
    () => [
      {
        id: "label",
        header: "Label",
        mobile: "title",
        value: (s) => s.label,
        cell: (s) => <span className="font-medium">{s.label}</span>,
      },
      {
        id: "state",
        header: "State",
        mobile: "badge",
        value: secretState,
        cell: (s) => <Status value={secretState(s)} domain="secret" />,
      },
      {
        id: "origin",
        header: "Origin",
        value: (s) => s.origin,
        cell: (s) => (s.origin === "vendor" ? "Vendor-issued" : "Generated"),
      },
      {
        id: "created",
        header: "Created",
        value: (s) => s.created_at,
        cell: (s) => (
          <span>
            <RelativeTime at={s.created_at} />
            {s.created_by && (
              <span className="text-muted-foreground"> by {s.created_by.name}</span>
            )}
          </span>
        ),
      },
      {
        id: "last_used",
        header: "Last used",
        value: (s) => s.last_used_at,
        cell: (s) => <RelativeTime at={s.last_used_at} />,
      },
      {
        id: "expires",
        header: "Expires",
        value: (s) => s.expires_at,
        cell: (s) =>
          s.revoked_at ? (
            <span className="text-muted-foreground">
              Revoked <RelativeTime at={s.revoked_at} />
            </span>
          ) : s.expires_at ? (
            <time dateTime={s.expires_at}>{formatDateTime(s.expires_at)}</time>
          ) : (
            <span className="text-muted-foreground">Until revoked</span>
          ),
      },
      {
        id: "actions",
        header: "Actions",
        headerHidden: true,
        hideable: false,
        align: "end",
        cell: (s) =>
          !s.revoked_at && s.active ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage || busy}
              aria-label={`Revoke ${s.label}`}
              onClick={() => {
                setError(null);
                setRevoking(s);
              }}
            >
              Revoke
            </Button>
          ) : null,
      },
    ],
    [busy, canManage],
  );

  const shownUrl = created?.ingest_url ?? ingestUrl;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Webhook endpoint</PanelTitle>
          <PanelActions>
            {state && <Status value={state} domain="source" />}
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <ValueField
            label="Ingest URL"
            value={ingestUrl}
            mono
            copy
            help={
              mode === "url"
                ? "In URL token mode the vendor cloud needs the full URL with the token, shown once when you create a secret."
                : "Paste this URL and a secret into the vendor cloud's webhook settings. Paths below it reach the decoder as the topic."
            }
          />
          <p className="text-meta text-muted-foreground">
            Last delivery:{" "}
            <RelativeTime
              at={adapter.webhook?.last_delivery_at}
              never="No deliveries yet"
            />
          </p>
        </PanelContent>
      </Panel>
      <section aria-labelledby="webhook-secrets-title" className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h2 id="webhook-secrets-title" className="text-heading">
            Webhook secrets
          </h2>
          <p className="text-meta text-muted-foreground">
            At most two secrets are active at a time. Rotating creates a new one;
            the previous secret keeps working for 7 days or until you revoke it.
            Secrets need no new revision or deployment.
          </p>
        </div>
        {!canManage && (
          <p className="text-meta text-muted-foreground">
            Managing webhook secrets needs the connection management permission.
          </p>
        )}
        <RequestError error={!dialog && !revoking ? error || query.error : null} />
        <DataTable
          id="adapter-webhook-secrets"
          label="Webhook secrets"
          noun={["secret", "secrets"]}
          rows={secrets}
          rowKey={(s) => s.uuid}
          rowLabel={(s) => s.label}
          columns={columns}
          refreshSeconds={5}
          toolbar={
            <>
              {active === 0 ? (
                <ToolbarButton
                  variant="default"
                  icon={<PlusIcon />}
                  label="Create secret"
                  disabled={!canManage || busy}
                  onClick={() => open("create")}
                />
              ) : (
                <ToolbarButton
                  icon={<RotateCwIcon />}
                  label="Rotate secret"
                  disabled={!canManage || busy || full}
                  onClick={() => open("rotate")}
                />
              )}
              {mode === "hmac" && (
                <ToolbarButton
                  icon={<KeyRoundIcon />}
                  label="Paste vendor secret"
                  disabled={!canManage || busy || full}
                  onClick={() => open("paste")}
                />
              )}
            </>
          }
          empty={
            <p className="p-4 text-body text-muted-foreground">
              No secrets yet. Create one, then paste it into the vendor cloud with
              the ingest URL.
            </p>
          }
        />
        {full && (
          <p className="text-meta text-muted-foreground">
            Two secrets are active. Revoke one before rotating again.
          </p>
        )}
      </section>

      <Dialog
        open={!!dialog}
        onOpenChange={(next) => {
          if (!next && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "rotate"
                ? "Rotate the webhook secret"
                : dialog === "paste"
                  ? "Paste the vendor's signing secret"
                  : "Create a webhook secret"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "rotate"
                ? "A new secret is generated and shown once. The current secret keeps working for 7 days or until you revoke it, so you can update the vendor cloud first."
                : dialog === "paste"
                  ? "For vendor clouds that issue their own HMAC signing secret. It is stored encrypted and never shown again."
                  : "A random secret is generated and shown once. Store it in the vendor cloud's webhook settings."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField
              label="Label"
              value={label}
              maxLength={80}
              disabled={busy}
              help="Shown in this list and the audit log, never the value."
              onChange={(e) => setLabel(e.target.value)}
            />
            {dialog === "paste" && (
              <TextField
                label="Signing secret"
                type="password"
                autoComplete="off"
                value={value}
                disabled={busy}
                error={
                  value && value.length < 16
                    ? "Use the full secret: at least 16 characters."
                    : undefined
                }
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </FieldGroup>
          <RequestError error={error} />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy || !label.trim() || (dialog === "paste" && value.length < 16)
              }
              onClick={() => void create()}
            >
              {dialog === "rotate"
                ? "Rotate secret"
                : dialog === "paste"
                  ? "Save secret"
                  : "Create secret"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!created}
        onOpenChange={(next) => {
          if (!next) setCreated(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy the new secret now</DialogTitle>
            <DialogDescription>
              {created?.value
                ? "This secret will not be shown again. Paste it into the vendor cloud's webhook settings before closing."
                : "Paste this URL into the vendor cloud. It contains the token and will not be shown again."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {created?.value && (
              <ValueField label="Secret" value={created.value} mono copy />
            )}
            {mode === "url" && shownUrl && (
              <ValueField label="Ingest URL with token" value={shownUrl} mono copy />
            )}
            <StatusMark tone="warning">Shown once. Store it securely.</StatusMark>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>I've stored it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!revoking}
        onOpenChange={(next) => {
          if (!next && !busy) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Deliveries that use this secret are refused within 10 seconds.
              {active <= 1
                ? " It is the only active secret, so every delivery will be refused until you create another."
                : " The other active secret keeps working."}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RequestError error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>
              Revoke secret
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
