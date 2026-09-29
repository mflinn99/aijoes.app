import express from "express";
import pinoHttp from "pino-http";
import path from "node:path";
import boardroom from "./routes/boardroom.js";
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
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
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
  app.use("/api", boardroom);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  app.use(express.static(publicDir, { index: false, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
