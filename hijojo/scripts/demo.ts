// Runs Hijojo against the synthetic world: fictional .test companies, a
// scripted model and a simulated mailbox. Nothing leaves this process.

export {};

process.env.HIJOJO_DEMO = "1";
process.env.HIJOJO_SEND_MODE = "simulate";
process.env.HIJOJO_DB_PATH ??= ".data/demo.db";
process.env.HIJOJO_INBOX_POLL_MINUTES ??= "1";

const { openDb } = await import("../server/db");
const { Repo } = await import("../server/repo");
const { systemClock } = await import("../server/clock");
const { seedUsers } = await import("./seed");
const users = seedUsers(new Repo(openDb(process.env.HIJOJO_DB_PATH), systemClock), {
  ...process.env,
  HIJOJO_USER_DOMAIN: "demo.test",
});
console.log("SIMULATION. Synthetic data only; no email leaves this process.");
for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.email}  ${u.password ?? "(unchanged)"}`);
await import("../server/index");
