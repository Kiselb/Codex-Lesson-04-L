const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
process.env.DISABLE_LLM = 'true';
const { LibsqlUserStore } = require('../src/libsql-store');
const { createRequestHandler } = require('../server');

test('Vercel-адаптер работает с libSQL и stateless-токеном', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'laces-libsql-test-')), 'cloud.sqlite').replace(/\\/g, '/');
  const store = new LibsqlUserStore({ url: `file:${file}` });
  await store.init();
  const handler = createRequestHandler({ store, authSecret: 'test-secret-that-is-long-enough', serveFiles: false });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'vercel_client', password: 'secret1' }) });
    assert.equal(registration.status, 201);
    const account = await registration.json();
    const chat = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` }, body: JSON.stringify({ message: 'Меня зовут Вера, нужны синие шнурки', dialogId: account.dialogId }) });
    assert.equal(chat.status, 200);
    const answer = await chat.json();
    assert.equal(answer.memory.name, 'Вера');
    assert.equal(answer.memory.color, 'синий');
    assert.equal((await store.dialogHistory(account.dialogId)).length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});
