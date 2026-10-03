import "dotenv/config";
import { createApp } from "./app.js";
import { assertProvidersConfigured, providerSummary } from "./providers/index.js";
import { storeKind } from "./store.js";
import { assertClockConfigured } from "./clock.js";

// Fail fast: a travel search with no aggregator behind it cannot find anything.
assertProvidersConfigured();
assertClockConfigured();

const port = Number(process.env.PORT || 3002);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

createApp().listen(port, "0.0.0.0", () => {
  const providers = providerSummary()
    .map((p) => `${p.name}(${[...p.transport, p.stays && "stays", p.anywhere && "anywhere"].filter(Boolean).join("+")})`)
    .join(", ");
  console.info(`Travel search listening on port ${port} (providers: ${providers}; store: ${storeKind()})`);
});
