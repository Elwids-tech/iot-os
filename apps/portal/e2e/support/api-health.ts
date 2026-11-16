import { createServer } from "node:http"

/**
 * Playwright global setup: answers the portal's connection probe, `GET /up` on the API
 * (spec 033, research R8), so mocked specs stay online when they sit idle. Specs mock
 * their API routes with `page.route`; this server closes any other connection, as an
 * absent API would. When something already listens there (the dev stack's API, or the
 * live API of studio.spec.ts), it answers instead and this does nothing.
 */
export default async function globalSetup() {
  const api = new URL(process.env.STUDIO_API_URL ?? "http://127.0.0.1:8001")
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/up") {
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/plain" })
      response.end("ok")
      return
    }
    request.socket.destroy()
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false))
    server.listen(Number(api.port || 80), api.hostname, () => resolve(true))
  })
  if (!listening) return undefined
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
