import type { ChecklistItem, ChecklistStep } from "@iot-os/api-client";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { Button } from "@iot-os/ui/components/button";
import { Status } from "@iot-os/ui/components/status-mark";
import { statusOf } from "@iot-os/ui/lib/status";
import { cn } from "@iot-os/ui/lib/utils";
import { checklistSteps } from "./source";

type StepState = ChecklistItem["state"];

/**
 * Setup in four steps, each one tab of the workbench. A step covers the checklist items
 * its tab completes, so the six saved states (FR-100) still drive what the steps show.
 */
export const setupSteps: readonly { tab: string; label: string; items: readonly ChecklistStep[] }[] = [
  { tab: "source", label: "Source", items: ["type", "connect"] },
  { tab: "decoder", label: "Decode", items: ["samples", "decoder"] },
  { tab: "deploy", label: "Deploy", items: ["deploy"] },
  { tab: "devices", label: "Devices", items: ["activate"] },
];

/** Done when every item is; otherwise the state of the first item that is not. */
export function stepState(checklist: ChecklistItem[], items: readonly ChecklistStep[]): StepState {
  const own = checklist.filter((item) => items.includes(item.step));
  if (!own.length) return "todo";
  return own.find((item) => item.state !== "done")?.state ?? "done";
}

const ring: Record<StepState, string> = {
  done: "border-success text-success",
  waiting: "border-info text-info",
  attention: "border-warning text-warning",
  todo: "border-input text-muted-foreground",
};

/** The number in a step's tab, a check once the step is done. With `state`, it also says the state to screen readers. */
export function StepMark({ number, state }: { number: number; state?: StepState }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-state={state}
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border text-micro font-medium tabular-nums",
          ring[state ?? "todo"],
        )}
      >
        {state === "done" ? <CheckIcon className="size-3" /> : number}
      </span>
      {state && <span className="sr-only">{statusOf(state, "checklist").label}:</span>}
    </>
  );
}

/**
 * One line under the step tabs: what to do next, its state and why, and the way to the
 * onboarding assistant, which walks the same steps (`onAsk`).
 */
export function SetupNext({
  checklist,
  onOpen,
  onAsk,
}: {
  checklist: ChecklistItem[];
  onOpen: (tab: string) => void;
  onAsk?: () => void;
}) {
  const next = checklist.find((item) => item.state !== "done");
  if (!next && !onAsk) return null;
  const step = next && checklistSteps[next.step];
  return (
    <div data-slot="setup-next" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {next && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body text-muted-foreground">
          Next:
          <Button
            variant="link"
            size="sm"
            className="link-target h-auto p-0"
            onClick={() => onOpen(step?.tab ?? "source")}
          >
            {step?.label ?? next.step}
          </Button>
          <Status value={next.state} domain="checklist" />
          {next.detail && <span>{next.detail}</span>}
        </p>
      )}
      {onAsk && (
        <Button variant="outline" size="sm" className="ml-auto" onClick={onAsk}>
          <SparklesIcon data-icon="inline-start" />
          Ask the assistant
        </Button>
      )}
    </div>
  );
}
