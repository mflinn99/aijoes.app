import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

// Where searches and saved trips live. JSON documents addressed by a
// collection and an id. Memory for tests and development; a directory of
// files for a single-instance deployment. Anything multi-replica swaps in a
// database behind the same three methods.

export interface Store {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  list<T>(collection: string): Promise<T[]>;
  remove(collection: string, id: string): Promise<void>;
}

export class MemoryStore implements Store {
  private data = new Map<string, Map<string, string>>();

  async get<T>(collection: string, id: string): Promise<T | null> {
    const raw = this.data.get(collection)?.get(id);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    let rows = this.data.get(collection);
    if (!rows) this.data.set(collection, (rows = new Map()));
    rows.set(id, JSON.stringify(value));
  }

  async list<T>(collection: string): Promise<T[]> {
    return [...(this.data.get(collection)?.values() ?? [])].map((raw) => JSON.parse(raw) as T);
  }

  async remove(collection: string, id: string): Promise<void> {
    this.data.get(collection)?.delete(id);
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class FileStore implements Store {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(collection: string, id: string): string {
    if (!SAFE_ID.test(collection) || !SAFE_ID.test(id)) throw new Error("Invalid store key");
    return path.join(this.dir, collection, `${id}.json`);
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const f = this.file(collection, id);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    const f = this.file(collection, id);
    mkdirSync(path.dirname(f), { recursive: true });
    // Write then rename, so a crash never leaves half a document.
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, f);
  }

  async list<T>(collection: string): Promise<T[]> {
    if (!SAFE_ID.test(collection)) throw new Error("Invalid store key");
    const dir = path.join(this.dir, collection);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(path.join(dir, n), "utf8")) as T);
  }

  async remove(collection: string, id: string): Promise<void> {
    rmSync(this.file(collection, id), { force: true });
  }
}

let store: Store | null = null;

export function storeKind(): "memory" | "file" {
  const kind = (process.env.TRAVEL_STORE ?? "file").toLowerCase();
  if (kind !== "memory" && kind !== "file") throw new Error(`TRAVEL_STORE must be memory or file (got "${kind}")`);
  return kind;
}

export function getStore(): Store {
  if (!store) store = storeKind() === "memory" ? new MemoryStore() : new FileStore(process.env.TRAVEL_DATA_DIR ?? ".data");
  return store;
}

export function setStore(s: Store | null): void {
  store = s;
}
