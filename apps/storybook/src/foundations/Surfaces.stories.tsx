import type { Meta, StoryObj } from "@storybook/react-vite"

const meta: Meta = { title: "Foundations/Surfaces" }
export default meta

const Layer = ({ name, token, className }: { name: string; token: string; className: string }) => (
  <div className={`flex min-h-28 flex-col justify-between rounded-xl p-4 ${className}`}>
    <span className="text-heading">{name}</span>
    <code className="font-mono text-code text-muted-foreground">{token}</code>
  </div>
)

/** Canvas, panel, raised and overlay, plus sunken areas inside a panel. */
export const Layers: StoryObj = {
  render: () => (
    <div className="grid max-w-4xl gap-6">
      <p className="max-w-prose text-body text-muted-foreground">
        The page is the canvas. Content sits on panels. Menus and popovers are
        raised; sheets and dialogs are overlays. Sunken areas, such as table
        headers, sit inside a panel.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-(--panel-gap)">
        <Layer name="Canvas" token="bg-background" className="bg-background ring-1 ring-border ring-inset" />
        <Layer name="Panel" token="bg-card shadow-panel" className="bg-card shadow-panel" />
        <Layer name="Raised" token="bg-popover shadow-raised" className="bg-popover shadow-raised" />
        <Layer name="Overlay" token="bg-popover shadow-overlay" className="bg-popover shadow-overlay" />
      </div>
      <section className="overflow-hidden rounded-xl bg-card shadow-panel">
        <div className="border-b bg-sunken px-4 py-2 text-meta text-muted-foreground">bg-sunken inside a panel</div>
        <div className="p-4 text-body">Panel content</div>
      </section>
    </div>
  ),
}
