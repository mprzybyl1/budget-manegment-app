# Budżet — osobisty menedżer budżetu (PWA)

Prosta, mobilna aplikacja do ogarnięcia finansów: konta i karty, wydatki z kategoriami,
listy zakupów z importem paragonu, analityka i limity wydatków. Projektowana **mobile-first**
(PWA — można dodać do ekranu początkowego iPhone'a z Safari).

## Funkcje
- **Konta i karty** — zwykłe, gotówka, oszczędności, karta kredytowa (limit + „dostępne”).
  Salda liczone automatycznie z transakcji.
- **Wydatki i wpływy** — z kategoriami (12 gotowych), szybkie dodawanie.
- **Przelewy między kontami** + **spłata karty** (osobno w raporcie „Operacje wewnętrzne”,
  nie zawyżają wydatków).
- **Listy zakupów** — „Zakończ zakupy → dodaj do budżetu”, hurtowe dodawanie pozycji
  (wklej tekst lub **wgraj PDF paragonu** — serwer wyciąga pozycje).
- **Limity wydatków per kategoria** — paski postępu + baner alertu na Pulpicie przy przekroczeniu.
- **Analityka** — wydatki wg kategorii (donut), trend 6 miesięcy, porównanie miesięcy.
- **Logowanie** (jeden użytkownik) + „Zapamiętaj mnie”. PWA działa offline po pierwszym wczytaniu.

## Stack
- Backend: **Node.js + Fastify + better-sqlite3** (jeden plik SQLite).
- Frontend: czysty **HTML/CSS/JS** (bez kroku build), Chart.js, service worker + manifest (PWA).
- Import PDF: `pdf-parse`. Auth: JWT w cookie httpOnly, hasła bcrypt.

## Uruchomienie
```bash
npm install
cp budzet.env.example budzet.env   # uzupełnij sekrety (JWT_SECRET, COOKIE_SECRET)
node set-password.js <login> <haslo>   # utwórz użytkownika
node server.js                          # domyślnie HOST/PORT z budzet.env
```
Aplikacja słucha pod `http://HOST:PORT` (domyślnie z `budzet.env`). W produkcji chowana
za reverse proxy (HTTPS).

## Struktura
```
server.js            # Fastify: API /api/* + statyczny front
db.js                # schema SQLite + seed kategorii + migracje
routes/              # auth, accounts, categories, transactions, dashboard, analytics, shopping, budgets
set-password.js      # ustawienie / zmiana hasła
gen-icons.js         # generator ikon PWA
public/              # front (index.html, app.js, styles.css, manifest, sw.js, icons/, vendor/)
```

## Bezpieczeństwo
- Baza `*.db` (dane finansowe + hash hasła) i `*.env` (sekrety) są w `.gitignore` — nie trafiają do repo.
