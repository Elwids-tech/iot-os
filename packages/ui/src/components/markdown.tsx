import type * as React from "react"
import ReactMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "@iot-os/ui/lib/utils"

const remarkPlugins: Options["remarkPlugins"] = [
  // A single "~" stays literal: "~20 °C to ~25 °C" is two approximations, not strikethrough.
  [remarkGfm, { singleTilde: false }],
  // Keep the author's single line breaks, as the plain-text replies did.
  remarkBreaks,
]

type ElementProps = React.HTMLAttributes<HTMLElement> & ExtraProps

const styled = (tag: keyof React.JSX.IntrinsicElements, base: string) =>
  function Styled({ node, className, ...props }: ElementProps) {
    const Tag = tag as React.ElementType
    return <Tag className={cn(base, className)} {...props} />
  }

/** A link in a reply: it opens in a new tab and sends no referrer. */
function MarkdownLink({ node, className, ...props }: React.ComponentProps<"a"> & ExtraProps) {
  return (
    <a
      className={cn("text-primary underline underline-offset-3 hover:text-primary/80", className)}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  )
}

const list = "pl-5 marker:text-muted-foreground [li>&]:mt-1 [&>li+li]:mt-1"

const defaults: Components = {
  p: styled("p", ""),
  // Headings stay small: replies sit in a narrow panel, not a page.
  h1: styled("h3", "text-heading"),
  h2: styled("h3", "text-heading"),
  h3: styled("h4", "text-heading"),
  h4: styled("h5", "font-semibold"),
  h5: styled("h6", "font-semibold"),
  h6: styled("h6", "font-semibold"),
  strong: styled("strong", "font-semibold text-foreground"),
  del: styled("del", "text-muted-foreground"),
  // A checklist (GFM task list) shows its checkboxes, not bullets as well.
  ul: styled("ul", cn("list-disc [&.contains-task-list]:list-none [&.contains-task-list]:pl-0", list)),
  ol: styled("ol", cn("list-decimal", list)),
  li: styled("li", "pl-0.5 [&>p+p]:mt-2"),
  blockquote: styled("blockquote", "border-l-2 pl-3 text-muted-foreground"),
  hr: styled("hr", "border-border"),
  code: styled(
    "code",
    "rounded-sm bg-muted px-1 py-0.5 font-mono text-code [pre>&]:bg-transparent [pre>&]:p-0",
  ),
  pre: styled("pre", "overflow-x-auto rounded-md border bg-sunken p-3 font-mono text-code"),
  table: ({ node, className, ...props }) => (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className={cn("w-full border-collapse text-meta", className)} {...props} />
    </div>
  ),
  thead: styled("thead", "bg-muted/50"),
  th: styled("th", "border-b px-2 py-1.5 text-left font-medium"),
  td: styled("td", "border-b px-2 py-1.5 align-top [tr:last-child>&]:border-b-0"),
  a: MarkdownLink,
  // An image loads without a click, so a prompt-injected reply could leak data through its URL.
  img: ({ alt }) => (alt ? <span className="text-muted-foreground">{alt}</span> : null),
  input: styled("input", "mr-1.5 align-middle accent-primary"),
}

/**
 * Model-written Markdown, such as assistant replies: paragraphs, lists, tables,
 * code and links (GitHub flavour). Raw HTML is never rendered and images show
 * only their alt text. `components` replaces the rendering of single elements,
 * for example to turn reference links into buttons.
 */
function Markdown({
  children,
  className,
  components,
}: {
  children: string
  className?: string
  components?: Components
}) {
  return (
    <div
      data-slot="markdown"
      className={cn("min-w-0 text-body leading-relaxed wrap-break-word [&>*+*]:mt-3", className)}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={{ ...defaults, ...components }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export { Markdown, MarkdownLink }
