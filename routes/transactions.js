// Transakcje (wydatki i przychody). Filtry: month=YYYY-MM, category, account.
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function transactionRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async (request) => {
    const { month, category, account, limit } = request.query || {};
    const where = [];
    const params = [];
    if (month) {
      where.push("strftime('%Y-%m', occurred_at) = ?");
      params.push(month);
    }
    if (category) {
      where.push('t.category_id = ?');
      params.push(category);
    }
    if (account) {
      where.push('t.account_id = ?');
      params.push(account);
    }
    const sql = `
      SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
             a.name AS account_name
      FROM txn t
      LEFT JOIN category c ON c.id = t.category_id
      LEFT JOIN account  a ON a.id = t.account_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.occurred_at DESC, t.id DESC
      ${limit ? 'LIMIT ' + Number(limit) : ''}`;
    return db.prepare(sql).all(...params);
  });

  app.post('/', async (request, reply) => {
    const b = request.body || {};
    const amount = Math.abs(Number(b.amount));
    if (!amount || !b.account_id) {
      return reply.code(400).send({ error: 'Podaj kwotę i konto' });
    }
    const type = b.type === 'income' ? 'income' : 'expense';
    const info = db
      .prepare(
        `INSERT INTO txn (account_id, category_id, type, amount, currency, note, occurred_at, source)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        Number(b.account_id),
        b.category_id ? Number(b.category_id) : null,
        type,
        amount,
        b.currency || 'PLN',
        b.note ? String(b.note) : null,
        b.occurred_at || todayISO(),
        b.source === 'shopping' ? 'shopping' : 'manual'
      );
    return reply.code(201).send(db.prepare('SELECT * FROM txn WHERE id = ?').get(info.lastInsertRowid));
  });

  // Przelew miedzy kontami (np. splata karty kredytowej). Tworzy dwie powiazane nogi.
  app.post('/transfer', async (request, reply) => {
    const b = request.body || {};
    const from = Number(b.from_account_id);
    const to = Number(b.to_account_id);
    const amount = Math.abs(Number(b.amount));
    if (!from || !to || !amount) {
      return reply.code(400).send({ error: 'Podaj konto źródłowe, docelowe i kwotę' });
    }
    if (from === to) return reply.code(400).send({ error: 'Konta muszą być różne' });
    const accFrom = db.prepare('SELECT * FROM account WHERE id = ?').get(from);
    const accTo = db.prepare('SELECT * FROM account WHERE id = ?').get(to);
    if (!accFrom || !accTo) return reply.code(404).send({ error: 'Konto nie istnieje' });

    const base = (b.note && String(b.note).trim()) || (accTo.type === 'credit' ? 'Spłata karty' : 'Przelew');
    const occurred = b.occurred_at || todayISO();
    const tid = randomUUID();

    const doTransfer = db.transaction(() => {
      db.prepare(
        `INSERT INTO txn (account_id, category_id, type, amount, currency, note, occurred_at, source, transfer_id)
         VALUES (?, NULL, 'transfer_out', ?, 'PLN', ?, ?, 'manual', ?)`
      ).run(from, amount, `${base} → ${accTo.name}`, occurred, tid);
      db.prepare(
        `INSERT INTO txn (account_id, category_id, type, amount, currency, note, occurred_at, source, transfer_id)
         VALUES (?, NULL, 'transfer_in', ?, 'PLN', ?, ?, 'manual', ?)`
      ).run(to, amount, `${base} ← ${accFrom.name}`, occurred, tid);
    });
    doTransfer();
    return reply.code(201).send({ ok: true, transfer_id: tid, amount });
  });

  app.patch('/:id', async (request, reply) => {
    const t = db.prepare('SELECT * FROM txn WHERE id = ?').get(request.params.id);
    if (!t) return reply.code(404).send({ error: 'Transakcja nie istnieje' });
    const b = request.body || {};
    db.prepare(
      `UPDATE txn SET account_id=?, category_id=?, type=?, amount=?, note=?, occurred_at=? WHERE id=?`
    ).run(
      b.account_id != null ? Number(b.account_id) : t.account_id,
      b.category_id !== undefined ? (b.category_id ? Number(b.category_id) : null) : t.category_id,
      b.type === 'income' || b.type === 'expense' ? b.type : t.type,
      b.amount != null ? Math.abs(Number(b.amount)) : t.amount,
      b.note !== undefined ? (b.note ? String(b.note) : null) : t.note,
      b.occurred_at || t.occurred_at,
      t.id
    );
    return db.prepare('SELECT * FROM txn WHERE id = ?').get(t.id);
  });

  app.delete('/:id', async (request, reply) => {
    const t = db.prepare('SELECT * FROM txn WHERE id = ?').get(request.params.id);
    if (!t) return reply.code(404).send({ error: 'Transakcja nie istnieje' });
    if (t.transfer_id) {
      // Przelew: usuń obie nogi naraz.
      db.prepare('DELETE FROM txn WHERE transfer_id = ?').run(t.transfer_id);
    } else {
      db.prepare('DELETE FROM txn WHERE id = ?').run(t.id);
    }
    return { ok: true };
  });
}
