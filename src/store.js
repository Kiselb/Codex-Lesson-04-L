const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_MEMORY, hashPassword, verifyPassword } = require('./user-utils');

class SqliteUserStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
  }

  close() { this.db.close(); }

  memoryFor(userId) {
    const memory = { ...DEFAULT_MEMORY };
    for (const row of this.db.prepare('SELECT fact_key, fact_value FROM user_facts WHERE user_id = ? ORDER BY id').all(userId)) {
      if (row.fact_key in memory) memory[row.fact_key] = row.fact_value;
    }
    return memory;
  }

  publicUserRow(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role, memory: this.memoryFor(row.id), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  findByUsername(username) { return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username)); }
  findById(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id); }

  create(username, password, role = 'client', memory = {}) {
    const clean = String(username).trim();
    if (clean.length < 3 || clean.length > 32) throw new Error('Логин должен содержать от 3 до 32 символов');
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_-]+$/.test(clean)) throw new Error('В логине допустимы буквы, цифры, _ и -');
    if (String(password).length < 6) throw new Error('Пароль должен содержать не менее 6 символов');
    if (!['client', 'admin'].includes(role)) throw new Error('Недопустимая роль');
    if (this.findByUsername(clean)) throw new Error('Такой пользователь уже существует');
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(id, clean, hashPassword(password), role);
    this.updateMemory(id, memory);
    return this.publicUserRow(this.findById(id));
  }

  seedDefaults() {
    if (!this.findByUsername('admin')) this.create('admin', 'admin123', 'admin');
    if (!this.findByUsername('lace_anna')) this.create('lace_anna', 'client123', 'client', { name: 'Анна', budget: '3500 ₽', shoeType: 'кроссовки', style: 'молодёжный', color: 'розовый' });
    if (!this.findByUsername('lace_ivan')) this.create('lace_ivan', 'client123', 'client', { name: 'Иван', budget: '6000 ₽', shoeType: 'ботинки', style: 'спортивный', color: 'чёрный', material: 'кевлар' });
  }

  authenticate(username, password) {
    const row = this.findByUsername(username);
    return row && verifyPassword(password, row.password_hash) ? this.publicUserRow(row) : null;
  }

  list() { return this.db.prepare('SELECT * FROM users ORDER BY created_at, username').all().map((row) => this.publicUserRow(row)); }

  updateMemory(id, patch) {
    if (!this.findById(id)) return null;
    const upsert = this.db.prepare(`INSERT INTO user_facts (user_id, fact_key, fact_value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value, updated_at = CURRENT_TIMESTAMP`);
    this.db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in DEFAULT_MEMORY)) continue;
        const clean = String(value ?? '').slice(0, 240);
        if (clean) upsert.run(id, key, clean);
        else this.db.prepare('DELETE FROM user_facts WHERE user_id = ? AND fact_key = ?').run(id, key);
      }
      this.db.prepare('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.publicUserRow(this.findById(id));
  }

  deleteMemory(id, key = null) {
    if (!this.findById(id)) return null;
    if (key && key in DEFAULT_MEMORY) this.db.prepare('DELETE FROM user_facts WHERE user_id = ? AND fact_key = ?').run(id, key);
    else if (!key) this.db.prepare('DELETE FROM user_facts WHERE user_id = ?').run(id);
    this.db.prepare('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return this.publicUserRow(this.findById(id));
  }

  startDialog(userId) {
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO dialogs (id, user_id) VALUES (?, ?)').run(id, userId);
    return id;
  }

  addMessage(dialogId, role, content) {
    this.db.prepare('INSERT INTO messages (dialog_id, role, content) VALUES (?, ?, ?)').run(dialogId, role, String(content).slice(0, 4000));
    this.db.prepare('UPDATE dialogs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dialogId);
  }

  dialogHistory(dialogId, limit = 20) {
    return this.db.prepare('SELECT role, content AS text, created_at AS createdAt FROM messages WHERE dialog_id = ? ORDER BY id DESC LIMIT ?').all(dialogId, limit).reverse();
  }

  dialogBelongsTo(dialogId, userId) { return Boolean(this.db.prepare('SELECT 1 FROM dialogs WHERE id = ? AND user_id = ?').get(dialogId, userId)); }

  listDialogs(userId) {
    return this.db.prepare(`SELECT d.id, d.created_at AS createdAt, d.updated_at AS updatedAt, COUNT(m.id) AS messageCount
      FROM dialogs d LEFT JOIN messages m ON m.dialog_id = d.id WHERE d.user_id = ? GROUP BY d.id ORDER BY d.updated_at DESC`).all(userId);
  }
}

module.exports = { SqliteUserStore, DEFAULT_MEMORY, hashPassword, verifyPassword };
