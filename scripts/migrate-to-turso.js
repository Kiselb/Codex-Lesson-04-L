const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { LibsqlUserStore } = require('../src/libsql-store');

const sourceFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'laces.sqlite');

async function batches(client, statements, size = 50) {
  if (!statements.length) return;
  for (let index = 0; index < statements.length; index += size) {
    await client.batch(statements.slice(index, index + size), 'write');
  }
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('Задайте TURSO_DATABASE_URL');
  const local = new DatabaseSync(sourceFile, { readOnly: true });
  const remote = new LibsqlUserStore({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  await remote.init();

  const users = local.prepare('SELECT * FROM users ORDER BY created_at').all();
  const facts = local.prepare('SELECT * FROM user_facts ORDER BY id').all();
  const dialogs = local.prepare('SELECT * FROM dialogs ORDER BY created_at').all();
  const messages = local.prepare('SELECT * FROM messages ORDER BY id').all();

  await batches(remote.client, users.map((row) => ({
    sql: `INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`, args: [row.id, row.username, row.password_hash, row.role, row.created_at, row.updated_at],
  })));
  await batches(remote.client, facts.map((row) => ({
    sql: `INSERT INTO user_facts (id, user_id, fact_key, fact_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value, updated_at = excluded.updated_at`,
    args: [row.id, row.user_id, row.fact_key, row.fact_value, row.created_at, row.updated_at],
  })));
  await batches(remote.client, dialogs.map((row) => ({
    sql: 'INSERT OR IGNORE INTO dialogs (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
    args: [row.id, row.user_id, row.created_at, row.updated_at],
  })));
  await batches(remote.client, messages.map((row) => ({
    sql: 'INSERT OR IGNORE INTO messages (id, dialog_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [row.id, row.dialog_id, row.role, row.content, row.created_at],
  })));

  local.close();
  await remote.close();
  console.log(`Перенос завершён: пользователей ${users.length}, фактов ${facts.length}, диалогов ${dialogs.length}, сообщений ${messages.length}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
