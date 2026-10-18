/** An id for one new-automation editor. Every unsaved automation shares the route id "new". */
export function newEditorId(): string {
  return `new:${crypto.randomUUID()}`
}

/**
 * The cache entries an editor's assistant chat lives in; it reads the first. Each new-automation editor has
 * its own chat, so the next new automation starts afresh. Once saved, the chat is also kept under the
 * workflow, so reopening that workflow continues the conversation.
 */
export function assistantSessionIds(editorId: string, workflowId?: string, evaluationId?: string): string[] {
  if (evaluationId) return [`${editorId}:evaluation:${evaluationId}`]
  return workflowId && workflowId !== editorId ? [editorId, workflowId] : [editorId]
}
