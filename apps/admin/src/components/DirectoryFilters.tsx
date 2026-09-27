import { FormEvent, useEffect, useState } from "react"
import type { Organization } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { useSearchParams } from "react-router-dom"

type DirectoryFiltersProps = {
  searchPlaceholder: string
  organizations?: Organization[]
}

export function DirectoryFilters({
  searchPlaceholder,
  organizations,
}: DirectoryFiltersProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("search") ?? ""
  const organization = searchParams.get("organization") ?? ""
  const [draftSearch, setDraftSearch] = useState(search)

  useEffect(() => setDraftSearch(search), [search])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const next = new URLSearchParams(searchParams)
    const value = draftSearch.trim()

    if (value) {
      next.set("search", value)
    } else {
      next.delete("search")
    }

    next.delete("page")
    setSearchParams(next)
  }

  function selectOrganization(value: string) {
    const next = new URLSearchParams(searchParams)

    if (value === "all") {
      next.delete("organization")
    } else {
      next.set("organization", value)
    }

    next.delete("page")
    setSearchParams(next)
  }

  function clear() {
    setDraftSearch("")
    setSearchParams(new URLSearchParams())
  }

  return (
    <form onSubmit={submit} role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <Label className="sr-only" htmlFor="directory-search">
        Search
      </Label>
      <Input
        id="directory-search"
        name="search"
        type="search"
        autoComplete="off"
        placeholder={searchPlaceholder}
        value={draftSearch}
        onChange={(event) => setDraftSearch(event.target.value)}
        className="h-7 w-full min-w-0 sm:w-64"
      />
      {organizations ? (
        <>
          <Label className="sr-only" htmlFor="organization-filter">
            Filter by organization
          </Label>
          <Select value={organization || "all"} onValueChange={selectOrganization}>
            <SelectTrigger id="organization-filter" size="sm" className="min-w-0 flex-1 sm:w-56 sm:flex-none">
              <SelectValue placeholder="All organizations" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectItem value="all">All organizations</SelectItem>
                {organizations.map((item) => (
                  <SelectItem key={item.uuid} value={item.uuid}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </>
      ) : null}
      <Button type="submit" size="sm" variant="outline">
        Search
      </Button>
      {search || organization ? (
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          Clear
        </Button>
      ) : null}
    </form>
  )
}
