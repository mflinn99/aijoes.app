import "dotenv/config";
import { createApp } from "./app.js";
import { aiModel, aiProvider, assertAIConfigured } from "./ai.js";

// Fail fast on a misconfigured AI provider rather than serving a board that
// cannot answer.
assertAIConfigured();

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

createApp().listen(port, "0.0.0.0", () =>
  console.info(`Sentinel8 listening on port ${port} (AI: ${aiProvider()}, model ${aiModel()})`),
);
