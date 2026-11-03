const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DISABLE_LLM = 'true';
const { createApp } = require('../server');

async function fixture(databaseFile) {
  const file = databaseFile || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'laces-sql-test-')), 'test.sqlite');
  const app = createApp({ databaseFile: file });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(route, { token, method = 'GET', body } = {}) {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  async function register(username, password = 'secret1') {
    const result = await request('/api/register', { method: 'POST', body: { username, password } });
    assert.equal(result.status, 201); return result.data;
  }
  async function close() {
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
  }
  return { ...app, request, register, databaseFile: file, close };
}

test('1. краткосрочная память и история текущего диалога работают', async (t) => {
  const app = await fixture(); t.after(app.close);
  const { token } = await app.register('dialog_client');
  const first = await app.request('/api/chat', { token, method: 'POST', body: { message: 'Мне нужны кроссовки, бюджет до 4000 рублей' } });
  const second = await app.request('/api/chat', { token, method: 'POST', body: { message: 'А если синие?' } });
  assert.equal(second.status, 200);
  assert.match(second.data.reply, /4000 руб/);
  assert.equal(second.data.dialogId, first.data.dialogId);
  const messages = app.store.db.prepare('SELECT role, content FROM messages WHERE dialog_id = ? ORDER BY id').all(first.data.dialogId);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map((row) => row.role), ['user', 'assistant', 'user', 'assistant']);
});

test('2. долгосрочная память сохраняется между диалогами и перезапуском', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laces-restart-test-'));
  const databaseFile = path.join(dir, 'persistent.sqlite');
  let app = await fixture(databaseFile);
  const first = await app.register('persistent_client');
  await app.request('/api/chat', { token: first.token, method: 'POST', body: { message: 'Меня зовут Борис, люблю киберпанк и красные шнурки' } });
  const newDialog = await app.request('/api/dialogs/new', { token: first.token, method: 'POST' });
  await app.close();

  app = await fixture(databaseFile);
  try {
    const restored = await app.request('/api/me', { token: first.token });
    assert.equal(restored.status, 200, 'подписанный токен должен работать на новом экземпляре сервера');
    const greeting = await app.request('/api/chat', { token: first.token, method: 'POST', body: { message: 'Привет', dialogId: newDialog.data.dialogId } });
    assert.match(greeting.data.reply, /Борис/);
    assert.match(greeting.data.reply, /киберпанк/);
    assert.ok(app.store.db.prepare('SELECT COUNT(*) AS count FROM dialogs WHERE user_id = ?').get(first.user.id).count >= 2);
  } finally { await app.close(); }
});

test('3. прямое изменение факта в SQL-базе влияет на следующий ответ', async (t) => {
  const app = await fixture(); t.after(app.close);
  const client = await app.register('database_client');
  await app.request('/api/chat', { token: client.token, method: 'POST', body: { message: 'Нужны шнурки для ботинок в классическом стиле' } });
  app.store.db.prepare(`INSERT INTO user_facts (user_id, fact_key, fact_value) VALUES (?, 'color', 'золотой')
    ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value`).run(client.user.id);
  const answer = await app.request('/api/chat', { token: client.token, method: 'POST', body: { message: 'Что предложите?' } });
  assert.match(answer.data.reply, /золотой/);
  assert.equal(answer.data.memory.color, 'золотой');
});

test('4. клиент не может прочитать, изменить или удалить чужие данные', async (t) => {
  const app = await fixture(); t.after(app.close);
  const anna = await app.request('/api/login', { method: 'POST', body: { username: 'lace_anna', password: 'client123' } });
  const ivan = app.store.findByUsername('lace_ivan');
  const read = await app.request('/api/admin/users', { token: anna.data.token });
  const change = await app.request(`/api/admin/users/${ivan.id}`, { token: anna.data.token, method: 'PATCH', body: { memory: { color: 'белый' } } });
  const remove = await app.request(`/api/admin/users/${ivan.id}`, { token: anna.data.token, method: 'DELETE' });
  assert.equal(read.status, 403);
  assert.equal(change.status, 403);
  assert.equal(remove.status, 403);
  assert.equal(app.store.memoryFor(ivan.id).color, 'чёрный');
});

test('в базе автоматически созданы два клиента с разными данными', async (t) => {
  const app = await fixture(); t.after(app.close);
  const anna = app.store.findByUsername('lace_anna');
  const ivan = app.store.findByUsername('lace_ivan');
  assert.equal(anna.role, 'client');
  assert.equal(ivan.role, 'client');
  assert.notEqual(app.store.memoryFor(anna.id).color, app.store.memoryFor(ivan.id).color);
});
