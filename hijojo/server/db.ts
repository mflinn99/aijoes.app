// SQLite persistence. The schema itself enforces the rules that must never be
// broken by a bug elsewhere: at most one introduction and one follow-up per
// prospect, one handoff per response, one QA-approved send per communication.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS opcos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL,
  intro_link TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  status_detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  opco_id TEXT,
  prospect_id TEXT,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  retrieved_at TEXT NOT NULL,
  published_at TEXT,
  content_hash TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sources_prospect ON sources(prospect_id);
CREATE INDEX IF NOT EXISTS sources_opco ON sources(opco_id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  opco_id TEXT NOT NULL,
  field TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('FACT','INFERENCE','UNKNOWN')),
  evidence TEXT NOT NULL,
  basis TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS claims_opco ON claims(opco_id);

CREATE TABLE IF NOT EXISTS profiles (
  opco_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (opco_id, version)
);

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  opco_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  attributes TEXT NOT NULL,
  score TEXT,
  why_them TEXT,
  why_now TEXT,
  why_proposition TEXT,
  conflicts TEXT NOT NULL DEFAULT '[]',
  contact_id TEXT,
  discovered_via TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  researched_at TEXT,
  UNIQUE (opco_id, domain)
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  signal_id TEXT,
  observed_at TEXT,
  note TEXT,
  superseded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS findings_prospect ON findings(prospect_id);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL,
  email_status TEXT NOT NULL,
  employer_domain TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('intro','followup')),
  attempt INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL,
  sections TEXT NOT NULL,
  evidence TEXT NOT NULL,
  opco_claim_ids TEXT NOT NULL,
  approach TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS comms_prospect ON communications(prospect_id);

CREATE TABLE IF NOT EXISTS qa_reports (
  id TEXT PRIMARY KEY,
  comm_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS','REWORK','REJECT')),
  checks TEXT NOT NULL,
  relevance TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qa_comm ON qa_reports(comm_id);

-- Every attempt to put a message on the wire. The partial unique index makes a
-- second live introduction or follow-up to the same prospect impossible.
CREATE TABLE IF NOT EXISTS outbound (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  comm_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('intro','followup','handoff')),
  to_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENDING','SENT','UNCERTAIN','FAILED')),
  provider_id TEXT,
  conversation_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outbound_one_per_step
  ON outbound(prospect_id, kind) WHERE status IN ('SENDING','SENT','UNCERTAIN') AND kind <> 'handoff';
CREATE UNIQUE INDEX IF NOT EXISTS outbound_one_per_comm
  ON outbound(comm_id) WHERE status IN ('SENDING','SENT','UNCERTAIN');
CREATE INDEX IF NOT EXISTS outbound_email ON outbound(to_email);

CREATE TABLE IF NOT EXISTS inbound (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE,
  prospect_id TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  conversation_id TEXT,
  classification TEXT,
  classification_reason TEXT
);
CREATE INDEX IF NOT EXISTS inbound_prospect ON inbound(prospect_id);
CREATE INDEX IF NOT EXISTS inbound_from ON inbound(from_email);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  inbound_id TEXT NOT NULL UNIQUE,
  prospect_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  verdict TEXT
);

CREATE TABLE IF NOT EXISTS suppression (
  value TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email','domain')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','dead','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opco_id TEXT,
  prospect_id TEXT,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_prospect ON events(prospect_id);

CREATE TABLE IF NOT EXISTS feedback (
  prospect_id TEXT PRIMARY KEY,
  false_positive INTEGER NOT NULL,
  note TEXT,
  by_user TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATOR','VIEWER')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function openDb(path = process.env.HIJOJO_DB_PATH ?? ".data/hijojo.db"): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/**
 * Run `fn` in a write transaction taken up front (BEGIN IMMEDIATE), so two
 * workers cannot both read "not yet sent" and both send.
 */
export function writeTx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}
