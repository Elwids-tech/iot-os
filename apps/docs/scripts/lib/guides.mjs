// Turns an in-product help guide (apps/api/resources/help) into a docs page. The
// guide stays the single source: these pages are generated at build time.
const FIELDS = ['contexts', 'keywords', 'questions', 'required_capabilities', 'revision', 'section', 'slug', 'summary', 'title']
const SECTION_ORDER = [
  'Getting started',
  'Devices',
  'Discovery and gateways',
  'Device profiles',
  'Telemetry',
  'Dashboards',
  'Alerts',
  'Automations',
  'Geofences',
  'Integrations',
  'Assistant',
  'Organization',
]

export function convertGuide(source, { file, slugs, portalUrl }) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error('missing front matter')
  let data
  try {
    data = JSON.parse(match[1])
  } catch {
    throw new Error('front matter is not valid JSON')
  }
  const keys = Object.keys(data).sort()
  const missing = FIELDS.filter((field) => !keys.includes(field))
  const unknown = keys.filter((key) => !FIELDS.includes(key))
  if (missing.length) throw new Error(`front matter is missing ${missing.join(', ')}`)
  if (unknown.length) throw new Error(`front matter has unknown fields ${unknown.join(', ')}`)
  if (!Number.isInteger(data.revision) || data.revision < 1) throw new Error('revision must be an integer of 1 or more')
  if (`${data.slug}.md` !== file) throw new Error('slug does not match the file name')

  const body = match[2].replace(/\]\((\/[^)\s]*)\)/g, (link, target) => {
    const help = target.match(/^\/help\/([a-z0-9-]+)\/?(#[^)]*)?$/)
    if (help) {
      if (!slugs.has(help[1])) throw new Error(`links to unknown guide ${help[1]}`)
      return `](/docs/guides/${help[1]}/${help[2] ?? ''})`
    }
    // Any other root-relative link is a portal screen: it opens the portal, which asks
    // the reader to sign in.
    return `](${portalUrl}${target})`
  })

  return {
    slug: data.slug,
    section: data.section,
    title: data.title,
    frontmatter: {
      title: data.title,
      description: data.summary,
      help_revision: data.revision,
      requires: data.required_capabilities,
      sidebar: { label: data.title },
    },
    body,
  }
}

export function orderGuideSections(pages) {
  const sections = new Map()
  for (const page of pages) {
    if (!sections.has(page.section)) sections.set(page.section, [])
    sections.get(page.section).push(page)
  }
  const rank = (section) => {
    const index = SECTION_ORDER.indexOf(section)
    return index === -1 ? SECTION_ORDER.length : index
  }
  return [...sections.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([section, items]) => ({
      section,
      slugs: items
        .sort((a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title))
        .map((page) => page.slug),
    }))
}
