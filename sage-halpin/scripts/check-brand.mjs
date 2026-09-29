// Fails if the retired Sixonic brand, or the word "roster", appears in anything
// that ships: source, the HTML shell, public assets and (when built) dist.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SHIPPED = ["src", "server", "public", "index.html", "dist"];
const BANNED = [/sixonic/i, /\broster\b/i];
const TEXT = /\.(tsx?|mjs|js|css|html|svg|json|txt)$/;

const failures = [];
function scan(target) {
  if (!existsSync(target)) return;
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target)) scan(path.join(target, entry));
    return;
  }
  if (!TEXT.test(target)) return;
  readFileSync(target, "utf8").split("\n").forEach((line, i) => {
    for (const pattern of BANNED) {
      if (pattern.test(line)) failures.push(`${path.relative(root, target)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

for (const entry of SHIPPED) scan(path.join(root, entry));

if (failures.length) {
  console.error(`Brand check failed: retired brand or banned wording found\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("Brand check passed: no Sixonic branding or roster wording in shipped files.");
