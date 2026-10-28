import type { LucideIcon } from "lucide-react"
import {
  BookOpenIcon,
  BoxesIcon,
  CableIcon,
  MessageCircleQuestionIcon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import type { Suggestion, SuggestionAction } from "./suggestions"

const icons: Record<SuggestionAction["kind"], LucideIcon> = {
  context: SparklesIcon,
  profile: BoxesIcon,
  automation: WorkflowIcon,
  help: BookOpenIcon,
  onboarding: CableIcon,
}

function Choices({
  label,
  items,
  onChoose,
}: {
  label: string
  items: Suggestion[]
  onChoose: (suggestion: Suggestion) => void
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5">
      <h4 className="skin-label text-meta font-medium text-muted-foreground">{label}</h4>
      {items.map((item) => {
        const ItemIcon = icons[item.action.kind]
        return (
          <Button
            key={item.id}
            variant="outline"
            className="h-auto w-full items-start justify-start gap-3 whitespace-normal p-3 text-left"
            onClick={() => onChoose(item)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <ItemIcon />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium">{item.title}</span>
              <span className="mt-0.5 block text-meta font-normal text-muted-foreground">
                {item.description}
              </span>
            </span>
          </Button>
        )
      })}
    </section>
  )
}

/**
 * Ask's start on pages without an assistant of their own: the work the assistant can
 * do here, the guides' questions about the page, then everything it can do anywhere.
 */
export function AssistantHome({
  page,
  here,
  more,
  questions,
  onChoose,
  onQuestion,
}: {
  page?: string
  here: Suggestion[]
  more: Suggestion[]
  questions: string[]
  onChoose: (suggestion: Suggestion) => void
  onQuestion: (question: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-6 flex flex-col gap-1.5">
        <h3 className="text-title">What can I help with?</h3>
        <p className="text-body text-muted-foreground">
          {page ? `Suggestions for ${page}. ` : ""}I draft changes for your review; nothing is
          saved, activated or sent without you.
        </p>
      </div>
      <div className="flex flex-col gap-7">
        {here.length > 0 && <Choices label="Suggested here" items={here} onChoose={onChoose} />}
        {questions.length > 0 && (
          <section aria-label="Questions about this page" className="flex flex-col gap-1">
            <h4 className="skin-label mb-1.5 text-meta font-medium text-muted-foreground">Questions about this page</h4>
            {questions.map((question) => (
              <Button
                key={question}
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                onClick={() => onQuestion(question)}
              >
                <MessageCircleQuestionIcon data-icon="inline-start" />
                {question}
              </Button>
            ))}
          </section>
        )}
        {more.length > 0 && (
          <Choices label={here.length ? "More the assistant can do" : "The assistant can"} items={more} onChoose={onChoose} />
        )}
      </div>
    </div>
  )
}
