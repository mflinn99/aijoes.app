import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

let db: Database.Database | null = null;

export function dbPath(): string {
  return process.env.METAMSP_DB_PATH ?? join(process.cwd(), '.data', 'metamsp.db');
}

export function getDb(): Database.Database {
  if (db) return db;
  const path = dbPath();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

export function applySchema(target: Database.Database): void {
  const schemaPath = join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  const sql = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '';
  if (!sql) throw new Error(`schema.sql not found at ${schemaPath}`);
  target.exec(sql);
}

/** For tests: an isolated in-memory database with the full schema applied. */
export function createTestDb(): Database.Database {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  applySchema(mem);
  return mem;
}

export function resetDbForTests(): void {
  db = null;
}
