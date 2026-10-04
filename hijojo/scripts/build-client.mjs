// Production client build. esbuild bundles the SPA directly; the Vite dev
// server is still used for local development.
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "dist/client";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/assets`, { recursive: true });
const result = await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  jsx: "automatic",
  target: "es2022",
  outdir: `${out}/assets`,
  entryNames: "[name]-[hash]",
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
const files = Object.keys(result.metafile.outputs).map((f) => f.replace(`${out}/`, ""));
const js = files.find((f) => f.endsWith(".js"));
const css = files.find((f) => f.endsWith(".css"));
const html = readFileSync("index.html", "utf8")
  .replace('<script type="module" src="/src/main.tsx"></script>', `${css ? `<link rel="stylesheet" href="/${css}" />\n    ` : ""}<script type="module" src="/${js}"></script>`);
writeFileSync(`${out}/index.html`, html);
