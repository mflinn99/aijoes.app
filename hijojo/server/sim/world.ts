// A synthetic world for end-to-end tests and the demo. Every company, person
// and page is fictional and lives on the reserved .test domain, so nothing here
// can reach a real prospect. The scripted model only cites text that is really
// on these pages, so the same provenance and QA rules apply as in production.

import { openDb } from "../db";
import { Repo } from "../repo";
import { FakeClock } from "../clock";
import { Engine } from "../engine";
import { testConfig, type Config } from "../config";
import { ScriptedLlm, type LlmTask } from "../llm/client";
import { SimMailbox } from "../mail/transport";
import { SimWeb } from "./web";
import { StaticContactProvider, WebSearchCandidates, type ContactCandidate } from "../agents/prospect";
import type { CommSections, Finding } from "../../shared/types";

export const OPCO = {
  name: "Clearwater",
  website: "https://clearwater.test",
  introLink: "https://clearwater.test/intro",
};

type Kind = Finding["kind"];
interface ScriptFinding {
  kind: Kind;
  statement: string;
  path: string;
  quote: string;
  signalId?: string;
}
interface ProspectScript {
  name: string;
  domain: string;
  pages: Record<string, { text: string; publishedAt?: string }>;
  attributes: { sector: [string, string, string]; employees: [number, string, string]; geography: [string, string, string] };
  findings: ScriptFinding[];
  points: { icpFit: number; need: number; timing: number; commercial: number };
  why: { them: string; now: string; proposition: string };
  contacts: ContactCandidate[];
  intro?: { themKind: Kind; nowSignal: string; sections: CommSections; subject: string };
  followup?: { nowSignal: string; sections: CommSections; subject: string };
}

const PROPOSITION = "Clearwater files UK customs declarations automatically for freight forwarders.";

export const PROSPECTS: Record<string, ProspectScript> = {
  "northbridge.test": {
    name: "Northbridge Freight",
    domain: "northbridge.test",
    pages: {
      "/": { text: "Northbridge Freight is a UK freight forwarder based in Ipswich with 320 employees, handling sea and air imports for retailers." },
      "/news": { text: "Northbridge Freight will open a 40,000 sq ft bonded warehouse at Felixstowe in January 2027.", publishedAt: "2026-09-21T08:00:00.000Z" },
      "/careers": { text: "We are recruiting four customs entry clerks to support growing import volumes.", publishedAt: "2026-09-28T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Freight forwarding", "/", "UK freight forwarder based in Ipswich"],
      employees: [320, "/", "with 320 employees"],
      geography: ["United Kingdom", "/", "UK freight forwarder based in Ipswich"],
    },
    findings: [
      { kind: "identity", statement: "UK freight forwarder based in Ipswich", path: "/", quote: "UK freight forwarder based in Ipswich" },
      { kind: "icp", statement: "320 employees", path: "/", quote: "with 320 employees" },
      { kind: "commercial", statement: "Handles sea and air imports for retailers", path: "/", quote: "handling sea and air imports for retailers" },
      { kind: "trigger", statement: "Opening a bonded warehouse at Felixstowe in January 2027", path: "/news", quote: "open a 40,000 sq ft bonded warehouse at Felixstowe", signalId: "new-bonded-site" },
      { kind: "trigger", statement: "Recruiting four customs entry clerks", path: "/careers", quote: "recruiting four customs entry clerks", signalId: "customs-hiring" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 8 },
    why: {
      them: "A UK forwarder whose sea and air import work for retailers generates heavy customs entry volume.",
      now: "It is opening a bonded warehouse at Felixstowe in January 2027 and recruiting customs entry clerks.",
      proposition: "Automated declarations absorb the new bonded volume without adding clerks.",
    },
    contacts: [{ name: "Dana Reyes", title: "Chief Operating Officer", email: "dana.reyes@northbridge.test", emailStatus: "verified", sourceUrl: "https://northbridge.test/about" }],
    intro: {
      themKind: "commercial",
      nowSignal: "new-bonded-site",
      subject: "Felixstowe bonded warehouse and customs entries",
      sections: {
        whyThem: "Northbridge Freight's sea and air import work for retailers is exactly where customs entries pile up.",
        whyNow: "With the Felixstowe bonded warehouse opening in January, that volume is about to grow.",
        problem: "Keying entries by hand tends to become the bottleneck when a bonded site comes online.",
        proposition: PROPOSITION,
        teaser: "This short walkthrough shows how a new bonded site gets set up:",
        cta: "Worth a look before Felixstowe opens?",
      },
    },
    followup: {
      nowSignal: "customs-hiring",
      subject: "Customs entry clerks at Northbridge",
      sections: {
        whyThem: "When I wrote last week it was about the new bonded warehouse at Felixstowe.",
        whyNow: "Since then I noticed Northbridge is recruiting four customs entry clerks to support growing import volumes.",
        problem: "Hiring for every rise in declarations gets expensive quickly.",
        proposition: PROPOSITION,
        teaser: "The walkthrough is still here:",
        cta: "Would a ten-minute call next week help?",
      },
    },
  },

  "haldenfoods.test": {
    name: "Halden Foods Logistics",
    domain: "haldenfoods.test",
    pages: {
      "/": { text: "Halden Foods Logistics is a UK freight forwarder in Hull specialising in chilled food imports, with 180 staff." },
      "/news": {
        text: "Halden has appointed Priya Shah as Head of Customs to lead the move of all import entries to the Customs Declaration Service.",
        publishedAt: "2026-09-10T08:00:00.000Z",
      },
      "/careers": { text: "Halden is hiring two customs entry specialists for its new Immingham chilled store.", publishedAt: "2026-09-30T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Freight forwarding", "/", "UK freight forwarder in Hull"],
      employees: [180, "/", "with 180 staff"],
      geography: ["United Kingdom", "/", "UK freight forwarder in Hull"],
    },
    findings: [
      { kind: "identity", statement: "UK freight forwarder in Hull", path: "/", quote: "UK freight forwarder in Hull" },
      { kind: "commercial", statement: "Specialises in chilled food imports", path: "/", quote: "specialising in chilled food imports" },
      { kind: "trigger", statement: "New Head of Customs leading the move of import entries to CDS", path: "/news", quote: "lead the move of all import entries to the Customs Declaration Service", signalId: "new-customs-lead" },
      { kind: "trigger", statement: "Hiring two customs entry specialists for a new Immingham chilled store", path: "/careers", quote: "hiring two customs entry specialists for its new Immingham chilled store", signalId: "customs-hiring" },
    ],
    points: { icpFit: 30, need: 28, timing: 10, commercial: 6 },
    why: {
      them: "A Hull forwarder specialising in chilled food imports, where clearance delays are costly.",
      now: "A new Head of Customs is leading the move of all import entries to CDS.",
      proposition: "Automated CDS declarations fit a process being rebuilt now.",
    },
    contacts: [{ name: "Priya Shah", title: "Head of Customs", email: "priya.shah@haldenfoods.test", emailStatus: "verified", sourceUrl: "https://haldenfoods.test/news" }],
    intro: {
      themKind: "commercial",
      nowSignal: "new-customs-lead",
      subject: "Moving Halden's import entries to CDS",
      sections: {
        whyThem: "Halden's chilled food imports through Hull leave little room for clearance delays.",
        whyNow: "Your role leading the move of all import entries to the Customs Declaration Service suggests the process is being rebuilt now.",
        problem: "Moving to CDS by hand means re-keying every entry in a new format.",
        proposition: PROPOSITION,
        teaser: "Here is a short walkthrough of a CDS move for a forwarder:",
        cta: "Would it be useful before you finalise the plan?",
      },
    },
    followup: {
      nowSignal: "customs-hiring",
      subject: "Customs entries for the Immingham chilled store",
      sections: {
        whyThem: "I wrote about your move of import entries to the Customs Declaration Service.",
        whyNow: "I have since seen Halden is hiring two customs entry specialists for its new Immingham chilled store.",
        problem: "A second site doubles the entries that have to stay compliant.",
        proposition: PROPOSITION,
        teaser: "The walkthrough covers a second site too:",
        cta: "Is that worth ten minutes?",
      },
    },
  },

  "pebble.test": {
    name: "Pebble Studio",
    domain: "pebble.test",
    pages: { "/": { text: "Pebble Studio is a graphic design studio in Brighton with 12 people, making brand identities for start-ups." } },
    attributes: {
      sector: ["Graphic design", "/", "graphic design studio in Brighton"],
      employees: [12, "/", "with 12 people"],
      geography: ["United Kingdom", "/", "graphic design studio in Brighton"],
    },
    findings: [{ kind: "identity", statement: "Graphic design studio in Brighton", path: "/", quote: "graphic design studio in Brighton" }],
    points: { icpFit: 5, need: 0, timing: 0, commercial: 2 },
    why: { them: "A design studio; not a freight forwarder.", now: "No trigger found.", proposition: "No customs workload." },
    contacts: [{ name: "Sam Lee", title: "Founder", email: "sam@pebble.test", emailStatus: "verified", sourceUrl: null }],
  },

  "ashgrove.test": {
    name: "Ashgrove Haulage",
    domain: "ashgrove.test",
    pages: {
      "/": { text: "Ashgrove Haulage is a UK freight forwarder in Dover with 250 employees, clearing cross-Channel loads for importers." },
      "/news": { text: "Ashgrove has acquired Medway Forwarding, adding its import clearance team to the group.", publishedAt: "2026-09-25T08:00:00.000Z" },
      "/careers": { text: "Ashgrove is recruiting a customs compliance lead for Dover.", publishedAt: "2026-09-27T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Freight forwarding", "/", "UK freight forwarder in Dover"],
      employees: [250, "/", "with 250 employees"],
      geography: ["United Kingdom", "/", "UK freight forwarder in Dover"],
    },
    findings: [
      { kind: "identity", statement: "UK freight forwarder in Dover", path: "/", quote: "UK freight forwarder in Dover" },
      { kind: "commercial", statement: "Clears cross-Channel loads for importers", path: "/", quote: "clearing cross-Channel loads for importers" },
      { kind: "trigger", statement: "Acquired Medway Forwarding and its import clearance team", path: "/news", quote: "acquired Medway Forwarding, adding its import clearance team", signalId: "acquisition" },
      { kind: "trigger", statement: "Recruiting a customs compliance lead", path: "/careers", quote: "recruiting a customs compliance lead for Dover", signalId: "customs-hiring" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 10 },
    why: { them: "A Dover forwarder clearing cross-Channel loads.", now: "It has just acquired Medway Forwarding.", proposition: "Merging two clearance teams onto one automated process." },
    // The only person the provider knows is the wrong one.
    contacts: [{ name: "Jo Park", title: "Marketing Intern", email: "jo.park@ashgrove.test", emailStatus: "verified", sourceUrl: null }],
    intro: {
      themKind: "commercial",
      nowSignal: "acquisition",
      subject: "Bringing Medway's clearance team onto one process",
      sections: {
        whyThem: "Ashgrove Haulage clears cross-Channel loads for importers out of Dover.",
        whyNow: "Having acquired Medway Forwarding and its import clearance team, you now run two ways of doing entries.",
        problem: "Two clearance teams on two processes doubles the room for error.",
        proposition: PROPOSITION,
        teaser: "This walkthrough shows a merged set-up:",
        cta: "Worth a look while the integration is planned?",
      },
    },
  },

  "ridgeway.test": {
    name: "Ridgeway Shipping",
    domain: "ridgeway.test",
    pages: {
      "/": { text: "Ridgeway Shipping is a UK freight forwarder in Southampton with 410 employees, moving containers for manufacturers." },
      "/news": { text: "Ridgeway is migrating all import entries from CHIEF to CDS before the end of the year.", publishedAt: "2026-09-15T08:00:00.000Z" },
      "/careers": { text: "Ridgeway is hiring a customs operations manager to run the new entries desk.", publishedAt: "2026-09-29T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Freight forwarding", "/", "UK freight forwarder in Southampton"],
      employees: [410, "/", "with 410 employees"],
      geography: ["United Kingdom", "/", "UK freight forwarder in Southampton"],
    },
    findings: [
      { kind: "identity", statement: "UK freight forwarder in Southampton", path: "/", quote: "UK freight forwarder in Southampton" },
      { kind: "commercial", statement: "Moves containers for manufacturers", path: "/", quote: "moving containers for manufacturers" },
      { kind: "trigger", statement: "Migrating all import entries from CHIEF to CDS this year", path: "/news", quote: "migrating all import entries from CHIEF to CDS", signalId: "cds-migration" },
      { kind: "trigger", statement: "Hiring a customs operations manager for a new entries desk", path: "/careers", quote: "hiring a customs operations manager to run the new entries desk", signalId: "customs-hiring" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 8 },
    why: { them: "A Southampton forwarder moving containers for manufacturers.", now: "It is migrating all import entries from CHIEF to CDS this year.", proposition: "Automated CDS filing removes the migration's re-keying." },
    contacts: [{ name: "Morgan Blake", title: "Operations Director", email: "morgan.blake@ridgeway.test", emailStatus: "verified", sourceUrl: "https://ridgeway.test/about" }],
    intro: {
      themKind: "commercial",
      nowSignal: "cds-migration",
      subject: "Ridgeway's CHIEF to CDS migration",
      sections: {
        whyThem: "Ridgeway Shipping moves containers for manufacturers through Southampton.",
        whyNow: "Migrating all import entries from CHIEF to CDS before the end of the year is a lot of re-keying.",
        problem: "Most forwarders find the new data requirements slow every entry down at first.",
        proposition: PROPOSITION,
        teaser: "Here is how a CHIEF to CDS switch looks with it:",
        cta: "Would that be useful for the migration plan?",
      },
    },
    followup: {
      nowSignal: "customs-hiring",
      subject: "Ridgeway's new entries desk",
      sections: {
        whyThem: "I wrote about Ridgeway migrating import entries from CHIEF to CDS.",
        whyNow: "I see you are now hiring a customs operations manager to run the new entries desk.",
        problem: "A new desk is the easiest moment to set the process up properly.",
        proposition: PROPOSITION,
        teaser: "The walkthrough shows a desk set-up:",
        cta: "Shall I send it to the new manager too?",
      },
    },
  },
};

export const RIVAL = { name: "Harbour Customs", domain: "harbourcustoms.test" };

function opcoPages(): Record<string, { html?: string; text?: string; status?: number }> {
  return {
    [OPCO.website]: {
      text: "Clearwater files UK customs declarations automatically for freight forwarders. Manual customs entries delay shipments and incur penalties.",
    },
    [`${OPCO.website}/pricing`]: { text: "Plans start at £900 per month for up to 500 declarations." },
    [`${OPCO.website}/about`]: { text: "Clearwater is the only platform that submits directly to the CDS service with no broker. It cuts clearance time for busy forwarders." },
    [OPCO.introLink]: { text: "A two-minute walkthrough of Clearwater for freight forwarders." },
  };
}

const bySuffix = (sources: { id: string; url: string }[], path: string) => {
  const s = sources.find((x) => (path === "/" ? !/\/[a-z]+$/.test(new URL(x.url).pathname) : x.url.endsWith(path)));
  return s?.id ?? "missing-source";
};

export interface WorldOptions {
  discover?: string[];
  config?: Partial<Config>;
  /** Replace sections the scripted composer writes, per domain. */
  composeOverride?: (domain: string, kind: "intro" | "followup", attempt: number) => Partial<CommSections> | null;
}

export function scriptedModel(opts: WorldOptions = {}): ScriptedLlm {
  const domainOf = (t: LlmTask<unknown>) => (t.context as any).prospect.domain as string;
  return new ScriptedLlm(
    {
      opco_analysis: (t) => {
        const sources = (t.context as any).sources as { id: string; url: string }[];
        const id = (p: string) => sources.find((s) => (p === "/" ? s.url === OPCO.website : s.url.endsWith(p)))?.id ?? "missing";
        return {
          claims: [
            { key: "prop", field: "proposition", statement: "Automated UK customs declarations for freight forwarders", status: "FACT", evidence: [{ sourceId: id("/"), quote: "files UK customs declarations automatically for freight forwarders" }], basis: null },
            { key: "problem", field: "problem", statement: "Manual customs entries delay shipments and incur penalties", status: "FACT", evidence: [{ sourceId: id("/"), quote: "Manual customs entries delay shipments and incur penalties" }], basis: null },
            { key: "usp", field: "usp", statement: "Submits directly to CDS with no broker", status: "FACT", evidence: [{ sourceId: id("/about"), quote: "submits directly to the CDS service with no broker" }], basis: null },
            { key: "cost", field: "cost", statement: "From £900 per month for up to 500 declarations", status: "FACT", evidence: [{ sourceId: id("/pricing"), quote: "Plans start at £900 per month for up to 500 declarations" }], basis: null },
            { key: "buyer", field: "buyer", statement: "Operations and customs leaders at forwarders", status: "INFERENCE", evidence: [], basis: "The product replaces an operational customs process" },
            { key: "roi", field: "proof", statement: "Cuts clearance time by 70%", status: "FACT", evidence: [{ sourceId: id("/about"), quote: "cuts clearance time by 70%" }], basis: null },
            { key: "weak", field: "weaknesses", statement: "Claims to be the only direct-to-CDS platform without evidence of comparison", status: "INFERENCE", evidence: [], basis: "Uniqueness claim on the site is unsubstantiated" },
          ],
        };
      },
      opco_profile: () => ({
        proposition: { text: "Automated UK customs declarations for freight forwarders", claimKeys: ["prop"] },
        problem: { text: "Manual customs entries delay shipments and incur penalties", claimKeys: ["problem"] },
        usp: { text: "Submits directly to CDS with no broker", claimKeys: ["usp"] },
        cost: { text: "From £900/month (up to 500 declarations)", claimKeys: ["cost"] },
        icp: {
          sectors: ["Freight forwarding"], subsectors: ["Customs brokerage"], geographies: ["United Kingdom"], employeeMin: 50, employeeMax: 1000,
          revenue: null, technology: ["CHIEF", "CDS"], maturity: null, ownership: [], growth: "Rising import volumes", regulatory: ["UK customs (CDS)"], other: [],
        },
        buyers: {
          economic: ["Chief Operating Officer", "Managing Director"],
          operational: ["Head of Customs", "Operations Director", "Customs Manager"],
          technical: ["IT Director"],
          influencer: ["Compliance Manager"],
        },
        signals: [
          { id: "new-bonded-site", name: "New bonded facility", description: "Opening bonded warehouse capacity", whyItMatters: "More declarations per day", keywords: ["bonded"] },
          { id: "customs-hiring", name: "Hiring customs staff", description: "Recruiting entry clerks or customs managers", whyItMatters: "Volume outgrowing the team", keywords: ["customs entry", "clerk"] },
          { id: "new-customs-lead", name: "New customs leadership", description: "New Head of Customs or similar", whyItMatters: "New leaders rebuild processes", keywords: ["Head of Customs"] },
          { id: "acquisition", name: "Acquisition", description: "Buying another forwarder", whyItMatters: "Two clearance processes to merge", keywords: ["acquired"] },
          { id: "cds-migration", name: "CDS migration", description: "Moving entries from CHIEF to CDS", whyItMatters: "Re-keying burden", keywords: ["CDS", "CHIEF"] },
        ],
        exclusions: [{ kind: "domain", value: RIVAL.domain, reason: "Competitor" }],
      }),
      prospect_research: (t) => {
        const s = PROSPECTS[domainOf(t)];
        const sources = (t.context as any).sources as { id: string; url: string }[];
        const attr = <T>([value, path, quote]: [T, string, string]) => ({ value, evidence: [{ sourceId: bySuffix(sources, path), quote }] });
        return {
          attributes: { sector: attr(s.attributes.sector), employees: attr(s.attributes.employees), geography: attr(s.attributes.geography) },
          findings: s.findings.map((f) => ({
            kind: f.kind, statement: f.statement, status: "FACT", evidence: [{ sourceId: bySuffix(sources, f.path), quote: f.quote }], basis: null, signalId: f.signalId ?? null,
          })),
          conflicts: [],
        };
      },
      prospect_qualification: (t) => {
        const s = PROSPECTS[domainOf(t)];
        const findings = (t.context as any).findings as Finding[];
        const ids = (...kinds: Kind[]) => findings.filter((f) => kinds.includes(f.kind)).map((f) => f.id);
        return {
          icpFit: { points: s.points.icpFit, rationale: "Sector, size and geography", findingIds: ids("identity", "icp") },
          need: { points: s.points.need, rationale: "Current trigger", findingIds: ids("trigger") },
          timing: { points: s.points.timing, rationale: "Recent", findingIds: ids("trigger") },
          commercial: { points: s.points.commercial, rationale: "Volume", findingIds: ids("commercial") },
          whyThem: s.why.them,
          whyNow: s.why.now,
          whyProposition: s.why.proposition,
        };
      },
      compose_message: (t) => {
        const c = t.context as any;
        const s = PROSPECTS[c.prospect.domain as string];
        const kind = c.kind as "intro" | "followup";
        const plan = kind === "intro" ? s.intro : s.followup;
        if (!plan) throw new Error(`No ${kind} script for ${s.domain}`);
        const findings = (c.findings as Finding[]).filter((f) => f.status === "FACT");
        const bySignal = (sig: string) => findings.find((f) => f.signalId === sig)?.id;
        const evidence =
          kind === "intro"
            ? [
                { section: "whyThem", findingId: findings.find((f) => f.kind === s.intro!.themKind)?.id },
                { section: "whyNow", findingId: bySignal(s.intro!.nowSignal) },
              ]
            : [
                { section: "whyThem", findingId: bySignal(s.intro!.nowSignal) },
                { section: "whyNow", findingId: bySignal(s.followup!.nowSignal) },
              ];
        const override = opts.composeOverride?.(s.domain, kind, c.attempt) ?? {};
        return {
          subject: plan.subject,
          sections: { ...plan.sections, ...override },
          evidence: evidence.filter((e) => e.findingId),
          opcoClaimIds: (c.claims as any[]).filter((x) => x.status === "FACT" && x.field === "proposition").map((x) => x.id),
          approach: kind === "intro" ? "trigger-led" : "new-observation",
        };
      },
    },
    () => {
      const domains = opts.discover ?? [...Object.keys(PROSPECTS), RIVAL.domain];
      const candidates = domains.map((d) => {
        const bare = d.replace(/^www\./, "");
        const s = PROSPECTS[bare];
        return { name: s?.name ?? RIVAL.name, domain: d, urls: [`https://${bare}/news`], why: s?.why.now ?? "Competitor" };
      });
      return {
        text: "Candidates:\n```json\n" + JSON.stringify({ candidates }) + "\n```",
        urls: candidates.flatMap((c) => c.urls.map((url) => ({ url, title: c.name }))),
      };
    },
  );
}

export function simWeb(): SimWeb {
  const web = new SimWeb(opcoPages());
  for (const p of Object.values(PROSPECTS)) {
    for (const [path, page] of Object.entries(p.pages)) web.set(`https://${p.domain}${path === "/" ? "" : path}`, page);
  }
  web.set(`https://${RIVAL.domain}`, { text: "Harbour Customs provides customs clearance software for forwarders across the UK." });
  return web;
}

export function createWorld(opts: WorldOptions = {}) {
  const clock = new FakeClock("2026-10-05T09:00:00.000Z");
  const repo = new Repo(openDb(":memory:"), clock);
  const web = simWeb();
  const llm = scriptedModel(opts);
  const mail = new SimMailbox(() => clock.now());
  const contacts = new StaticContactProvider(
    Object.fromEntries(Object.values(PROSPECTS).map((p) => [p.domain, p.contacts])),
    "synthetic-directory",
  );
  const config = testConfig(opts.config);
  const engine = new Engine({
    repo, config, llm, reviewer: null, fetcher: web, contacts, candidates: [new WebSearchCandidates(llm)], transport: mail, inbox: mail,
  });

  /** Run jobs, sync the inbox and repeat until nothing is due. */
  async function settle() {
    for (let i = 0; i < 50; i++) {
      await engine.syncInbox();
      const n = await engine.runDue();
      if (n === 0) return;
    }
    throw new Error("World did not settle");
  }

  /** Advance the clock a day at a time, settling as we go, as a real worker would. */
  async function advanceDays(days: number) {
    for (let d = 0; d < days; d++) {
      clock.advanceDays(1);
      await settle();
    }
  }

  const prospect = (domain: string) => repo.prospects().find((p) => p.domain === domain)!;

  return { clock, repo, web, llm, mail, contacts, config, engine, settle, advanceDays, prospect };
}

export type World = ReturnType<typeof createWorld>;
