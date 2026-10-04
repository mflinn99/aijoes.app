// Creates the first users. Passwords come from the environment or are generated
// and printed once; there is no known default.

import { randomBytes } from "node:crypto";
import { openDb } from "../server/db";
import { Repo } from "../server/repo";
import { systemClock } from "../server/clock";
import { createUser } from "../server/auth";
import type { Role } from "../shared/types";

export function seedUsers(repo: Repo, env: NodeJS.ProcessEnv = process.env): { email: string; role: Role; password: string | null }[] {
  const domain = env.HIJOJO_USER_DOMAIN || "aigogo.ai";
  const wanted: { email: string; name: string; role: Role; env: string }[] = [
    { email: env.HIJOJO_ADMIN_EMAIL || `admin@${domain}`, name: "Administrator", role: "ADMIN", env: "HIJOJO_ADMIN_PASSWORD" },
    { email: env.HIJOJO_OPERATOR_EMAIL || `operator@${domain}`, name: "Operator", role: "OPERATOR", env: "HIJOJO_OPERATOR_PASSWORD" },
    { email: env.HIJOJO_VIEWER_EMAIL || `viewer@${domain}`, name: "Viewer", role: "VIEWER", env: "HIJOJO_VIEWER_PASSWORD" },
  ];
  const out = [];
  for (const u of wanted) {
    const exists = repo.db.prepare("SELECT 1 FROM users WHERE email = ?").get(u.email.toLowerCase());
    if (exists) {
      out.push({ email: u.email, role: u.role, password: null });
      continue;
    }
    const password = env[u.env] || randomBytes(12).toString("base64url");
    createUser(repo, { email: u.email, name: u.name, role: u.role, password });
    out.push({ email: u.email, role: u.role, password: env[u.env] ? "(from environment)" : password });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = new Repo(openDb(process.env.HIJOJO_DB_PATH), systemClock);
  for (const u of seedUsers(repo)) {
    console.log(`${u.role.padEnd(8)} ${u.email}  ${u.password ?? "(already exists; unchanged)"}`);
  }
  console.log("\nPasswords are shown once. Store them now.");
}
