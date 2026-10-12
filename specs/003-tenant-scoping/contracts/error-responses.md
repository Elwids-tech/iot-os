# Contract: Not-found and refusal responses

Spec FR-003, FR-006, FR-008, FR-009, SC-002, SC-011 and clarification Q3. Design:
[research.md](../research.md) D2, D9 and D10. These are the only changes this
feature makes to the public API. Successful responses do not change (FR-034).

## Not found

Every 404 on an `api/*` route has the body:

```json
{"message": "Not Found"}
```

| Cause | Today | After |
| --- | --- | --- |
| Unknown organization UUID | 404 `No query results for model [App\Domain\Shared\Models\Organization] <uuid>` | 404 `Not Found` |
| Authenticated non-member of an existing organization (portal and organization administration) | 403 `You do not belong to this organization.` | 404 `Not Found` |
| Integration application of another organization | 404 (empty message) | 404 `Not Found` |
| Record that does not exist | 404 `No query results for model [<class>] <id>` | 404 `Not Found` |
| Record of another organization (path) | 404 (empty message) for most domains | 404 `Not Found` |
| Child record under the wrong parent | 404 (empty message) | 404 `Not Found` |
| Integration resource not granted to the application | 404 | 404 `Not Found` |
| Malformed identifier (route pattern) | 404 | 404 `Not Found` |
| Feature switched off (`abort_unless(config(...), 404)`) | 404 (empty message) | 404 `Not Found` |

There is one renderer in `apps/api/bootstrap/app.php`, covering
`ModelNotFoundException` and `NotFoundHttpException` on `api/*`. A domain `abort(404,
'<message>')` that explains a tenant reason is changed to the uniform body.
`apps/portal/src/components/forms.tsx:63-64` already shows "This isn't available. It
may have been removed, or the feature isn't enabled for this organization." for this
body.

## Refusals that stay

| Cause | Response |
| --- | --- |
| Member without the needed tenant permission | 403 (message as today) |
| Integration token or application without the operation's ability | 403 (as today) |
| Missing platform permission on `api/v1/admin` | 403 (as today) |
| No session or token | 401 (as today) |

## Request references (bodies and queries)

A reference to another organization's record gets exactly the response that the same
field gives for a reference that does not exist: the same status (422 with the same
field error, or 404 where the operation looks the reference up before validating) and
the same body.

## Client-chosen request identifiers

An `operation_uuid`, `request_uuid` or `request_id` that only another organization has
used is answered exactly like a key the acting organization used for a different
request: 409 with the same message for every operation, "This request identifier was
already used for a different request." Today's per-operation 404 or 409 answers
converge on this. The residual signal is described in research D10 and is owner
decision 1.

## Contract and documentation changes (PR 2)

- `contracts/openapi/supplements/shared.yaml`:
  - `NotFound` description: add "and authenticated callers who are not members of the
    organization", and give the body example `{"message": "Not Found"}`.
  - `Forbidden` description: remove "not a member of the organization".
- `x-organization-scoped` meaning in `docs/reference/api.md` and the
  `SecurityTransformer` docblock: "404 unknown organization or non-member".
- Then `php artisan contract:export`; G1 to G4 stay green.
- `docs/features/access.md:48`: "404 for unknown, 403 for non-members" becomes "404
  for an unknown organization and for non-members, so a non-member cannot tell whether
  the organization exists".
- No operation adds or removes a status. 403 stays documented on organization
  operations for permission refusals.
