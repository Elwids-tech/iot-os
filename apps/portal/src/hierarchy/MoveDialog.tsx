import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import type { Entity } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { EntityPicker } from "./EntityPicker"
import { impactLines } from "./model"

/** Moves an entity and its branch: choose where, read the impact, then confirm. */
export function MoveDialog({
  org,
  entity,
  onClose,
  onMoved,
}: {
  org: string
  entity: Entity
  onClose: () => void
  onMoved: (entity: Entity) => void
}) {
  // Undefined until a place is chosen; null is the top level.
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  const [targetLabel, setTargetLabel] = useState<string>()
  const impact = useQuery({
    queryKey: ["entity", org, entity.uuid, "move-impact", target],
    queryFn: () => api.entityMoveImpact(org, entity.uuid, target ?? null),
    enabled: target !== undefined,
  })
  const move = useMutation({
    mutationFn: () => api.moveEntity(org, entity.uuid, target ?? null),
    onSuccess: (moved) => {
      onMoved(moved)
      onClose()
    },
  })
  const own = `${entity.path}/`.toLowerCase()
  const unchanged = target !== undefined && (target ?? null) === entity.parent_uuid
  return (
    <Dialog open onOpenChange={(open) => !open && !move.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {entity.name}</DialogTitle>
          <DialogDescription>
            Everything below it moves too. Devices keep their data; only their paths change.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <EntityPicker
            org={org}
            label="Move under"
            value={target ?? ""}
            selectedLabel={target ? targetLabel : undefined}
            none="The top level"
            placeholder="Choose where it goes"
            accept={(candidate) => candidate.uuid !== entity.uuid && !`${candidate.path}/`.toLowerCase().startsWith(own)}
            onChange={(uuid, chosen) => {
              setTarget(uuid || null)
              setTargetLabel(chosen ? chosen.path : undefined)
              move.reset()
            }}
            help="Search by name or path. Only places the type rules allow will accept it."
          />
          {target !== undefined && (
            <section aria-label="What changes" className="rounded-lg bg-sunken p-3 text-body">
              {unchanged ? (
                <p className="text-muted-foreground">{entity.name} is already there.</p>
              ) : impact.isLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : impact.error ? (
                <RequestError error={impact.error} />
              ) : impact.data ? (
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {impactLines(impact.data, entity.name).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}
          <RequestError error={move.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={target === undefined || unchanged || !impact.data || move.isPending}
            onClick={() => move.mutate()}
          >
            {move.isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
