import { Constellation } from './Constellation';
import { Mark } from './Mark';

// Copy follows the rebrand proposal revised 23 September 2026. Two things are
// deliberately absent until they exist: photography (the identity asks for real
// imagery of people working together, not stock or generated portraits) and an
// enquiry address (none has been supplied, and one should not be invented).
// "Talk to us" lands on the closing panel until a real route is agreed.

const NAV = [
  { href: '#idea', label: 'The Idea' },
  { href: '#roster', label: 'The Roster' },
  { href: '#memory', label: 'The Memory' },
  { href: '#how', label: 'How It Works' },
  { href: '#boards', label: 'For Boards' },
];

const CHANGES = [
  ['Human specialists, agentic advisers and their assignments', 'Company context, strategy and agreed objectives'],
  ['Questions, opportunities and risks under review', 'Decisions, rationales, assumptions and outcomes'],
  ['Market conditions and operating priorities', 'Evidence provenance, action history and lessons'],
  ['Meeting participants and leadership roles', 'Permissions, governance rules and knowledge ownership'],
] as const;

// Agents are shown as named roles and capabilities — never as people.
const AGENTS = [
  { role: 'Strategy', does: 'Tracks the agreed objectives and tests plans against them.' },
  { role: 'Commercial growth', does: 'Watches markets, customers and pipeline for opportunity and risk.' },
  { role: 'Finance', does: 'Checks forecasts against actuals and the assumptions behind them.' },
  { role: 'Operations', does: 'Follows actions through and surfaces delivery issues early.' },
  { role: 'Technology', does: 'Assesses systems, change programmes and technical exposure.' },
  { role: 'People', does: 'Maps leadership, capability and succession against the plan.' },
  { role: 'Governance', does: 'Keeps decision rights, conflicts and obligations in view.' },
  { role: 'Sector specialist', does: 'Brings the regulation and dynamics of a specific industry.' },
];

const AGENT_DECLARES = ['Scope', 'Tools', 'Memory access', 'Escalation threshold'];

const MEMORY_PROPERTIES = [
  'Source links',
  'Timestamps',
  'Owners',
  'Access controls',
  'Corrections',
  'Retention rules',
  'Version history',
];

const STEPS = [
  {
    n: '01',
    title: 'Understand the company',
    short: 'Establish priorities, sources, permissions and decision rights.',
    long: 'With permission, connect the documents, operating systems, plans, meetings and people that matter. Establish what is known, uncertain, outdated or restricted.',
  },
  {
    n: '02',
    title: 'Assemble the right roster',
    short: 'Select human and agentic advisers for the work at hand.',
    long: 'Each opportunity or decision gets relevant human expertise and agentic advisers. Their remit, access, duration and authority are explicit.',
  },
  {
    n: '03',
    title: 'Work the decision',
    short: 'Examine evidence, alternatives, dissent, consequences and next actions.',
    long: 'Agents research, watch, analyse, test assumptions, prepare alternatives and track actions. Human advisers bring lived experience, judgement, relationships and challenge.',
  },
  {
    n: '04',
    title: 'Learn and carry forward',
    short: 'Record the outcome and make authorised knowledge available to the next roster.',
    long: 'What was decided, why, by whom, on what evidence and with what result — revisited against reality. When advisers or executives rotate, a successor receives the relevant authorised context and can trace it to source.',
  },
];

const ENGAGEMENTS = [
  {
    name: 'First Decision',
    assembled: 'A focused human and agent roster around one live board question.',
    value: 'Decision brief, evidence map and an initial memory record.',
  },
  {
    name: 'Living Board',
    assembled: 'A changing roster for recurring priorities, with agentic work between meetings.',
    value: 'Ongoing decision cycle, action follow-through and maintained company memory.',
  },
  {
    name: 'Group Intelligence',
    assembled: 'Rosters across business units or portfolio companies with appropriate separation.',
    value: 'Shared patterns where permitted, local decision histories and group-level learning.',
  },
];

function Wordmark() {
  return (
    <a href="#top" className="sh-wordmark" aria-label="Sage Halpin — The Evolving Board">
      <Mark size={30} />
      <span>
        <span className="sh-wordmark-name">SAGE HALPIN</span>
        <span className="sh-wordmark-desc">THE EVOLVING BOARD</span>
      </span>
    </a>
  );
}

export default function SageHalpinPage() {
  return (
    <>
      <a className="sh-skip" href="#idea">
        Skip to content
      </a>

      <header className="sh-header">
        <div className="sh-wrap sh-header-inner">
          <Wordmark />
          <nav aria-label="Primary" className="sh-nav">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <a href="#contact" className="sh-nav-cta">
              Talk to Us
            </a>
          </nav>
          <details className="sh-menu">
            <summary aria-label="Menu">Menu</summary>
            <nav aria-label="Primary (compact)">
              {NAV.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
              <a href="#contact">Talk to Us</a>
            </nav>
          </details>
        </div>
      </header>

      <main id="top">
        <section className="sh-hero">
          <div className="sh-wrap sh-hero-inner">
            <div className="sh-hero-copy">
              <p className="sh-eyebrow">SAGE HALPIN · THE EVOLVING BOARD</p>
              <h1>
                The roster evolves.
                <br />
                <em>The knowledge compounds.</em>
              </h1>
              <p className="sh-lede">
                A continuously changing roster of human experts and agentic advisers. One enduring
                institutional memory. Each decision benefits from the knowledge of those that came
                before.
              </p>
              <div className="sh-ctas">
                <a className="sh-btn sh-btn-primary" href="#idea">
                  Explore Sage Halpin
                </a>
                <a className="sh-btn sh-btn-ghost" href="#how">
                  See the model
                </a>
              </div>
            </div>
            <div className="sh-hero-visual">
              <Constellation />
              <ul className="sh-legend" aria-label="Key">
                <li>
                  <span className="sh-key sh-key-human" /> Human adviser
                </li>
                <li>
                  <span className="sh-key sh-key-agent" /> Agentic adviser
                </li>
                <li>
                  <span className="sh-key sh-key-line" /> Institutional memory
                </li>
              </ul>
            </div>
          </div>
        </section>

        <div className="sh-strip" role="note">
          <div className="sh-wrap">
            HUMAN JUDGEMENT <span>×</span> AGENTIC CAPABILITY <span>×</span> INSTITUTIONAL MEMORY
          </div>
        </div>

        <section id="idea" className="sh-section">
          <div className="sh-wrap">
            <p className="sh-kicker">The idea</p>
            <div className="sh-split">
              <h2>A living board, aligned to the decisions in front of it.</h2>
              <div className="sh-prose">
                <p>
                  Sage Halpin is a changing combination of experienced people and specialist AI
                  agents. Human expertise enters for an acquisition, an industry expansion or a
                  leadership transition. Agentic advisers monitor evidence, prepare questions,
                  challenge plans and follow actions through.
                </p>
                <p>
                  Approved learning from each assignment becomes part of the company’s enduring
                  knowledge base. The roster is fluid. The knowledge is continuous. Board authority
                  remains with the client’s appointed directors and authorised decision makers.
                </p>
              </div>
            </div>

            <div className="sh-ledger" role="table" aria-label="What changes and what remains">
              <div className="sh-ledger-row sh-ledger-head" role="row">
                <span role="columnheader">Changes with the business</span>
                <span role="columnheader">Continues across the business</span>
              </div>
              {CHANGES.map(([changes, remains]) => (
                <div className="sh-ledger-row" role="row" key={changes}>
                  <span role="cell">{changes}</span>
                  <span role="cell">{remains}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="roster" className="sh-section sh-section-alt">
          <div className="sh-wrap">
            <p className="sh-kicker">The roster</p>
            <div className="sh-split">
              <h2>Expertise that moves with you.</h2>
              <div className="sh-prose">
                <p>
                  The roster follows the work: a finance expert for a transaction, an operator for
                  integration, a sector adviser for expansion, and specialist agents active between
                  meetings. Contributors change. The context remains available to authorised
                  successors.
                </p>
              </div>
            </div>

            <div className="sh-two">
              <article className="sh-card">
                <p className="sh-card-tag">
                  <span className="sh-key sh-key-human" /> The human roster
                </p>
                <h3>Board-level people, for a defined mandate.</h3>
                <p>
                  A curated bench of board-level operators, sector specialists, functional experts
                  and independent challengers. Members join for a specific problem, period or
                  mandate, and leave behind a structured handover. Their participation and
                  availability are contracted and visible to the client.
                </p>
              </article>
              <article className="sh-card">
                <p className="sh-card-tag">
                  <span className="sh-key sh-key-agent" /> The agentic roster
                </p>
                <h3>Persistent advisers that work between meetings.</h3>
                <p>
                  Task-capable agents that distinguish evidence from inference, show their sources
                  and ask for a human decision when authority is required. Every agent declares:
                </p>
                <ul className="sh-chips">
                  {AGENT_DECLARES.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </article>
            </div>

            <ul className="sh-agents" aria-label="Agentic advisers">
              {AGENTS.map((a) => (
                <li key={a.role}>
                  <span className="sh-agent-role">
                    <span className="sh-key sh-key-agent" /> {a.role} agent
                  </span>
                  <span className="sh-agent-does">{a.does}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="memory" className="sh-section">
          <div className="sh-wrap">
            <p className="sh-kicker">The memory</p>
            <div className="sh-split">
              <h2>A company that remembers.</h2>
              <div className="sh-prose">
                <p>
                  Decisions, evidence, actions and outcomes form a traceable company memory. New
                  contributors arrive informed. Existing contributors see what has changed. Earlier
                  judgements remain connected to their reasons and results.
                </p>
                <p>
                  The knowledge layer is client-owned. It joins company facts, decisions,
                  assumptions, meeting outputs, work products, actions and measured outcomes.
                  Contradictions and stale information are surfaced for review rather than silently
                  treated as truth.
                </p>
              </div>
            </div>

            <ul className="sh-properties" aria-label="Every record carries">
              {MEMORY_PROPERTIES.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>

            <aside className="sh-note">
              <p className="sh-note-title">What “never losing knowledge” means</p>
              <p>
                When a person leaves, a project changes hands or a new adviser joins, the
                organisation’s history is available to its authorised successors. That is a design
                for durable, transferable institutional memory, subject to the client’s retention,
                deletion and access policies. It is not a claim that every conversation is captured,
                or that data can never be lost.
              </p>
            </aside>

            <div className="sh-two sh-two-spaced">
              <div>
                <h3 className="sh-h3-serif">The work continues between meetings.</h3>
                <p>
                  Agentic advisers monitor agreed signals, develop options, challenge assumptions,
                  surface emerging issues and follow through on actions. Human advisers guide, test
                  and decide with the people accountable for the business.
                </p>
              </div>
              <div>
                <h3 className="sh-h3-serif">The orchestration.</h3>
                <p>
                  Sage Halpin identifies the expertise a question calls for, convenes the relevant
                  people and agents, prepares a board-ready view, records the decision and follows
                  execution. The roster adapts when the company’s priorities change.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="sh-section sh-section-ink">
          <div className="sh-wrap">
            <p className="sh-kicker">How it works</p>
            <h2>One cycle, carried forward.</h2>
            <ol className="sh-steps">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="sh-step-n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p className="sh-step-short">{s.short}</p>
                  <p className="sh-step-long">{s.long}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="boards" className="sh-section">
          <div className="sh-wrap">
            <p className="sh-kicker">For boards</p>
            <div className="sh-split">
              <h2>Built for consequential change.</h2>
              <div className="sh-prose">
                <p>
                  For founder-led companies, ambitious mid-market boards, PE-backed businesses and
                  groups whose priorities, leadership and opportunities change faster than a fixed
                  advisory structure can serve.
                </p>
              </div>
            </div>

            <div className="sh-engagements">
              {ENGAGEMENTS.map((e) => (
                <article key={e.name} className="sh-engagement">
                  <h3>{e.name}</h3>
                  <p className="sh-label">What is assembled</p>
                  <p>{e.assembled}</p>
                  <p className="sh-label">Continuing value</p>
                  <p>{e.value}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="sh-closing">
          <div className="sh-wrap sh-closing-inner">
            <Mark size={44} />
            <h2>
              Expertise changes.
              <br />
              <em>Understanding deepens.</em>
            </h2>
            <p>
              A living roster connected to a durable record of what the organisation knows, decides
              and learns.
            </p>
            <a className="sh-btn sh-btn-primary" href="#how">
              Explore the model
            </a>
          </div>
        </section>
      </main>

      <footer className="sh-footer">
        <div className="sh-wrap sh-footer-inner">
          <Wordmark />
          <p className="sh-disclosure">
            Human advisers and AI agents support the board. AI agents are not statutory directors
            and do not exercise voting rights. The client’s authorised people retain decision
            authority. Data access, retention and deletion follow the agreed terms.
          </p>
        </div>
      </footer>
    </>
  );
}
