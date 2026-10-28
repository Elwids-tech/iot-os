import { useEffect, useId, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ApiError,
  type AdapterFixture,
  type AdapterSecrets,
  type DeviceAdapter,
  type FetchResult,
  type PollCredentials,
  type PollParam,
} from "@iot-os/api-client";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field";
import {
  SelectField,
  TextareaField,
  TextField,
} from "@iot-os/ui/components/form-fields";
import { Input } from "@iot-os/ui/components/input";
import { JsonEditor } from "@iot-os/ui/components/json-editor";
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { api } from "../../lib/api";
import { fieldError, RequestError } from "../../components/forms";
import {
  DAY,
  localInput,
  placeholders,
  pollFixture,
  pollIssues,
  type PollSource as PollSourceSettings,
} from "../source";

const MAX_ROWS = 20;
type ValueTarget = { field: "query" | "headers" | "body"; index: number; start: number; end: number };

/** The draft's polling settings and credentials. */
export function PollSource({
  adapter,
  source,
  onChange,
  secrets,
  onSecretsChange,
  canEdit,
  error,
}: {
  adapter?: DeviceAdapter;
  source: PollSourceSettings;
  onChange: (source: PollSourceSettings) => void;
  secrets: AdapterSecrets | undefined;
  onSecretsChange: (secrets: AdapterSecrets) => void;
  canEdit: boolean;
  /** The last save error, for field messages. */
  error: unknown;
}) {
  const id = useId();
  const issues = pollIssues(source);
  const disabled = !canEdit;
  const target = useRef<ValueTarget | null>(null);
  const [canInsert, setCanInsert] = useState(false);
  const request = source.request;
  const setRequest = (patch: Partial<PollSourceSettings["request"]>) =>
    onChange({ ...source, request: { ...request, ...patch } });
  const server = (field: string) => fieldError(error, `source.${field}`);
  const inputId = (t: Pick<ValueTarget, "field" | "index">) =>
    t.field === "body" ? `${id}-body` : `${id}-${t.field}-value-${t.index}`;

  function remember(field: ValueTarget["field"], index: number) {
    return (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      const el = event.currentTarget;
      target.current = {
        field,
        index,
        start: el.selectionStart ?? el.value.length,
        end: el.selectionEnd ?? el.value.length,
      };
      setCanInsert(true);
    };
  }
  function insert(name: (typeof placeholders)[number]) {
    const at = target.current;
    if (!at) return;
    const token = `{${name}}`;
    const current =
      at.field === "body" ? (request.body ?? "") : (request[at.field][at.index]?.value ?? "");
    const next = current.slice(0, at.start) + token + current.slice(at.end);
    if (at.field === "body") setRequest({ body: next });
    else
      setRequest({
        [at.field]: request[at.field].map((row, i) =>
          i === at.index ? { ...row, value: next } : row,
        ),
      });
    const caret = at.start + token.length;
    target.current = { ...at, start: caret, end: caret };
    requestAnimationFrame(() => {
      const el = document.getElementById(inputId(at)) as HTMLInputElement | null;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }
  function placement(next: PollCredentials["placement"]) {
    const previous = "name" in source.credentials ? source.credentials.name : "";
    onChange({
      ...source,
      credentials:
        next === "header" || next === "query"
          ? { placement: next, name: previous || (next === "header" ? "x-api-key" : "api_key") }
          : { placement: next },
    });
  }
  const saved = (key: keyof DeviceAdapter["saved_secrets"]) =>
    adapter?.source.type === "poll" && adapter.saved_secrets?.[key];
  const secretField = (
    key: keyof AdapterSecrets,
    label: string,
    fallback: string,
    type: "password" | "text" = "password",
  ) => (
    <TextField
      key={key}
      label={label}
      type={type}
      autoComplete={type === "password" ? "new-password" : "off"}
      value={secrets?.[key] ?? ""}
      disabled={disabled}
      placeholder={saved(key as keyof DeviceAdapter["saved_secrets"]) ? "Saved · enter to replace" : fallback}
      error={fieldError(error, `secrets.${key}`)}
      onChange={(e) => onSecretsChange({ ...secrets, [key]: e.target.value })}
    />
  );
  const credentials = source.credentials;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Request</PanelTitle>
          <PanelDescription>
            One HTTPS request per page. Placeholders are filled in at every run.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 md:grid-cols-[8rem_minmax(0,1fr)]">
            <SelectField
              label="Method"
              value={request.method}
              disabled={disabled}
              options={[
                { value: "GET", label: "GET" },
                { value: "POST", label: "POST" },
              ]}
              onChange={(value) => setRequest({ method: value as "GET" | "POST" })}
            />
            <TextField
              label="URL"
              type="url"
              inputMode="url"
              value={request.url}
              disabled={disabled}
              maxLength={2000}
              placeholder="https://api.vendor.example/v1/accounts/A1/history"
              help="HTTPS to a public address. Credentials go under Credentials, placeholders in the query."
              error={server("request.url") ?? issues.url}
              onChange={(e) => setRequest({ url: e.target.value })}
            />
          </FieldGroup>
          <div
            role="group"
            aria-labelledby={`${id}-placeholders`}
            className="flex flex-wrap items-center gap-2"
          >
            <span id={`${id}-placeholders`} className="text-meta text-muted-foreground">
              Insert a placeholder:
            </span>
            {placeholders.map((name) => (
              <Button
                key={name}
                type="button"
                size="xs"
                variant="outline"
                className="font-mono"
                disabled={disabled || !canInsert}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(name)}
              >
                {`{${name}}`}
              </Button>
            ))}
            <span className="text-meta text-muted-foreground">
              {canInsert
                ? "Inserted where the cursor is in the last value you edited."
                : "Click into a value first."}
            </span>
          </div>
          <ParamRows
            id={id}
            field="query"
            title="Query parameters"
            noun="query parameter"
            rows={request.query}
            disabled={disabled}
            error={server("request.query")}
            onChange={(query) => setRequest({ query })}
            onValueEvent={remember}
          />
          <ParamRows
            id={id}
            field="headers"
            title="Headers"
            noun="header"
            rows={request.headers}
            disabled={disabled}
            error={server("request.headers")}
            help="Authorization, Cookie, Host and proxy headers are set by the platform."
            onChange={(headers) => setRequest({ headers })}
            onValueEvent={remember}
          />
          {request.method === "POST" && (
            <TextareaField
              id={`${id}-body`}
              label="Body template"
              optional
              rows={5}
              className="font-mono"
              value={request.body ?? ""}
              disabled={disabled}
              maxLength={16384}
              placeholder={'{"since": "{cursor}", "limit": {page_size}}'}
              help="JSON sent with each request, up to 16 KiB, with the same placeholders."
              error={server("request.body")}
              onChange={(e) => {
                setRequest({ body: e.target.value });
                remember("body", 0)(e);
              }}
              onFocus={remember("body", 0)}
              onSelect={remember("body", 0)}
              onKeyUp={remember("body", 0)}
              onClick={remember("body", 0)}
            />
          )}
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Credentials</PanelTitle>
          <PanelDescription>
            Stored encrypted and never shown again. Changing them creates a draft
            revision that is tested and deployed like any other change.
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="How the API key is sent"
              value={credentials.placement}
              disabled={disabled}
              options={[
                { value: "none", label: "No credentials" },
                { value: "header", label: "API key in a header" },
                { value: "query", label: "API key in a query parameter" },
                { value: "bearer", label: "Bearer token" },
                { value: "basic", label: "Basic authentication" },
              ]}
              onChange={(value) => placement(value as PollCredentials["placement"])}
            />
            {(credentials.placement === "header" || credentials.placement === "query") && (
              <TextField
                label={credentials.placement === "header" ? "Header name" : "Query parameter name"}
                value={credentials.name}
                disabled={disabled}
                maxLength={128}
                error={server("credentials.name")}
                onChange={(e) =>
                  onChange({
                    ...source,
                    credentials: { placement: credentials.placement as "header" | "query", name: e.target.value },
                  })
                }
              />
            )}
            {(credentials.placement === "header" || credentials.placement === "query") &&
              secretField("api_key", "API key", "Vendor API key")}
            {credentials.placement === "bearer" && secretField("token", "Bearer token", "Vendor access token")}
            {credentials.placement === "basic" && (
              <>
                {secretField("username", "Username", "Vendor username", "text")}
                {secretField("password", "Password", "Vendor password")}
              </>
            )}
            <TextareaField
              label="Custom CA certificate"
              optional
              rows={3}
              value={secrets?.ca_certificate ?? ""}
              disabled={disabled}
              placeholder={
                saved("ca_certificate")
                  ? "Saved · enter to replace"
                  : "PEM certificate for a private CA. Leave blank to keep the saved value."
              }
              onChange={(e) => onSecretsChange({ ...secrets, ca_certificate: e.target.value })}
            />
          </FieldGroup>
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Schedule and paging</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NumberField
              label="Interval (minutes)"
              value={Math.round(source.interval_seconds / 60)}
              min={1}
              max={1440}
              disabled={disabled}
              help="Between 1 minute and 24 hours. Runs never overlap."
              error={server("interval_seconds")}
              onChange={(minutes) => onChange({ ...source, interval_seconds: (minutes ?? 0) * 60 })}
            />
            <SelectField
              label="Time format"
              value={source.time_format}
              disabled={disabled}
              help="How {now}, window bounds and generated cursors are written."
              options={[
                { value: "iso", label: "ISO 8601" },
                { value: "epoch_s", label: "Epoch seconds" },
                { value: "epoch_ms", label: "Epoch milliseconds" },
              ]}
              onChange={(value) =>
                onChange({ ...source, time_format: value as PollSourceSettings["time_format"] })
              }
            />
            <NumberField
              label="Initial look-back (minutes)"
              value={Math.round(source.initial_lookback_seconds / 60)}
              min={1}
              max={43200}
              disabled={disabled}
              help="Where Fetch now starts before there is a cursor; at most 30 days."
              error={server("initial_lookback_seconds")}
              onChange={(minutes) =>
                onChange({ ...source, initial_lookback_seconds: (minutes ?? 0) * 60 })
              }
            />
            <NumberField
              label="Page size"
              optional
              value={source.page.size ?? null}
              min={1}
              max={5000}
              disabled={disabled}
              help="Records per page, sent as the parameter below."
              error={server("page.size")}
              onChange={(size) => onChange({ ...source, page: { ...source.page, size } })}
            />
            <TextField
              label="Page size parameter"
              optional
              value={source.page.size_param ?? ""}
              placeholder="limit"
              disabled={disabled || !source.page.size}
              maxLength={128}
              error={server("page.size_param")}
              onChange={(e) =>
                onChange({ ...source, page: { ...source.page, size_param: e.target.value } })
              }
            />
            <SelectField
              label="More pages when"
              value={source.page.more}
              disabled={disabled}
              error={server("page.more") ?? issues.more}
              options={[
                { value: "full_page", label: "A page comes back full" },
                { value: "token", label: "A next-page token is returned" },
                { value: "none", label: "Never: one page per run" },
              ]}
              onChange={(more) =>
                onChange({
                  ...source,
                  page: { ...source.page, more: more as PollSourceSettings["page"]["more"] },
                })
              }
            />
            <NumberField
              label="Pages per run"
              value={source.page.max_pages}
              min={1}
              max={100}
              disabled={disabled}
              help="A run that reaches the limit is followed by the next one after a short pause."
              error={server("page.max_pages")}
              onChange={(max) =>
                onChange({ ...source, page: { ...source.page, max_pages: max ?? 0 } })
              }
            />
          </FieldGroup>
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Records and cursor</PanelTitle>
          <PanelDescription>
            Each record becomes one decoder input; the cursor says where the next run resumes.
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TextField
              label="Records location"
              optional
              className="font-mono"
              value={source.records}
              placeholder="/data"
              disabled={disabled}
              help="A JSON Pointer to the records array. Leave empty when the response is the array."
              error={server("records")}
              onChange={(e) => onChange({ ...source, records: e.target.value })}
            />
            <SelectField
              label="Cursor"
              value={source.cursor.kind}
              disabled={disabled}
              options={[
                { value: "timestamp", label: "Timestamp from the response" },
                { value: "token", label: "Next-page token from the response" },
                { value: "window", label: "Time window" },
              ]}
              onChange={(kind) =>
                onChange({
                  ...source,
                  cursor:
                    kind === "window"
                      ? { kind: "window", lag_seconds: 0 }
                      : {
                          kind: kind as "timestamp" | "token",
                          pointer: "pointer" in source.cursor ? source.cursor.pointer : "",
                        },
                })
              }
            />
            {source.cursor.kind === "window" ? (
              <NumberField
                label="Lag (seconds)"
                optional
                value={source.cursor.lag_seconds ?? 0}
                min={0}
                max={3600}
                disabled={disabled}
                help="Each window ends this long before now, for APIs that publish late. Up to 1 hour."
                error={server("cursor.lag_seconds")}
                onChange={(lag) =>
                  onChange({ ...source, cursor: { kind: "window", lag_seconds: lag ?? 0 } })
                }
              />
            ) : (
              <TextField
                label={source.cursor.kind === "token" ? "Next-page token location" : "Cursor location"}
                className="font-mono"
                value={source.cursor.pointer}
                placeholder={source.cursor.kind === "token" ? "/next" : "/maxDate"}
                disabled={disabled}
                help="A JSON Pointer into the response. The next run sends it as {cursor}."
                error={server("cursor.pointer")}
                onChange={(e) =>
                  onChange({
                    ...source,
                    cursor: { kind: source.cursor.kind as "timestamp" | "token", pointer: e.target.value },
                  })
                }
              />
            )}
          </FieldGroup>
        </PanelContent>
      </Panel>

    </div>
  );
}

function ParamRows({
  id,
  field,
  title,
  noun,
  rows,
  disabled,
  error,
  help,
  onChange,
  onValueEvent,
}: {
  id: string;
  field: "query" | "headers";
  title: string;
  noun: string;
  rows: PollParam[];
  disabled: boolean;
  error?: string;
  help?: string;
  onChange: (rows: PollParam[]) => void;
  onValueEvent: (
    field: "query" | "headers",
    index: number,
  ) => (event: { currentTarget: HTMLInputElement }) => void;
}) {
  const set = (index: number, patch: Partial<PollParam>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel id={`${id}-${field}-title`}>{title}</FieldLabel>
      <div role="group" aria-labelledby={`${id}-${field}-title`} className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
            <Input
              aria-label={`${title}: name ${index + 1}`}
              value={row.name}
              disabled={disabled}
              maxLength={128}
              placeholder="name"
              onChange={(e) => set(index, { name: e.target.value })}
            />
            <Input
              id={`${id}-${field}-value-${index}`}
              aria-label={`${title}: value ${index + 1}`}
              className="font-mono"
              value={row.value}
              disabled={disabled}
              maxLength={1000}
              placeholder="value or {cursor}"
              onChange={(e) => {
                set(index, { value: e.target.value });
                onValueEvent(field, index)(e);
              }}
              onFocus={onValueEvent(field, index)}
              onSelect={onValueEvent(field, index)}
              onKeyUp={onValueEvent(field, index)}
              onClick={onValueEvent(field, index)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={`Remove ${noun} ${index + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || rows.length >= MAX_ROWS}
            onClick={() => onChange([...rows, { name: "", value: "" }])}
          >
            <PlusIcon data-icon="inline-start" />
            Add {noun}
          </Button>
        </div>
      </div>
      <FieldDescription>
        {help ? `${help} ` : ""}
        {rows.length >= MAX_ROWS ? `At most ${MAX_ROWS}.` : `Up to ${MAX_ROWS}.`}
      </FieldDescription>
      {error && <p className="text-meta text-destructive">{error}</p>}
    </Field>
  );
}

/** A number input that lets the person clear it while typing. */
function NumberField({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof TextField>, "value" | "onChange" | "type"> & {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if ((text === "" ? null : Number(text)) !== value) setText(value == null ? "" : String(value));
    // Only an outside change (a reload, a reset) rewrites the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextField
      {...props}
      type="number"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = e.target.value === "" ? null : Number(e.target.value);
        onChange(next === null || Number.isFinite(next) ? next : null);
      }}
    />
  );
}

type RecordRow = { index: number; record: unknown };

/** One request with the saved draft: nothing is published and the cursor does not move (FR-039). */
export function FetchNow({
  org,
  adapter,
  dirty,
  canConnect,
  onAddFixture,
}: {
  org: string;
  adapter?: DeviceAdapter;
  dirty: boolean;
  canConnect: boolean;
  onAddFixture: (fixture: AdapterFixture) => void;
}) {
  const [result, setResult] = useState<{ data: FetchResult; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const saved = adapter?.source.type === "poll";
  const hint = !adapter
    ? "Save the adapter first. Fetch now uses the saved draft and credentials."
    : !saved
      ? "Save the polling settings first. Fetch now uses the saved draft and credentials."
      : dirty
        ? "Save the draft first. Fetch now uses the saved settings and credentials, not unsaved edits."
        : !canConnect
          ? "Fetch now needs the connection management permission."
          : "Runs one request with the saved draft. Nothing is published and the cursor does not move.";
  async function run() {
    if (!adapter) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.fetchNow(org, adapter.uuid, adapter.draft_revision);
      setResult({ data, at: new Date().toISOString() });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  const limited = error instanceof ApiError && error.status === 429;
  const data = result?.data;
  const keys = useMemo(() => {
    const first = data?.records[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) return [];
    return Object.entries(first as Record<string, unknown>)
      .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
      .map(([key]) => key)
      .slice(0, 4);
  }, [data]);
  const columns = useMemo<DataColumn<RecordRow>[]>(
    () => [
      {
        id: "index",
        header: "#",
        mobile: "title",
        value: (r) => r.index + 1,
        cell: (r) => <span className="tabular-nums">Record {r.index + 1}</span>,
      },
      ...keys.map<DataColumn<RecordRow>>((key) => ({
        id: `key-${key}`,
        header: key,
        value: (r) => String((r.record as Record<string, unknown>)?.[key] ?? ""),
        cell: (r) => (
          <span className="break-all">
            {String((r.record as Record<string, unknown>)?.[key] ?? "—")}
          </span>
        ),
      })),
      {
        id: "json",
        header: "JSON",
        mobile: "hidden",
        value: (r) => JSON.stringify(r.record),
        cell: (r) => (
          <code className="line-clamp-2 max-w-md break-all whitespace-normal text-code text-muted-foreground">
            {JSON.stringify(r.record)}
          </code>
        ),
      },
      {
        id: "add",
        header: "Add as fixture",
        headerHidden: true,
        hideable: false,
        align: "end",
        cell: (r) => (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Add record ${r.index + 1} as fixture`}
            onClick={() =>
              onAddFixture(
                pollFixture(
                  r.record,
                  r.index,
                  data?.record_count ?? 0,
                  result?.at ?? new Date().toISOString(),
                  adapter?.polling?.cursor?.value,
                ),
              )
            }
          >
            <PlusIcon data-icon="inline-start" />
            Add as fixture
          </Button>
        ),
      },
    ],
    [adapter?.polling?.cursor?.value, data, keys, onAddFixture, result?.at],
  );
  const { excerpt, json } = useMemo(() => {
    const text = data?.excerpt ?? "";
    try {
      return { excerpt: JSON.stringify(JSON.parse(text), null, 2), json: true };
    } catch {
      // A truncated or non-JSON excerpt is shown as received.
      return { excerpt: text, json: false };
    }
  }, [data]);
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Fetch now</PanelTitle>
          <PanelDescription>{hint}</PanelDescription>
          <PanelActions>
            <Button
              size="sm"
              disabled={!saved || dirty || !canConnect || busy}
              onClick={() => void run()}
            >
              <PlayIcon data-icon="inline-start" />
              {busy ? "Fetching…" : "Fetch now"}
            </Button>
          </PanelActions>
        </PanelHeader>
        {(error || data) && (
          <PanelContent className="flex flex-col gap-4">
            {limited ? (
              <Alert>
                <AlertTitle>Fetch now limit reached</AlertTitle>
                <AlertDescription>
                  Fetch now runs at most 6 times a minute per adapter, shared with
                  the onboarding assistant. Try again in a minute.
                </AlertDescription>
              </Alert>
            ) : (
              <RequestError error={error} />
            )}
            {data && (
              <>
                {data.error && (
                  <Alert variant="destructive">
                    <AlertTitle>The vendor API did not return records</AlertTitle>
                    <AlertDescription>{data.error}</AlertDescription>
                  </Alert>
                )}
                <PropertyList
                  items={[
                    {
                      label: "HTTP status",
                      value:
                        data.status == null ? (
                          <span className="text-muted-foreground">No answer</span>
                        ) : (
                          <span className="tabular-nums">{data.status}</span>
                        ),
                    },
                    {
                      label: "Duration",
                      value: data.duration_ms == null ? "—" : `${data.duration_ms.toLocaleString()} ms`,
                    },
                    {
                      label: "Records",
                      value:
                        data.record_count > data.records.length
                          ? `${data.record_count.toLocaleString()} (showing the first ${data.records.length})`
                          : data.record_count.toLocaleString(),
                    },
                    { label: "More pages", value: data.more ? "Yes" : "No" },
                    {
                      label: "Next cursor",
                      value: data.next_cursor ? (
                        <code className="break-all text-code">{data.next_cursor}</code>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      ),
                    },
                  ]}
                />
                {Object.keys(data.headers ?? {}).length > 0 && (
                  <details className="text-meta">
                    <summary className="cursor-pointer text-muted-foreground">
                      Response headers
                    </summary>
                    <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
                      {Object.entries(data.headers).map(([name, value]) => (
                        <div key={name} className="col-span-2 grid grid-cols-subgrid">
                          <dt className="font-mono text-muted-foreground">{name}</dt>
                          <dd className="min-w-0 font-mono break-all">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </>
            )}
          </PanelContent>
        )}
      </Panel>
      {data && data.records.length > 0 && (
        <DataTable
          id="adapter-fetch-records"
          label="Fetched records"
          noun={["record", "records"]}
          rows={data.records.map((record, index) => ({ index, record }))}
          rowKey={(r) => String(r.index)}
          rowLabel={(r) => `Record ${r.index + 1}`}
          columns={columns}
        />
      )}
      {data && (
        <JsonEditor
          label={data.truncated ? "Response excerpt · truncated" : "Response excerpt"}
          language={json ? "json" : "javascript"}
          value={excerpt}
          readOnly
        />
      )}
    </div>
  );
}

/** Where a polling cursor starts: a local date and time within the last 30 days. */
export function CursorStartField({
  value,
  onChange,
  disabled,
  label = "Start reading from",
  help = "Records observed after this time are read. Up to 30 days back.",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  help?: string;
}) {
  const now = Date.now();
  return (
    <TextField
      label={label}
      type="datetime-local"
      value={value}
      min={localInput(now - 30 * DAY)}
      max={localInput(now)}
      disabled={disabled}
      help={help}
      error={cursorStartError(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function cursorStartError(value: string) {
  const at = Date.parse(value);
  if (!value || Number.isNaN(at)) return "Choose a date and time.";
  if (at < Date.now() - 30 * DAY) return "Choose a time within the last 30 days.";
  if (at > Date.now() + 60_000) return "Choose a time in the past.";
  return undefined;
}
