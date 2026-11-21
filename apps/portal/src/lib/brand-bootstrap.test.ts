import { describe, expect, it } from "vitest"
import bootstrap from "./brand-bootstrap.js?raw"
import fixture from "./__fixtures__/runtime-config.branded.js?raw"

/** The few DOM calls the bootstrap makes, recorded. */
class Element {
  attributes: Record<string, string> = {}
  children: Element[] = []
  textContent = ""
  parentNode: Element | null = null
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  appendChild(child: Element) {
    child.parentNode = this
    this.children.push(child)
  }
  removeChild(child: Element) {
    this.children = this.children.filter((item) => item !== child)
  }
}

function page(options: { script?: string; kept?: string; theme?: string; hostname?: string } = {}) {
  const head = new Element("head")
  const root = new Element("div")
  const manifest = new Element("link")
  const touch = new Element("link")
  touch.setAttribute("href", "/apple-touch-icon-180x180.png")
  head.appendChild(manifest)
  head.appendChild(touch)
  const stored = new Map<string, string>()
  if (options.kept) stored.set("iot-runtime-config", options.kept)
  if (options.theme) stored.set("theme", options.theme)
  const replaced: string[] = []
  const window: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
    location: { hostname: options.hostname ?? "acme.example.com", pathname: "/devices", search: "?q=1", hash: "#top", replace: (url: string) => replaced.push(url) },
    matchMedia: () => ({ matches: false }),
  }
  const document = {
    title: "",
    head,
    getElementById: (id: string) => (id === "root" ? root : null),
    querySelector: (selector: string) => (selector.includes("manifest") ? manifest : touch).parentNode && (selector.includes("manifest") ? manifest : touch),
    createElement: (tag: string) => new Element(tag),
  }
  // runtime-config.js first, as index.html loads it, then the bootstrap's own text.
  new Function("window", "document", `${options.script ?? ""}\n${bootstrap}`)(window, document)
  return { window, document, head, root, stored, replaced }
}

const config = (value: object) => `window.__IOT_CONFIG__ = ${JSON.stringify(value)};`

describe("the brand bootstrap", () => {
  it("names the tab, sets the icons and draws the brand's loading mark on an address", () => {
    const { document, head, root, stored, window } = page({ script: fixture })

    expect(document.title).toBe("Acme Monitor")
    expect(head.children.map((link) => link.attributes.rel ?? link.attributes.href)).toEqual(["https://api.example.com/api/v1/brand-assets/7c9e6679-7425-40de-944b-e07fc1f90ae7a665a4592042/180", "icon"])
    expect(head.children[1].attributes.href).toMatch(/\/192$/)
    const [mark] = root.children
    expect(mark.attributes).toHaveProperty("data-brand-loading")
    expect(mark.children[0].attributes).toMatchObject({ alt: "Acme Monitor", src: expect.stringMatching(/\/logo$/) })
    expect(window.__IOT_HALT__).toBeUndefined()
    // Kept for a launch without the network.
    expect(JSON.parse(stored.get("iot-runtime-config")!).brand.product_name).toBe("Acme Monitor")
  })

  it("writes the name when the brand has no logo, and prefers the dark logo on dark appearance", () => {
    const brand = { product_name: "Acme Monitor", short_name: "Acme", support_url: null, logo: null, logo_dark: null, icon: null, touch_icon: null, powered_by: null }
    const address = { kind: "name", host: "acme.example.com", state: "active" }
    const plain = page({ script: config({ address, brand }) })
    expect(plain.root.children[0].textContent).toBe("Acme Monitor")
    expect(plain.root.children[0].children).toEqual([])
    // No brand icon: the platform's touch icon goes, and no tab icon is added.
    expect(plain.head.children).toEqual([])

    const logos = { ...brand, logo: "/light.png", logo_dark: "/dark.png" }
    expect(page({ script: config({ address, brand: logos }) }).root.children[0].children[0].attributes.src).toBe("/dark.png")
    expect(page({ script: config({ address, brand: logos }), theme: "light" }).root.children[0].children[0].attributes.src).toBe("/light.png")
  })

  it("leaves the platform's own address as it was", () => {
    const { document, head, root, stored } = page({ script: config({ VITE_API_URL: "https://api.example.com", environment: "production" }), hostname: "app.example.com", kept: "{}" })

    expect(document.title).toBe("IoT OS")
    expect(root.children).toEqual([])
    expect(head.children).toHaveLength(2)
    expect(head.children[1].attributes.href).toBe("/apple-touch-icon-180x180.png")
    expect(stored.has("iot-runtime-config")).toBe(false)
  })

  it("uses the platform's name on an address whose brand has no name yet, without its icons", () => {
    const { document, head, root } = page({ script: config({ address: { kind: "name", host: "acme.example.com", state: "active" }, brand: null }) })

    expect(document.title).toBe("IoT OS")
    expect(root.children).toEqual([])
    expect(head.children).toEqual([])
  })

  it("says an address is not in use and starts nothing", () => {
    const { document, head, root, stored, window } = page({ script: config({ address: { state: "not_in_use" } }), kept: fixture.replace("window.__IOT_CONFIG__ = ", "").replace(/;\s*$/, "") })

    expect(window.__IOT_HALT__).toBe(true)
    expect(document.title).toBe("This address is not in use")
    expect(root.children[0].textContent).toBe("This address is not in use.")
    expect(head.children).toHaveLength(1)
    expect(stored.has("iot-runtime-config")).toBe(false)
  })

  it("follows a renamed address, keeping the page that was asked for", () => {
    const { replaced, root, window } = page({ script: config({ address: { state: "moved", to: "https://acme-monitor.example.com" } }) })

    expect(replaced).toEqual(["https://acme-monitor.example.com/devices?q=1#top"])
    expect(window.__IOT_HALT__).toBe(true)
    expect(root.children).toEqual([])
  })

  it("starts from the brand it last learned when runtime-config.js cannot be fetched", () => {
    const kept = fixture.replace("window.__IOT_CONFIG__ = ", "").replace(/;\s*$/, "")
    const offline = page({ kept })
    expect(offline.document.title).toBe("Acme Monitor")
    expect((offline.window.__IOT_CONFIG__ as { VITE_API_URL: string }).VITE_API_URL).toBe("https://api.example.com")

    // What another host kept is not this host's brand.
    const elsewhere = page({ kept, hostname: "other.example.com" })
    expect(elsewhere.document.title).toBe("IoT OS")
    expect(elsewhere.window.__IOT_CONFIG__).toBeUndefined()
  })
})
