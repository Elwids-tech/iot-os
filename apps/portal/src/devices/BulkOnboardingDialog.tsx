import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type { BulkOnboardingRun, DiscoveryCandidate, Gateway } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextField } from "@iot-os/ui/components/form-fields"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { api } from "../lib/api"
import { RequestError, fieldError } from "../components/forms"
import { sourceProblems } from "./mapping"

/** Sources one run can onboard; the API refuses more (spec 026). */
export const BULK_LIMIT = 500
const PLACEHOLDERS = ["{device_id}", "{gateway}", "{n}"]

/** Sorted as the API numbers `{n}`: meter-2 before meter-10. */
const bySource = (a: DiscoveryCandidate, b: DiscoveryCandidate) =>
  a.source_device_id.localeCompare(b.source_device_id, undefined, { numeric: true })

/** A device name from the pattern, as the API builds it. */
export function deviceName(pattern: string, gateway: string, deviceId: string, n: number) {
  return pattern.replaceAll("{device_id}", deviceId).replaceAll("{gateway}", gateway).replaceAll("{n}", String(n)).trim()
}

function patternProblem(pattern: string) {
  if (!pattern.includes("{device_id}")) return "The name pattern must contain {device_id}."
  if ((pattern.match(/\{[^}]*\}/g) ?? []).some((token) => !PLACEHOLDERS.includes(token)))
    return "The name pattern can use only {device_id}, {gateway} and {n}."
  if (pattern.length > 120) return "The name pattern can be at most 120 characters."
  return undefined
}

/**
 * Onboards the selected sources of one gateway with one published profile: each becomes a
 * device named from the pattern, mapped by the profile and activated. Sources whose birth
 * lacks what the profile needs are flagged here and skipped by the run.
 */
export function BulkOnboardingDialog({
  org,
  gateway,
  sources,
  onClose,
  onStarted,
}: {
  org: string
  gateway: Gateway
  sources: DiscoveryCandidate[]
  onClose: () => void
  onStarted: (run: BulkOnboardingRun) => void
}) {
  const [profileSearch, setProfileSearch] = useState(""),
    [profilePage, setProfilePage] = useState(1),
    [profile, setProfile] = useState(""),
    [pattern, setPattern] = useState("{device_id}"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null)
  const profiles = useQuery({
    queryKey: ["bulk-onboarding-profiles", org, profileSearch, profilePage],
    queryFn: () => api.deviceProfiles(org, { search: profileSearch, page: profilePage, perPage: 25 }),
  })
  const detail = useQuery({
    queryKey: ["bulk-onboarding-profile", org, profile],
    queryFn: () => api.deviceProfile(org, profile),
    enabled: Boolean(profile),
  })
  const artifact = useQuery({
    queryKey: ["bulk-onboarding-artifact", org, profile, detail.data?.revision],
    queryFn: () => api.profileArtifact(org, profile, detail.data!.revision),
    enabled: Boolean(detail.data?.revision),
  })
  const sorted = useMemo(() => [...sources].sort(bySource), [sources])
  const mismatched = useMemo(
    () =>
      artifact.data
        ? sorted.flatMap((source) => {
            const problems = sourceProblems(artifact.data.definition.parameters, source.metrics)
            return problems.length ? [{ source, problems }] : []
          })
        : [],
    [artifact.data, sorted],
  )
  // One operation per request: a retried submit of the same choices returns the same run.
  const operation = useRef(crypto.randomUUID())
  useEffect(() => {
    operation.current = crypto.randomUUID()
  }, [artifact.data?.uuid, pattern, sorted])
  const problem = patternProblem(pattern)
  const over = sorted.length > BULK_LIMIT
  const submit = async () => {
    if (!artifact.data || problem || over) return
    setBusy(true)
    setError(null)
    try {
      onStarted(
        await api.createBulkOnboarding(org, gateway.uuid, {
          operation_uuid: operation.current,
          artifact_uuid: artifact.data.uuid,
          name_pattern: pattern,
          source_device_ids: sorted.map((s) => s.source_device_id),
        }),
      )
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }
  const count = sorted.length.toLocaleString()
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Onboard {count} sources</DialogTitle>
          <DialogDescription>
            From {gateway.name}. Each source becomes a device with the profile’s measurements and is
            activated. Devices are active once the runtime confirms them.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <SearchableSelect
            label="Device profile"
            value={profile}
            selectedLabel={detail.data?.name}
            options={(profiles.data?.data ?? []).filter((p) => p.revision > 0).map((p) => ({ value: p.uuid, label: p.name }))}
            search={profileSearch}
            onSearchChange={(value) => {
              setProfileSearch(value)
              setProfilePage(1)
            }}
            onChange={setProfile}
            loading={profiles.isFetching}
            page={profilePage}
            hasNextPage={Boolean(profiles.data && profiles.data.meta.current_page < profiles.data.meta.last_page)}
            onPageChange={setProfilePage}
            help={artifact.data ? `Version ${artifact.data.revision} is live.` : "Published profiles only."}
            emptyText="No published profiles found."
          />
          {!profile && (
            <Link
              to={`/organizations/${encodeURIComponent(org)}/device-profiles`}
              className="text-body text-primary underline-offset-4 hover:underline"
            >
              Create or publish a profile
            </Link>
          )}
          <TextField
            label="Device names"
            value={pattern}
            maxLength={120}
            onChange={(event) => setPattern(event.target.value)}
            error={problem ?? fieldError(error, "name_pattern")}
            help="Use {device_id}, and optionally {gateway} and {n} (the source’s place in the list)."
          />
          {!problem && (
            <div className="flex flex-col gap-1" aria-label="Name preview">
              <span className="text-meta text-muted-foreground">Preview</span>
              <ul className="flex flex-col gap-0.5 text-body">
                {sorted.slice(0, 3).map((source, index) => (
                  <li key={source.uuid}>{deviceName(pattern, gateway.name, source.source_device_id, index + 1)}</li>
                ))}
                {sorted.length > 3 && <li className="text-muted-foreground">and {(sorted.length - 3).toLocaleString()} more</li>}
              </ul>
            </div>
          )}
          {artifact.data && (
            <div role="status" aria-label="Match summary" className="flex flex-col gap-1">
              {mismatched.length === 0 ? (
                <StatusMark tone="good">Every selected source announces what this profile needs.</StatusMark>
              ) : (
                <>
                  <StatusMark tone="warning">
                    {mismatched.length.toLocaleString()} of {count} sources lack what this profile needs and will be skipped.
                  </StatusMark>
                  <ul className="flex flex-col gap-0.5 pl-3.5 text-meta text-muted-foreground">
                    {mismatched.slice(0, 5).map(({ source, problems }) => (
                      <li key={source.uuid}>
                        <span className="font-mono text-code text-foreground">{source.source_device_id}</span>: {problems.join(", ")}
                      </li>
                    ))}
                    {mismatched.length > 5 && <li>and {(mismatched.length - 5).toLocaleString()} more</li>}
                  </ul>
                </>
              )}
            </div>
          )}
          {over && (
            <StatusMark tone="warning">
              Onboard at most {BULK_LIMIT} sources at a time. Clear some of the selection, then onboard the rest in another run.
            </StatusMark>
          )}
          <RequestError error={profiles.error ?? detail.error ?? artifact.error ?? (fieldError(error, "name_pattern") ? null : error)} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!artifact.data || Boolean(problem) || over || busy} onClick={() => void submit()}>
            {busy ? "Starting…" : `Onboard ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
