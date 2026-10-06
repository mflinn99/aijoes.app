// Builds the Microsoft 365 Copilot app package (a zip of copilot/appPackage)
// with ${{VARS}} filled from an env file and the environment.
//
//   node scripts/copilot-package.mjs [env]        # reads copilot/env/.env.<env>, default "prod"
//
// Upload the zip in Teams admin centre (Manage apps > Upload) or sideload it in
// Teams for testing, or open the copilot/ folder in Microsoft 365 Agents Toolkit.
import { crc32, deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

export function fill(text, vars) {
  return text.replace(/\$\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, k) => (vars[k] ? vars[k] : m));
}

/** Minimal zip writer (deflate), enough for an app package. */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const deflated = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function buildPackage(vars, dir = "copilot/appPackage") {
  const files = readdirSync(dir).sort().map((name) => {
    const raw = readFileSync(join(dir, name));
    return [name, /\.(json|ya?ml)$/.test(name) ? Buffer.from(fill(raw.toString("utf8"), vars)) : raw];
  });
  const missing = new Set();
  for (const [, data] of files) for (const m of data.toString("latin1").matchAll(/\$\{\{\s*([A-Z0-9_]+)\s*\}\}/g)) missing.add(m[1]);
  if (missing.size) throw new Error(`Missing values: ${[...missing].join(", ")}`);
  return zip(files);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const envName = process.argv[2] ?? "prod";
  const vars = { ...loadEnvFile(`copilot/env/.env.${envName}`), ...process.env };
  const out = buildPackage(vars);
  mkdirSync("dist/copilot", { recursive: true });
  const file = `dist/copilot/hijojo-copilot-${envName}.zip`;
  writeFileSync(file, out);
  console.log(`Wrote ${file}`);
}
