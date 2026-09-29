import { BoardroomHero } from './BoardroomHero';
import { Mark } from './Mark';

// Copy follows the rebrand proposal (revised 23 September 2026), reworded as an
// evolving team. Two things are deliberately absent until they exist: real
// photography of people working together, and an enquiry address. "Talk to Us"
// lands on the closing panel until a real route is agreed.

export default function SageHalpinPage() {
  return (
    <div className="sh-page">
      <header className="top">
        <div className="wrap top-inner">
          <a className="wordmark" href="#top" aria-label="Sage Halpin, the evolving board">
            <Mark size={34} />
            <span><span className="wordmark-name">SAGE HALPIN</span><span className="wordmark-desc">THE EVOLVING BOARD</span></span>
          </a>
          <nav className="nav" aria-label="Primary">
            <a href="#idea">The Idea</a><a href="#team">The Team</a><a href="#memory">The Memory</a><a href="#how">How It Works</a><a href="#boards">For Boards</a><a className="nav-cta" href="#contact">Talk to Us</a>
          </nav>
          <details className="menu">
            <summary>Menu</summary>
            <nav aria-label="Primary, compact">
              <a href="#idea">The Idea</a><a href="#team">The Team</a><a href="#memory">The Memory</a><a href="#how">How It Works</a><a href="#boards">For Boards</a><a href="#contact">Talk to Us</a>
            </nav>
          </details>
        </div>
      </header>

      <main id="top">
        <BoardroomHero>
      <div className="hero-copy">
              <p className="label eyebrow">Sage Halpin · The evolving board</p>
              <h1 id="hero-title">The team evolves. <span className="second">The knowledge compounds.</span></h1>
              <p className="lede">An evolving team of human experts and agentic advisers that scales and flexes with the ever-changing needs of your organisation. One enduring institutional memory, so each decision benefits from the knowledge of those that came before.</p>
              <div className="ctas">
                <a className="btn btn-primary" href="#idea">Explore Sage Halpin</a>
                <a className="btn btn-ghost" href="#how">See the model</a>
              </div>
            </div>
      </BoardroomHero>

        <div className="strip">
          <div className="wrap strip-inner">
            <span>Human judgement</span><em>×</em><span>Agentic capability</span><em>×</em><span>Institutional memory</span>
          </div>
        </div>

        <section id="idea" className="section">
          <div className="wrap">
            <p className="label kicker">The idea</p>
            <div className="idea-grid">
              <h2>A living board, aligned to the decisions in front of it.</h2>
              <div className="prose">
                <p>Sage Halpin is a changing combination of experienced people and specialist AI agents. Human expertise enters for an acquisition, an industry expansion or a leadership transition. Agentic advisers monitor evidence, prepare questions, challenge plans and follow actions through.</p>
                <p>Approved learning from each assignment becomes part of the company's enduring knowledge base. The team is fluid. The knowledge is continuous. Board authority remains with the client's appointed directors and authorised decision makers.</p>
              </div>
            </div>
            <div className="flows">
              <div className="flow flow-changes">
                <h3><span className="dot dot-person" />Changes with the business</h3>
                <ul>
                  <li>Human specialists, agentic advisers and their assignments</li>
                  <li>Questions, opportunities and risks under review</li>
                  <li>Market conditions and operating priorities</li>
                  <li>Meeting participants and leadership roles</li>
                </ul>
              </div>
              <div className="flow flow-continues">
                <h3><span className="dot dot-continues" />Continues across the business</h3>
                <ul>
                  <li>Company context, strategy and agreed objectives</li>
                  <li>Decisions, rationales, assumptions and outcomes</li>
                  <li>Evidence provenance, action history and lessons</li>
                  <li>Permissions, governance rules and knowledge ownership</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="team" className="section">
          <div className="wrap">
            <div className="team-head">
              <div>
                <p className="label kicker">The team</p>
                <h2>A team that scales and flexes with you.</h2>
              </div>
              <div className="prose">
                <p>The team grows, contracts and changes shape with the ever-changing needs of your organisation: a finance expert for a transaction, an operator for integration, a sector adviser for expansion, and specialist agents active between meetings. Contributors change. The context remains available to authorised successors.</p>
              </div>
            </div>
            <div className="bento">
              <article className="tile tile-people">
                <p className="big">People</p>
                <div>
                  <h3>Board-level people, for a defined mandate.</h3>
                  <p>A curated bench of board-level operators, sector specialists, functional experts and independent challengers. Members join for a specific problem, period or mandate, and leave behind a structured handover. Their participation and availability are contracted and visible to the client.</p>
                </div>
              </article>
              <article className="tile tile-agents">
                <h3>Agentic advisers that work between meetings.</h3>
                <p>Task-capable agents that distinguish evidence from inference, show their sources and ask for a human decision when authority is required. Every agent declares:</p>
                <ul className="declares"><li>Scope</li><li>Tools</li><li>Memory access</li><li>Escalation threshold</li></ul>
              </article>
              <article className="tile tile-roles" aria-label="Agentic advisers">
                <ul className="roles">
                  <li><span className="dot dot-agent" /><strong>Strategy agent</strong><span>Tracks the agreed objectives and tests plans against them.</span></li>
                  <li><span className="dot dot-agent" /><strong>Commercial growth agent</strong><span>Watches markets, customers and pipeline.</span></li>
                  <li><span className="dot dot-agent" /><strong>Finance agent</strong><span>Checks forecasts against actuals and assumptions.</span></li>
                  <li><span className="dot dot-agent" /><strong>Operations agent</strong><span>Follows actions through and surfaces delivery issues.</span></li>
                  <li><span className="dot dot-agent" /><strong>Technology agent</strong><span>Assesses systems, change and technical exposure.</span></li>
                  <li><span className="dot dot-agent" /><strong>People agent</strong><span>Maps leadership, capability and succession.</span></li>
                  <li><span className="dot dot-agent" /><strong>Governance agent</strong><span>Keeps decision rights, conflicts and obligations in view.</span></li>
                  <li><span className="dot dot-agent" /><strong>Sector specialist agent</strong><span>Brings an industry's regulation and dynamics.</span></li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section id="memory" className="section memory">
          <div className="wrap">
            <div className="memory-grid">
              <div>
                <p className="label kicker">The memory</p>
                <h2>A company that remembers.</h2>
                <div className="prose prose-after">
                  <p>Decisions, evidence, actions and outcomes form a traceable company memory. New contributors arrive informed. Existing contributors see what has changed. Earlier judgements remain connected to their reasons and results.</p>
                  <p>The knowledge layer is client-owned. Contradictions and stale information are surfaced for review rather than silently treated as truth.</p>
                </div>
                <ul className="tags" aria-label="Every record carries">
                  <li>Source links</li><li>Timestamps</li><li>Owners</li><li>Access controls</li><li>Corrections</li><li>Retention rules</li><li>Version history</li>
                </ul>
              </div>
              <aside className="caveat">
                <h3>What "never losing knowledge" means</h3>
                <p>When a person leaves, a project changes hands or a new adviser joins, the organisation's history is available to its authorised successors. That is a design for durable, transferable institutional memory, subject to the client's retention, deletion and access policies. It is not a claim that every conversation is captured, or that data can never be lost.</p>
              </aside>
            </div>
            <div className="pair">
              <div>
                <h3>The work continues between meetings.</h3>
                <p>Agentic advisers monitor agreed signals, develop options, challenge assumptions, surface emerging issues and follow through on actions. Human advisers guide, test and decide with the people accountable for the business.</p>
              </div>
              <div>
                <h3>The orchestration.</h3>
                <p>Sage Halpin identifies the expertise a question calls for, convenes the relevant people and agents, prepares a board-ready view, records the decision and follows execution. The team adapts when the company's priorities change.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="section how">
          <div className="wrap">
            <p className="label kicker">How it works</p>
            <h2>One cycle, carried forward.</h2>
            <ol className="steps">
              <li className="step"><span className="step-n">01</span><h3>Understand the company</h3><p>Establish priorities, sources, permissions and decision rights. With permission, connect the documents, systems, plans, meetings and people that matter, and establish what is known, uncertain, outdated or restricted.</p></li>
              <li className="step"><span className="step-n">02</span><h3>Assemble the right team</h3><p>Select human and agentic advisers for the work at hand. Their remit, access, duration and authority are explicit.</p></li>
              <li className="step"><span className="step-n">03</span><h3>Work the decision</h3><p>Examine evidence, alternatives, dissent, consequences and next actions. Agents research, test assumptions and track actions; human advisers bring experience, judgement, relationships and challenge.</p></li>
              <li className="step"><span className="step-n">04</span><h3>Learn and carry forward</h3><p>Record what was decided, why, by whom and on what evidence, then revisit it against the result. When advisers rotate, a successor receives the authorised context and can trace it to source.</p></li>
            </ol>
          </div>
        </section>

        <section id="boards" className="section">
          <div className="wrap">
            <div className="boards-head">
              <div>
                <p className="label kicker">For boards</p>
                <h2>Built for consequential change.</h2>
              </div>
              <div className="prose"><p>For founder-led companies, ambitious mid-market boards, PE-backed businesses and groups whose priorities, leadership and opportunities change faster than a fixed advisory structure can serve.</p></div>
            </div>
            <div className="engagements">
              <article className="engagement">
                <h3>First Decision</h3>
                <span className="label">What is assembled</span><p>A focused team of human and agentic advisers around one live board question.</p>
                <span className="label">Continuing value</span><p>Decision brief, evidence map and an initial memory record.</p>
              </article>
              <article className="engagement">
                <h3>Living Board</h3>
                <span className="label">What is assembled</span><p>A team that flexes with recurring priorities, with agentic work between meetings.</p>
                <span className="label">Continuing value</span><p>Ongoing decision cycle, action follow-through and maintained company memory.</p>
              </article>
              <article className="engagement">
                <h3>Group Intelligence</h3>
                <span className="label">What is assembled</span><p>Teams across business units or portfolio companies, with appropriate separation.</p>
                <span className="label">Continuing value</span><p>Shared patterns where permitted, local decision histories and group-level learning.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="contact" className="closing">
          <div className="wrap closing-inner">
            <h2>Expertise changes. <span>Understanding deepens.</span></h2>
            <div>
              <Mark size={52} className="mark" />
              <p>An evolving team connected to a durable record of what the organisation knows, decides and learns.</p>
              <a className="btn btn-primary" href="#how">Explore the model</a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap footer-inner">
          <span className="wordmark"><span><span className="wordmark-name">SAGE HALPIN</span><span className="wordmark-desc">THE EVOLVING BOARD</span></span></span>
          <p className="disclosure">Human advisers and AI agents support the board. AI agents are not statutory directors and do not exercise voting rights. The client's authorised people retain decision authority. Data access, retention and deletion follow the agreed terms.</p>
        </div>
      </footer>
    </div>
  );
}
