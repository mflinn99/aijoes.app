/**
 * Additive column migrations.
 *
 * schema.sql uses CREATE TABLE IF NOT EXISTS, which never adds a column to a
 * table that already exists. Anything added to an existing table after the
 * first release goes here, guarded by a check so it is safe to run on every
 * boot and on a fresh database alike.
 */

import type { Database } from 'better-sqlite3';

interface ColumnAddition {
  table: string;
  column: string;
  definition: string;
}

const COLUMNS: ColumnAddition[] = [
  { table: 'users', column: 'password_hash', definition: 'TEXT' },
  { table: 'users', column: 'status', definition: "TEXT NOT NULL DEFAULT 'active'" },
  { table: 'users', column: 'last_login_at', definition: 'TEXT' },
  { table: 'users', column: 'idp', definition: "TEXT NOT NULL DEFAULT 'local'" },
  { table: 'users', column: 'idp_subject', definition: 'TEXT' },
  // What the MSP already sells this customer. Without it, MSP EXPAND proposes
  // services the customer is already paying for, which is worse than proposing
  // nothing — it tells the account owner the platform does not know the account.
  { table: 'customers', column: 'current_services', definition: "TEXT NOT NULL DEFAULT '[]'" },
];

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

export function migrate(db: Database): void {
  for (const { table, column, definition } of COLUMNS) {
    const tableExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    if (!tableExists) continue;
    if (hasColumn(db, table, column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
