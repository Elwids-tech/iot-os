import { Badge } from "@iot-os/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@iot-os/ui/components/breadcrumb"
import { Button } from "@iot-os/ui/components/button"
import { CopyText } from "@iot-os/ui/components/copy-text"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@iot-os/ui/components/dropdown-menu"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { cn } from "@iot-os/ui/lib/utils"
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ListTreeIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { Diagram, type DiagramHandle, type Enter } from "./Diagram"
import { ROOT, children, kindLabel, nodes, parents, trail, type AtlasNode, type Box } from "./model"

function fromHash() {
  const id = window.location.hash.replace(/^#\/?/, "")
  return nodes[id] ? id : ROOT
}

/** Every diagram in tree order, with its depth. */
function outline(id: string, depth = 0): { id: string; depth: number }[] {
  return [{ id, depth }, ...children(id).flatMap((child) => outline(child, depth + 1))]
}

function Paths({ title, paths }: { title: string; paths?: string[] }) {
  if (!paths?.length) return null
  return (
    <div className="flex flex-col gap-1">
      <h3 className="skin-label text-meta text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-0.5">
        {paths.map((path) => (
          <li key={path} className="min-w-0">
            <CopyText value={path} label="path" className="max-w-full font-mono text-code" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Details({ node, box, onClose }: { node: AtlasNode; box: Box | null; onClose: () => void }) {
  return (
    <Panel className="max-h-full">
      <PanelHeader>
        <PanelTitle>{box ? box.label : node.title}</PanelTitle>
        {box ? (
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close details" onClick={onClose}>
            <XIcon />
          </Button>
        ) : (
          <Badge variant="outline" className="ml-auto">
            {kindLabel[node.kind]}
          </Badge>
        )}
        {box?.sub ? <PanelDescription className="basis-full">{box.sub}</PanelDescription> : null}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4 overflow-y-auto p-4">
        <p className="text-body">{box ? box.detail : node.summary}</p>
        <Paths title="Code" paths={box?.code} />
        <Paths title="Read more" paths={box ? box.docs : node.docs} />
        {box ? null : (
          <p className="text-meta text-muted-foreground">
            Boxes with a magnifier zoom in. Other boxes show their details here. Press Escape to go up a level.
          </p>
        )}
      </PanelContent>
    </Panel>
  )
}

export function App() {
  const [id, setId] = useState(fromHash)
  const [selected, setSelected] = useState<Box | null>(null)
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const diagram = useRef<DiagramHandle>(null)
  const enter = useRef<Enter>({ type: "fade" })
  const busy = useRef(false)

  const node = nodes[id]
  const path = trail(id)
  const steps = node.steps ?? []

  useEffect(() => {
    const onHash = () => setId(fromHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  // A new diagram starts unselected and unplayed; browser back and forward just fade.
  useEffect(() => {
    setSelected(null)
    setStep(-1)
    setPlaying(false)
    enter.current = { type: "fade" }
    document.title = `${nodes[id].title} · Platform atlas`
  }, [id])

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (step + 1 >= steps.length) setPlaying(false)
      else setStep(step + 1)
    }, step < 0 ? 0 : 3400)
    return () => window.clearTimeout(timer)
  }, [playing, step, steps.length])

  async function go(target: string, how: "in" | "out" | "fade", boxId?: string) {
    if (target === id || busy.current) return
    busy.current = true
    if (how !== "fade") await diagram.current?.exit(how, boxId)
    const below = trail(id)[trail(id).indexOf(target) + 1]
    enter.current = how === "out" ? { type: "out", fromBox: parents[below]?.box } : { type: how }
    window.location.hash = `#/${target}`
    setId(target)
    busy.current = false
  }

  const up = () => {
    const parent = parents[id]
    if (parent) void go(parent.node, "out")
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") up()
      if (event.key === "ArrowRight" && steps.length) {
        setPlaying(false)
        setStep((value) => Math.min(value + 1, steps.length - 1))
      }
      if (event.key === "ArrowLeft" && steps.length) {
        setPlaying(false)
        setStep((value) => Math.max(value - 1, -1))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2">
        <h1 className="text-title">Platform atlas</h1>
        <Breadcrumb>
          <BreadcrumbList>
            {path.map((item, index) => (
              <Fragment key={item}>
                {index ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {item === id ? (
                    <BreadcrumbPage>{nodes[item].title}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={() => void go(item, "out")}>
                        {nodes[item].title}
                      </button>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              <ListTreeIcon />
              Contents
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {outline(ROOT).map((item) => (
              <DropdownMenuItem
                key={item.id}
                aria-current={item.id === id ? "page" : undefined}
                className={cn(item.id === id && "font-medium text-foreground")}
                style={{ paddingLeft: 8 + item.depth * 14 }}
                onSelect={() => void go(item.id, "fade")}
              >
                {nodes[item.id].title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" disabled={!parents[id]} onClick={up}>
          <ArrowUpIcon />
          Up a level
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <main className="flex min-h-80 min-w-0 flex-1 flex-col gap-3">
          <div className="relative min-h-0 flex-1">
            <Diagram
              key={id}
              ref={diagram}
              node={node}
              enter={enter.current}
              step={step >= 0 ? steps[step] : null}
              selected={selected?.id ?? null}
              onSelect={setSelected}
              onOpen={(box) => void go(box.opens!, "in", box.id)}
            />
          </div>
          {steps.length ? (
            <Panel>
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Previous step" disabled={step < 0} onClick={() => { setPlaying(false); setStep(step - 1) }}>
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={playing ? "Pause" : "Play the walkthrough"}
                    onClick={() => {
                      if (!playing && step >= steps.length - 1) setStep(-1)
                      setPlaying(!playing)
                    }}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Next step" disabled={step >= steps.length - 1} onClick={() => { setPlaying(false); setStep(step + 1) }}>
                    <ChevronRightIcon />
                  </Button>
                </div>
                <p className="min-w-0 flex-1 text-body" aria-live="polite">
                  {step >= 0 ? steps[step].text : <span className="text-muted-foreground">Play the walkthrough, or step through it with the arrow keys.</span>}
                </p>
                <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
                  {step >= 0 ? `${step + 1} of ${steps.length}` : `${steps.length} steps`}
                </span>
              </div>
            </Panel>
          ) : null}
        </main>
        <aside aria-label="Details" className="min-h-0 shrink-0 lg:w-80">
          <Details node={node} box={selected} onClose={() => setSelected(null)} />
        </aside>
      </div>
    </div>
  )
}
