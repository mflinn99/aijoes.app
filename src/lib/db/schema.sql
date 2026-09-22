-- AIGoGo MetaMSP schema. Directive §24: multi-tenant from day one.
-- Every table holding MSP or end-customer data carries tenant_id and is listed
-- in TENANT_SCOPED_TABLES; the guarded query layer refuses to touch one without
-- a tenant predicate.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- tenancy ---

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('MSP','PLATFORM')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('PLATFORM_ADMIN','MSP_ADMIN','MSP_USER','READ_ONLY')),
  created_at    TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

-- MSP -> Customers (§18). A customer belongs to exactly one MSP tenant.
CREATE TABLE IF NOT EXISTS customers (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  domain            TEXT,
  current_mrr       REAL NOT NULL DEFAULT 0,
  relationship_note TEXT,
  renewal_date      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);

-- ------------------------------------------------------------ company twin ---

CREATE TABLE IF NOT EXISTS company_twins (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  customer_id    TEXT REFERENCES customers(id),
  display_name   TEXT NOT NULL,
  domain         TEXT,
  understanding  INTEGER NOT NULL DEFAULT 0,
  twin_json      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_twins_tenant ON company_twins(tenant_id);

-- Raw normalised source records, kept for provenance (§3, §21).
CREATE TABLE IF NOT EXISTS source_records (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  company_id    TEXT NOT NULL REFERENCES company_twins(id),
  connector_id  TEXT NOT NULL,
  locator       TEXT,
  label         TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  retrieved_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_tenant_company ON source_records(tenant_id, company_id);

-- ------------------------------------------------------------- opportunity ---

CREATE TABLE IF NOT EXISTS opportunities (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id),
  company_id             TEXT NOT NULL REFERENCES company_twins(id),
  category               TEXT NOT NULL CHECK (category IN ('MAKE_MORE','SPEND_LESS','MSP_EXPAND')),
  subcategory            TEXT NOT NULL,
  title                  TEXT NOT NULL,
  estimated_annual_value REAL NOT NULL,
  implementation_cost    REAL NOT NULL,
  confidence             REAL NOT NULL,
  effort                 REAL NOT NULL,
  risk                   TEXT NOT NULL,
  time_to_value          INTEGER NOT NULL,
  execution_readiness    REAL NOT NULL,
  execution_status       TEXT NOT NULL,
  playbook_id            TEXT,
  score                  REAL NOT NULL,
  realised_value         REAL,
  opportunity_json       TEXT NOT NULL,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opps_tenant_company ON opportunities(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_opps_tenant_score ON opportunities(tenant_id, score DESC);

-- ------------------------------------------------------------ supply chain ---

CREATE TABLE IF NOT EXISTS supplier_relationships (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id),
  company_id           TEXT NOT NULL REFERENCES company_twins(id),
  supplier_name        TEXT NOT NULL,
  category             TEXT NOT NULL,
  annual_spend         REAL NOT NULL,
  spend_confidence     REAL NOT NULL,
  contract_end         TEXT,
  renewal_date         TEXT,
  criticality          TEXT NOT NULL,
  switching_complexity TEXT NOT NULL,
  savings_potential    REAL NOT NULL,
  relationship_json    TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_company ON supplier_relationships(tenant_id, company_id);

-- --------------------------------------------------------------- execution ---

CREATE TABLE IF NOT EXISTS execution_plans (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  opportunity_id   TEXT NOT NULL REFERENCES opportunities(id),
  company_id       TEXT NOT NULL REFERENCES company_twins(id),
  objective        TEXT NOT NULL,
  financial_target REAL NOT NULL,
  status           TEXT NOT NULL,
  plan_json        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  authorised_at    TEXT,
  authorised_by    TEXT,
  completed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_plans_tenant ON execution_plans(tenant_id);

CREATE TABLE IF NOT EXISTS execution_tasks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  execution_plan_id   TEXT NOT NULL REFERENCES execution_plans(id),
  seq                 INTEGER NOT NULL,
  action              TEXT NOT NULL,
  assigned_capability TEXT NOT NULL,
  approval_required   INTEGER NOT NULL,
  status              TEXT NOT NULL,
  task_json           TEXT NOT NULL,
  started_at          TEXT,
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_plan ON execution_tasks(tenant_id, execution_plan_id);

-- ----------------------------------------------------------------- benefit ---

CREATE TABLE IF NOT EXISTS benefits (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  company_id         TEXT NOT NULL REFERENCES company_twins(id),
  opportunity_id     TEXT NOT NULL REFERENCES opportunities(id),
  type               TEXT NOT NULL,
  stage              TEXT NOT NULL,
  forecast_value     REAL NOT NULL DEFAULT 0,
  realised_value     REAL NOT NULL DEFAULT 0,
  verified_value     REAL NOT NULL DEFAULT 0,
  measurement_period TEXT,
  benefit_json       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benefits_tenant ON benefits(tenant_id);

-- --------------------------------------------------------------- autonomy ----

CREATE TABLE IF NOT EXISTS autonomy_grants (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  user_id            TEXT,
  action_type        TEXT,
  capability_id      TEXT,
  level              INTEGER NOT NULL,
  monetary_threshold REAL NOT NULL,
  max_risk           TEXT NOT NULL,
  granted_by         TEXT NOT NULL,
  granted_at         TEXT NOT NULL,
  expires_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_grants_tenant ON autonomy_grants(tenant_id);

CREATE TABLE IF NOT EXISTS approvals (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  execution_plan_id TEXT NOT NULL REFERENCES execution_plans(id),
  task_id           TEXT,
  requested_at      TEXT NOT NULL,
  decided_at        TEXT,
  decided_by        TEXT,
  decision          TEXT,
  rationale         TEXT,
  summary           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_tenant ON approvals(tenant_id);

-- ------------------------------------------------------- audit + telemetry ---
-- Directive §24: "immutable audit trail for execution actions". Append-only is
-- enforced by triggers below, not merely by convention.

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  actor         TEXT NOT NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('human','agent','system')),
  action        TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  detail_json   TEXT NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_at ON audit_log(tenant_id, at DESC);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Directive §25/§26: observability and cost accounting.
CREATE TABLE IF NOT EXISTS agent_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  company_id     TEXT,
  objective      TEXT NOT NULL,
  capability_id  TEXT,
  execution_id   TEXT,
  status         TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  duration_ms    INTEGER,
  cost_gbp       REAL NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  benefit_gbp    REAL NOT NULL DEFAULT 0,
  failure        TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  detail_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON agent_events(tenant_id, started_at DESC);

-- Analysis run progress (§2 progressive stages).
CREATE TABLE IF NOT EXISTS analysis_runs (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  company_id   TEXT,
  input        TEXT NOT NULL,
  status       TEXT NOT NULL,
  stages_json  TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON analysis_runs(tenant_id, started_at DESC);

-- Connector configuration per tenant. Secrets are never stored here (§24).
CREATE TABLE IF NOT EXISTS connector_configs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  connector_id  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  secret_ref    TEXT,
  config_json   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, connector_id)
);

-- ------------------------------------------------------------------ auth ----
-- Directive iteration 2: authentication and session state.

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  -- SHA-256 of the session token. The token itself is never stored.
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_token    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  revoked_at    TEXT,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Failed sign-in attempts, for lockout. Keyed by email + ip.
CREATE TABLE IF NOT EXISTS auth_attempts (
  id        TEXT PRIMARY KEY,
  key       TEXT NOT NULL,
  at        TEXT NOT NULL,
  succeeded INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_key ON auth_attempts(key, at DESC);

-- ------------------------------------------------------------------ jobs ----
-- Durable background work. Iteration 1 used fire-and-forget promises, so a
-- restart mid-analysis left a run stuck at "running" forever.

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','dead')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_after     TEXT NOT NULL,
  locked_at     TEXT,
  locked_by     TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id, created_at DESC);

-- --------------------------------------------------------------- secrets ----
-- Per-tenant third-party credentials, encrypted at rest. The platform master
-- key never lives here; it comes from the environment or a KMS.

CREATE TABLE IF NOT EXISTS secrets (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  ref           TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  iv            TEXT NOT NULL,
  auth_tag      TEXT NOT NULL,
  key_id        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, ref)
);

-- -------------------------------------------------------- connected facts ---
-- Measured figures from a connected system, kept separately from the twin's
-- provenanced claims because they are structured payloads an engine consumes
-- directly rather than single values with confidence.

CREATE TABLE IF NOT EXISTS connected_facts (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  company_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  facts_json   TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  UNIQUE (tenant_id, company_id, kind)
);

-- ---------------------------------------------------------- verification ----
-- A baseline captured before execution, so realised value can later be proved
-- against a connected system of record rather than asserted.

CREATE TABLE IF NOT EXISTS verification_baselines (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  company_id      TEXT NOT NULL,
  opportunity_id  TEXT NOT NULL,
  execution_plan_id TEXT NOT NULL,
  kind            TEXT NOT NULL,
  baseline_json   TEXT NOT NULL,
  captured_at     TEXT NOT NULL,
  verify_after    TEXT NOT NULL,
  verified_at     TEXT,
  verified_value  REAL,
  outcome         TEXT,
  UNIQUE (tenant_id, execution_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_baselines_due ON verification_baselines(verified_at, verify_after);

-- ------------------------------------------------------------- schedules ----
-- Directive §22: "Build a refresh mechanism." A twin that is never re-analysed
-- decays quietly; a stale figure that still looks confident is worse than a
-- gap, because nobody goes looking for it.

CREATE TABLE IF NOT EXISTS refresh_schedules (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  interval_days  INTEGER NOT NULL,
  next_run_at    TEXT NOT NULL,
  last_run_at    TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  UNIQUE (tenant_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_refresh_due ON refresh_schedules(enabled, next_run_at);

-- ------------------------------------------------------------------ oidc ----
-- Short-lived state for an in-flight sign-in. Rows are single-use and expire
-- quickly; a callback presenting a state that is missing, used or stale is
-- rejected.

CREATE TABLE IF NOT EXISTS oidc_states (
  state       TEXT PRIMARY KEY,
  nonce       TEXT NOT NULL,
  redirect_to TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT
);
