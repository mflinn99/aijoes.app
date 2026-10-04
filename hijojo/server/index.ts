import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrap } from "./bootstrap";
import { createApp } from "./app";
import { OPCO } from "./sim/world";

const { engine, status } = bootstrap();
const app = createApp(engine, status, { secureCookies: process.env.NODE_ENV === "production" });

const dist = join(process.cwd(), "dist", "client");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 5050);
app.listen(port, () => {
  const s = engine.sendingState();
  console.log(`Hijojo API on :${port} (${s.mode}${s.canSend ? "" : `, not sending: ${s.reason}`})`);
});

if (process.env.HIJOJO_DEMO === "1" && engine.d.repo.opcos().length === 0) {
  engine.addOpco(OPCO);
}

// The worker: run due jobs continuously; poll the inbox on its own cadence.
if (process.env.HIJOJO_DISABLE_WORKER !== "1") {
  let busy = false;
  let lastSync = 0;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const pollMs = engine.d.config.inboxPollMinutes * 60_000;
      if (Date.now() - lastSync >= pollMs) {
        lastSync = Date.now();
        await engine.syncInbox().catch((e) => engine.d.repo.event("inbox.sync_failed", (e as Error).message));
      }
      await engine.runDue(25);
    } finally {
      busy = false;
    }
  }, 3000);
}
