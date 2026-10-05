import express from "express";
import pinoHttp from "pino-http";
import path from "node:path";
import boardroom from "./routes/boardroom.js";
import consultations from "./routes/consultations.js";
import workspaces from "./routes/workspaces.js";
import auth from "./routes/auth.js";
import { aiProvider } from "./ai.js";
import { limitFromEnv, rateLimit } from "./rate-limit.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function redactUrl(url: string): string {
  return url.replace(/\/respond\/[^/?#]+/g, "/respond/[redacted]");
}

export function createApp({ publicDir = path.resolve(process.cwd(), "dist/public") } = {}) {
  const app = express();

  // Azure Container Apps (and Front Door, when used) terminate TLS and proxy
  // the request; trust the first hop so rate limiting sees the client IP.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      // Board questions can be commercially sensitive: never log bodies.
      serializers: {
        // Questionnaire links carry a person's access token: keep it out of the logs.
        req: (req: { method: string; url: string }) => ({ method: req.method, url: redactUrl(req.url) }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use(express.json({ limit: "256kb" }));

  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/readyz", (_req, res) => res.json({ status: "ready", ai: aiProvider() }));

  const windowMs = 10 * 60 * 1000;
  app.use("/api/boardroom/chat", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_CHAT_PER_10_MIN", 20) }));
  app.use("/api/boardroom/analysis", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_ANALYSIS_PER_10_MIN", 10) }));
  // Consultations: the AI steps are limited like board sessions; creating,
  // inviting and answering are cheap but still bounded per client.
  const consult = rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_CONSULT_AI_PER_10_MIN", 20) });
  app.use("/api/consultations/questionnaire", consult);
  app.use(/^\/api\/consultations\/[^/]+\/(shadow-board|synthesis|challenge)$/, consult);
  app.use(/^\/api\/workspaces\/[^/]+\/(agents\/[^/]+\/study|decisions\/[^/]+\/outcome|horizon\/scan|checkpoints)$/, consult);
  app.use("/api/workspaces", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_CONSULT_PER_10_MIN", 120) }));
  app.use("/api/consultations", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_CONSULT_PER_10_MIN", 120) }));
  app.use("/api/respond", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_RESPOND_PER_10_MIN", 60) }));
  app.use("/api/respond", (_req, res, next) => {
    // Questionnaire links carry a token: never pass it on in a Referer header.
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Accounts: slow down password guessing per IP.
  const authMessage = "Too many sign-in attempts. Please wait a few minutes and try again.";
  app.use(["/api/auth/signin", "/api/auth/signup"], rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_AUTH_PER_10_MIN", 10), message: authMessage }));
  app.use("/api/account", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_ACCOUNT_PER_10_MIN", 240), message: authMessage }));
  app.use("/api", auth);
  app.use("/api", boardroom);
  app.use("/api", consultations);
  app.use("/api", workspaces);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use("/api", (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    req.log.error({ err }, "request failed");
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  app.use(express.static(publicDir, { index: false, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
