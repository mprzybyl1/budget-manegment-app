// Warstwa bazy danych: better-sqlite3 (jeden plik, idealne dla 1 uzytkownika).
// Schema + indeksy + seed domyslnych kategorii. Wszystko synchroniczne.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, 'budzet.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS user (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'checking',   -- checking|cash|credit|savings
  currency        TEXT NOT NULL DEFAULT 'PLN',
  opening_balance REAL NOT NULL DEFAULT 0,
  credit_limit    REAL,                               -- tylko dla kart kredytowych
  archived        INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '📦',
  kind        TEXT NOT NULL DEFAULT 'expense',        -- expense|income
  color       TEXT NOT NULL DEFAULT '#6366f1',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS txn (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES category(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'expense',        -- expense|income
  amount      REAL NOT NULL,                          -- zawsze dodatnia, znak wynika z type
  currency    TEXT NOT NULL DEFAULT 'PLN',
  note        TEXT,
  occurred_at TEXT NOT NULL,                          -- YYYY-MM-DD
  source      TEXT NOT NULL DEFAULT 'manual',         -- manual|shopping
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shopping_list (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',           -- open|done
  account_id  INTEGER REFERENCES account(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES category(id) ON DELETE SET NULL,
  finished_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shopping_item (
  id         INTEGER PRIMARY KEY,
  list_id    INTEGER NOT NULL REFERENCES shopping_list(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  qty        REAL NOT NULL DEFAULT 1,
  price      REAL,                                    -- cena za sztuke (opcjonalna)
  checked    INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Miejsce na przyszle limity (na razie nieuzywane w UI).
CREATE TABLE IF NOT EXISTS budget (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,                         -- YYYY-MM
  limit_amount REAL NOT NULL,
  UNIQUE(category_id, month)
);

CREATE INDEX IF NOT EXISTS idx_txn_occurred ON txn(occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_category ON txn(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_account  ON txn(account_id);
CREATE INDEX IF NOT EXISTS idx_item_list    ON shopping_item(list_id);
`);

// Seed domyslnych kategorii tylko gdy tabela pusta.
const catCount = db.prepare('SELECT COUNT(*) AS n FROM category').get().n;
if (catCount === 0) {
  const insert = db.prepare(
    'INSERT INTO category (name, emoji, kind, color, sort_order) VALUES (?,?,?,?,?)'
  );
  const seed = [
    ['Spożywcze', '🛒', 'expense', '#22c55e', 1],
    ['Restauracje', '🍽️', 'expense', '#f97316', 2],
    ['Transport', '🚗', 'expense', '#3b82f6', 3],
    ['Mieszkanie', '🏠', 'expense', '#a855f7', 4],
    ['Rachunki', '💡', 'expense', '#eab308', 5],
    ['Zdrowie', '💊', 'expense', '#ef4444', 6],
    ['Rozrywka', '🎬', 'expense', '#ec4899', 7],
    ['Ubrania', '👕', 'expense', '#14b8a6', 8],
    ['Subskrypcje', '📱', 'expense', '#6366f1', 9],
    ['Inne', '📦', 'expense', '#64748b', 10],
    ['Wypłata', '💰', 'income', '#16a34a', 11],
    ['Inne przychody', '➕', 'income', '#0ea5e9', 12],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  tx(seed);
}

// Migracja: kolumna transfer_id laczy dwie nogi przelewu (np. splata karty).
const txnCols = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name);
if (!txnCols.includes('transfer_id')) {
  db.exec('ALTER TABLE txn ADD COLUMN transfer_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_txn_transfer ON txn(transfer_id)');
}

export default db;
