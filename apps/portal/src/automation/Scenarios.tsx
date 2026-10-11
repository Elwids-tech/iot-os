import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workflow } from "@iot-os/workflow-editor";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import { Button } from "@iot-os/ui/components/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group";
import { Input } from "@iot-os/ui/components/input";
import { Badge } from "@iot-os/ui/components/badge";
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from "@iot-os/ui/components/field";
import { SelectField, TextField } from "@iot-os/ui/components/form-fields";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";

type Reading = {
  binding: string;
  value: unknown;
  quality: "good" | "bad";
  age_seconds: number;
};
type Step = {
  label: string;
  at_seconds: number;
  device_uuid: string | null;
  readings: Reading[];
  expected_actions: Record<string, number>;
  expected_outputs: {
    node_id: string;
    port: string;
    known: boolean;
    value: unknown;
  }[];
};
type Scenario = {
  uuid?: string;
  name: string;
  revision: number;
  draft_revision: number;
  definition: { steps: Step[] };
};
type Check = {
  step: number;
  node_id: string | null;
  label: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
};
type Run = {
  uuid: string;
  scenario_revision: number;
  draft_revision: number;
  created_at: string;
  scenario: Scenario["definition"];
  result: {
    passed: boolean;
    checks: Check[];
    steps: {
      trace: {
        node_id: string;
        status: string;
        reason: string;
        inputs: unknown;
        outputs: unknown;
      }[];
      intents: unknown[];
    }[];
  };
};
const blankStep = (seconds: number): Step => ({
  label: seconds ? "Next step" : "Initial state",
  at_seconds: seconds,
  device_uuid: null,
  readings: [],
  expected_actions: {},
  expected_outputs: [],
});
const display = (value: unknown) => JSON.stringify(value);

export function Scenarios({
  org,
  workflowId,
  graph,
  revision,
  workflowDirty,
}: {
  org: string;
  workflowId: string;
  graph: Workflow;
  revision: number;
  workflowDirty: boolean;
}) {
  const qc = useQueryClient();
  const base = `/${workflowId}/scenarios`;
  const key = ["automation-scenarios", org, workflowId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.automation<{ data: Scenario[] }>(org, base),
  });
  const [draft, setDraft] = useState<Scenario>();
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<Run>();
  const [evidence, setEvidence] = useState<string>("");
  const dirty = !!draft && JSON.stringify(draft) !== original;
  useUnsavedContribution(dirty);
  const history = useQuery({
    queryKey: [...key, draft?.uuid, "runs"],
    enabled: !!draft?.uuid,
    queryFn: () =>
      api.automation<{ data: Run[] }>(org, `${base}/${draft!.uuid}/runs`),
  });
  const sources = graph.bindings.filter((b) =>
    graph.nodes.some(
      (n) => n.type === "source.parameter.v1" && n.config.binding === b.role,
    ),
  );
  const devices = [...new Set(sources.map((b) => b.device_uuid))];
  const actions = graph.nodes.filter((n) => n.type.startsWith("action."));
  function open(s: Scenario) {
    setDraft(structuredClone(s));
    setOriginal(JSON.stringify(s));
    setRun(undefined);
    setError("");
  }
  function updateStep(index: number, step: Step) {
    setDraft(
      (d) =>
        d && {
          ...d,
          definition: {
            steps: d.definition.steps.map((s, i) => (i === index ? step : s)),
          },
        },
    );
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    const response = await api.automation<{ data: Scenario }>(
      org,
      `${base}${draft.uuid ? `/${draft.uuid}` : ""}`,
      draft.uuid ? "PUT" : "POST",
      { ...draft, draft_revision: revision },
    );
    open(response.data);
    await qc.invalidateQueries({ queryKey: key });
  }
  async function execute() {
    const response = await api.automation<{ data: Run }>(
      org,
      `${base}/${draft!.uuid}/runs`,
      "POST",
      { revision: draft!.revision, draft_revision: revision },
    );
    setRun(response.data);
    setEvidence("");
    await history.refetch();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved test scenarios</CardTitle>
        <CardDescription>
          Replay timed readings and check expected outcomes. Simulations never
          send live commands. The latest 20 runs per scenario are retained.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(error || list.error || history.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {error || String(list.error || history.error)}
            </AlertDescription>
          </Alert>
        )}
        {workflowDirty && (
          <Alert>
            <AlertDescription>
              Save the workflow before saving or running scenarios.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <SelectField
              label="Saved scenario"
              value={draft?.uuid ?? ""}
              disabled={dirty || busy}
              options={(list.data?.data ?? []).map((s) => ({
                value: s.uuid!,
                label: s.name,
              }))}
              onChange={(value) => {
                const s = list.data?.data.find((s) => s.uuid === value);
                if (s) open(s);
              }}
              placeholder="Select a scenario"
            />
          </div>
          <Button
            variant="outline"
            disabled={dirty || busy}
            onClick={() => {
              const s: Scenario = {
                name: "New scenario",
                revision: 0,
                draft_revision: revision,
                definition: { steps: [blankStep(0)] },
              };
              setDraft(s);
              setOriginal("");
              setRun(undefined);
            }}
          >
            New scenario
          </Button>
        </div>
        {draft && (
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            {draft.draft_revision !== revision && (
              <Alert>
                <AlertDescription>
                  This scenario was authored for workflow revision{" "}
                  {draft.draft_revision}. Review its bindings and expectations
                  before testing revision {revision}.
                </AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="scenario-name">Scenario name</FieldLabel>
                <Input
                  id="scenario-name"
                  value={draft.name}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
            </FieldGroup>
            <Accordion type="multiple" defaultValue={["step-0"]}>
              {draft.definition.steps.map((step, index) => (
                <AccordionItem key={index} value={`step-${index}`}>
                  <AccordionTrigger>
                    Step {index + 1}: {step.label} · +{step.at_seconds}s
                  </AccordionTrigger>
                  <AccordionContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel>Step label</FieldLabel>
                        <Input
                          aria-label={`Step ${index + 1} label`}
                          value={step.label}
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              label: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Seconds from start</FieldLabel>
                        <Input
                          aria-label={`Step ${index + 1} seconds`}
                          type="number"
                          min={0}
                          max={604800}
                          disabled={index === 0}
                          value={step.at_seconds}
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              at_seconds: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <SelectField
                        label={`Step ${index + 1} input`}
                        value={step.device_uuid ?? "clock"}
                        options={[
                          { value: "clock", label: "Advance clock only" },
                          ...devices.map((id) => ({
                            value: id,
                            label: sources
                              .filter((b) => b.device_uuid === id)
                              .map((b) => b.role)
                              .join(", "),
                          })),
                        ]}
                        help="Readings from the selected device arrive together. Omitted readings retain earlier evidence until it expires."
                        onChange={(value) =>
                          updateStep(index, {
                            ...step,
                            device_uuid: value === "clock" ? null : value,
                            readings: [],
                          })
                        }
                      />
                      {sources
                        .filter((b) => b.device_uuid === step.device_uuid)
                        .map((b) => {
                          const r = step.readings.find(
                            (r) => r.binding === b.role,
                          );
                          const replace = (next: Reading | undefined) =>
                            updateStep(index, {
                              ...step,
                              readings: [
                                ...step.readings.filter(
                                  (r) => r.binding !== b.role,
                                ),
                                ...(next ? [next] : []),
                              ],
                            });
                          return (
                            <Field key={b.role}>
                              <FieldLabel>
                                {b.role} ({b.data_type})
                              </FieldLabel>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    replace(
                                      r
                                        ? undefined
                                        : {
                                            binding: b.role,
                                            value:
                                              b.data_type === "boolean"
                                                ? false
                                                : b.data_type === "number"
                                                  ? 0
                                                  : "",
                                            quality: "good",
                                            age_seconds: 0,
                                          },
                                    )
                                  }
                                >
                                  {r ? "Omit reading" : "Include reading"}
                                </Button>
                                {r && (
                                  <>
                                    <ScalarInput
                                      label={`${b.role} value`}
                                      value={r.value}
                                      onChange={(value) =>
                                        replace({ ...r, value })
                                      }
                                    />
                                    <ToggleGroup
                                      type="single"
                                      value={r.quality}
                                      onValueChange={(value) => {
                                        if (value)
                                          replace({
                                            ...r,
                                            quality: value as "good" | "bad",
                                          });
                                      }}
                                    >
                                      <ToggleGroupItem value="good">
                                        Good quality
                                      </ToggleGroupItem>
                                      <ToggleGroupItem value="bad">
                                        Bad quality
                                      </ToggleGroupItem>
                                    </ToggleGroup>
                                    <Input
                                      aria-label={`${b.role} age in seconds`}
                                      type="number"
                                      min={0}
                                      value={r.age_seconds}
                                      onChange={(e) =>
                                        replace({
                                          ...r,
                                          age_seconds: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </>
                                )}
                              </div>
                              {r && (
                                <FieldDescription>
                                  Value uses JSON: 0, false, null, or a quoted
                                  string. Age is seconds before this step.
                                </FieldDescription>
                              )}
                            </Field>
                          );
                        })}
                      {actions.map((n) => (
                        <Field key={n.id}>
                          <FieldLabel>Expected requests: {n.id}</FieldLabel>
                          <Input
                            aria-label={`Expected requests ${n.id} step ${index + 1}`}
                            type="number"
                            min={0}
                            max={100}
                            value={step.expected_actions[n.id] ?? 0}
                            onChange={(e) =>
                              updateStep(index, {
                                ...step,
                                expected_actions: {
                                  ...step.expected_actions,
                                  [n.id]: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </Field>
                      ))}
                      <FieldDescription>
                        Every action defaults to zero expected requests. Set
                        Device State emits one request per setting.
                      </FieldDescription>
                      {step.expected_outputs.map((c, j) => (
                        <Field key={j}>
                          <FieldLabel>Output check {j + 1}</FieldLabel>
                          <SelectField
                            label="Output node"
                            value={c.node_id}
                            options={graph.nodes.map((n) => ({
                              value: n.id,
                              label: n.id,
                            }))}
                            onChange={(node_id) =>
                              updateStep(index, {
                                ...step,
                                expected_outputs: step.expected_outputs.map(
                                  (x, k) => (k === j ? { ...c, node_id } : x),
                                ),
                              })
                            }
                          />
                          <Input
                            aria-label="Output port"
                            value={c.port}
                            onChange={(e) =>
                              updateStep(index, {
                                ...step,
                                expected_outputs: step.expected_outputs.map(
                                  (x, k) =>
                                    k === j
                                      ? { ...c, port: e.target.value }
                                      : x,
                                ),
                              })
                            }
                          />
                          <ToggleGroup
                            type="single"
                            value={c.known ? "known" : "unknown"}
                            onValueChange={(value) => {
                              if (value)
                                updateStep(index, {
                                  ...step,
                                  expected_outputs: step.expected_outputs.map(
                                    (x, k) =>
                                      k === j
                                        ? { ...c, known: value === "known" }
                                        : x,
                                  ),
                                });
                            }}
                          >
                            <ToggleGroupItem value="known">
                              Known value
                            </ToggleGroupItem>
                            <ToggleGroupItem value="unknown">
                              Unknown
                            </ToggleGroupItem>
                          </ToggleGroup>
                          {c.known && (
                            <ScalarInput
                              label="Expected output value"
                              value={c.value}
                              onChange={(value) =>
                                updateStep(index, {
                                  ...step,
                                  expected_outputs: step.expected_outputs.map(
                                    (x, k) => (k === j ? { ...c, value } : x),
                                  ),
                                })
                              }
                            />
                          )}
                          <Button
                            variant="outline"
                            onClick={() =>
                              updateStep(index, {
                                ...step,
                                expected_outputs: step.expected_outputs.filter(
                                  (_, k) => k !== j,
                                ),
                              })
                            }
                          >
                            Remove output check
                          </Button>
                        </Field>
                      ))}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            updateStep(index, {
                              ...step,
                              expected_outputs: [
                                ...step.expected_outputs,
                                {
                                  node_id: graph.nodes[0]?.id ?? "",
                                  port: "out",
                                  known: false,
                                  value: null,
                                },
                              ],
                            })
                          }
                        >
                          Add output check
                        </Button>
                        <Button
                          variant="outline"
                          disabled={index === 0}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              definition: {
                                steps: draft.definition.steps.filter(
                                  (_, i) => i !== index,
                                ),
                              },
                            })
                          }
                        >
                          Remove step
                        </Button>
                      </div>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || draft.definition.steps.length >= 100}
                onClick={() =>
                  setDraft({
                    ...draft,
                    definition: {
                      steps: [
                        ...draft.definition.steps,
                        blankStep(
                          draft.definition.steps.at(-1)!.at_seconds + 10,
                        ),
                      ],
                    },
                  })
                }
              >
                Add step
              </Button>
              <Button
                disabled={busy || workflowDirty || !dirty}
                onClick={() => void perform(save)}
              >
                Save scenario
              </Button>
              <Button
                disabled={busy || workflowDirty || dirty || !draft.uuid}
                onClick={() => void perform(execute)}
              >
                {busy ? "Working…" : `Test workflow revision ${revision}`}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !dirty}
                onClick={() => {
                  if (original) open(JSON.parse(original));
                  else {
                    setDraft(undefined);
                    setOriginal("");
                  }
                }}
              >
                Discard scenario edits
              </Button>
            </div>
            {!!history.data?.data.length && (
              <SelectField
                label="Run history"
                value={run?.uuid ?? ""}
                options={history.data.data.map((r) => ({
                  value: r.uuid,
                  label: `${r.result.passed ? "Passed" : "Failed"} · workflow ${r.draft_revision} / scenario ${r.scenario_revision} · ${new Date(r.created_at).toLocaleString()}`,
                }))}
                onChange={(value) => {
                  setRun(history.data?.data.find((r) => r.uuid === value));
                  setEvidence("");
                }}
              />
            )}
          </fieldset>
        )}
        {run && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Badge variant={run.result.passed ? "secondary" : "destructive"}>
                {run.result.passed ? "Passed" : "Failed"}
              </Badge>
              <Badge variant="outline">
                Workflow {run.draft_revision} · Scenario {run.scenario_revision}
              </Badge>
            </div>
            {(workflowDirty ||
              dirty ||
              run.draft_revision !== revision ||
              run.scenario_revision !== draft?.revision) && (
              <Alert>
                <AlertDescription>
                  This result does not verify the current edits. Save and run
                  again.
                </AlertDescription>
              </Alert>
            )}
            {run.result.checks
              .filter((c) => !c.passed)
              .map((c, i) => (
                <Button
                  className="justify-start whitespace-normal"
                  variant="outline"
                  key={i}
                  onClick={() => {
                    setEvidence(`evidence-${c.step}`);
                    setTimeout(() => {
                      const target = document.getElementById(
                        c.node_id
                          ? `scenario-node-${run.uuid}-${c.step}-${c.node_id}`
                          : `scenario-evidence-${run.uuid}-${c.step}`,
                      );
                      target?.focus({ preventScroll: true });
                      target?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                    }, 200);
                  }}
                >
                  Step {c.step + 1} · {c.node_id ?? "Evidence"} · {c.label}:
                  expected {display(c.expected)}, received {display(c.actual)} —
                  View evidence
                </Button>
              ))}
            <Accordion
              type="single"
              collapsible
              value={evidence}
              onValueChange={setEvidence}
            >
              {run.scenario.steps.map((s, i) => (
                <AccordionItem
                  value={`evidence-${i}`}
                  key={i}
                  id={`scenario-evidence-${run.uuid}-${i}`}
                >
                  <AccordionTrigger>
                    Step {i + 1}: {s.label} · +{s.at_seconds}s
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-3">
                      {run.result.checks
                        .filter((c) => c.step === i)
                        .map((c, j) => (
                          <p key={j}>
                            {c.passed ? "Pass" : "Fail"} · {c.node_id} {c.label}{" "}
                            · Expected {display(c.expected)} · Actual{" "}
                            {display(c.actual)}
                          </p>
                        ))}
                      {run.result.steps[i]?.trace.map((t) => (
                        <div
                          key={t.node_id}
                          id={`scenario-node-${run.uuid}-${i}-${t.node_id}`}
                          tabIndex={-1}
                        >
                          <p>
                            {t.node_id} · {t.status} · {t.reason}
                          </p>
                          <details>
                            <summary>Input and output values</summary>
                            <pre className="max-h-64 overflow-auto text-xs">
                              {JSON.stringify(
                                { inputs: t.inputs, outputs: t.outputs },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScalarInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(value) ?? "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (value !== undefined) {
      setRaw(JSON.stringify(value));
      setInvalid(false);
    }
  }, [value]);
  return (
    <TextField
      label={label}
      value={raw}
      error={invalid ? "Enter a valid JSON value before saving." : undefined}
      onChange={(e) => {
        setRaw(e.target.value);
        try {
          const next = JSON.parse(e.target.value);
          if (next !== null && typeof next === "object") throw new Error();
          setInvalid(false);
          onChange(next);
        } catch {
          setInvalid(true);
          onChange(undefined);
        }
      }}
    />
  );
}
