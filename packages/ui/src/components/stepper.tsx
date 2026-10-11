import * as React from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@iot-os/ui/lib/utils"

/**
 * Progress through a fixed sequence of steps, for wizards. Completed steps
 * show a check, the current step is emphasised and announced with
 * aria-current, later steps are muted. Compact enough for a page header row.
 */
function Stepper({
  steps,
  current,
  className,
  onStep,
  ...props
}: React.ComponentProps<"ol"> & {
  steps: Array<{ label: string }>
  /** 1-based index of the current step. */
  current: number
  /** When set, completed steps become buttons that return to that step. */
  onStep?: (step: number) => void
}) {
  return (
    <ol
      data-slot="stepper"
      aria-label={`Step ${current} of ${steps.length}`}
      className={cn("flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-sm", className)}
      {...props}
    >
      {steps.map((step, index) => {
        const number = index + 1
        const state = number < current ? "done" : number === current ? "current" : "todo"
        const marker = (
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums",
              state === "done" && "border-primary bg-primary text-primary-foreground",
              state === "current" && "border-primary text-primary",
              state === "todo" && "border-border text-muted-foreground"
            )}
          >
            {state === "done" ? <CheckIcon className="size-3" /> : number}
          </span>
        )
        const content = (
          <>
            {marker}
            <span
              className={cn(
                "truncate",
                state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                state === "todo" && "max-md:sr-only"
              )}
            >
              <span className="sr-only">Step {number}: </span>
              {step.label}
            </span>
          </>
        )
        return (
          <li
            key={step.label}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-0 items-center gap-1.5"
          >
            {state === "done" && onStep ? (
              <button
                type="button"
                onClick={() => onStep(number)}
                className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {content}
              </button>
            ) : (
              content
            )}
            {number < steps.length && (
              <span aria-hidden="true" className="mx-1 h-px w-4 bg-border max-md:w-2" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }
