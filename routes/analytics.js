// Analityka dla wybranego miesiaca: wg kategorii, dzienny przebieg, porownanie miesiac do miesiaca.
import { db } from '../db.js';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default async function analyticsRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async (request) => {
    const month = (request.query && request.query.month) || currentMonth();
    const prev = prevMonth(month);

    // Wydatki wg kategorii (donut).
    const byCategory = db
      .prepare(
        `SELECT COALESCE(c.id, 0) AS category_id,
                COALESCE(c.name, 'Bez kategorii') AS name,
                COALESCE(c.emoji, '❓') AS emoji,
                COALESCE(c.color, '#94a3b8') AS color,
                SUM(t.amount) AS total
         FROM txn t LEFT JOIN category c ON c.id = t.category_id
         WHERE t.type='expense' AND strftime('%Y-%m', t.occurred_at) = ?
         GROUP BY c.id ORDER BY total DESC`
      )
      .all(month);

    // Dzienny przebieg wydatkow (slupki).
    const byDay = db
      .prepare(
        `SELECT t.occurred_at AS day, SUM(t.amount) AS total
         FROM txn t
         WHERE t.type='expense' AND strftime('%Y-%m', t.occurred_at) = ?
         GROUP BY t.occurred_at ORDER BY t.occurred_at`
      )
      .all(month);

    const sumMonth = (mm) =>
      db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS s FROM txn
           WHERE type='expense' AND strftime('%Y-%m', occurred_at) = ?`
        )
        .get(mm).s;

    const thisMonthTotal = sumMonth(month);
    const prevMonthTotal = sumMonth(prev);

    const incomeTotal = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM txn
         WHERE type='income' AND strftime('%Y-%m', occurred_at) = ?`
      )
      .get(month).s;

    // Ostatnie 6 miesiecy (trend).
    const trend = [];
    let cur = month;
    for (let i = 0; i < 6; i++) {
      trend.unshift({ month: cur, total: sumMonth(cur) });
      cur = prevMonth(cur);
    }

    // Operacje wewnetrzne (przelewy) w miesiacu - kazdy przelew raz, z konta -> na konto.
    const transfers = db
      .prepare(
        `SELECT o.transfer_id, o.amount, o.occurred_at, o.note,
                af.name AS from_name, at.name AS to_name
         FROM txn o
         JOIN txn i ON i.transfer_id = o.transfer_id AND i.type = 'transfer_in'
         LEFT JOIN account af ON af.id = o.account_id
         LEFT JOIN account at ON at.id = i.account_id
         WHERE o.type = 'transfer_out' AND strftime('%Y-%m', o.occurred_at) = ?
         ORDER BY o.occurred_at DESC, o.id DESC`
      )
      .all(month);
    const transfersTotal = transfers.reduce((s, t) => s + t.amount, 0);

    return {
      month,
      this_month_total: thisMonthTotal,
      prev_month_total: prevMonthTotal,
      income_total: incomeTotal,
      by_category: byCategory,
      by_day: byDay,
      trend,
      transfers,
      transfers_total: transfersTotal,
    };
  });
}
