// Signs a verification fixture's temporary administrator in to the portal API.
// People reach the portal API by Sanctum session, not bearer tokens, so this keeps a
// cookie jar and sends the XSRF header the way the portal does. Local stacks only.
import assert from 'node:assert/strict'

const PORTAL = process.env.IOT_PORTAL_URL ?? 'http://localhost:5173'

/** A fetch that carries the session: request(method, url, body?) → Response. */
export async function portalSession(apiOrigin, { email, password }) {
  const jar = new Map()
  async function request(method, url, body) {
    const headers = { Accept: 'application/json', Origin: PORTAL, Referer: PORTAL + '/' }
    if (jar.size) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    if (jar.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(jar.get('XSRF-TOKEN'))
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]
      jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1))
    }
    return response
  }
  await request('GET', apiOrigin + '/sanctum/csrf-cookie')
  const login = await request('POST', apiOrigin + '/api/v1/auth/login', { email, password })
  assert.equal(login.status, 200, `Fixture sign-in: ${login.status} ${(await login.text()).slice(0, 300)}`)
  return request
}

/** Signs a Playwright browser context in, so the portal it opens has the session. */
export async function signInBrowser(context, apiOrigin, { email, password }) {
  const headers = { Accept: 'application/json', Origin: PORTAL, Referer: PORTAL + '/' }
  await context.request.get(apiOrigin + '/sanctum/csrf-cookie', { headers })
  const xsrf = (await context.cookies(apiOrigin)).find(cookie => cookie.name === 'XSRF-TOKEN')
  assert.ok(xsrf, 'No XSRF cookie from the API')
  const login = await context.request.post(apiOrigin + '/api/v1/auth/login', {
    headers: { ...headers, 'X-XSRF-TOKEN': decodeURIComponent(xsrf.value) },
    data: { email, password },
  })
  assert.equal(login.status(), 200, `Fixture sign-in: ${login.status()}`)
}
