// The engine runs the remit's operating loop, and nothing beyond it:
//
//   enter OpCo → understand → profile → search → research → qualify → score →
//   self-QA → send intro → monitor → (response → stop → hand to Mark)
//   | (no response → wait 5 days → re-validate → one follow-up → stop)
//
// Each stage is a durable job. Sending is the only step that leaves the
// building, and it re-checks everything inside a write transaction first.

import type { Repo } from "./repo";
import { writeTx } from "./db";
import type { Config } from "./config";
import type { Fetcher } from "./research/fetcher";
import type { Llm } from "./llm/client";
import type { Inbox, MailTransport, ReceivedMail } from "./mail/transport";
import { JobQueue, type Job } from "./jobs/queue";
import { analyseOpco } from "./agents/opco";
import {
  dedupeCandidates,
  identifyContact,
  qualifyProspect,
  researchProspect,
  type CandidateSource,
  type ContactProvider,
} from "./agents/prospect";
import { composeCommunication } from "./agents/compose";
import { qaCommunication } from "./qa/run";
import { classifyResponse } from "./responses/classifier";
import { buildHandoff } from "./responses/handoff";
import { bareDomain, effectiveThreshold, matchExclusion } from "./qualification";
import { addDays } from "./clock";
import { suspendedSignals } from "./metrics";
import { HANDOFF_CLASSES, type CommKind, type Communication, type InboundMessage, type QaCheck } from "../shared/types";

export interface EngineDeps {
  repo: Repo;
  config: Config;
  llm: Llm;
  /** Optional independent model reviewer for QA. Null means rules only. */
  reviewer: Llm | null;
  fetcher: Fetcher;
  contacts: ContactProvider;
  candidates: CandidateSource[];
  transport: MailTransport;
  inbox: Inbox;
}

export type SendOutcome =
  | { outcome: "sent" }
  | { outcome: "blocked"; reason: string }
  | { outcome: "deferred"; reason: string; until: string }
  | { outcome: "uncertain"; reason: string }
  | { outcome: "failed"; reason: string };

class Deferred extends Error {
  constructor(
    readonly until: string,
    message: string,
  ) {
    super(message);
  }
}

export class Engine {
  readonly jobs: JobQueue;
  constructor(readonly d: EngineDeps) {
    this.jobs = new JobQueue(d.repo);
  }

  private get repo() {
    return this.d.repo;
  }

  threshold(): number {
    return effectiveThreshold(Number(this.repo.setting("threshold") ?? NaN));
  }

  halted(): boolean {
    return this.repo.setting("halted") === "1";
  }

  /** Live sending needs three keys: live mode in config, a live transport, and an administrator's switch. */
  sendingState(): { canSend: boolean; mode: "simulate" | "live"; reason: string | null } {
    if (this.halted()) return { canSend: false, mode: this.d.config.sendMode, reason: "Sending is halted" };
    if (this.d.config.sendMode === "simulate") {
      return this.d.transport.live
        ? { canSend: false, mode: "simulate", reason: "Simulation mode with a live transport configured; refusing to send" }
        : { canSend: true, mode: "simulate", reason: null };
    }
    if (!this.d.transport.live) return { canSend: false, mode: "live", reason: "Live mode, but no live mail transport is configured" };
    if (this.repo.setting("live_sending") !== "on") return { canSend: false, mode: "live", reason: "Live sending has not been switched on by an administrator" };
    return { canSend: true, mode: "live", reason: null };
  }

  // ---- entry points -----------------------------------------------------------

  addOpco(input: { name: string; website: string; introLink?: string | null; notes?: string }) {
    const opco = this.repo.createOpco(input);
    this.jobs.enqueue("analyse_opco", { opcoId: opco.id }, { key: `analyse_opco:${opco.id}:${this.repo.now()}` });
    return opco;
  }

  /** Add a company the operator already knows about; it is researched and qualified like any other. */
  addProspect(opcoId: string, input: { name: string; domain: string; urls?: string[] }) {
    const p = this.repo.createProspect({ opcoId, name: input.name, domain: bareDomain(input.domain), discoveredVia: "operator" });
    if (p) this.jobs.enqueue("research", { prospectId: p.id, urls: input.urls ?? [] }, { key: `research:${p.id}:1` });
    return p;
  }

  // ---- worker -----------------------------------------------------------------

  /** Run due jobs until none are left (or `max` have run). */
  async runDue(max = 500): Promise<number> {
    let n = 0;
    for (; n < max; n++) {
      const job = this.jobs.claim();
      if (!job) break;
      await this.runJob(job);
    }
    return n;
  }

  private async runJob(job: Job): Promise<void> {
    try {
      await this.handle(job);
      this.jobs.complete(job.id);
    } catch (e) {
      if (e instanceof Deferred) {
        this.jobs.defer(job, e.until);
        return;
      }
      const msg = (e as Error).message ?? String(e);
      const r = this.jobs.fail(job, msg);
      this.repo.event(`job.${r}`, `${job.type}: ${msg}`, { prospectId: job.payload?.prospectId ?? null, opcoId: job.payload?.opcoId ?? null });
      if (r === "dead" && job.type === "analyse_opco") this.repo.setOpcoStatus(job.payload.opcoId, "FAILED", msg);
    }
  }

  private async handle(job: Job): Promise<void> {
    const p = job.payload;
    switch (job.type) {
      case "analyse_opco":
        return this.analyse(p.opcoId);
      case "discover":
        return this.discover(p.opcoId);
      case "research":
        return this.research(p.prospectId, p.urls ?? []);
      case "qualify":
        return this.qualify(p.prospectId);
      case "compose":
        return this.compose(p.prospectId, p.kind, p.attempt, p.feedbackCommId ?? null);
      case "send":
        await this.send(p.commId);
        return;
      case "reconcile":
        return this.reconcile(p.commId, p.providerRef ?? null, p.round ?? 1);
      case "followup_check":
        return this.followupCheck(p.prospectId);
      case "close_sequence":
        return this.closeSequence(p.prospectId);
      case "sync_inbox":
        await this.syncInbox();
        return;
      case "handoff":
        return this.sendHandoff(p.inboundId);
    }
  }

  // ---- understand & profile ---------------------------------------------------

  private async analyse(opcoId: string) {
    const profile = await analyseOpco({ repo: this.repo, llm: this.d.llm, fetcher: this.d.fetcher }, opcoId);
    if (profile?.complete) this.jobs.enqueue("discover", { opcoId }, { key: `discover:${opcoId}:${profile.version}` });
  }

  // ---- search -----------------------------------------------------------------

  async discover(opcoId: string) {
    const opco = this.repo.opco(opcoId)!;
    const profile = this.repo.profile(opcoId);
    if (!profile?.complete) {
      this.repo.event("discover.skipped", "Profile incomplete; prospecting cannot start", { opcoId });
      return;
    }
    const limit = this.d.config.maxNewProspectsPerRun;
    const found = [];
    for (const source of this.d.candidates) {
      try {
        found.push(...(await source.find({ opco, profile, limit })));
      } catch (e) {
        this.repo.event("discover.source_failed", `${source.name}: ${(e as Error).message}`, { opcoId });
      }
    }
    let created = 0;
    for (const c of dedupeCandidates(found)) {
      if (created >= limit) break;
      const p = this.repo.createProspect({ opcoId, name: c.name, domain: c.domain, discoveredVia: c.via });
      if (!p) continue; // already known: duplicate prevented
      created++;
      const excluded = matchExclusion({ name: c.name, domain: c.domain, attributes: p.attributes }, profile);
      if (excluded) {
        this.repo.setProspectStatus(p.id, "REJECTED", `Excluded (${excluded.kind}): ${excluded.reason}`);
        continue;
      }
      this.jobs.enqueue("research", { prospectId: p.id, urls: c.urls }, { key: `research:${p.id}:1` });
    }
    this.repo.event("discover.done", `${found.length} candidate(s), ${created} new prospect(s)`, { opcoId });
  }

  // ---- research, contact, qualify ---------------------------------------------

  private async research(prospectId: string, urls: string[]) {
    const r = await researchProspect({ repo: this.repo, llm: this.d.llm, fetcher: this.d.fetcher }, prospectId, urls);
    if (!r.ok) return;
    const contact = await identifyContact({ repo: this.repo, contacts: this.d.contacts }, prospectId);
    if (!contact) {
      this.repo.setProspectStatus(
        prospectId,
        "RESEARCHING",
        this.d.contacts.configured ? "No relevant decision-maker identified" : "Awaiting a decision-maker: no contact-data provider is configured; add one manually",
      );
      return;
    }
    this.jobs.enqueue("qualify", { prospectId }, { key: `qualify:${prospectId}:${this.repo.now()}` });
  }

  private async qualify(prospectId: string) {
    const r = await qualifyProspect(
      { repo: this.repo, llm: this.d.llm, threshold: this.threshold(), suspendedSignals: suspendedSignals(this.repo) },
      prospectId,
    );
    if (r.status === "QUALIFIED") this.jobs.enqueue("compose", { prospectId, kind: "intro", attempt: 1 }, { key: `compose:${prospectId}:intro:1` });
  }

  // ---- communicate & QA -------------------------------------------------------

  private async compose(prospectId: string, kind: CommKind, attempt: number, feedbackCommId: string | null) {
    const prospect = this.repo.prospect(prospectId)!;
    const expected = kind === "intro" ? "QUALIFIED" : "FOLLOW_UP_DUE";
    if (prospect.status !== expected) {
      this.repo.event("compose.skipped", `${kind}: prospect is ${prospect.status}`, { opcoId: prospect.opcoId, prospectId });
      return;
    }
    const contact = this.repo.contact(prospect.contactId!)!;
    const opco = this.repo.opco(prospect.opcoId)!;
    const feedback: QaCheck[] = feedbackCommId ? (this.repo.qaReports(feedbackCommId).at(-1)?.checks.filter((c) => !c.passed) ?? []) : [];
    const previous = kind === "followup" ? (this.repo.communications({ prospectId }).find((c) => c.kind === "intro" && c.status === "SENT") ?? null) : null;

    const comm = await composeCommunication(
      { repo: this.repo, llm: this.d.llm },
      {
        kind,
        opco,
        prospect,
        contact,
        findings: this.repo.findings(prospectId),
        claims: this.repo.claims(opco.id),
        senderName: this.d.config.senderName,
        attempt,
        previous,
        feedback,
      },
    );
    const report = await qaCommunication({ repo: this.repo, config: this.d.config, reviewer: this.d.reviewer }, comm.id);
    if (report.verdict === "PASS") {
      this.jobs.enqueue("send", { commId: comm.id }, { key: `send:${comm.id}` });
      return;
    }
    const failed = report.checks.filter((c) => !c.passed);
    const prospectFail = failed.find((c) => c.scope === "prospect" && c.severity === "reject");
    if (prospectFail) {
      this.endSequence(prospectId, kind, "REJECTED", `QA: ${prospectFail.detail}`);
      return;
    }
    const researchFail = failed.filter((c) => c.scope === "research");
    if (researchFail.length) {
      if (researchFail.some((c) => c.name === "evidence.fresh") && researchFail.every((c) => c.name === "evidence.fresh" || c.name === "recipient.verified") && attempt < this.d.config.maxComposeAttempts) {
        // Stale evidence: refresh it, then re-qualify from scratch.
        this.repo.setProspectStatus(prospectId, "RESEARCHING", "QA: evidence needs refreshing");
        if (kind === "intro") this.jobs.enqueue("research", { prospectId, urls: [] }, { key: `research:${prospectId}:${this.repo.now()}` });
        return;
      }
      this.endSequence(prospectId, kind, "RESEARCHING", `QA returned for research: ${researchFail.map((c) => c.detail).join("; ")}`);
      return;
    }
    if (attempt < this.d.config.maxComposeAttempts) {
      this.jobs.enqueue("compose", { prospectId, kind, attempt: attempt + 1, feedbackCommId: comm.id }, { key: `compose:${prospectId}:${kind}:${attempt + 1}` });
      return;
    }
    this.endSequence(prospectId, kind, "RESEARCHING", `No ${kind} passed QA after ${attempt} attempts: ${failed.map((c) => c.name).join(", ")}`);
  }

  /** A follow-up that cannot be sent ends the sequence; it never re-enters research. */
  private endSequence(prospectId: string, kind: CommKind, status: "REJECTED" | "RESEARCHING", reason: string) {
    if (kind === "followup") this.repo.setProspectStatus(prospectId, "CLOSED", `Follow-up not sent. ${reason}`);
    else this.repo.setProspectStatus(prospectId, status, reason);
  }

  // ---- send ---------------------------------------------------------------------

  async send(commId: string): Promise<SendOutcome> {
    const repo = this.repo;
    const comm = repo.communication(commId);
    if (!comm) return { outcome: "blocked", reason: "No such communication" };
    if (comm.status === "SENDING") {
      // A worker died mid-send. Do not resend; find out what happened.
      repo.setCommStatus(commId, "UNCERTAIN", "Interrupted during send");
      this.jobs.enqueue("reconcile", { commId, providerRef: null }, { key: `reconcile:${commId}:1` });
      return { outcome: "uncertain", reason: "Interrupted during send" };
    }
    if (comm.status !== "QA_PASS") return { outcome: "blocked", reason: `Communication is ${comm.status}, not QA_PASS` };
    const qa = repo.qaReports(commId).at(-1);
    if (!qa || qa.verdict !== "PASS" || qa.contentHash !== comm.contentHash) return this.block(comm, "The content sent must be exactly the content QA passed");

    // Links are checked immediately before sending.
    const link = await this.d.fetcher.check(comm.link);
    if (!link.ok) return this.block(comm, `Link check failed for ${comm.link}: ${link.error ?? `HTTP ${link.status}`}`);

    const prospect = repo.prospect(comm.prospectId)!;
    const contact = repo.contact(comm.contactId)!;
    let outboundId: string;
    try {
      outboundId = writeTx(repo.db, () => {
        const state = this.sendingState();
        if (!state.canSend) throw new Blocked(state.reason!);
        const cap = this.d.config.dailySendCap;
        if (repo.sentSince(addDays(repo.clock.now(), -1)) >= cap) {
          throw new Deferred(new Date(repo.clock.now().getTime() + 60 * 60_000).toISOString(), `Daily cap of ${cap} reached`);
        }
        const p = repo.prospect(comm.prospectId)!;
        const expected = comm.kind === "intro" ? "QUALIFIED" : "FOLLOW_UP_DUE";
        if (p.status !== expected) throw new Blocked(`Prospect is ${p.status}; a ${comm.kind} needs ${expected}`);
        const sup = repo.isSuppressed(contact.email);
        if (sup.suppressed) throw new Blocked(`Recipient suppressed: ${sup.reason}`);
        const c = repo.contact(contact.id)!;
        if (c.emailStatus === "bounced" || c.emailStatus === "invalid") throw new Blocked(`Address is ${c.emailStatus}`);
        const replied =
          repo.inboundFor({ prospectId: p.id }).length + repo.inboundFor({ email: contact.email }).length + repo.inboundFor({ domain: bareDomain(p.domain) }).length;
        if (replied) throw new Blocked("A response has been received; automation has stopped");
        try {
          const row = repo.insertOutbound({ prospectId: p.id, commId, kind: comm.kind, toEmail: contact.email });
          repo.setCommStatus(commId, "SENDING");
          return row.id;
        } catch (e) {
          if (String((e as Error).message).includes("UNIQUE")) throw new Blocked(`A ${comm.kind} has already been sent to this prospect`);
          throw e;
        }
      });
    } catch (e) {
      if (e instanceof Blocked) return this.block(comm, e.message);
      if (e instanceof Deferred) {
        repo.event("send.deferred", e.message, { opcoId: prospect.opcoId, prospectId: prospect.id });
        throw e;
      }
      throw e;
    }

    const result = await this.d.transport.send({
      to: contact.email,
      toName: contact.name,
      subject: comm.subject,
      body: comm.body,
      idempotencyKey: commId,
    });

    if (result.status === "sent") {
      this.recordSent(comm, outboundId, result.providerId, result.conversationId);
      return { outcome: "sent" };
    }
    if (result.status === "uncertain") {
      repo.updateOutbound(outboundId, { status: "UNCERTAIN", detail: result.reason });
      repo.setCommStatus(commId, "UNCERTAIN", result.reason);
      repo.event("send.uncertain", `${result.reason}; reconciling, will not resend blindly`, { opcoId: prospect.opcoId, prospectId: prospect.id });
      this.jobs.enqueue("reconcile", { commId, providerRef: result.providerRef }, {
        key: `reconcile:${commId}:1`,
        runAt: new Date(repo.clock.now().getTime() + 10 * 60_000).toISOString(),
      });
      return { outcome: "uncertain", reason: result.reason };
    }
    // Definitely not sent.
    repo.updateOutbound(outboundId, { status: "FAILED", detail: result.reason });
    if (result.invalidRecipient) {
      repo.setCommStatus(commId, "FAILED", result.reason);
      repo.setEmailStatus(contact.email, "invalid");
      repo.suppress(contact.email, "email", `Invalid recipient: ${result.reason}`);
      this.endSequence(prospect.id, comm.kind, "RESEARCHING", `Recipient rejected by the mail server: ${result.reason}`);
      return { outcome: "failed", reason: result.reason };
    }
    repo.setCommStatus(commId, "QA_PASS", `Send failed: ${result.reason}`);
    if (result.permanent) {
      repo.setCommStatus(commId, "FAILED", result.reason);
      this.endSequence(prospect.id, comm.kind, "RESEARCHING", `Send failed: ${result.reason}`);
      return { outcome: "failed", reason: result.reason };
    }
    throw new Error(`Transient send failure: ${result.reason}`);
  }

  private block(comm: Communication, reason: string): SendOutcome {
    this.repo.setCommStatus(comm.id, "SEND_BLOCKED", reason);
    const p = this.repo.prospect(comm.prospectId)!;
    this.repo.event("send.blocked", `${comm.kind}: ${reason}`, { opcoId: p.opcoId, prospectId: p.id });
    return { outcome: "blocked", reason };
  }

  private recordSent(comm: Communication, outboundId: string, providerId: string, conversationId: string | null) {
    const repo = this.repo;
    const now = repo.now();
    writeTx(repo.db, () => {
      repo.updateOutbound(outboundId, { status: "SENT", providerId, conversationId });
      repo.setCommStatus(comm.id, "SENT", null, now);
      if (comm.kind === "intro") {
        repo.setProspectStatus(comm.prospectId, "CONTACTED", `Introduction sent ${now.slice(0, 10)}`);
        this.jobs.enqueue("followup_check", { prospectId: comm.prospectId }, {
          key: `followup_check:${comm.prospectId}`,
          runAt: addDays(now, this.d.config.followupAfterDays),
        });
      } else {
        repo.setProspectStatus(comm.prospectId, "FOLLOWED_UP", `Follow-up sent ${now.slice(0, 10)}; no further automated messages`);
        this.jobs.enqueue("close_sequence", { prospectId: comm.prospectId }, {
          key: `close_sequence:${comm.prospectId}`,
          runAt: addDays(now, this.d.config.closeAfterDays),
        });
      }
    });
    const p = repo.prospect(comm.prospectId)!;
    repo.event("send.sent", `${comm.kind} to ${repo.contact(comm.contactId)!.email} via ${this.d.transport.name}`, { opcoId: p.opcoId, prospectId: p.id });
  }

  private async reconcile(commId: string, providerRef: string | null, round: number) {
    const comm = this.repo.communication(commId)!;
    const ob = this.repo.outboundFor({ commId }).find((o) => o.status === "UNCERTAIN" || o.status === "SENDING");
    if (!ob) return;
    const r = await this.d.transport.reconcile(providerRef, commId);
    if (r.status === "sent") {
      this.recordSent(comm, ob.id, r.providerId, r.conversationId);
      return;
    }
    if (r.status === "not_sent") {
      this.repo.updateOutbound(ob.id, { status: "FAILED", detail: "Reconciled: not sent" });
      this.repo.setCommStatus(commId, "QA_PASS", "Reconciled: not sent; retrying");
      this.jobs.enqueue("send", { commId }, { key: `send:${commId}:retry:${round}` });
      return;
    }
    const p = this.repo.prospect(comm.prospectId)!;
    if (round >= 3) {
      this.repo.event("send.unresolved", "Could not establish whether the message was sent; held for a human. It will not be resent.", { opcoId: p.opcoId, prospectId: p.id });
      return;
    }
    this.jobs.enqueue("reconcile", { commId, providerRef, round: round + 1 }, {
      key: `reconcile:${commId}:${round + 1}`,
      runAt: new Date(this.repo.clock.now().getTime() + 30 * 60_000).toISOString(),
    });
  }

  // ---- wait five days, re-validate, one follow-up, stop -------------------------

  private async followupCheck(prospectId: string) {
    const p = this.repo.prospect(prospectId)!;
    if (p.status !== "CONTACTED") return; // responded, closed or otherwise moved on
    if (this.repo.inboundFor({ prospectId }).length) return;
    this.repo.setProspectStatus(prospectId, "FOLLOW_UP_DUE", "No response after five days; re-validating");

    const refreshed = await researchProspect({ repo: this.repo, llm: this.d.llm, fetcher: this.d.fetcher }, prospectId);
    // Research may have reset the status; restore it unless a response arrived meanwhile.
    if (this.repo.inboundFor({ prospectId }).length) return;
    if (!refreshed.ok) {
      this.repo.setProspectStatus(prospectId, "CLOSED", `Re-validation failed (${refreshed.reason}); no follow-up sent`);
      return;
    }
    const decision = await qualifyProspect(
      { repo: this.repo, llm: this.d.llm, threshold: this.threshold(), suspendedSignals: suspendedSignals(this.repo) },
      prospectId,
      { apply: false },
    );
    if (this.repo.inboundFor({ prospectId }).length) return;
    if (decision.status !== "QUALIFIED") {
      this.repo.setProspectStatus(prospectId, "CLOSED", `Re-validation: ${decision.reason}; no follow-up sent`);
      return;
    }
    this.repo.setProspectStatus(prospectId, "FOLLOW_UP_DUE", "Re-validated; composing the follow-up");
    this.jobs.enqueue("compose", { prospectId, kind: "followup", attempt: 1 }, { key: `compose:${prospectId}:followup:1` });
  }

  private async closeSequence(prospectId: string) {
    const p = this.repo.prospect(prospectId)!;
    if (p.status === "FOLLOWED_UP") this.repo.setProspectStatus(prospectId, "CLOSED", "No response to the introduction or the follow-up");
  }

  // ---- monitor responses ----------------------------------------------------------

  async syncInbox(): Promise<number> {
    const last = this.repo.setting("inbox_synced_at") ?? addDays(this.repo.clock.now(), -30);
    const since = addDays(last, -1); // overlap; inbound rows are idempotent by provider id
    const started = this.repo.now();
    const mails = await this.d.inbox.poll(since);
    let n = 0;
    for (const m of mails) if (await this.receive(m)) n++;
    this.repo.setSetting("inbox_synced_at", started);
    return n;
  }

  private matchProspect(m: ReceivedMail): string | null {
    if (m.conversationId) {
      const ob = this.repo.outboundFor({ conversationId: m.conversationId }).find((o) => o.kind !== "handoff");
      if (ob) return ob.prospectId;
    }
    const from = m.fromEmail.toLowerCase();
    const byEmail = this.repo.outboundFor({ email: from }).filter((o) => o.kind !== "handoff" && o.status !== "FAILED");
    if (byEmail.length) return byEmail[byEmail.length - 1].prospectId;
    const domain = from.split("@")[1];
    if (!domain) return null;
    const contacted = this.repo
      .prospectsByDomain(bareDomain(domain))
      .filter((p) => this.repo.outboundFor({ prospectId: p.id }).some((o) => o.kind !== "handoff" && o.status === "SENT"));
    return contacted.length ? contacted[contacted.length - 1].id : null;
  }

  /** Record one received message. Any response stops automation immediately. */
  async receive(m: ReceivedMail): Promise<InboundMessage | null> {
    const repo = this.repo;
    const prospectId = this.matchProspect(m);
    const inbound = writeTx(repo.db, () => {
      const rec = repo.addInbound({
        providerId: m.providerId,
        prospectId,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        subject: m.subject,
        body: m.body,
        receivedAt: m.receivedAt,
        conversationId: m.conversationId,
      });
      if (!rec || !prospectId) return rec;
      this.stopAutomation(prospectId);
      return rec;
    });
    if (!inbound) return null; // already processed
    if (!prospectId) {
      repo.event("inbound.unmatched", `From ${m.fromEmail}: ${m.subject}`);
      return inbound;
    }

    const { cls, reason } = await classifyResponse({ subject: m.subject, body: m.body, fromEmail: m.fromEmail, headers: m.headers }, this.d.llm);
    repo.classifyInbound(inbound.id, cls, reason);
    const p = repo.prospect(prospectId)!;
    repo.event("inbound.classified", `${cls} from ${m.fromEmail}: ${reason}`, { opcoId: p.opcoId, prospectId });

    switch (cls) {
      case "BOUNCE": {
        const contact = p.contactId ? repo.contact(p.contactId) : null;
        if (contact) {
          repo.setEmailStatus(contact.email, "bounced");
          repo.suppress(contact.email, "email", "Bounced");
        }
        repo.setProspectStatus(prospectId, "CLOSED", "Address bounced");
        break;
      }
      case "UNSUBSCRIBE":
        repo.suppress(m.fromEmail, "email", "Asked to unsubscribe");
        repo.setProspectStatus(prospectId, "CLOSED", "Unsubscribed; suppressed");
        break;
      case "NOT_INTERESTED":
        // The opt-out line promises no further contact after "no thanks".
        repo.suppress(m.fromEmail, "email", "Replied not interested");
        repo.setProspectStatus(prospectId, "CLOSED", "Not interested; suppressed");
        break;
      default:
        repo.setProspectStatus(prospectId, "RESPONDED", `${cls.replace("_", " ").toLowerCase()} response received`);
        if (HANDOFF_CLASSES.includes(cls)) this.jobs.enqueue("handoff", { inboundId: inbound.id }, { key: `handoff:${inbound.id}` });
    }
    return repo.inbound(inbound.id);
  }

  /** Cancel everything still scheduled for this prospect. Called inside the receiving transaction. */
  private stopAutomation(prospectId: string) {
    const repo = this.repo;
    this.jobs.cancel(`followup_check:${prospectId}`);
    this.jobs.cancel(`close_sequence:${prospectId}`);
    this.jobs.cancelPrefix(`compose:${prospectId}:`);
    for (const c of repo.communications({ prospectId })) {
      if (c.status === "QA_PASS" || c.status === "DRAFT" || c.status === "QA_REWORK" || c.status === "SEND_BLOCKED") {
        repo.setCommStatus(c.id, "CANCELLED", "Response received");
        this.jobs.cancel(`send:${c.id}`);
      }
    }
    const p = repo.prospect(prospectId)!;
    repo.event("automation.stopped", "Response received; all automated messages cancelled", { opcoId: p.opcoId, prospectId });
  }

  // ---- hand to Mark ---------------------------------------------------------------

  private async sendHandoff(inboundId: string) {
    const repo = this.repo;
    const inbound = repo.inbound(inboundId)!;
    const prospect = repo.prospect(inbound.prospectId!)!;
    const opco = repo.opco(prospect.opcoId)!;
    const contact = repo.contact(prospect.contactId!)!;
    const content = buildHandoff({
      opco,
      prospect,
      contact,
      findings: repo.findings(prospect.id),
      sources: repo.sourcesFor({ prospectId: prospect.id }),
      sent: repo.communications({ prospectId: prospect.id }).filter((c) => c.status === "SENT"),
      inbound,
      cls: inbound.classification!,
    });
    const handoff = repo.addHandoff({ inboundId, prospectId: prospect.id, to: this.d.config.handoffTo, subject: content.subject, body: content.body }) ?? repo.handoffs({ prospectId: prospect.id }).find((h) => h.inboundId === inboundId)!;
    if (handoff.status === "SENT") return;

    // Internal mail: not subject to outreach rules, but never sent while halted.
    if (this.halted()) throw new Error("Sending is halted; handoff will be retried");
    const r = await this.d.transport.send({ to: handoff.to, toName: null, subject: handoff.subject, body: handoff.body, idempotencyKey: handoff.id });
    if (r.status === "sent") {
      repo.setHandoffStatus(handoff.id, "SENT", repo.now());
      repo.setProspectStatus(prospect.id, "PASSED_TO_MARK", `Handed to ${handoff.to}`);
      return;
    }
    if (r.status === "uncertain") {
      const rec = await this.d.transport.reconcile(r.providerRef, handoff.id);
      if (rec.status === "sent") {
        repo.setHandoffStatus(handoff.id, "SENT", repo.now());
        repo.setProspectStatus(prospect.id, "PASSED_TO_MARK", `Handed to ${handoff.to}`);
        return;
      }
    }
    repo.setHandoffStatus(handoff.id, "FAILED");
    throw new Error(`Handoff to ${handoff.to} failed: ${r.status === "failed" ? r.reason : r.status}`);
  }
}

class Blocked extends Error {}
