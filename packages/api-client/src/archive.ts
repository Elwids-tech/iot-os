/** Lists hide archived dashboards and automations unless asked: `only` lists them alone, `include` with the others. */
export type ArchiveFilter = "only" | "include"
/** Who archived a dashboard or automation; null when it is current or that person was deleted. */
export type ArchivedBy = { user_id: number; name: string | null }
/** What archive and restore return (spec 031 FR-037). */
export type ArchiveState = { uuid: string; archived_at: string | null; archived_by: ArchivedBy | null }
