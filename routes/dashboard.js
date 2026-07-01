// Pulpit: salda kont, suma majatku, wydatki/przychody biezacego miesiaca, ostatnie transakcje.
import { db } from '../db.js';
import { accountWithBalance } from './accounts.js';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export default async function dashboardRoutes(app) {
  app.addHook('preHandler', app.auth);

  app.get('/', async () => {
    const month = currentMonth();

    const accs = db
      .prepare('SELECT * FROM account WHERE archived = 0 ORDER BY sort_order, id')
      .all();
    const deltaRows = db
      .prepare(
        `SELECT account_id,
                COALESCE(SUM(CASE WHEN type IN ('income','transfer_in') THEN amount ELSE -amount END),0) AS delta
         FROM txn GROUP BY account_id`
      )
      .all();
    const deltaMap = new Map(deltaRows.map((r) => [r.account_id, r.delta]));
    const accounts = accs.map((a) => accountWithBalance(a, deltaMap));

    // Suma majatku: konta nie-kredytowe dodatnio, kredytowe to zadluzenie (saldo zwykle ujemne).
    const netWorth = accounts.reduce((s, a) => s + a.balance, 0);

    const m = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS spent,
           COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income
         FROM txn WHERE strftime('%Y-%m', occurred_at) = ?`
      )
      .get(month);

    const recent = db
      .prepare(
        `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
                a.name AS account_name
         FROM txn t
         LEFT JOIN category c ON c.id = t.category_id
         LEFT JOIN account  a ON a.id = t.account_id
         ORDER BY t.occurred_at DESC, t.id DESC LIMIT 8`
      )
      .all();

    return {
      month,
      net_worth: netWorth,
      month_spent: m.spent,
      month_income: m.income,
      accounts,
      recent,
    };
  });
}
