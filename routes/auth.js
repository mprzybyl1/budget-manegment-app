// Logowanie / wylogowanie / kto jestem. Jeden uzytkownik.
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

export default async function authRoutes(app) {
  app.post('/login', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: 'Podaj login i hasło' });
    }
    const user = db.prepare('SELECT * FROM user WHERE username = ?').get(String(username).trim());
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return reply.code(401).send({ error: 'Błędny login lub hasło' });
    }
    const token = app.jwt.sign({ uid: user.id, username: user.username });
    app.setAuthCookie(reply, token, request.body.remember !== false);
    return { ok: true, username: user.username };
  });

  app.post('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: app.auth }, async (request) => {
    return { username: request.user.username };
  });

  // Zmiana hasla (zalogowany).
  app.post('/change-password', { preHandler: app.auth }, async (request, reply) => {
    const { current, next } = request.body || {};
    const user = db.prepare('SELECT * FROM user WHERE id = ?').get(request.user.uid);
    if (!user || !bcrypt.compareSync(String(current || ''), user.password_hash)) {
      return reply.code(401).send({ error: 'Błędne obecne hasło' });
    }
    if (!next || String(next).length < 6) {
      return reply.code(400).send({ error: 'Nowe hasło musi mieć min. 6 znaków' });
    }
    const hash = bcrypt.hashSync(String(next), 10);
    db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(hash, user.id);
    return { ok: true };
  });
}
