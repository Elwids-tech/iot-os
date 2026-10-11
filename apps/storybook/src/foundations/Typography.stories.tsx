import type { Meta, StoryObj } from "@storybook/react-vite"

const meta: Meta = { title: "Foundations/Typography" }
export default meta

const scale = [
  ["text-display", "KPI numbers", "1,222", "text-display"],
  ["text-title", "The page h1", "Devices", "text-title"],
  ["text-heading", "Panel and section titles", "Latest measurements", "text-heading"],
  ["text-body", "Default copy", "Configuration applied as revision 2", "text-body"],
  ["text-meta", "Captions, column heads, timestamps", "Last seen 6 d ago", "text-meta text-muted-foreground"],
  ["text-code", "Ids and keys, with font-mono", "gps-demo-tracker-2", "font-mono text-code"],
  ["text-micro", "Initials and count badges only", "TR · 3", "text-micro font-semibold"],
] as const

/** Seven named steps. Use these instead of raw sizes such as text-lg or text-[13px]. */
export const Scale: StoryObj = {
  render: () => (
    <section className="max-w-3xl overflow-hidden rounded-xl bg-card shadow-panel">
      {scale.map(([name, use, sample, className]) => (
        <div key={name} className="grid grid-cols-[9rem_1fr] items-baseline gap-4 border-b px-4 py-3 last:border-0">
          <div className="flex flex-col">
            <code className="font-mono text-code">{name}</code>
            <span className="text-meta text-muted-foreground">{use}</span>
          </div>
          <span className={className}>{sample}</span>
        </div>
      ))}
    </section>
  ),
}
