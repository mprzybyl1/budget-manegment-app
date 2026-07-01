// Ustawienie / zmiana hasla uzytkownika (jeden uzytkownik).
// Uzycie:  node set-password.js <login> <haslo>
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error('Uzycie: node set-password.js <login> <haslo>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Haslo musi miec min. 6 znakow.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT * FROM user LIMIT 1').get();

if (existing) {
  db.prepare('UPDATE user SET username = ?, password_hash = ? WHERE id = ?').run(
    username,
    hash,
    existing.id
  );
  console.log(`Zaktualizowano uzytkownika "${username}".`);
} else {
  db.prepare('INSERT INTO user (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Utworzono uzytkownika "${username}".`);
}
