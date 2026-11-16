import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { execSync } from "node:child_process"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

/** Names this build in `<meta name="build-id">`, so tests and people can tell versions apart. */
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    // The image build has no git checkout; the build time still tells two builds apart.
    return new Date().toISOString()
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app (spec 033, research R2 to R5): the worker in src/sw.ts precaches the
    // app shell only. Updates wait for Reload or the next launch (src/pwa/UpdatePrompt.tsx).
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      devOptions: { enabled: false },
      // globPatterns below already precaches every PNG; this would list the icons twice.
      includeManifestIcons: false,
      manifest: {
        name: "IoT OS",
        short_name: "IoT OS",
        description: "Monitor devices, dashboards and alerts.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The kit's light --background (tokens.css), as hex because manifests take no oklch().
        background_color: "#f3f6f9",
        theme_color: "#f3f6f9",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        // Deployment settings are written when the container starts; the worker fetches them network-first.
        globIgnores: ["runtime-config.js"],
      },
    }),
  ],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173, strictPort: true },
})
