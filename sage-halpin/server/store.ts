import { TableClient, odata } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";

// Durable storage for board consultations: the question, the people invited to
// answer it, their questionnaire responses and the board's views. The rest of
// the workspace still lives in the lead's browser; this is the part that has to
// be shared with people answering from their own devices.
//
// Documents are JSON, addressed by a partition (one consultation, or the token
// index) and a row. Production uses Azure Table Storage with the app's managed
// identity, so replicas share it; hosts with PostgreSQL (such as Replit) use
// that; development and tests use memory.

export interface Store {
  get<T>(partition: string, row: string): Promise<T | null>;
  put<T>(partition: string, row: string, value: T): Promise<void>;
  list<T>(partition: string): Promise<{ row: string; value: T }[]>;
  remove(partition: string, row: string): Promise<void>;
  /** Every document with this row key, across partitions (for housekeeping). */
  listByRow<T>(row: string): Promise<{ partition: string; value: T }[]>;
}

export class StoreConfigError extends Error {}

export class MemoryStore implements Store {
  private data = new Map<string, Map<string, string>>();

  async get<T>(partition: string, row: string): Promise<T | null> {
    const raw = this.data.get(partition)?.get(row);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put<T>(partition: string, row: string, value: T): Promise<void> {
    let rows = this.data.get(partition);
    if (!rows) this.data.set(partition, (rows = new Map()));
    rows.set(row, JSON.stringify(value));
  }

  async list<T>(partition: string): Promise<{ row: string; value: T }[]> {
    return [...(this.data.get(partition) ?? new Map<string, string>())].map(([row, raw]) => ({ row, value: JSON.parse(raw) as T }));
  }

  async listByRow<T>(row: string): Promise<{ partition: string; value: T }[]> {
    const out: { partition: string; value: T }[] = [];
    for (const [partition, rows] of this.data) {
      const raw = rows.get(row);
      if (raw !== undefined) out.push({ partition, value: JSON.parse(raw) as T });
    }
    return out;
  }

  async remove(partition: string, row: string): Promise<void> {
    const rows = this.data.get(partition);
    rows?.delete(row);
    if (rows && rows.size === 0) this.data.delete(partition);
  }
}

// Azure Table Storage keys may not contain / \ # ? or control characters.
const UNSAFE_KEY = /[\\/#?\u0000-\u001f\u007f-\u009f]/;

function checkKey(key: string): string {
  if (!key || UNSAFE_KEY.test(key)) throw new Error("invalid storage key");
  return key;
}

export class TableStore implements Store {
  private ready: Promise<unknown> | null = null;

  constructor(private readonly client: TableClient) {}

  private ensureTable() {
    // createTable succeeds when the table already exists.
    this.ready ??= this.client.createTable().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  async get<T>(partition: string, row: string): Promise<T | null> {
    await this.ensureTable();
    try {
      const entity = await this.client.getEntity<{ json: string }>(checkKey(partition), checkKey(row));
      return JSON.parse(entity.json) as T;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async put<T>(partition: string, row: string, value: T): Promise<void> {
    await this.ensureTable();
    await this.client.upsertEntity(
      { partitionKey: checkKey(partition), rowKey: checkKey(row), json: JSON.stringify(value) },
      "Replace",
    );
  }

  async list<T>(partition: string): Promise<{ row: string; value: T }[]> {
    await this.ensureTable();
    const out: { row: string; value: T }[] = [];
    const entities = this.client.listEntities<{ json: string }>({
      queryOptions: { filter: odata`PartitionKey eq ${checkKey(partition)}` },
    });
    for await (const entity of entities) out.push({ row: entity.rowKey as string, value: JSON.parse(entity.json) as T });
    return out;
  }

  async listByRow<T>(row: string): Promise<{ partition: string; value: T }[]> {
    await this.ensureTable();
    const out: { partition: string; value: T }[] = [];
    const entities = this.client.listEntities<{ json: string }>({
      queryOptions: { filter: odata`RowKey eq ${checkKey(row)}` },
    });
    for await (const entity of entities) out.push({ partition: entity.partitionKey as string, value: JSON.parse(entity.json) as T });
    return out;
  }

  async remove(partition: string, row: string): Promise<void> {
    await this.ensureTable();
    try {
      await this.client.deleteEntity(checkKey(partition), checkKey(row));
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }
}

/**
 * PostgreSQL: one table of JSON documents keyed by partition and row. Used where
 * the host provides a database (DATABASE_URL), such as Replit.
 */
export class PostgresStore implements Store {
  private ready: Promise<unknown> | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly table = "sentinel8_documents",
  ) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) throw new StoreConfigError("PG_TABLE must be a plain lower-case table name");
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
           partition_key TEXT NOT NULL,
           row_key TEXT NOT NULL,
           json TEXT NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           PRIMARY KEY (partition_key, row_key)
         );
         CREATE INDEX IF NOT EXISTS ${this.table}_row_key ON ${this.table} (row_key);`,
      )
      .catch((err) => {
        this.ready = null;
        throw err;
      });
    return this.ready;
  }

  async get<T>(partition: string, row: string): Promise<T | null> {
    await this.ensureTable();
    const { rows } = await this.pool.query<{ json: string }>(`SELECT json FROM ${this.table} WHERE partition_key = $1 AND row_key = $2`, [
      checkKey(partition),
      checkKey(row),
    ]);
    return rows.length ? (JSON.parse(rows[0].json) as T) : null;
  }

  async put<T>(partition: string, row: string, value: T): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO ${this.table} (partition_key, row_key, json) VALUES ($1, $2, $3)
       ON CONFLICT (partition_key, row_key) DO UPDATE SET json = EXCLUDED.json, updated_at = now()`,
      [checkKey(partition), checkKey(row), JSON.stringify(value)],
    );
  }

  async list<T>(partition: string): Promise<{ row: string; value: T }[]> {
    await this.ensureTable();
    const { rows } = await this.pool.query<{ row_key: string; json: string }>(
      `SELECT row_key, json FROM ${this.table} WHERE partition_key = $1 ORDER BY row_key`,
      [checkKey(partition)],
    );
    return rows.map((r) => ({ row: r.row_key, value: JSON.parse(r.json) as T }));
  }

  async listByRow<T>(row: string): Promise<{ partition: string; value: T }[]> {
    await this.ensureTable();
    const { rows } = await this.pool.query<{ partition_key: string; json: string }>(
      `SELECT partition_key, json FROM ${this.table} WHERE row_key = $1 ORDER BY partition_key`,
      [checkKey(row)],
    );
    return rows.map((r) => ({ partition: r.partition_key, value: JSON.parse(r.json) as T }));
  }

  async remove(partition: string, row: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query(`DELETE FROM ${this.table} WHERE partition_key = $1 AND row_key = $2`, [checkKey(partition), checkKey(row)]);
  }
}

export type StoreKind = "memory" | "table" | "postgres";

export function storeKind(): StoreKind {
  const fallback = process.env.NODE_ENV === "production" ? (process.env.DATABASE_URL ? "postgres" : "table") : "memory";
  const raw = (process.env.STORE ?? fallback).toLowerCase();
  if (raw !== "memory" && raw !== "table" && raw !== "postgres") throw new StoreConfigError(`STORE must be memory, table or postgres (got "${raw}")`);
  return raw;
}

/** Throws StoreConfigError describing what is missing, so startup can fail fast. */
export function assertStoreConfigured(): void {
  if (storeKind() === "table" && !process.env.TABLE_ENDPOINT) {
    throw new StoreConfigError("Set TABLE_ENDPOINT (https://<account>.table.core.windows.net) for STORE=table");
  }
  if (storeKind() === "postgres" && !process.env.DATABASE_URL) {
    throw new StoreConfigError("Set DATABASE_URL (postgres://…) for STORE=postgres");
  }
}

let shared: Store | null = null;

export function getStore(): Store {
  if (shared) return shared;
  if (storeKind() === "table") {
    assertStoreConfigured();
    const client = new TableClient(
      process.env.TABLE_ENDPOINT as string,
      process.env.TABLE_NAME || "consultations",
      new DefaultAzureCredential(),
    );
    shared = new TableStore(client);
  } else if (storeKind() === "postgres") {
    assertStoreConfigured();
    shared = new PostgresStore(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }), process.env.PG_TABLE || undefined);
  } else {
    shared = new MemoryStore();
  }
  return shared;
}
