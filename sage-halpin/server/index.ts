import "dotenv/config";
import express from "express";
import pinoHttp from "pino-http";
import path from "node:path";
import boardroom from "./routes/boardroom.js";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required. Copy .env.example to .env and set a provider key.");
}

const app = express();
app.use(pinoHttp());
app.use(express.json({ limit: "1mb" }));
app.use("/api", boardroom);
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const publicDir = path.resolve(process.cwd(), "dist/public");
app.use(express.static(publicDir));
app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");
app.listen(port, "0.0.0.0", () => console.info(`SIXONIC listening on port ${port}`));
