// Listy zakupow + pozycje. "Zakoncz zakupy" -> jeden wydatek = suma cen pozycji.
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { db } from '../db.js';

function listSummary(list) {
  const items = db
    .prepare('SELECT * FROM shopping_item WHERE list_id = ? ORDER BY sort_order, id')
    .all(list.id);
  const total = items.reduce(
    (s, it) => s + (it.price != null ? it.price * it.qty : 0),
    0
  );
  return { ...list, items, total };
}

export default async function shoppingRoutes(app) {
  app.addHook('preHandler', app.auth);

  // Wyciaga tekst z wgranego PDF (np. e-paragon z apki Biedronki). Front sam parsuje pozycje.
  app.post('/parse-pdf', async (request, reply) => {
    const b = request.body || {};
    if (!b.data) return reply.code(400).send({ error: 'Brak pliku' });
    let buf;
    try {
      buf = Buffer.from(String(b.data).replace(/^data:[^;]*;base64,/, ''), 'base64');
    } catch {
      return reply.code(400).send({ error: 'Nieprawidłowy plik' });
    }
    if (!buf.length || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      return reply.code(400).send({ error: 'To nie jest plik PDF' });
    }
    try {
      const data = await pdf(buf);
      const text = (data.text || '').trim();
      if (!text) return reply.code(422).send({ error: 'PDF nie zawiera tekstu (może to skan/obraz).' });
      return { text };
    } catch {
      return reply.code(422).send({ error: 'Nie udało się odczytać PDF' });
    }
  });

  // Lista wszystkich list (z pozycjami).
  app.get('/', async (request) => {
    const { status } = request.query || {};
    const where = status === 'open' || status === 'done' ? 'WHERE status = ?' : '';
    const lists = db
      .prepare(`SELECT * FROM shopping_list ${where} ORDER BY created_at DESC, id DESC`)
      .all(...(where ? [status] : []));
    return lists.map(listSummary);
  });

  app.get('/:id', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    return listSummary(list);
  });

  app.post('/', async (request, reply) => {
    const b = request.body || {};
    const info = db
      .prepare('INSERT INTO shopping_list (name, account_id, category_id) VALUES (?,?,?)')
      .run(
        (b.name && String(b.name).trim()) || 'Zakupy',
        b.account_id ? Number(b.account_id) : null,
        b.category_id ? Number(b.category_id) : null
      );
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(info.lastInsertRowid);
    return reply.code(201).send(listSummary(list));
  });

  app.patch('/:id', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    const b = request.body || {};
    db.prepare(
      'UPDATE shopping_list SET name=?, account_id=?, category_id=? WHERE id=?'
    ).run(
      b.name != null ? String(b.name).trim() : list.name,
      b.account_id !== undefined ? (b.account_id ? Number(b.account_id) : null) : list.account_id,
      b.category_id !== undefined ? (b.category_id ? Number(b.category_id) : null) : list.category_id,
      list.id
    );
    return listSummary(db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(list.id));
  });

  app.delete('/:id', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    db.prepare('DELETE FROM shopping_list WHERE id = ?').run(list.id);
    return { ok: true };
  });

  // --- Pozycje ---
  app.post('/:id/items', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    const b = request.body || {};
    if (!b.name) return reply.code(400).send({ error: 'Podaj nazwę pozycji' });
    const maxOrder =
      db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM shopping_item WHERE list_id = ?').get(
        list.id
      ).m + 1;
    const info = db
      .prepare(
        'INSERT INTO shopping_item (list_id, name, qty, price, sort_order) VALUES (?,?,?,?,?)'
      )
      .run(
        list.id,
        String(b.name).trim(),
        Number(b.qty) || 1,
        b.price != null && b.price !== '' ? Number(b.price) : null,
        maxOrder
      );
    return reply.code(201).send(db.prepare('SELECT * FROM shopping_item WHERE id = ?').get(info.lastInsertRowid));
  });

  // Hurtowe dodanie wielu pozycji (np. z wklejonego/wgranego paragonu). Dodaje na koniec listy.
  app.post('/:id/items/bulk', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    const items = Array.isArray(request.body && request.body.items) ? request.body.items : [];
    const clean = items
      .map((it) => ({
        name: it && it.name ? String(it.name).trim() : '',
        qty: Number(it && it.qty) > 0 ? Number(it.qty) : 1,
        price: it && it.price != null && it.price !== '' ? Number(it.price) : null,
      }))
      .filter((it) => it.name);
    if (!clean.length) return reply.code(400).send({ error: 'Brak pozycji do dodania' });

    let order = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM shopping_item WHERE list_id = ?').get(list.id).m;
    const ins = db.prepare('INSERT INTO shopping_item (list_id, name, qty, price, sort_order) VALUES (?,?,?,?,?)');
    const addAll = db.transaction(() => {
      for (const it of clean) ins.run(list.id, it.name, it.qty, Number.isFinite(it.price) ? it.price : null, ++order);
    });
    addAll();
    return reply.code(201).send({ ok: true, added: clean.length, list: listSummary(list) });
  });

  app.patch('/:id/items/:itemId', async (request, reply) => {
    const it = db
      .prepare('SELECT * FROM shopping_item WHERE id = ? AND list_id = ?')
      .get(request.params.itemId, request.params.id);
    if (!it) return reply.code(404).send({ error: 'Pozycja nie istnieje' });
    const b = request.body || {};
    db.prepare(
      'UPDATE shopping_item SET name=?, qty=?, price=?, checked=? WHERE id=?'
    ).run(
      b.name != null ? String(b.name).trim() : it.name,
      b.qty != null ? Number(b.qty) : it.qty,
      b.price !== undefined ? (b.price != null && b.price !== '' ? Number(b.price) : null) : it.price,
      b.checked != null ? (b.checked ? 1 : 0) : it.checked,
      it.id
    );
    return db.prepare('SELECT * FROM shopping_item WHERE id = ?').get(it.id);
  });

  app.delete('/:id/items/:itemId', async (request, reply) => {
    const it = db
      .prepare('SELECT * FROM shopping_item WHERE id = ? AND list_id = ?')
      .get(request.params.itemId, request.params.id);
    if (!it) return reply.code(404).send({ error: 'Pozycja nie istnieje' });
    db.prepare('DELETE FROM shopping_item WHERE id = ?').run(it.id);
    return { ok: true };
  });

  // Zakonczenie zakupow -> jeden wydatek = suma cen pozycji (lub przekazana kwota).
  app.post('/:id/finish', async (request, reply) => {
    const list = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(request.params.id);
    if (!list) return reply.code(404).send({ error: 'Lista nie istnieje' });
    if (list.status === 'done') {
      return reply.code(400).send({ error: 'Lista jest już zakończona' });
    }
    const b = request.body || {};
    const accountId = b.account_id ? Number(b.account_id) : list.account_id;
    if (!accountId) return reply.code(400).send({ error: 'Wybierz konto do obciążenia' });
    const categoryId = b.category_id ? Number(b.category_id) : list.category_id;

    const items = db
      .prepare('SELECT * FROM shopping_item WHERE list_id = ? ORDER BY sort_order, id')
      .all(list.id);
    const computed = items.reduce((s, it) => s + (it.price != null ? it.price * it.qty : 0), 0);
    const amount =
      b.amount != null && b.amount !== '' ? Math.abs(Number(b.amount)) : computed;
    if (!amount) {
      return reply.code(400).send({ error: 'Brak kwoty — uzupełnij ceny pozycji lub podaj sumę' });
    }

    const noteItems = items
      .map((it) => `${it.name}${it.price != null ? ` (${(it.price * it.qty).toFixed(2)})` : ''}`)
      .join(', ');
    const occurred = b.occurred_at || new Date().toISOString().slice(0, 10);

    const finish = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO txn (account_id, category_id, type, amount, currency, note, occurred_at, source)
           VALUES (?,?,?,?,?,?,?, 'shopping')`
        )
        .run(
          accountId,
          categoryId,
          'expense',
          amount,
          'PLN',
          `Zakupy: ${list.name}${noteItems ? ` — ${noteItems}` : ''}`,
          occurred
        );
      db.prepare(
        "UPDATE shopping_list SET status='done', finished_at=datetime('now'), account_id=?, category_id=? WHERE id=?"
      ).run(accountId, categoryId, list.id);
      return info.lastInsertRowid;
    });
    const txnId = finish();

    return {
      ok: true,
      amount,
      transaction: db.prepare('SELECT * FROM txn WHERE id = ?').get(txnId),
    };
  });
}
