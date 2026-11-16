import { defineConfig } from "@vite-pwa/assets-generator/config"

/**
 * App icons from `icons/app-icon.svg` (spec 033, research R5). Run
 * `pnpm --filter @iot-os/portal icons` after changing the SVG and commit the PNGs it
 * moves into `public/`, so the image build needs no image tooling. The source is
 * full-bleed navy with the glyph inside the maskable safe zone, so no size adds padding.
 */
export default defineConfig({
  images: ["icons/app-icon.svg"],
  preset: {
    transparent: { sizes: [64, 192, 512], padding: 0 },
    maskable: { sizes: [512], padding: 0 },
    apple: { sizes: [180], padding: 0 },
  },
  headLinkOptions: { preset: "2023" },
})
