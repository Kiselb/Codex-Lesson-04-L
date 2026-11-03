const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('Vercel-функция загружается без локального node:sqlite', async () => {
  const originalLoad = Module._load;
  Module._load = function guardedLoad(request, parent, isMain) {
    if (request === 'node:sqlite') throw new Error('node:sqlite не должен загружаться в Vercel-функции');
    return originalLoad.call(this, request, parent, isMain);
  };

  let handler;
  try {
    handler = require('../api/[...route].js');
  } finally {
    Module._load = originalLoad;
  }

  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
  await handler({ method: 'GET', url: '/api/health' }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).ok, true);
});
