const { createRequestHandler } = require('../server');
const { LibsqlUserStore } = require('../src/libsql-store');

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      if (!process.env.AUTH_SECRET) throw new Error('Не задана переменная AUTH_SECRET');
      const store = new LibsqlUserStore({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
      await store.init();
      await store.seedFromEnvironment();
      return createRequestHandler({ store, authSecret: process.env.AUTH_SECRET, serveFiles: false });
    })();
  }
  return handlerPromise;
}

module.exports = async function vercelHandler(req, res) {
  try {
    const handler = await getHandler();
    return handler(req, res);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Ошибка конфигурации серверной функции' }));
  }
};
