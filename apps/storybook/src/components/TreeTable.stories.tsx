import { useEffect, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "@iot-os/ui/components/badge"
import { TreeTable, type TreeLevel, type TreeTableColumn } from "@iot-os/ui/components/tree-table"

const meta: Meta = { title: "Components/TreeTable" }
export default meta

type Node = { key: string; name: string; type: string; devices: number; children: number }

// A made-up building: three floors of twelve zones, each zone with a few rooms.
function childrenOf(parent: Node | null): Node[] {
  if (!parent) return [{ key: "hq", name: "Harbour office", type: "Building", devices: 214, children: 3 }]
  if (parent.type === "Building")
    return [1, 2, 3].map((floor) => ({ key: `${parent.key}/f${floor}`, name: `Floor ${floor}`, type: "Floor", devices: 70, children: 12 }))
  if (parent.type === "Floor")
    return Array.from({ length: 12 }, (_, zone) => ({
      key: `${parent.key}/z${zone + 1}`,
      name: `Zone ${String.fromCharCode(65 + zone)}`,
      type: "Zone",
      devices: 6,
      children: zone % 3 === 0 ? 0 : 3,
    }))
  return Array.from({ length: parent.children }, (_, room) => ({ key: `${parent.key}/r${room + 1}`, name: `Room ${room + 1}`, type: "Room", devices: 2, children: 0 }))
}

/** Five rows a page, after a short pause, as a server would answer. */
function useLevel(parent: Node | null): TreeLevel<Node> {
  const all = childrenOf(parent)
  const [shown, setShown] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(5)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [])
  return {
    rows: loading && shown === 0 ? undefined : all.slice(0, shown),
    total: all.length,
    hasMore: shown < all.length,
    loadingMore: loading && shown > 0,
    onLoadMore: () => {
      setLoading(true)
      setTimeout(() => {
        setShown((count) => count + 5)
        setLoading(false)
      }, 300)
    },
  }
}

const columns: TreeTableColumn<Node>[] = [
  { id: "name", header: "Name", cell: (node) => <span className="font-medium">{node.name}</span> },
  { id: "type", header: "Type", cell: (node) => <Badge variant="outline">{node.type}</Badge>, phoneHidden: true },
  { id: "devices", header: "Devices", align: "end", cell: (node) => node.devices },
]

function Demo() {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <TreeTable
        label="Hierarchy"
        columns={columns}
        rowKey={(node) => node.key}
        rowLabel={(node) => node.name}
        hasChildren={(node) => node.children > 0}
        useLevel={useLevel}
        selected={selected}
        onSelect={(node) => setSelected(node.key)}
        defaultExpanded={["hq"]}
      />
      <p className="text-meta text-muted-foreground">Selected: {selected ?? "nothing"}</p>
    </div>
  )
}

/**
 * Levels load when opened and page five rows at a time. Tab into the tree, then use the
 * arrow keys: Right opens a row or enters it, Left closes it or goes to its parent, Enter selects.
 */
export const Lazy: StoryObj = { render: () => <Demo /> }

/** An empty top level shows the page's own empty state inside the panel. */
export const Empty: StoryObj = {
  render: () => (
    <TreeTable<Node>
      label="Hierarchy"
      columns={columns}
      rowKey={(node) => node.key}
      rowLabel={(node) => node.name}
      hasChildren={() => false}
      useLevel={() => ({ rows: [], hasMore: false, onLoadMore: () => {} })}
      empty={<p className="p-6 text-center text-muted-foreground">Nothing here yet.</p>}
    />
  ),
}
