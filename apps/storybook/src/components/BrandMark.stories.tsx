import type { Meta, StoryObj } from "@storybook/react-vite"
import { BrandMark } from "@iot-os/ui/components/brand-mark"

const meta: Meta<typeof BrandMark> = { title: "Components/BrandMark", component: BrandMark }
export default meta

const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="60" height="60" rx="12" fill="${fill}"/><text x="76" y="41" font-family="sans-serif" font-size="30" font-weight="700" fill="${fill}">Acme</text></svg>`,
  )}`

/**
 * An organization or brand in the sidebar, on the sign-in card and in previews. With a logo
 * it shows the image, and the dark logo on dark appearance when one was uploaded. Without
 * one it shows the initial, and the name beside it with `showName`.
 */
export const States: StoryObj = {
  render: () => (
    <dl className="grid max-w-md grid-cols-[10rem_1fr] items-center gap-y-4 text-body">
      <dt className="text-muted-foreground">Logo</dt>
      <dd><BrandMark name="Acme Monitor" logo={{ url: wordmark("#1d4ed8") }} /></dd>
      <dt className="text-muted-foreground">Light and dark logos</dt>
      <dd><BrandMark name="Acme Monitor" logo={{ url: wordmark("#1d4ed8") }} logoDark={{ url: wordmark("#93c5fd") }} size="md" /></dd>
      <dt className="text-muted-foreground">Large</dt>
      <dd><BrandMark name="Acme Monitor" logo={{ url: wordmark("#1d4ed8") }} size="lg" /></dd>
      <dt className="text-muted-foreground">No logo</dt>
      <dd><BrandMark name="Corner Shop" /></dd>
      <dt className="text-muted-foreground">No logo, with name</dt>
      <dd><BrandMark name="Corner Shop" showName size="md" /></dd>
    </dl>
  ),
}
