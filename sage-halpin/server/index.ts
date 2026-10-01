import "dotenv/config";
import { createApp } from "./app.js";
import { aiModel, aiProvider, assertAIConfigured } from "./ai.js";
import { assertStoreConfigured, storeKind } from "./store.js";
import { assertEmailConfigured, emailProvider } from "./email.js";
import { sweepExpired } from "./routes/consultations.js";

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
