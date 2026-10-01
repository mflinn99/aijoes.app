import "dotenv/config";
import { createApp } from "./app.js";
import { aiModel, aiProvider, assertAIConfigured } from "./ai.js";
import { assertStoreConfigured, storeKind } from "./store.js";
import { assertEmailConfigured, emailProvider } from "./email.js";
import { sweepExpired } from "./routes/consultations.js";
import { scanDueWorkspaces } from "./horizon.js";
import { getStore } from "./store.js";

// Fail fast on a misconfigured AI provider rather than serving a board that
// cannot answer.
assertAIConfigured();
assertStoreConfigured();
assertEmailConfigured();

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

createApp().listen(port, "0.0.0.0", () =>
  console.info(`Sentinel8 listening on port ${port} (AI: ${aiProvider()}, model ${aiModel()}; store: ${storeKind()}; email: ${emailProvider()})`),
);

// Delete consultations past their retention date, whether or not anyone opens them again.
const SWEEP_MS = 6 * 60 * 60 * 1000;
const sweep = () =>
  sweepExpired()
    .then((n) => n > 0 && console.info(`Deleted ${n} expired consultation(s)`))
    .catch((err) => console.error("Consultation sweep failed", err));
setTimeout(sweep, 60_000).unref();
setInterval(sweep, SWEEP_MS).unref();

// Keep looking outward: every half hour, scan each workspace that is due
// (each sets its own interval, 6 hours to a week). HORIZON_SCANNER=off stops it.
if ((process.env.HORIZON_SCANNER ?? "on").toLowerCase() !== "off") {
  const SCAN_CHECK_MS = 30 * 60 * 1000;
  const scan = () =>
    scanDueWorkspaces(getStore())
      .then((n) => n > 0 && console.info(`Horizon scan: ${n} workspace(s) scanned`))
      .catch((err) => console.error("Horizon scan failed", err));
  setTimeout(scan, 2 * 60_000).unref();
  setInterval(scan, SCAN_CHECK_MS).unref();
}
