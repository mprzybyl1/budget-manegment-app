// Fastify: API pod /api/* + statyczny front (PWA). Auth = JWT w cookie httpOnly.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import './db.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import dashboardRoutes from './routes/dashboard.js';
import analyticsRoutes from './routes/analytics.js';
import shoppingRoutes from './routes/shopping.js';
import budgetRoutes from './routes/budgets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  console.error('Brak JWT_SECRET w środowisku (budzet.env). Przerywam.');
  process.exit(1);
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
  bodyLimit: 15 * 1024 * 1024, // do 15 MB (wgrywany PDF paragonu w base64)
});

await app.register(fastifyCookie);
await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET,
  cookie: { cookieName: 'token', signed: false },
});

// Dekorator: wymaga zalogowania (token z cookie). Zwraca 401 gdy brak/niewazny.
app.decorate('auth', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Wymagane logowanie' });
  }
});

// Ustawienie cookie z tokenem (po loginie).
// remember=true -> ciastko trwałe (rok); false -> ciastko sesyjne (do zamknięcia przeglądarki).
app.decorate('setAuthCookie', (reply, token, remember = true) => {
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: 60 * 60 * 24 * 365 } : {}), // rok
  });
});

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

// Trasy API.
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(accountRoutes, { prefix: '/api/accounts' });
await app.register(categoryRoutes, { prefix: '/api/categories' });
await app.register(transactionRoutes, { prefix: '/api/transactions' });
await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
await app.register(analyticsRoutes, { prefix: '/api/analytics' });
await app.register(shoppingRoutes, { prefix: '/api/shopping-lists' });
await app.register(budgetRoutes, { prefix: '/api/budgets' });

// Statyczny front (SPA: nieznane sciezki spoza /api -> index.html).
await app.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/',
});
app.setNotFoundHandler((request, reply) => {
  if (request.raw.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Nie znaleziono' });
  }
  return reply.sendFile('index.html');
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Budzet słucha na http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
