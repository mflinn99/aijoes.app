import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { PostgresStore, storeKind } from "../server/store.js";

// The PostgreSQL store (used on hosts such as Replit) against a real database.
// Runs when TEST_DATABASE_URL points at one, as in CI; each run uses its own table.

const url = process.env.TEST_DATABASE_URL;
const table = `s8_test_${Date.now()}`;

describe.runIf(url)("PostgresStore", () => {
  let pool: pg.Pool;
  let store: PostgresStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
    store = new PostgresStore(pool, table);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  });

  it("stores, replaces, lists and removes documents", async () => {
    expect(await store.get("c-1", "meta")).toBeNull();
    await store.put("c-1", "meta", { question: "Expand?", n: 1 });
    await store.put("c-1", "meta", { question: "Expand?", n: 2 });
    await store.put("c-1", "answer-b", { v: "b" });
    await store.put("c-1", "answer-a", { v: "a" });
    expect(await store.get("c-1", "meta")).toEqual({ question: "Expand?", n: 2 });
    expect((await store.list("c-1")).map((r) => r.row)).toEqual(["answer-a", "answer-b", "meta"]);
    await store.remove("c-1", "answer-a");
    await store.remove("c-1", "missing"); // removing nothing is fine
    expect((await store.list("c-1")).map((r) => r.row)).toEqual(["answer-b", "meta"]);
  });

  it("finds a row key across partitions", async () => {
    await store.put("c-2", "meta", { id: 2 });
    await store.put("c-3", "meta", { id: 3 });
    const found = await store.listByRow<{ id?: number }>("meta");
    expect(found.filter((f) => f.partition !== "c-1").map((f) => f.value.id)).toEqual([2, 3]);
  });

  it("keeps documents when the app restarts", async () => {
    await store.put("accounts", "a-1", { name: "Pat" });
    const restarted = new PostgresStore(pool, table);
    expect(await restarted.get("accounts", "a-1")).toEqual({ name: "Pat" });
  });

  it("treats keys as data, never as SQL", async () => {
    const sneaky = "x'); DROP TABLE users; --";
    await store.put(sneaky, "row", { ok: true });
    expect(await store.get(sneaky, "row")).toEqual({ ok: true });
    await expect(store.put("a/b", "row", {})).rejects.toThrow("invalid storage key");
  });

  it("refuses a table name that isn't a plain identifier", () => {
    expect(() => new PostgresStore(pool, "docs; drop table x")).toThrow("PG_TABLE");
  });
});

describe("store selection", () => {
  it("uses PostgreSQL in production when the host provides DATABASE_URL", () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, STORE: process.env.STORE, DATABASE_URL: process.env.DATABASE_URL };
    try {
      delete process.env.STORE;
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgres://example/db";
      expect(storeKind()).toBe("postgres");
      delete process.env.DATABASE_URL;
      expect(storeKind()).toBe("table");
      process.env.STORE = "postgres";
      expect(storeKind()).toBe("postgres");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
