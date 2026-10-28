import type { ChecklistItem } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { Status } from "@iot-os/ui/components/status-mark";
import { checklistSteps } from "./source";

/**
 * Where setup stands, from the adapter's saved state (FR-100): six steps, each
 * opening the tab that completes it. It needs no assistant.
 */
export function SetupChecklist({
  checklist,
  onOpen,
}: {
  checklist: ChecklistItem[];
  onOpen: (tab: string) => void;
}) {
  const done = checklist.filter((item) => item.state === "done").length;
  const next = checklist.find((item) => item.state !== "done");
  return (
    <Panel aria-labelledby="adapter-setup-title">
      <PanelHeader>
        <PanelTitle id="adapter-setup-title">Setup checklist</PanelTitle>
        <PanelDescription>
          {done === checklist.length
            ? "Every step is done."
            : `${done} of ${checklist.length} done${next ? ` · next: ${checklistSteps[next.step]?.label ?? next.step}` : ""}`}
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="p-2">
        <ol className="grid gap-1 sm:grid-cols-3 xl:grid-cols-6">
          {checklist.map((item, index) => {
            const step = checklistSteps[item.step];
            return (
              <li
                key={item.step}
                data-state={item.state}
                aria-current={item === next ? "step" : undefined}
                className="flex min-w-0 flex-col items-start gap-1 rounded-lg p-2 aria-[current=step]:bg-sunken"
              >
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-foreground"
                  onClick={() => onOpen(step?.tab ?? "type")}
                >
                  {index + 1} · {step?.label ?? item.step}
                </Button>
                <Status value={item.state} domain="checklist" className="text-meta" />
                {item.detail && (
                  <p className="line-clamp-2 text-meta text-muted-foreground">
                    {item.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </PanelContent>
    </Panel>
  );
}
