// Konta i karty. Saldo liczone w locie: opening_balance + przychody - wydatki.
import { db } from '../db.js';

const TYPES = ['checking', 'cash', 'credit', 'savings'];

// Mapa account_id -> suma (przychody - wydatki).
function deltaByAccount() {
  const rows = db
    .prepare(
      `SELECT account_id,
              COALESCE(SUM(CASE WHEN type IN ('income','transfer_in') THEN amount ELSE -amount END),0) AS delta
       FROM txn GROUP BY account_id`
    )
    .all();
  const map = new Map();
  for (const r of rows) map.set(r.account_id, r.delta);
  return map;
}

export function accountWithBalance(acc, deltaMap) {
  const delta = deltaMap.get(acc.id) || 0;
  const balance = acc.opening_balance + delta;
  const out = { ...acc, balance };
  if (acc.type === 'credit' && acc.credit_limit != null) {
    out.available = acc.credit_limit + balance; // balance zwykle ujemny na karcie
  }
  return out;
}

export default async function accountRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async () => {
    const accs = db
      .prepare('SELECT * FROM account WHERE archived = 0 ORDER BY sort_order, id')
      .all();
    const deltaMap = deltaByAccount();
    return accs.map((a) => accountWithBalance(a, deltaMap));
  });

  app.post('/', async (request, reply) => {
    const b = request.body || {};
    if (!b.name) return reply.code(400).send({ error: 'Podaj nazwę konta' });
    const type = TYPES.includes(b.type) ? b.type : 'checking';
    const info = db
      .prepare(
        `INSERT INTO account (name, type, currency, opening_balance, credit_limit, sort_order)
         VALUES (?,?,?,?,?,?)`
      )
      .run(
        String(b.name).trim(),
        type,
        b.currency || 'PLN',
        Number(b.opening_balance) || 0,
        b.credit_limit != null && b.credit_limit !== '' ? Number(b.credit_limit) : null,
        Number(b.sort_order) || 0
      );
    const acc = db.prepare('SELECT * FROM account WHERE id = ?').get(info.lastInsertRowid);
    return reply.code(201).send(accountWithBalance(acc, deltaByAccount()));
  });

  app.patch('/:id', async (request, reply) => {
    const acc = db.prepare('SELECT * FROM account WHERE id = ?').get(request.params.id);
    if (!acc) return reply.code(404).send({ error: 'Konto nie istnieje' });
    const b = request.body || {};
    db.prepare(
      `UPDATE account SET name=?, type=?, currency=?, opening_balance=?, credit_limit=?, sort_order=?
       WHERE id=?`
    ).run(
      b.name != null ? String(b.name).trim() : acc.name,
      TYPES.includes(b.type) ? b.type : acc.type,
      b.currency || acc.currency,
      b.opening_balance != null ? Number(b.opening_balance) : acc.opening_balance,
      b.credit_limit != null && b.credit_limit !== '' ? Number(b.credit_limit) : acc.credit_limit,
      b.sort_order != null ? Number(b.sort_order) : acc.sort_order,
      acc.id
    );
    const updated = db.prepare('SELECT * FROM account WHERE id = ?').get(acc.id);
    return accountWithBalance(updated, deltaByAccount());
  });

  // Usuniecie konta tylko gdy nie ma transakcji; inaczej archiwizacja.
  app.delete('/:id', async (request, reply) => {
    const acc = db.prepare('SELECT * FROM account WHERE id = ?').get(request.params.id);
    if (!acc) return reply.code(404).send({ error: 'Konto nie istnieje' });
    const n = db.prepare('SELECT COUNT(*) AS n FROM txn WHERE account_id = ?').get(acc.id).n;
    if (n > 0) {
      db.prepare('UPDATE account SET archived = 1 WHERE id = ?').run(acc.id);
      return { ok: true, archived: true };
    }
    db.prepare('DELETE FROM account WHERE id = ?').run(acc.id);
    return { ok: true, archived: false };
  });
}
