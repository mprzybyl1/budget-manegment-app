// Kategorie wydatkow i przychodow.
import { db } from '../db.js';

export default async function categoryRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async (request) => {
    const { kind } = request.query || {};
    if (kind === 'expense' || kind === 'income') {
      return db
        .prepare('SELECT * FROM category WHERE archived = 0 AND kind = ? ORDER BY sort_order, id')
        .all(kind);
    }
    return db.prepare('SELECT * FROM category WHERE archived = 0 ORDER BY sort_order, id').all();
  });

  app.post('/', async (request, reply) => {
    const b = request.body || {};
    if (!b.name) return reply.code(400).send({ error: 'Podaj nazwę kategorii' });
    const maxOrder =
      db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM category').get().m + 1;
    const info = db
      .prepare(
        'INSERT INTO category (name, emoji, kind, color, sort_order) VALUES (?,?,?,?,?)'
      )
      .run(
        String(b.name).trim(),
        b.emoji || '📦',
        b.kind === 'income' ? 'income' : 'expense',
        b.color || '#6366f1',
        b.sort_order != null ? Number(b.sort_order) : maxOrder
      );
    return reply.code(201).send(db.prepare('SELECT * FROM category WHERE id = ?').get(info.lastInsertRowid));
  });

  app.patch('/:id', async (request, reply) => {
    const cat = db.prepare('SELECT * FROM category WHERE id = ?').get(request.params.id);
    if (!cat) return reply.code(404).send({ error: 'Kategoria nie istnieje' });
    const b = request.body || {};
    db.prepare(
      'UPDATE category SET name=?, emoji=?, kind=?, color=?, sort_order=? WHERE id=?'
    ).run(
      b.name != null ? String(b.name).trim() : cat.name,
      b.emoji || cat.emoji,
      b.kind === 'income' || b.kind === 'expense' ? b.kind : cat.kind,
      b.color || cat.color,
      b.sort_order != null ? Number(b.sort_order) : cat.sort_order,
      cat.id
    );
    return db.prepare('SELECT * FROM category WHERE id = ?').get(cat.id);
  });

  app.delete('/:id', async (request, reply) => {
    const cat = db.prepare('SELECT * FROM category WHERE id = ?').get(request.params.id);
    if (!cat) return reply.code(404).send({ error: 'Kategoria nie istnieje' });
    // Nie kasujemy twardo, zeby nie gubic historii transakcji - archiwizujemy.
    db.prepare('UPDATE category SET archived = 1 WHERE id = ?').run(cat.id);
    return { ok: true };
  });
}
