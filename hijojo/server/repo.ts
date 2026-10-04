// Data access. Rows in, domain objects out; no business decisions here.

import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Clock } from "./clock";
import type {
  ActivityEvent,
  Claim,
  CommStatus,
  Communication,
  Contact,
  EmailStatus,
  Finding,
  Handoff,
  InboundMessage,
  Opco,
  OpcoStatus,
  Prospect,
  ProspectingProfile,
  ProspectStatus,
  QaReport,
  ResponseClass,
  Source,
} from "../shared/types";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

const j = (v: unknown) => JSON.stringify(v);
const p = <T>(v: string | null): T => (v == null ? (null as T) : (JSON.parse(v) as T));

export interface OutboundRow {
  id: string;
  prospectId: string;
  commId: string;
  kind: "intro" | "followup" | "handoff";
  toEmail: string;
  status: "SENDING" | "SENT" | "UNCERTAIN" | "FAILED";
  providerId: string | null;
  conversationId: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export class Repo {
  constructor(
    readonly db: Db,
    readonly clock: Clock,
  ) {}

  now(): string {
    return this.clock.now().toISOString();
  }

  // ---- events ---------------------------------------------------------------
  event(type: string, detail: string, ids: { opcoId?: string | null; prospectId?: string | null } = {}): void {
    this.db
      .prepare("INSERT INTO events (opco_id, prospect_id, type, detail, at) VALUES (?,?,?,?,?)")
      .run(ids.opcoId ?? null, ids.prospectId ?? null, type, detail, this.now());
  }

  events(filter: { prospectId?: string; opcoId?: string; limit?: number } = {}): ActivityEvent[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.prospectId) (where.push("prospect_id = ?"), args.push(filter.prospectId));
    if (filter.opcoId) (where.push("opco_id = ?"), args.push(filter.opcoId));
    const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, filter.limit ?? 200) as any[]).map((r) => ({
      id: r.id,
      opcoId: r.opco_id,
      prospectId: r.prospect_id,
      type: r.type,
      detail: r.detail,
      at: r.at,
    }));
  }

  // ---- opcos ----------------------------------------------------------------
  createOpco(input: { name: string; website: string; introLink?: string | null; notes?: string }): Opco {
    const opco: Opco = {
      id: newId("opco"),
      name: input.name.trim(),
      website: input.website.trim(),
      introLink: (input.introLink ?? "").trim() || input.website.trim(),
      notes: input.notes ?? "",
      status: "NEW",
      statusDetail: null,
      createdAt: this.now(),
    };
    this.db
      .prepare("INSERT INTO opcos (id,name,website,intro_link,notes,status,status_detail,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(opco.id, opco.name, opco.website, opco.introLink, opco.notes, opco.status, null, opco.createdAt);
    this.event("opco.created", `${opco.name} (${opco.website})`, { opcoId: opco.id });
    return opco;
  }

  private opcoRow(r: any): Opco {
    return {
      id: r.id,
      name: r.name,
      website: r.website,
      introLink: r.intro_link,
      notes: r.notes,
      status: r.status,
      statusDetail: r.status_detail,
      createdAt: r.created_at,
    };
  }

  opco(id: string): Opco | null {
    const r = this.db.prepare("SELECT * FROM opcos WHERE id = ?").get(id);
    return r ? this.opcoRow(r) : null;
  }

  opcos(): Opco[] {
    return (this.db.prepare("SELECT * FROM opcos ORDER BY created_at").all() as any[]).map((r) => this.opcoRow(r));
  }

  setOpcoStatus(id: string, status: OpcoStatus, detail: string | null = null): void {
    this.db.prepare("UPDATE opcos SET status = ?, status_detail = ? WHERE id = ?").run(status, detail, id);
  }

  // ---- sources --------------------------------------------------------------
  addSource(s: Omit<Source, "id">, owner: { opcoId?: string; prospectId?: string }): Source {
    const src: Source = { id: newId("src"), ...s };
    this.db
      .prepare(
        "INSERT INTO sources (id,opco_id,prospect_id,url,kind,title,retrieved_at,published_at,content_hash,text) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(src.id, owner.opcoId ?? null, owner.prospectId ?? null, src.url, src.kind, src.title, src.retrievedAt, src.publishedAt, src.contentHash, src.text);
    return src;
  }

  private sourceRow(r: any): Source {
    return {
      id: r.id,
      url: r.url,
      kind: r.kind,
      title: r.title,
      retrievedAt: r.retrieved_at,
      publishedAt: r.published_at,
      contentHash: r.content_hash,
      text: r.text,
    };
  }

  source(id: string): Source | undefined {
    const r = this.db.prepare("SELECT * FROM sources WHERE id = ?").get(id);
    return r ? this.sourceRow(r) : undefined;
  }

  sourcesFor(owner: { opcoId?: string; prospectId?: string }): Source[] {
    const rows = owner.opcoId
      ? this.db.prepare("SELECT * FROM sources WHERE opco_id = ? ORDER BY retrieved_at").all(owner.opcoId)
      : this.db.prepare("SELECT * FROM sources WHERE prospect_id = ? ORDER BY retrieved_at").all(owner.prospectId);
    return (rows as any[]).map((r) => this.sourceRow(r));
  }

  // ---- claims & profile -------------------------------------------------------
  replaceClaims(opcoId: string, claims: Claim[]): void {
    this.db.prepare("DELETE FROM claims WHERE opco_id = ?").run(opcoId);
    const ins = this.db.prepare(
      "INSERT INTO claims (id,opco_id,field,statement,status,evidence,basis,note) VALUES (?,?,?,?,?,?,?,?)",
    );
    for (const c of claims) ins.run(c.id, opcoId, c.field, c.statement, c.status, j(c.evidence), c.basis, c.note);
  }

  claims(opcoId: string): Claim[] {
    return (this.db.prepare("SELECT * FROM claims WHERE opco_id = ?").all(opcoId) as any[]).map((r) => ({
      id: r.id,
      field: r.field,
      statement: r.statement,
      status: r.status,
      evidence: p(r.evidence),
      basis: r.basis,
      note: r.note,
    }));
  }

  saveProfile(profile: Omit<ProspectingProfile, "version" | "createdAt">): ProspectingProfile {
    const prev = this.db.prepare("SELECT MAX(version) v FROM profiles WHERE opco_id = ?").get(profile.opcoId) as { v: number | null };
    const full: ProspectingProfile = { ...profile, version: (prev.v ?? 0) + 1, createdAt: this.now() };
    this.db
      .prepare("INSERT INTO profiles (opco_id, version, body, created_at) VALUES (?,?,?,?)")
      .run(full.opcoId, full.version, j(full), full.createdAt);
    return full;
  }

  profile(opcoId: string): ProspectingProfile | null {
    const r = this.db
      .prepare("SELECT body FROM profiles WHERE opco_id = ? ORDER BY version DESC LIMIT 1")
      .get(opcoId) as { body: string } | undefined;
    return r ? p(r.body) : null;
  }

  // ---- prospects ------------------------------------------------------------
  private prospectRow(r: any): Prospect {
    return {
      id: r.id,
      opcoId: r.opco_id,
      name: r.name,
      domain: r.domain,
      status: r.status,
      statusReason: r.status_reason,
      attributes: p(r.attributes),
      score: p(r.score),
      whyThem: r.why_them,
      whyNow: r.why_now,
      whyProposition: r.why_proposition,
      conflicts: p(r.conflicts),
      contactId: r.contact_id,
      discoveredVia: r.discovered_via,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      researchedAt: r.researched_at,
    };
  }

  /** Returns null when the company is already a prospect for this OpCo. */
  createProspect(input: { opcoId: string; name: string; domain: string; discoveredVia: string }): Prospect | null {
    const now = this.now();
    const id = newId("pr");
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO prospects (id,opco_id,name,domain,status,attributes,discovered_via,created_at,updated_at)
         VALUES (?,?,?,?, 'RESEARCHING', ?, ?, ?, ?)`,
      )
      .run(id, input.opcoId, input.name, input.domain, j({ sector: null, employees: null, geography: null }), input.discoveredVia, now, now);
    if (res.changes === 0) return null;
    this.event("prospect.discovered", `${input.name} (${input.domain}) via ${input.discoveredVia}`, { opcoId: input.opcoId, prospectId: id });
    return this.prospect(id);
  }

  prospect(id: string): Prospect | null {
    const r = this.db.prepare("SELECT * FROM prospects WHERE id = ?").get(id);
    return r ? this.prospectRow(r) : null;
  }

  prospects(opcoId?: string): Prospect[] {
    const rows = opcoId
      ? this.db.prepare("SELECT * FROM prospects WHERE opco_id = ? ORDER BY created_at").all(opcoId)
      : this.db.prepare("SELECT * FROM prospects ORDER BY created_at").all();
    return (rows as any[]).map((r) => this.prospectRow(r));
  }

  prospectsByDomain(domain: string): Prospect[] {
    return (this.db.prepare("SELECT * FROM prospects WHERE domain = ?").all(domain) as any[]).map((r) => this.prospectRow(r));
  }

  updateProspect(id: string, patch: Partial<Omit<Prospect, "id" | "opcoId" | "createdAt">>): void {
    const cols: Record<string, unknown> = {};
    if (patch.name !== undefined) cols.name = patch.name;
    if (patch.status !== undefined) cols.status = patch.status;
    if (patch.statusReason !== undefined) cols.status_reason = patch.statusReason;
    if (patch.attributes !== undefined) cols.attributes = j(patch.attributes);
    if (patch.score !== undefined) cols.score = patch.score == null ? null : j(patch.score);
    if (patch.whyThem !== undefined) cols.why_them = patch.whyThem;
    if (patch.whyNow !== undefined) cols.why_now = patch.whyNow;
    if (patch.whyProposition !== undefined) cols.why_proposition = patch.whyProposition;
    if (patch.conflicts !== undefined) cols.conflicts = j(patch.conflicts);
    if (patch.contactId !== undefined) cols.contact_id = patch.contactId;
    if (patch.researchedAt !== undefined) cols.researched_at = patch.researchedAt;
    cols.updated_at = this.now();
    const keys = Object.keys(cols);
    this.db.prepare(`UPDATE prospects SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => cols[k]), id);
  }

  setProspectStatus(id: string, status: ProspectStatus, reason: string | null): void {
    const before = this.prospect(id);
    this.updateProspect(id, { status, statusReason: reason });
    if (before && before.status !== status) {
      this.event("prospect.status", `${before.status} → ${status}${reason ? `: ${reason}` : ""}`, { opcoId: before.opcoId, prospectId: id });
    }
  }

  // ---- findings -------------------------------------------------------------
  replaceFindings(prospectId: string, findings: Finding[]): void {
    this.db.prepare("UPDATE findings SET superseded = 1 WHERE prospect_id = ?").run(prospectId);
    const ins = this.db.prepare(
      "INSERT INTO findings (id,prospect_id,kind,statement,status,evidence,signal_id,observed_at,note) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const f of findings) ins.run(f.id, prospectId, f.kind, f.statement, f.status, j(f.evidence), f.signalId, f.observedAt, f.note);
  }

  private findingRow(r: any): Finding {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      kind: r.kind,
      statement: r.statement,
      status: r.status,
      evidence: p(r.evidence),
      signalId: r.signal_id,
      observedAt: r.observed_at,
      note: r.note,
    };
  }

  /** Current findings only; superseded ones are kept for the audit trail. */
  findings(prospectId: string): Finding[] {
    return (this.db.prepare("SELECT * FROM findings WHERE prospect_id = ? AND superseded = 0").all(prospectId) as any[]).map((r) =>
      this.findingRow(r),
    );
  }

  finding(id: string): Finding | null {
    const r = this.db.prepare("SELECT * FROM findings WHERE id = ?").get(id);
    return r ? this.findingRow(r) : null;
  }

  // ---- contacts -------------------------------------------------------------
  addContact(c: Omit<Contact, "id">): Contact {
    const contact: Contact = { id: newId("ct"), ...c, email: c.email.trim().toLowerCase(), employerDomain: c.employerDomain.toLowerCase() };
    this.db
      .prepare("INSERT INTO contacts (id,prospect_id,name,title,email,email_status,employer_domain,source,source_url) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(contact.id, contact.prospectId, contact.name, contact.title, contact.email, contact.emailStatus, contact.employerDomain, contact.source, contact.sourceUrl);
    return contact;
  }

  contact(id: string): Contact | null {
    const r = this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as any;
    return r
      ? {
          id: r.id,
          prospectId: r.prospect_id,
          name: r.name,
          title: r.title,
          email: r.email,
          emailStatus: r.email_status,
          employerDomain: r.employer_domain,
          source: r.source,
          sourceUrl: r.source_url,
        }
      : null;
  }

  contactsByEmail(email: string): Contact[] {
    return (this.db.prepare("SELECT id FROM contacts WHERE email = ?").all(email.toLowerCase()) as any[]).map((r) => this.contact(r.id)!);
  }

  setEmailStatus(email: string, status: EmailStatus): void {
    this.db.prepare("UPDATE contacts SET email_status = ? WHERE email = ?").run(status, email.toLowerCase());
  }

  // ---- communications -------------------------------------------------------
  addCommunication(c: Omit<Communication, "id" | "createdAt" | "sentAt" | "status" | "statusReason">): Communication {
    const comm: Communication = { ...c, id: newId("cm"), status: "DRAFT", statusReason: null, createdAt: this.now(), sentAt: null };
    this.db
      .prepare(
        `INSERT INTO communications (id,prospect_id,contact_id,kind,attempt,subject,body,link,sections,evidence,opco_claim_ids,approach,status,status_reason,content_hash,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        comm.id, comm.prospectId, comm.contactId, comm.kind, comm.attempt, comm.subject, comm.body, comm.link,
        j(comm.sections), j(comm.evidence), j(comm.opcoClaimIds), comm.approach, comm.status, null, comm.contentHash, comm.createdAt,
      );
    return comm;
  }

  private commRow(r: any): Communication {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      contactId: r.contact_id,
      kind: r.kind,
      attempt: r.attempt,
      subject: r.subject,
      body: r.body,
      link: r.link,
      sections: p(r.sections),
      evidence: p(r.evidence),
      opcoClaimIds: p(r.opco_claim_ids),
      approach: r.approach,
      status: r.status,
      statusReason: r.status_reason,
      contentHash: r.content_hash,
      createdAt: r.created_at,
      sentAt: r.sent_at,
    };
  }

  communication(id: string): Communication | null {
    const r = this.db.prepare("SELECT * FROM communications WHERE id = ?").get(id);
    return r ? this.commRow(r) : null;
  }

  communications(filter: { prospectId?: string; opcoId?: string } = {}): Communication[] {
    if (filter.prospectId) {
      return (this.db.prepare("SELECT * FROM communications WHERE prospect_id = ? ORDER BY created_at").all(filter.prospectId) as any[]).map((r) =>
        this.commRow(r),
      );
    }
    if (filter.opcoId) {
      return (
        this.db
          .prepare("SELECT c.* FROM communications c JOIN prospects p ON p.id = c.prospect_id WHERE p.opco_id = ? ORDER BY c.created_at")
          .all(filter.opcoId) as any[]
      ).map((r) => this.commRow(r));
    }
    return (this.db.prepare("SELECT * FROM communications ORDER BY created_at").all() as any[]).map((r) => this.commRow(r));
  }

  setCommStatus(id: string, status: CommStatus, reason: string | null = null, sentAt?: string): void {
    this.db
      .prepare("UPDATE communications SET status = ?, status_reason = ?, sent_at = COALESCE(?, sent_at) WHERE id = ?")
      .run(status, reason, sentAt ?? null, id);
  }

  // ---- QA -------------------------------------------------------------------
  addQaReport(r: Omit<QaReport, "id" | "createdAt">): QaReport {
    const report: QaReport = { ...r, id: newId("qa"), createdAt: this.now() };
    this.db
      .prepare("INSERT INTO qa_reports (id,comm_id,verdict,checks,relevance,reviewer,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(report.id, report.commId, report.verdict, j(report.checks), j(report.relevance), report.reviewer, report.contentHash, report.createdAt);
    return report;
  }

  qaReports(commId: string): QaReport[] {
    return (this.db.prepare("SELECT * FROM qa_reports WHERE comm_id = ? ORDER BY created_at").all(commId) as any[]).map((r) => ({
      id: r.id,
      commId: r.comm_id,
      verdict: r.verdict,
      checks: p(r.checks),
      relevance: p(r.relevance),
      reviewer: r.reviewer,
      contentHash: r.content_hash,
      createdAt: r.created_at,
    }));
  }

  allQaVerdicts(): { verdict: string; n: number }[] {
    return this.db.prepare("SELECT verdict, COUNT(*) n FROM qa_reports GROUP BY verdict").all() as any[];
  }

  // ---- outbound ---------------------------------------------------------------
  private outboundRow(r: any): OutboundRow {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      commId: r.comm_id,
      kind: r.kind,
      toEmail: r.to_email,
      status: r.status,
      providerId: r.provider_id,
      conversationId: r.conversation_id,
      detail: r.detail,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  insertOutbound(o: { prospectId: string; commId: string; kind: OutboundRow["kind"]; toEmail: string }): OutboundRow {
    const now = this.now();
    const id = newId("ob");
    this.db
      .prepare("INSERT INTO outbound (id,prospect_id,comm_id,kind,to_email,status,created_at,updated_at) VALUES (?,?,?,?,?,'SENDING',?,?)")
      .run(id, o.prospectId, o.commId, o.kind, o.toEmail.toLowerCase(), now, now);
    return this.outbound(id)!;
  }

  outbound(id: string): OutboundRow | null {
    const r = this.db.prepare("SELECT * FROM outbound WHERE id = ?").get(id);
    return r ? this.outboundRow(r) : null;
  }

  outboundFor(filter: { prospectId?: string; commId?: string; email?: string; conversationId?: string }): OutboundRow[] {
    const [col, val] = filter.prospectId
      ? ["prospect_id", filter.prospectId]
      : filter.commId
        ? ["comm_id", filter.commId]
        : filter.email
          ? ["to_email", filter.email.toLowerCase()]
          : ["conversation_id", filter.conversationId];
    return (this.db.prepare(`SELECT * FROM outbound WHERE ${col} = ? ORDER BY created_at`).all(val) as any[]).map((r) => this.outboundRow(r));
  }

  allOutbound(): OutboundRow[] {
    return (this.db.prepare("SELECT * FROM outbound ORDER BY created_at").all() as any[]).map((r) => this.outboundRow(r));
  }

  updateOutbound(id: string, patch: { status: OutboundRow["status"]; providerId?: string | null; conversationId?: string | null; detail?: string | null }): void {
    this.db
      .prepare(
        "UPDATE outbound SET status = ?, provider_id = COALESCE(?, provider_id), conversation_id = COALESCE(?, conversation_id), detail = COALESCE(?, detail), updated_at = ? WHERE id = ?",
      )
      .run(patch.status, patch.providerId ?? null, patch.conversationId ?? null, patch.detail ?? null, this.now(), id);
  }

  sentSince(sinceIso: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) n FROM outbound WHERE kind IN ('intro','followup') AND status IN ('SENT','SENDING','UNCERTAIN') AND created_at >= ?")
        .get(sinceIso) as { n: number }
    ).n;
  }

  // ---- inbound ----------------------------------------------------------------
  /** Returns null if this provider message was already recorded (idempotent sync). */
  addInbound(m: Omit<InboundMessage, "id" | "classification" | "classificationReason">): InboundMessage | null {
    const id = newId("in");
    const res = this.db
      .prepare(
        "INSERT OR IGNORE INTO inbound (id,provider_id,prospect_id,from_email,from_name,subject,body,received_at,conversation_id) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(id, m.providerId, m.prospectId, m.fromEmail.toLowerCase(), m.fromName, m.subject, m.body, m.receivedAt, m.conversationId);
    return res.changes ? this.inbound(id) : null;
  }

  private inboundRow(r: any): InboundMessage {
    return {
      id: r.id,
      providerId: r.provider_id,
      prospectId: r.prospect_id,
      fromEmail: r.from_email,
      fromName: r.from_name,
      subject: r.subject,
      body: r.body,
      receivedAt: r.received_at,
      conversationId: r.conversation_id,
      classification: r.classification,
      classificationReason: r.classification_reason,
    };
  }

  inbound(id: string): InboundMessage | null {
    const r = this.db.prepare("SELECT * FROM inbound WHERE id = ?").get(id);
    return r ? this.inboundRow(r) : null;
  }

  inboundFor(filter: { prospectId?: string; email?: string; domain?: string }): InboundMessage[] {
    let rows: any[];
    if (filter.prospectId) rows = this.db.prepare("SELECT * FROM inbound WHERE prospect_id = ? ORDER BY received_at").all(filter.prospectId) as any[];
    else if (filter.email) rows = this.db.prepare("SELECT * FROM inbound WHERE from_email = ?").all(filter.email.toLowerCase()) as any[];
    else rows = this.db.prepare("SELECT * FROM inbound WHERE from_email LIKE ?").all(`%@${filter.domain!.toLowerCase()}`) as any[];
    return rows.map((r) => this.inboundRow(r));
  }

  allInbound(): InboundMessage[] {
    return (this.db.prepare("SELECT * FROM inbound ORDER BY received_at").all() as any[]).map((r) => this.inboundRow(r));
  }

  classifyInbound(id: string, cls: ResponseClass, reason: string): void {
    this.db.prepare("UPDATE inbound SET classification = ?, classification_reason = ? WHERE id = ?").run(cls, reason, id);
  }

  // ---- handoffs ---------------------------------------------------------------
  addHandoff(h: Omit<Handoff, "id" | "createdAt" | "sentAt" | "status" | "verdict">): Handoff | null {
    const id = newId("ho");
    const res = this.db
      .prepare("INSERT OR IGNORE INTO handoffs (id,inbound_id,prospect_id,to_email,subject,body,status,created_at) VALUES (?,?,?,?,?,?,'PENDING',?)")
      .run(id, h.inboundId, h.prospectId, h.to, h.subject, h.body, this.now());
    return res.changes ? this.handoff(id) : null;
  }

  private handoffRow(r: any): Handoff {
    return {
      id: r.id,
      inboundId: r.inbound_id,
      prospectId: r.prospect_id,
      to: r.to_email,
      subject: r.subject,
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      verdict: r.verdict,
    };
  }

  handoff(id: string): Handoff | null {
    const r = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id);
    return r ? this.handoffRow(r) : null;
  }

  handoffs(filter: { prospectId?: string } = {}): Handoff[] {
    const rows = filter.prospectId
      ? this.db.prepare("SELECT * FROM handoffs WHERE prospect_id = ? ORDER BY created_at").all(filter.prospectId)
      : this.db.prepare("SELECT * FROM handoffs ORDER BY created_at").all();
    return (rows as any[]).map((r) => this.handoffRow(r));
  }

  setHandoffStatus(id: string, status: Handoff["status"], sentAt: string | null = null): void {
    this.db.prepare("UPDATE handoffs SET status = ?, sent_at = COALESCE(?, sent_at) WHERE id = ?").run(status, sentAt, id);
  }

  setHandoffVerdict(id: string, verdict: "ACCEPTED" | "DECLINED"): void {
    this.db.prepare("UPDATE handoffs SET verdict = ? WHERE id = ?").run(verdict, id);
  }

  // ---- suppression ------------------------------------------------------------
  suppress(value: string, kind: "email" | "domain", reason: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO suppression (value, kind, reason, created_at) VALUES (?,?,?,?)")
      .run(value.trim().toLowerCase(), kind, reason, this.now());
    this.event("suppression.added", `${kind} ${value}: ${reason}`);
  }

  isSuppressed(email: string): { suppressed: boolean; reason: string | null } {
    const e = email.trim().toLowerCase();
    const domain = e.split("@")[1] ?? "";
    const r = this.db.prepare("SELECT reason FROM suppression WHERE value IN (?, ?)").get(e, domain) as { reason: string } | undefined;
    return { suppressed: !!r, reason: r?.reason ?? null };
  }

  suppressionList(): { value: string; kind: string; reason: string; createdAt: string }[] {
    return (this.db.prepare("SELECT * FROM suppression ORDER BY created_at DESC").all() as any[]).map((r) => ({
      value: r.value,
      kind: r.kind,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  // ---- feedback ---------------------------------------------------------------
  setFeedback(prospectId: string, falsePositive: boolean, note: string | null, byUser: string | null): void {
    this.db
      .prepare(
        "INSERT INTO feedback (prospect_id,false_positive,note,by_user,at) VALUES (?,?,?,?,?) ON CONFLICT(prospect_id) DO UPDATE SET false_positive = excluded.false_positive, note = excluded.note, by_user = excluded.by_user, at = excluded.at",
      )
      .run(prospectId, falsePositive ? 1 : 0, note, byUser, this.now());
  }

  feedback(): { prospectId: string; falsePositive: boolean }[] {
    return (this.db.prepare("SELECT * FROM feedback").all() as any[]).map((r) => ({ prospectId: r.prospect_id, falsePositive: !!r.false_positive }));
  }

  // ---- settings ---------------------------------------------------------------
  setting(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}
