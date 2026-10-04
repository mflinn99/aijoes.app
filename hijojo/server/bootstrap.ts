// Wires the engine from the environment. Each integration either has real
// configuration or reports itself unconfigured; none is faked in production.
// HIJOJO_DEMO=1 instead runs the synthetic world, labelled as a simulation.

import { openDb } from "./db";
import { Repo } from "./repo";
import { systemClock } from "./clock";
import { loadConfig } from "./config";
import { Engine } from "./engine";
import { AnthropicLlm, UnconfiguredLlm, type Llm } from "./llm/client";
import { LiveFetcher } from "./research/fetcher";
import { UnconfiguredContactProvider, WebSearchCandidates, StaticContactProvider } from "./agents/prospect";
import { SimMailbox } from "./mail/transport";
import { GraphMail, graphConfigFromEnv } from "./mail/graph";
import { scriptedModel, simWeb, PROSPECTS } from "./sim/world";
import type { AppStatus } from "./app";

export function bootstrap(env: NodeJS.ProcessEnv = process.env): { engine: Engine; status: AppStatus } {
  const config = loadConfig(env);
  const repo = new Repo(openDb(env.HIJOJO_DB_PATH), systemClock);

  if (env.HIJOJO_DEMO === "1") {
    if (config.sendMode === "live") throw new Error("HIJOJO_DEMO cannot run in live mode");
    const llm = scriptedModel();
    const mail = new SimMailbox();
    const engine = new Engine({
      repo,
      config: { ...config, senderName: config.senderName === "AIGoGo" ? "Alex Morgan" : config.senderName },
      llm,
      reviewer: null,
      fetcher: simWeb(),
      contacts: new StaticContactProvider(Object.fromEntries(Object.values(PROSPECTS).map((p) => [p.domain, p.contacts])), "synthetic-directory"),
      candidates: [new WebSearchCandidates(llm)],
      transport: mail,
      inbox: mail,
    });
    const sim = { configured: false, detail: "Simulated: synthetic .test world" };
    return { engine, status: { ai: { configured: false, detail: "Simulated: scripted model" }, research: sim, contacts: sim, mail: { configured: false, detail: "Simulated mailbox; nothing is sent" } } };
  }

  const hasAi = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const llm: Llm = hasAi ? new AnthropicLlm(env.HIJOJO_MODEL || "claude-opus-5-5") : new UnconfiguredLlm();
  const graph = graphConfigFromEnv(env);
  const live = config.sendMode === "live";
  const mailbox = live && graph ? new GraphMail(graph) : new SimMailbox();
  const engine = new Engine({
    repo,
    config: { ...config, senderEmail: graph?.mailbox ?? config.senderEmail },
    llm,
    reviewer: hasAi && env.HIJOJO_MODEL_REVIEW !== "0" ? llm : null,
    fetcher: new LiveFetcher(),
    contacts: new UnconfiguredContactProvider(),
    candidates: hasAi ? [new WebSearchCandidates(llm)] : [],
    transport: mailbox,
    inbox: mailbox,
  });
  return {
    engine,
    status: {
      ai: hasAi ? { configured: true, detail: llm.name } : { configured: false, detail: "Set ANTHROPIC_API_KEY. Analysis, research and drafting will not run without it." },
      research: { configured: true, detail: "Direct HTTPS retrieval with private-network protection. Requires outbound internet access." },
      contacts: { configured: false, detail: "Contact-data provider not yet named. Add decision-makers manually per prospect." },
      mail: live
        ? graph
          ? { configured: true, detail: `Outlook (${graph.mailbox}) via Microsoft Graph` }
          : { configured: false, detail: "Live mode requested but Outlook is not configured (HIJOJO_GRAPH_*); nothing will send" }
        : { configured: false, detail: `Simulation: messages are recorded, not sent${graph ? " (Outlook is configured but unused)" : ""}` },
    },
  };
}
