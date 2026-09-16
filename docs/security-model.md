# Security and Tenancy Model

Directive §24.

## Tenant isolation is structural

SQLite has no row-level security, so isolation is enforced in `TenantDb`, and enforced
*before* a statement reaches the database:

- Every table holding MSP or end-customer data is listed in `TENANT_SCOPED_TABLES`.
- A statement touching one is rejected unless it constrains `tenant_id` to the
  caller's tenant.
- The constraint must bind `@tenantId` — the context parameter. A literal
  (`tenant_id = 'tenant-b'`) is rejected, because it would let a caller scope to
  someone else's tenant.
- An `INSERT` must carry the `tenant_id` column bound to the same parameter.
- `@tenantId` is bound by `TenantDb` itself; callers never supply it.

Forgetting the predicate is a thrown `TenantIsolationError`, not a silent
cross-tenant read. There is deliberately **no admin bypass on this class**.

Cross-tenant reads go through `unscopedPlatformQuery`, which is separately named,
requires `PLATFORM_ADMIN`, and has no path from a request handler.

**Migration note:** moving to Postgres should replace this guard with real row-level
security. `TenantDb` is the only way tenant data is read, so that is a swap behind one
class rather than an audit of every query.

## Audit is append-only at the database

```sql
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
```

Updates and deletes abort regardless of what application code attempts. Tested.

## Autonomy

Deny by default. An action with no matching grant resolves to `OBSERVE`. A new action
type is `OBSERVE` for every tenant even where other actions are `AUTONOMOUS` —
autonomy is never inherited by a new capability.

Grants are scoped by tenant, user, action type, capability, monetary threshold and
risk ceiling. The most specific grant wins; ties break toward the *lower* level, which
is the conservative reading of ambiguous authority.

Exceeding a threshold does not fail the action — it drops it to `PREPARE`, so the work
is still done and a human approves the last step. Anything touching systems, money,
customers, contracts or communications needs `EXECUTE` or above.

One call drops every grant in a tenant to `OBSERVE`.

## Secrets

No third-party credential is stored in the database. `connector_configs` holds a
`secret_ref`, never a secret. Connectors read keys from the environment at point of
use. The Companies House connector reports `not-configured` and contributes nothing
when its key is absent, rather than degrading to a guess.

## Untrusted input

Website content is fetched from systems outsiders can influence. It is treated as
data throughout: parsed into typed claims with explicit confidence, never executed,
never passed to a query builder or a shell. Fetches are bounded (12s timeout, 1.5MB
cap, identified user agent) and a failure degrades the understanding score rather
than raising.

There is currently **no LLM in any effectful path**. The analysis engines, correlation
of claims, scoring, routing and policy are all deterministic code. If model
enrichment is added, the rule to preserve is that model output is parsed into a typed
structure and validated against policy before reaching anything effectful.

## Known gaps

| Gap | Status | Consequence |
| --- | --- | --- |
| No authentication / IdP | **Open** | Session is a fixed demo tenant. Must be closed before any real data. |
| RBAC roles defined but not enforced at routes | **Open** | `READ_ONLY` can currently reach mutating routes. |
| No encryption at rest | **Open** | SQLite file is plaintext. |
| No rate limiting on analysis | **Open** | Public-web fetching could be abused. |
| CSRF protection on route handlers | **Open** | Same-origin JSON only, but not enforced. |

These are stated rather than hidden because the platform is not yet safe for real
customer data, and the BUILD-REPORT names them as the first work to do next.
