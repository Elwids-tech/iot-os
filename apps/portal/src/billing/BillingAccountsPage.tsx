import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { OwnedBillingAccount } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@iot-os/ui/components/tooltip"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { Building2Icon, PlusIcon, WalletIcon } from "lucide-react"
import { LoadError } from "../components/forms"
import { api } from "../lib/api"
import { atLimit, billingAccountsKey, organizationsOfLimit } from "./model"
import { NewOrganizationDialog } from "./NewOrganizationDialog"

type AccountOrganization = OwnedBillingAccount["organizations"][number]

const EXPLANATION =
  "A billing account groups organizations for billing. Owning it gives you no access to them: you open the ones you are a member of."

/** The billing accounts the signed-in person owns, and the organizations each pays for (spec 023). */
export default function BillingAccountsPage() {
  const state = useUrlState()
  const accounts = useQuery({ queryKey: billingAccountsKey, queryFn: () => api.ownedBillingAccounts() })
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const account = accounts.data?.find((item) => item.uuid === state.get("account")) ?? accounts.data?.[0]

  const columns = useMemo<DataColumn<AccountOrganization>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        mobile: "title",
        value: (organization) => organization.name,
        cell: (organization) => <span className="font-medium">{organization.name}</span>,
      },
      {
        id: "created",
        header: "Created",
        value: (organization) => organization.created_at ?? "",
        cell: (organization) => <RelativeTime at={organization.created_at} />,
      },
      {
        id: "access",
        header: "Access",
        align: "end",
        value: (organization) => (organization.member ? "Member" : "Not a member"),
        cell: (organization) =>
          organization.member ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/organizations/${encodeURIComponent(organization.uuid)}/home`}>
                Open<span className="sr-only"> {organization.name}</span>
              </Link>
            </Button>
          ) : (
            <span className="text-meta text-muted-foreground">Not a member</span>
          ),
      },
    ],
    [],
  )

  if (accounts.error)
    return (
      <CollectionPage title="Billing accounts">
        <LoadError error={accounts.error} what="your billing accounts" onRetry={() => accounts.refetch()} busy={accounts.isFetching} />
      </CollectionPage>
    )

  if (accounts.data && !account)
    return (
      <CollectionPage title="Billing accounts">
        <EmptyState
          icon={<WalletIcon />}
          title="You don't own a billing account"
          description="The platform operator makes people owners of billing accounts."
        />
      </CollectionPage>
    )

  const full = account ? atLimit(account) : false
  const limitReason = account
    ? `${account.name} allows ${account.organization_limit} ${account.organization_limit === 1 ? "organization" : "organizations"}. Contact the platform operator to raise the limit.`
    : ""
  const newOrganization = (
    <Button size="sm" disabled={!account || full} onClick={() => setCreating(true)}>
      <PlusIcon data-icon="inline-start" />
      New organization
    </Button>
  )
  const options = (accounts.data ?? [])
    .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map((item) => ({ value: item.uuid, label: item.name }))

  return (
    <CollectionPage
      title="Billing accounts"
      description={account ? organizationsOfLimit(account) : undefined}
      actions={
        <>
          {full ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer or focus events, so the wrapper carries the tooltip. */}
                <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {newOrganization}
                </span>
              </TooltipTrigger>
              <TooltipContent>{limitReason}</TooltipContent>
            </Tooltip>
          ) : (
            newOrganization
          )}
        </>
      }
    >
      <p className="text-body text-muted-foreground">{EXPLANATION}</p>
      {accounts.data && accounts.data.length > 1 && account ? (
        <SearchableSelect
          label="Billing account"
          className="max-w-sm"
          value={account.uuid}
          selectedLabel={account.name}
          options={options}
          search={search}
          onSearchChange={setSearch}
          emptyText="No billing accounts match."
          onChange={(uuid) => {
            setSearch("")
            state.set({ account: uuid })
          }}
        />
      ) : null}
      <DataTable
        id="billing-account-organizations"
        label={account ? `Organizations of ${account.name}` : "Organizations"}
        noun={["organization", "organizations"]}
        rows={account?.organizations}
        rowKey={(organization) => organization.uuid}
        rowLabel={(organization) => organization.name}
        columns={columns}
        defaultSort={[{ id: "name", desc: false }]}
        empty={
          <EmptyState
            inset
            icon={<Building2Icon />}
            title="No organizations yet"
            description="Organizations you create here belong to this billing account."
            action={full ? undefined : newOrganization}
          />
        }
      />
      {creating && account ? <NewOrganizationDialog account={account} onClose={() => setCreating(false)} /> : null}
    </CollectionPage>
  )
}
