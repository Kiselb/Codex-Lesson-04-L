const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { DEFAULT_MEMORY, hashPassword, verifyPassword } = require('./user-utils');

class LibsqlUserStore {
  constructor({ url, authToken }) {
    if (!url) throw new Error('Не задан URL базы Turso');
    this.client = createClient({ url, authToken });
  }

  async init() {
    await this.client.execute('PRAGMA foreign_keys = ON');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map((item) => item.trim()).filter(Boolean)) {
      await this.client.execute(statement);
    }
  }

  async close() { this.client.close(); }

  async memoryFor(userId) {
    const memory = { ...DEFAULT_MEMORY };
    const result = await this.client.execute({ sql: 'SELECT fact_key, fact_value FROM user_facts WHERE user_id = ? ORDER BY id', args: [userId] });
    for (const row of result.rows) if (row.fact_key in memory) memory[row.fact_key] = row.fact_value;
    return memory;
  }

  async publicUserRow(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role, memory: await this.memoryFor(row.id), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async findByUsername(username) {
    const result = await this.client.execute({ sql: 'SELECT * FROM users WHERE username = ? COLLATE NOCASE', args: [String(username)] });
    return result.rows[0] || null;
  }

  async findById(id) {
    const result = await this.client.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    return result.rows[0] || null;
  }

  async create(username, password, role = 'client', memory = {}) {
    const clean = String(username).trim();
    if (clean.length < 3 || clean.length > 32) throw new Error('Логин должен содержать от 3 до 32 символов');
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_-]+$/.test(clean)) throw new Error('В логине допустимы буквы, цифры, _ и -');
    if (String(password).length < 6) throw new Error('Пароль должен содержать не менее 6 символов');
    if (!['client', 'admin'].includes(role)) throw new Error('Недопустимая роль');
    if (await this.findByUsername(clean)) throw new Error('Такой пользователь уже существует');
    const id = crypto.randomUUID();
    try {
      await this.client.execute({ sql: 'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)', args: [id, clean, hashPassword(password), role] });
    } catch (error) {
      if (/unique/i.test(error.message)) throw new Error('Такой пользователь уже существует');
      throw error;
    }
    await this.updateMemory(id, memory);
    return this.publicUserRow(await this.findById(id));
  }

  async seedAccount(username, password, role, memory = {}) {
    if (!await this.findByUsername(username)) await this.create(username, password, role, memory);
  }

  async seedFromEnvironment() {
    if (process.env.ADMIN_PASSWORD) {
      await this.seedAccount(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD, 'admin');
    }
    if (process.env.SEED_DEMO_USERS === 'true') {
      await this.seedAccount('lace_anna', 'client123', 'client', { name: 'Анна', budget: '3500 ₽', shoeType: 'кроссовки', style: 'молодёжный', color: 'розовый' });
      await this.seedAccount('lace_ivan', 'client123', 'client', { name: 'Иван', budget: '6000 ₽', shoeType: 'ботинки', style: 'спортивный', color: 'чёрный', material: 'кевлар' });
    }
  }

  async authenticate(username, password) {
    const row = await this.findByUsername(username);
    return row && verifyPassword(password, row.password_hash) ? this.publicUserRow(row) : null;
  }

  async list() {
    const result = await this.client.execute('SELECT * FROM users ORDER BY created_at, username');
    return Promise.all(result.rows.map((row) => this.publicUserRow(row)));
  }

  async updateMemory(id, patch) {
    if (!await this.findById(id)) return null;
    const statements = [];
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULT_MEMORY)) continue;
      const clean = String(value ?? '').slice(0, 240);
      statements.push(clean ? {
        sql: `INSERT INTO user_facts (user_id, fact_key, fact_value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value, updated_at = CURRENT_TIMESTAMP`, args: [id, key, clean],
      } : { sql: 'DELETE FROM user_facts WHERE user_id = ? AND fact_key = ?', args: [id, key] });
    }
    statements.push({ sql: 'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [id] });
    await this.client.batch(statements, 'write');
    return this.publicUserRow(await this.findById(id));
  }

  async deleteMemory(id, key = null) {
    if (!await this.findById(id)) return null;
    if (key && key in DEFAULT_MEMORY) await this.client.execute({ sql: 'DELETE FROM user_facts WHERE user_id = ? AND fact_key = ?', args: [id, key] });
    else if (!key) await this.client.execute({ sql: 'DELETE FROM user_facts WHERE user_id = ?', args: [id] });
    await this.client.execute({ sql: 'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [id] });
    return this.publicUserRow(await this.findById(id));
  }

  async startDialog(userId) {
    const id = crypto.randomUUID();
    await this.client.execute({ sql: 'INSERT INTO dialogs (id, user_id) VALUES (?, ?)', args: [id, userId] });
    return id;
  }

  async addMessage(dialogId, role, content) {
    await this.client.batch([
      { sql: 'INSERT INTO messages (dialog_id, role, content) VALUES (?, ?, ?)', args: [dialogId, role, String(content).slice(0, 4000)] },
      { sql: 'UPDATE dialogs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [dialogId] },
    ], 'write');
  }

  async dialogHistory(dialogId, limit = 20) {
    const result = await this.client.execute({ sql: 'SELECT role, content AS text, created_at AS createdAt FROM messages WHERE dialog_id = ? ORDER BY id DESC LIMIT ?', args: [dialogId, limit] });
    return [...result.rows].reverse();
  }

  async dialogBelongsTo(dialogId, userId) {
    const result = await this.client.execute({ sql: 'SELECT 1 AS found FROM dialogs WHERE id = ? AND user_id = ?', args: [dialogId, userId] });
    return result.rows.length > 0;
  }

  async listDialogs(userId) {
    const result = await this.client.execute({
      sql: `SELECT d.id, d.created_at AS createdAt, d.updated_at AS updatedAt, COUNT(m.id) AS messageCount
        FROM dialogs d LEFT JOIN messages m ON m.dialog_id = d.id WHERE d.user_id = ? GROUP BY d.id ORDER BY d.updated_at DESC`, args: [userId],
    });
    return result.rows;
  }
}

module.exports = { LibsqlUserStore };
