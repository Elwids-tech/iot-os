import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [tailwindcss(), { name: "independent-host-boundary", generateBundle() {
    for (const id of this.getModuleIds()) {
      if (/\/(?:apps\/(?:portal|admin)|packages\/(?:api-client|auth))\//.test(id)) {
        this.error("Independent application must not import core frontend modules: " + id);
      }
    }
  } }],
  ssr: { noExternal: true },
  build: { ssr: "src/server.tsx", ssrEmitAssets: true, cssCodeSplit: false,
    rollupOptions: { output: { entryFileNames: "server.js", assetFileNames: "[name][extname]" } } },
});
