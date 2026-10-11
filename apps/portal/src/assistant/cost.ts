/** The server's estimate for every run so far; application accounting, not a provider invoice. */
export const conversationCost = (runs?: Array<{ cost_usd?: number | null }>) =>
  runs?.reduce((total, run) => total + (run.cost_usd || 0), 0) ?? 0

export const formatCost = (usd: number) => `$${usd.toFixed(3)}`
