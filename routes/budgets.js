// Limity wydatkow per kategoria. Limity sa CYKLICZNE (miesiac = '*'), czyli obowiazuja
// co miesiac. Postep liczony jest dla wybranego miesiaca (spent vs limit).
import { db } from '../db.js';

const RECUR = '*';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default async function budgetRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async (request) => {
    const month = (request.query && request.query.month) || currentMonth();

    const cats = db
      .prepare("SELECT * FROM category WHERE archived = 0 AND kind = 'expense' ORDER BY sort_order, id")
      .all();
    const limits = new Map(
      db.prepare('SELECT category_id, limit_amount FROM budget WHERE month = ?').all(RECUR)
        .map((r) => [r.category_id, r.limit_amount])
    );
    const spentMap = new Map(
      db.prepare(
        `SELECT category_id, SUM(amount) AS s FROM txn
         WHERE type = 'expense' AND strftime('%Y-%m', occurred_at) = ?
         GROUP BY category_id`
      ).all(month).map((r) => [r.category_id, r.s])
    );

    const items = cats.map((c) => {
      const limit = limits.has(c.id) ? limits.get(c.id) : null;
      const spent = spentMap.get(c.id) || 0;
      return {
        category_id: c.id,
        name: c.name,
        emoji: c.emoji,
        color: c.color,
        limit_amount: limit,
        spent,
        remaining: limit != null ? limit - spent : null,
        pct: limit ? Math.round((spent / limit) * 100) : null,
      };
    });

    const budgeted = items.filter((i) => i.limit_amount != null);
    return {
      month,
      items,
      total_limit: budgeted.reduce((s, i) => s + i.limit_amount, 0),
      total_spent: budgeted.reduce((s, i) => s + i.spent, 0),
      any: budgeted.length > 0,
    };
  });

  // Ustawienie / zmiana / usuniecie limitu dla kategorii (limit_amount<=0 => usun).
  app.put('/', async (request, reply) => {
    const b = request.body || {};
    const catId = Number(b.category_id);
    if (!catId) return reply.code(400).send({ error: 'Brak kategorii' });
    const cat = db.prepare('SELECT * FROM category WHERE id = ?').get(catId);
    if (!cat) return reply.code(404).send({ error: 'Kategoria nie istnieje' });

    const amt = Number(b.limit_amount);
    if (!amt || amt <= 0) {
      db.prepare('DELETE FROM budget WHERE category_id = ? AND month = ?').run(catId, RECUR);
      return { ok: true, category_id: catId, limit_amount: null };
    }
    db.prepare(
      `INSERT INTO budget (category_id, month, limit_amount) VALUES (?, ?, ?)
       ON CONFLICT(category_id, month) DO UPDATE SET limit_amount = excluded.limit_amount`
    ).run(catId, RECUR, amt);
    return { ok: true, category_id: catId, limit_amount: amt };
  });
}
