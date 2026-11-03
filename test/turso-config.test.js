const test = require('node:test');
const assert = require('node:assert/strict');
const { tursoConfig } = require('../src/turso-config');

test('используются переменные Turso с префиксом KISELB', () => {
  const config = tursoConfig({
    KISELB_TURSO_DATABASE_URL: 'libsql://kiselb.example',
    KISELB_TURSO_AUTH_TOKEN: 'kiselb-token',
    TURSO_DATABASE_URL: 'libsql://legacy.example',
    TURSO_AUTH_TOKEN: 'legacy-token',
  });
  assert.deepEqual(config, { url: 'libsql://kiselb.example', authToken: 'kiselb-token' });
});

test('старые имена переменных Turso остаются резервными', () => {
  const config = tursoConfig({
    TURSO_DATABASE_URL: 'libsql://legacy.example',
    TURSO_AUTH_TOKEN: 'legacy-token',
  });
  assert.deepEqual(config, { url: 'libsql://legacy.example', authToken: 'legacy-token' });
});
