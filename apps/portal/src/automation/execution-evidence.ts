export type ExecutionSelection = { id: string; generation: number; draft_revision: number }
export type ExecutionReferences = {
  workflow_uuid: string; evaluation_id: string; captured_at: string; at: string;
  generation: number; draft_revision: number; trace_truncated: boolean;
  steps: { node_id: string; node_type: string }[];
  actions: { id: string; node_id?: string | null }[];
}
export type EvidenceTarget = { evaluationId: string; step?: number; action?: string }
export type EvidencePart = { text: string; target?: EvidenceTarget }

// Only server-returned reference positions can become interactive links.
export function evidenceParts(answer: string, evidence?: ExecutionReferences | null): EvidencePart[] {
  if (!evidence) return [{ text: answer }]
  return answer.split(/(\[(?:evaluation|step:\d+|action:\d+)\])/g).filter(Boolean).map(text => {
    const target = { evaluationId: evidence.evaluation_id }
    if (text === "[evaluation]") return { text: `Evaluation ${evidence.evaluation_id}`, target }
    const match = /^\[(step|action):(\d+)\]$/.exec(text)
    if (!match) return { text }
    const index = Number(match[2]) - 1
    if (match[1] === "step" && evidence.steps[index]) return { text: `Step ${index + 1} · ${evidence.steps[index].node_id}`, target: { ...target, step: index } }
    if (match[1] === "action" && evidence.actions[index]) return { text: `Action ${index + 1} · ${evidence.actions[index].node_id ?? "delivery"}`, target: { ...target, action: evidence.actions[index].id } }
    return { text: `${text} (reference unavailable)` }
  })
}

export const evidenceHref = (index: number) => `#evidence-${index}`

/** The answer as Markdown, with each server-returned reference as a `#evidence-N` link into `targets`. */
export function evidenceMarkdown(answer: string, evidence?: ExecutionReferences | null): { markdown: string; targets: EvidenceTarget[] } {
  const targets: EvidenceTarget[] = []
  const markdown = evidenceParts(answer, evidence).map(part => {
    if (!part.target) return part.text
    targets.push(part.target)
    return `[${part.text.replace(/[\\[\]*_`]/g, "\\$&")}](${evidenceHref(targets.length - 1)})`
  }).join("")
  return { markdown, targets }
}
