const { createRequestHandler } = require('../server');
const { LibsqlUserStore } = require('../src/libsql-store');
const { tursoConfig } = require('../src/turso-config');

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      if (!process.env.AUTH_SECRET) throw new Error('Не задана переменная AUTH_SECRET');
      const store = new LibsqlUserStore(tursoConfig());
      await store.init();
      await store.seedFromEnvironment();
      return createRequestHandler({ store, authSecret: process.env.AUTH_SECRET, serveFiles: false });
    })();
  }
  return handlerPromise;
}

module.exports = async function vercelHandler(req, res) {
  try {
    if (req.method === 'GET' && new URL(req.url, 'https://vercel.local').pathname === '/api/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: true, runtime: process.version }));
    }
    const handler = await getHandler();
    return handler(req, res);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Ошибка конфигурации серверной функции' }));
  }
};
