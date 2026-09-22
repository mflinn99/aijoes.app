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

## Authentication (iteration 2)

Passwords are hashed with scrypt, parameters stored alongside the hash so they can be
raised later without invalidating anyone. A session token is random, never stored —
the database holds only its SHA-256 — and resolves to a tenant and role. Sessions
expire on a sliding window, and are revoked on sign-out, on password change, and when
an account is disabled.

Sign-in is throttled per email **and** IP, so one attacker cannot lock a real user out
by guessing their address from elsewhere. Failure messages are identical whether the
address exists or the password is wrong, and the scrypt comparison runs even for an
unknown user so the timing does not distinguish them either.

`IdentityProvider` is the interface everything authenticates through. Local passwords
are implemented; OIDC reports itself unconfigured until an issuer is supplied, rather
than falling back to something weaker. Wiring an MSP's SSO is configuration, not code.

## RBAC

One matrix, enforced on every page and every route handler.

| Role | Permissions |
| --- | --- |
| `READ_ONLY` | read |
| `MSP_USER` | read, analyse, execute, halt |
| `MSP_ADMIN` | + authorise, administer |
| `PLATFORM_ADMIN` | + platform |

The separation that matters: an MSP user does the work — analyses, plans, runs — but
cannot *authorise* a plan or approve a gate, because those commit money and reach a
customer. Halting is deliberately available to anyone who can act; an emergency stop
that needs an administrator is not an emergency stop.

Tests drive the real route handlers with real sessions and assert each boundary,
including that `READ_ONLY` is refused on all nine mutating actions.

## Credential vault

Third-party credentials are encrypted per tenant with AES-256-GCM under a master key
from `METAMSP_SECRET_KEY` (or a KMS in production). The vault **refuses to store
anything when no key is configured** rather than silently writing plaintext, so a
connector reports itself unconfigured instead of appearing to work. A key rotation
surfaces as a connector needing reconnection, not as corrupted output, and tampering
is caught by the auth tag. No credential reaches a log, an error message, an audit
record or a prompt.

## Other controls

- **CSRF**: every session carries a token, echoed on all mutating routes and compared
  in constant time. A token from another session is rejected.
- **Rate limiting**: token buckets on sign-in (per IP) and analysis (per tenant), the
  latter because analysis performs outbound fetching against third-party websites.
- **Last-administrator protection**: an administrator cannot demote or disable
  themselves, and the final active administrator cannot be disabled.

## Known gaps

| Gap | Status | Consequence |
| --- | --- | --- |
| No encryption at rest for the database file | **Open** | SQLite file is plaintext; the vault protects credentials but not analysis data. |
| SQLite rather than Postgres with RLS | **Open** | Isolation is enforced by the guarded query layer. Tested, but a database-level control is stronger. |
| No CSRF token on the sign-in POST | **Accepted** | SameSite=Lax cookies plus a JSON content-type requirement; login CSRF is low impact here. |
| Single-instance rate limiting | **Open** | Buckets are in-process; a shared store is needed behind more than one instance. |
| OIDC flow not exercised end to end | **Open** | The provider builds an authorization URL; the callback handler is not yet written. |

The platform is now safe to hold real customer data behind a trusted network. The
remaining items above are what stands between that and an internet-facing deployment.
