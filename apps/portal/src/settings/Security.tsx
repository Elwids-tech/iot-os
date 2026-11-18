import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { OrganizationSecurity } from "@iot-os/api-client"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { toast } from "sonner"
import { Confirm, LoadError, RequestError } from "../components/forms"
import { api } from "../lib/api"
import { useAdministration } from "../members/shared"

/**
 * The organization's sign-in security (spec 034, US3, FR-021): require two-step sign-in
 * for every member. Only someone with their own second step set up can change it.
 */
export function SecuritySettings() {
  const { org } = useAdministration()
  const cache = useQueryClient()
  const key = ["organization-security", org]
  const security = useQuery({ queryKey: key, queryFn: () => api.organizationSecurity(org) })
  const [confirming, setConfirming] = useState<boolean | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)

  async function save(required: boolean) {
    setSaving(true)
    setError(null)
    try {
      cache.setQueryData<OrganizationSecurity>(key, await api.setOrganizationTwoStep(org, required))
      // The member list's Two-step column and the organization context change with it.
      void cache.invalidateQueries({ queryKey: ["members", org] })
      void cache.invalidateQueries({ queryKey: ["session"] })
      toast.success(required ? "Two-step sign-in is required for every member" : "Two-step sign-in is no longer required")
    } catch (reason) {
      setError(reason)
    } finally {
      setSaving(false)
    }
  }

  const data = security.data
  const without = data?.members_without_two_step ?? 0
  return (
    <div className="flex max-w-form flex-col gap-(--panel-gap)">
      <h2 className="text-title">Security</h2>
      <Panel aria-labelledby="organization-two-step">
        <PanelHeader>
          <PanelTitle id="organization-two-step">Two-step sign-in</PanelTitle>
          <PanelDescription>
            Require every member to sign in with a code from an authenticator app after their password. It applies to
            members everywhere they sign in, including in other organizations.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          {security.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : security.error ? (
            <LoadError error={security.error} what="the security settings" onRetry={() => security.refetch()} />
          ) : (
            <>
              <SwitchField
                align="end"
                label="Require two-step sign-in"
                description={
                  data!.can_change
                    ? "Members without it are asked to set it up on their next click. Turning it off turns nobody's off."
                    : undefined
                }
                checked={data!.two_step_required}
                disabled={!data!.can_change || saving}
                onCheckedChange={(required) => (required && without > 0 ? setConfirming(true) : void save(required))}
              />
              {!data!.can_change && (
                <p className="text-body text-muted-foreground" data-testid="organization-two-step-own-first">
                  Set up two-step sign-in for your own account first, in{" "}
                  <Link to="/account/security" className="text-primary underline underline-offset-4">
                    Account → Security
                  </Link>
                  .
                </p>
              )}
              <p className="text-meta text-muted-foreground" data-testid="members-without-two-step">
                {without === 0
                  ? "Every member has two-step sign-in."
                  : `${without} ${without === 1 ? "member does" : "members do"} not have two-step sign-in yet.`}
              </p>
              <RequestError error={error} />
            </>
          )}
        </PanelContent>
      </Panel>
      <Confirm
        open={confirming !== null}
        title="Require two-step sign-in?"
        description={`${without} ${without === 1 ? "member" : "members"} without two-step sign-in will be asked to set it up before they can continue.`}
        action="Require it"
        destructive={false}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          await save(true)
          setConfirming(null)
        }}
      />
    </div>
  )
}
