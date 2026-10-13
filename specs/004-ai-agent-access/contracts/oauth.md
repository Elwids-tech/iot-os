# Contract: Agent Sign-in (OAuth 2.1 with Passport)

Laravel Passport 13.9 is the authorization server and `laravel/mcp` 1.0.2 serves
discovery (research D2 to D5). `{api}` is `APP_URL` (for example
`https://api.example.com`), and `{portal}` is `FRONTEND_URL`. The canonical resource is
`{api}/mcp`.

- Rows marked **ours** are code this feature adds.
- All other rows are package behaviour observed in the spike (research section 6) and
  pinned by the conformance suite.
- While `IOT_AGENTS_ENABLED=false`, every endpoint in this document answers 404
  (**ours**).

## Discovery (`laravel/mcp`)

### `GET {api}/.well-known/oauth-protected-resource/mcp` (and the root path)

```json
{
  "resource": "{api}/mcp",
  "authorization_servers": ["{api}"],
  "scopes_supported": ["mcp:use"]
}
```

### `GET {api}/.well-known/oauth-authorization-server`

```json
{
  "issuer": "{api}",
  "authorization_endpoint": "{api}/oauth/authorize",
  "token_endpoint": "{api}/oauth/token",
  "registration_endpoint": "{api}/oauth/register",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["mcp:use"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"]
}
```

CIMD is not advertised, so clients register dynamically (research D4).
`offline_access` is not listed; refresh tokens are always issued.

### Unauthenticated calls to `/mcp`

`401` with
`WWW-Authenticate: Bearer realm="mcp", resource_metadata="{api}/.well-known/oauth-protected-resource/mcp"`.
When the token belonged to a revoked or expired connection (**ours**), the response is
`401` with `error="invalid_token"` and
`error_description="This connection was disconnected in <APP_NAME>. Connect again."`.

## Registration: `POST {api}/oauth/register` (RFC 7591)

`laravel/mcp`'s `OAuthRegisterController`, on our route named `mcp.oauth.register`
with `throttle:10,1` per address (**ours**).

- **Request (JSON)**:
  - `redirect_uris`: required, at least one;
  - `client_name` (or `name`): 1–255 characters;
  - optional `logo_uri` and `client_uri`.
- **Redirect URIs**: `http` and `https` URIs must start with a domain in
  `mcp.redirect_domains`, which comes from `IOT_AGENTS_REDIRECT_DOMAINS` (default
  `*`). Loopback (`localhost`, `127.0.0.1`) is accepted for command-line agents.
- **Response `201`**:

  ```json
  {
    "client_id": "<uuid>",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
    "scope": "mcp:use",
    "token_endpoint_auth_method": "none"
  }
  ```

- **Errors** are `400` with `invalid_redirect_uri` or `invalid_client_metadata`.
- No client secret is issued. Clients with no connection 24 hours after creation are
  deleted (**ours**).

## Authorization: `GET {api}/oauth/authorize` (Passport, `web` middleware)

**Parameters**: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`,
`code_challenge_method=S256`, `state`, `scope=mcp:use` (optional) and `resource`
(optional).

Passport validates the client, the redirect URI and PKCE, and answers with
RFC 6749 errors. Before Passport, `RequireMcpResource` (**ours**) checks that a
`resource`, when present, equals `{api}/mcp` (trailing slash ignored). An absent
`resource` is accepted, because Claude has been reported to omit it. Any other value
is redirected back with `error=invalid_target`.

- **Signed out**: `302` to `{portal}/connect?return=<this authorize URL, URL-encoded>`
  (**ours**, `redirectGuestsTo` for this route only). After sign-in the portal
  navigates to `return`, accepting only URLs that start with `{api}/oauth/authorize`.
- **Signed in**: Passport stores the request and an `authToken` in the API session.
  Our authorization view redirects `302` to `{portal}/connect` (**ours**).

## Consent (**ours**; [portal-api.md](portal-api.md))

The portal's approve and deny endpoints complete Passport's stored request:

- They pull it from the session; the `auth_token` must match.
- They mark it approved or denied with the person's id.
- They call `AuthorizationServer::completeAuthorizationRequest`.
- They return the resulting `Location` as `{redirect_to}`.

Approval gives `{redirect_uri}?code=…&state=…`; denial gives
`{redirect_uri}?error=access_denied&state=…`. A request can be completed once.

## Tokens: `POST {api}/oauth/token` (Passport; `application/x-www-form-urlencoded`)

The route uses a thin subclass of Passport's `AccessTokenController` (**ours**) and is
limited to 60 requests per minute per address. `RequireMcpResource` applies here too.

- **Authorization code**:
  - Parameters: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
    `code_verifier`, `resource` (optional).
  - Passport checks the code, the client, the redirect URI and PKCE S256.
  - The subclass then checks that the connection for the person and client is
    active (**ours**).
- **Refresh**:
  - Parameters: `grant_type=refresh_token`, `refresh_token`, `client_id`.
  - Passport rotates the refresh token on every use.
  - Presenting a refresh token already revoked by rotation returns `invalid_grant`.
    The subclass then revokes the connection of that `client_id` with reason
    `refresh_reuse` (**ours**).

Success `200`:

```json
{
  "token_type": "Bearer",
  "expires_in": 3600,
  "access_token": "<JWT>",
  "refresh_token": "<encrypted>"
}
```

Errors are `400` or `401` JSON per RFC 6749 §5.2: `invalid_request`, `invalid_client`,
`invalid_grant`, `unsupported_grant_type`, `invalid_target` (**ours**).

**Token lifetimes**: access tokens 1 hour, refresh tokens 90 days. A connection unused
for 90 days expires regardless of its refresh token (**ours**). Tokens are signed with
the deployment's Passport keys. Rotating the keys invalidates every agent token, and
agents then connect again.

## Not provided

- Revocation (RFC 7009) and introspection endpoints. Disconnecting happens in the
  portal and takes effect on the next call.
- Client ID Metadata Documents (deferred, research D4).
- Device, password, client-credentials and personal-token grants, and Passport's JSON
  API (`Passport::ignoreRoutes()`, then only authorize and token are registered).

## Token use

- Access tokens are accepted only as `Authorization: Bearer` on `/mcp`, through the
  `mcp` guard over the `users` provider.
- They are rejected by every `/api/v1`, `/api/integration/v1` and `/api/internal`
  route. Portal sessions and integration tokens are rejected on `/mcp` (FR-014; spike
  step "fresh test").
- Passport checks the `revoked` flag on every request, and `AuthenticateAgent` checks
  the connection, so disconnecting applies from the next call.
