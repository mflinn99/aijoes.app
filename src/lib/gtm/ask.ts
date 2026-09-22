/**
 * ASK JOJO, over the GTM engine.
 *
 * The directive's definition of done is that a person can ask the system what it
 * is doing and get an answer from live data. So this module answers a fixed set
 * of questions by querying the same tables the engine writes to — there is no
 * summary cache, and no question is answered from a narrative the engine stored
 * about itself.
 *
 * Every answer carries its basis. When the honest answer is "nothing yet", that
 * is what comes back, with the reason.
 */

import type { TenantDb } from '../db/tenant';
import { gtmAnalyst } from './agents';
import { listDecisions } from './governance';
import { measureObjectives } from './objectives';
import { pipelineHealth, listPipelineActions } from './pipeline';
import { health as recoveryHealth } from './recovery';
import { analyse as analyseLearning, activeStrategy } from './learning';
import { morningBrief, renderBrief } from './brief';
import {
  listAccounts, listHypotheses, listMeetings, listOpportunities, listOutreach,
  getAccount, findAccountByDomain, findAccountByName, getHypothesis, listSuppressions,
} from './store';
import { pendingOutbox } from './crm/sync';

export type GtmQuestion =
  | 'what-has-it-found'
  | 'who-should-we-approach'
  | 'why-this-company'
  | 'what-has-been-sent'
  | 'what-came-back'
  | 'whats-in-the-pipeline'
  | 'whats-the-forecast'
  | 'what-needs-my-decision'
  | 'whats-it-blocked-on'
  | 'is-it-working'
  | 'what-did-it-do-overnight'
  | 'what-is-it-learning'
  | 'unknown';

export interface GtmAnswer {
  question: GtmQuestion;
  /** The answer in plain English. */
  answer: string;
  /** The rows behind it, so the number can be checked rather than believed. */
  basis: string;
  /** Structured payload for a UI that wants to render rather than read. */
  data: unknown;
  /** What the person can do next, when there is something. */
  suggestions: string[];
}

export function classifyQuestion(raw: string): { question: GtmQuestion; subject: string | null } {
  const lower = raw.toLowerCase().trim();

  // "Why <company>" has to be checked before the generic "why", because the
  // subject is the whole point of the question.
  const whyMatch = /why\s+(?:did\s+(?:we|you|it)\s+)?(?:contact|approach|pick|choose|target)\s+([\w &.'-]+)/i.exec(raw)
    ?? /why\s+(?:is|was)\s+([\w &.'-]+?)\s+(?:on the list|a target|being contacted)/i.exec(raw);
  if (whyMatch) return { question: 'why-this-company', subject: whyMatch[1]!.trim().replace(/[?.]$/, '') };

  if (/overnight|since yesterday|last night|this morning|brief/.test(lower)) return { question: 'what-did-it-do-overnight', subject: null };
  if (/needs? my decision|need (?:me|you)|waiting on me|approve|sign.?off|escalat/.test(lower)) return { question: 'what-needs-my-decision', subject: null };
  if (/blocked|stuck|can'?t do|cannot do|what.s stopping/.test(lower)) return { question: 'whats-it-blocked-on', subject: null };
  if (/forecast|weighted|how much.*(close|land)|expect to (win|close)/.test(lower)) return { question: 'whats-the-forecast', subject: null };
  if (/pipeline|open (deals?|opportunit)/.test(lower)) return { question: 'whats-in-the-pipeline', subject: null };
  if (/(reply|replies|response|responded|came back|heard back)/.test(lower)) return { question: 'what-came-back', subject: null };
  if (/(sent|outreach|emails?|messages?|contacted)/.test(lower)) return { question: 'what-has-been-sent', subject: null };
  if (/(who|which|what) (compan|account|business).*(approach|contact|target|worth|priorit)/.test(lower) || /who should (we|i)/.test(lower)) {
    return { question: 'who-should-we-approach', subject: null };
  }
  if (/learn|improv|strategy|weight/.test(lower)) return { question: 'what-is-it-learning', subject: null };
  if (/is it working|working\??$|any good|effective|performance/.test(lower)) return { question: 'is-it-working', subject: null };
  if (/found|discover|research|how many (compan|account)/.test(lower)) return { question: 'what-has-it-found', subject: null };

  return { question: 'unknown', subject: null };
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function askGtm(db: TenantDb, raw: string, mspId: string): GtmAnswer {
  const { question, subject } = classifyQuestion(raw);

  switch (question) {
    case 'what-has-it-found': {
      const accounts = listAccounts(db, { mspId, limit: 5000 });
      const real = accounts.filter((a) => !a.synthetic);
      const synthetic = accounts.length - real.length;
      const researched = real.filter((a) => a.researchState === 'researched');
      const hypotheses = listHypotheses(db, { limit: 5000 });
      const workable = hypotheses.filter((h) => h.quality === 'strong' || h.quality === 'workable');

      return {
        question,
        answer: real.length === 0 && synthetic === 0
          ? 'Nothing. No account has entered the universe yet, so there is nothing to research.'
          : `${real.length} real account(s), of which ${researched.length} are researched. ${workable.length} of ${hypotheses.length} hypotheses cleared the evidence bar.`
            + (synthetic > 0 ? ` A further ${synthetic} synthetic account(s) exist to prove the engine at scale; they can never be contacted and do not count towards any target.` : ''),
        basis: 'gtm_accounts and gtm_hypotheses, counted live.',
        data: { real: real.length, synthetic, researched: researched.length, hypotheses: hypotheses.length, workable: workable.length },
        suggestions: researched.length === 0 ? ['Run the research agent, or check BLOCKERS.md for why it cannot reach its sources.'] : ['Ask who we should approach.'],
      };
    }

    case 'who-should-we-approach': {
      const ranked = listAccounts(db, { mspId, limit: 2000 })
        .filter((a) => !a.synthetic && !a.suppressed && a.researchState === 'researched')
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 10);

      if (ranked.length === 0) {
        return {
          question,
          answer: 'Nobody yet. No researched, non-suppressed account exists, so any list would be invented.',
          basis: 'gtm_accounts where research_state = researched and suppressed = 0.',
          data: [],
          suggestions: ['Check what the system is blocked on.'],
        };
      }

      const lines = ranked.map((a, i) =>
        `${i + 1}. ${a.name} — ${Math.round(a.priorityScore)}/100. ${a.scores?.priority.summary ?? 'No scoring rationale recorded.'}`,
      );
      return {
        question,
        answer: `Ranked by AGENTIC_GTM_PRIORITY_SCORE:\n${lines.join('\n')}`,
        basis: `Priority is a weighted blend of ICP, need, timing, value, evidence, contactability and delivery fit under strategy ${activeStrategy(db).version}. Every component carries its own reason.`,
        data: ranked.map((a) => ({ id: a.id, name: a.name, score: Math.round(a.priorityScore), why: a.scores?.priority.summary ?? null })),
        suggestions: ['Ask "why did we contact <company>" for the full evidence chain on any of these.'],
      };
    }

    case 'why-this-company': {
      if (!subject) {
        return { question, answer: 'Name the company and I will give you the evidence chain.', basis: 'No company named in the question.', data: null, suggestions: [] };
      }
      const account = findAccountByName(db, mspId, subject) ?? findAccountByDomain(db, mspId, subject.toLowerCase());
      if (!account) {
        return {
          question,
          answer: `"${subject}" is not in the target universe. If it was contacted, it was not by this engine.`,
          basis: 'No matching row in gtm_accounts.',
          data: null,
          suggestions: [],
        };
      }

      const hypotheses = listHypotheses(db, { limit: 2000 }).filter((h) => h.accountId === account.id);
      const messages = listOutreach(db, { accountId: account.id, limit: 50 });
      const best = hypotheses.sort((a, b) => b.confidence - a.confidence)[0];

      if (!best) {
        return {
          question,
          answer: `${account.name} is in the universe but no hypothesis was ever generated for it, so nothing should have gone out.`,
          basis: `gtm_accounts row exists; no gtm_hypotheses rows. ${messages.length} message(s) recorded.`,
          data: { account, messages },
          suggestions: messages.length > 0 ? ['This is worth investigating: a message without a hypothesis should not be possible.'] : [],
        };
      }

      const evidence = best.evidence.map((e) => `  - ${e.statement} (${e.source}, confidence ${Math.round(e.confidence * 100)}%)`).join('\n');
      return {
        question,
        answer: [
          `${account.name}: ${best.headline}.`,
          '',
          `What is happening: ${best.whatIsHappening}`,
          `Why it matters: ${best.whyItMatters}`,
          `Why now: ${best.whyContactNow}`,
          `What Onward could do: ${best.whatOnwardCouldDo}`,
          `Worth: ${gbp(best.commercialValue.point)} (${best.commercialValue.basis})`,
          '',
          'Evidence:',
          evidence,
          '',
          messages.length > 0
            ? `${messages.length} message(s): ${messages.map((m) => `step ${m.step} ${m.status}`).join(', ')}.`
            : 'Nothing has been sent.',
        ].join('\n'),
        basis: `Hypothesis ${best.id}, quality ${best.quality}, confidence ${Math.round(best.confidence * 100)}%. Every evidence item names its source.`,
        data: { account, hypothesis: best, messages },
        suggestions: [],
      };
    }

    case 'what-has-been-sent': {
      const all = listOutreach(db, { limit: 1000 });
      const sent = all.filter((m) => m.status === 'sent');
      const awaiting = all.filter((m) => m.status === 'awaiting-approval' || m.status === 'approved');
      const blocked = all.filter((m) => m.status === 'blocked' || m.status === 'suppressed');

      return {
        question,
        answer: sent.length === 0
          ? `Nothing has been sent. ${all.length} message(s) exist: ${awaiting.length} awaiting approval, ${blocked.length} blocked. No approved email provider is configured, so the engine stops at approval by design rather than sending unattended.`
          : `${sent.length} sent, ${awaiting.length} awaiting approval, ${blocked.length} blocked.`,
        basis: 'gtm_outreach grouped by status.',
        data: { sent: sent.length, awaiting: awaiting.length, blocked: blocked.length, total: all.length },
        suggestions: blocked.length > 0 ? ['Ask what it is blocked on.'] : [],
      };
    }

    case 'what-came-back': {
      const responses = db.all<{ sentiment: string; received_at: string; account_id: string }>(
        `SELECT sentiment, received_at, account_id FROM gtm_responses WHERE tenant_id = @tenantId ORDER BY received_at DESC LIMIT 100`,
      );
      const meetings = listMeetings(db);

      return {
        question,
        answer: responses.length === 0
          ? `No responses recorded. ${meetings.length} meeting(s) exist. With nothing sent, there is nothing to have come back — that is an input problem, not a proposition problem.`
          : `${responses.length} response(s): ${responses.filter((r) => r.sentiment === 'positive').length} positive, ${responses.filter((r) => r.sentiment === 'negative').length} negative. ${meetings.length} meeting(s) booked.`,
        basis: 'gtm_responses and gtm_meetings.',
        data: { responses: responses.length, meetings: meetings.length },
        suggestions: [],
      };
    }

    case 'whats-in-the-pipeline': {
      const health = pipelineHealth(db);
      const open = listOpportunities(db, { open: true, limit: 50 });
      const lines = open
        .sort((a, b) => b.weightedGbp - a.weightedGbp)
        .slice(0, 10)
        .map((o) => `  ${o.name} — ${o.stage}, ${gbp(o.valueGbp)} at ${Math.round(o.probability * 100)}% = ${gbp(o.weightedGbp)}`);

      return {
        question,
        answer: open.length === 0
          ? 'The pipeline is empty. No opportunity has been created from a hypothesis.'
          : `${health.open} open, ${gbp(health.weightedGbp)} weighted.\n${lines.join('\n')}`,
        basis: 'gtm_opportunities. Weighted value is stage probability × value; the probabilities are fixed per stage and stated in the code, not estimated per deal.',
        data: health,
        suggestions: health.atRisk.length > 0 ? [`${health.atRisk.length} opportunit(ies) have been idle for 30+ days.`] : [],
      };
    }

    case 'whats-the-forecast': {
      const health = pipelineHealth(db);
      const objectives = measureObjectives(db, mspId);
      const target = objectives.progress.find((p) => p.key === 'weighted-pipeline-gbp');

      return {
        question,
        answer: [
          `${gbp(health.weightedGbp)} weighted across ${health.open} open opportunit${health.open === 1 ? 'y' : 'ies'}.`,
          target ? `Target is ${gbp(target.target)}, so this is ${Math.round(target.fraction * 100)}% of the way there.` : '',
          health.atRisk.length > 0
            ? `${gbp(health.atRisk.reduce((s, r) => s + r.valueGbp, 0))} of it has not been touched in 30 days, which is the part of the forecast I would not rely on.`
            : '',
        ].filter(Boolean).join(' '),
        basis: 'Stage probabilities are fixed and visible. There is no per-deal probability judgement, because the engine has no basis for one.',
        data: { health, target },
        suggestions: [],
      };
    }

    case 'what-needs-my-decision': {
      const decisions = listDecisions(db, 'open');
      const humanActions = listPipelineActions(db, { limit: 200 }).filter((a) => a.requiresHuman);

      if (decisions.length === 0 && humanActions.length === 0) {
        return { question, answer: 'Nothing. Everything in flight is within standing commercial policy.', basis: 'gtm_decisions with status open, and gtm_pipeline_actions requiring a human.', data: [], suggestions: [] };
      }

      const lines = decisions
        .sort((a, b) => b.expectedValue - a.expectedValue)
        .map((d) => [
          `${d.trigger.replace(/-/g, ' ').toUpperCase()} — ${gbp(d.expectedValue)}`,
          `  Context: ${d.context}`,
          `  Recommendation: ${d.recommendation}`,
          `  Proposed action: ${d.proposedAction}`,
        ].join('\n'));

      return {
        question,
        answer: [
          decisions.length > 0 ? `${decisions.length} decision(s):\n${lines.join('\n\n')}` : '',
          humanActions.length > 0 ? `\n\n${humanActions.length} pipeline item(s) the engine will not do itself.` : '',
        ].join(''),
        basis: 'Each decision carries context, evidence, a recommendation, an expected value and a proposed action — never raw data.',
        data: { decisions, humanActions: humanActions.length },
        suggestions: [],
      };
    }

    case 'whats-it-blocked-on': {
      const brief = morningBrief(db, mspId);
      const health = recoveryHealth(db);
      const queued = pendingOutbox(db);

      return {
        question,
        answer: brief.blockers.length === 0 && health.needsHuman.length === 0
          ? 'Nothing. Every component the engine needs is either working or has a stated fallback.'
          : [
            ...brief.blockers.map((b) => `  ${b}`),
            ...health.needsHuman.map((f) => `  ${f.component}/${f.operation}: ${f.kind} — ${f.message}`),
            queued.length > 0 ? `  ${queued.length} CRM write(s) queued.` : '',
          ].filter(Boolean).join('\n'),
        basis: 'gtm_failures (unresolved), gtm_crm_outbox (pending), and objectives with nothing counted. Full detail and the remedy for each is in BLOCKERS.md.',
        data: { blockers: brief.blockers, needsHuman: health.needsHuman, queued: queued.length },
        suggestions: ['Read BLOCKERS.md for what each one needs and who can supply it.'],
      };
    }

    case 'is-it-working': {
      const funnel = gtmAnalyst(db, { mspId });
      const objectives = measureObjectives(db, mspId);
      const met = objectives.progress.filter((p) => p.met).length;

      return {
        question,
        answer: [
          `${met} of ${objectives.progress.length} commercial objectives met.`,
          `The constraint is: ${funnel.constraint}`,
          funnel.contacted === 0
            ? 'Nothing has been contacted, so the engine has not yet been tested against reality. Everything above this line is the machine working; nothing below it has been proved.'
            : `Contact → response is running at ${Math.round(funnel.conversion.contactToResponse * 100)}%.`,
        ].join(' '),
        basis: 'Funnel counts from gtm_accounts, gtm_hypotheses and gtm_opportunities. Objectives counted from the same tables, not from a separate tally.',
        data: { funnel, objectives },
        suggestions: [],
      };
    }

    case 'what-did-it-do-overnight': {
      const brief = morningBrief(db, mspId);
      return {
        question,
        answer: renderBrief(brief),
        basis: 'Every line derives from a row created in the last 24 hours.',
        data: brief,
        suggestions: brief.oneThing ? [brief.oneThing.action] : [],
      };
    }

    case 'what-is-it-learning': {
      const report = analyseLearning(db);
      const strategy = activeStrategy(db);

      return {
        question,
        answer: [
          `Active strategy: ${strategy.version}. ${strategy.note}`,
          `${report.totalOutcomes} recorded outcome(s).`,
          report.findings.length > 0 ? report.findings.join(' ') : 'No segment has enough outcomes to say anything reliable yet.',
          report.withheldBecause ?? '',
          report.proposal ? `A proposal exists (${report.proposal.version}): ${report.proposal.changes.join(' ')} It will not be applied until a person activates it.` : '',
        ].filter(Boolean).join('\n'),
        basis: `gtm_outcomes grouped by archetype, service, persona and signal. A segment with fewer than 12 outcomes reports no rate at all rather than a misleading percentage.`,
        data: report,
        suggestions: report.proposal ? ['Review and activate, or leave the current weighting in place.'] : [],
      };
    }

    default: {
      const suppressed = listSuppressions(db).length;
      return {
        question: 'unknown',
        answer: 'I can answer: what it has found, who to approach, why a particular company was contacted, what has been sent, what came back, what is in the pipeline, the forecast, what needs your decision, what it is blocked on, what it did overnight, what it is learning, and whether it is working.',
        basis: `The engine currently holds ${listAccounts(db, { mspId, limit: 5000 }).length} account(s) and ${suppressed} suppression rule(s).`,
        data: null,
        suggestions: ['Try: "what did it do overnight?"'],
      };
    }
  }
}
