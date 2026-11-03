const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { SqliteUserStore } = require('./src/store');
const { extractPreferences } = require('./src/agent');
const { generateReply } = require('./src/llm');
const { issueToken, verifyToken } = require('./src/auth');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'laces.sqlite');

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Слишком большой запрос'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function createRequestHandler({ store, authSecret = process.env.AUTH_SECRET || 'local-development-secret-change-me', serveFiles = false }) {

  function currentSession(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return token ? verifyToken(token, authSecret) : null;
  }

  async function requireAuth(req, res) {
    const session = currentSession(req);
    if (!session || !await store.findById(session.userId)) {
      json(res, 401, { error: 'Необходим вход в систему' });
      return null;
    }
    return session;
  }

  function serveStatic(req, res, pathname) {
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(path.resolve(PUBLIC_DIR)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      json(res, 404, { error: 'Не найдено' });
      return;
    }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  }

  return async function requestHandler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (req.method === 'POST' && pathname === '/api/register') {
        const body = await readBody(req);
        const user = await store.create(body.username, body.password, 'client');
        const dialogId = await store.startDialog(user.id);
        const token = issueToken({ userId: user.id, dialogId }, authSecret);
        return json(res, 201, { token, user, dialogId });
      }
      if (req.method === 'POST' && pathname === '/api/login') {
        const body = await readBody(req);
        const user = await store.authenticate(body.username, body.password);
        if (!user) return json(res, 401, { error: 'Неверный логин или пароль' });
        const dialogId = await store.startDialog(user.id);
        const token = issueToken({ userId: user.id, dialogId }, authSecret);
        return json(res, 200, { token, user, dialogId });
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/me') {
        const session = await requireAuth(req, res); if (!session) return;
        return json(res, 200, { user: store.publicUserRow(await store.findById(session.userId)), dialogId: session.dialogId });
      }
      if (req.method === 'PATCH' && pathname === '/api/me/memory') {
        const session = await requireAuth(req, res); if (!session) return;
        const body = await readBody(req);
        return json(res, 200, { user: await store.updateMemory(session.userId, body.memory) });
      }
      if (req.method === 'DELETE' && pathname === '/api/me/memory') {
        const session = await requireAuth(req, res); if (!session) return;
        return json(res, 200, { user: await store.deleteMemory(session.userId, url.searchParams.get('key')) });
      }
      if (req.method === 'GET' && pathname === '/api/dialogs') {
        const session = await requireAuth(req, res); if (!session) return;
        return json(res, 200, { dialogs: await store.listDialogs(session.userId) });
      }
      if (req.method === 'POST' && pathname === '/api/dialogs/new') {
        const session = await requireAuth(req, res); if (!session) return;
        return json(res, 201, { dialogId: await store.startDialog(session.userId) });
      }
      if (req.method === 'POST' && pathname === '/api/chat') {
        const session = await requireAuth(req, res); if (!session) return;
        const body = await readBody(req);
        const text = String(body.message || '').trim();
        if (!text || text.length > 1000) return json(res, 400, { error: 'Сообщение должно содержать от 1 до 1000 символов' });
        const extracted = extractPreferences(text);
        const dialogId = body.dialogId && await store.dialogBelongsTo(body.dialogId, session.userId) ? body.dialogId : session.dialogId;
        if (!dialogId || !await store.dialogBelongsTo(dialogId, session.userId)) return json(res, 400, { error: 'Диалог не найден' });
        const user = await store.updateMemory(session.userId, extracted);
        await store.addMessage(dialogId, 'user', text);
        const history = await store.dialogHistory(dialogId, 20);
        const generated = await generateReply({ text, memory: user.memory, history });
        await store.addMessage(dialogId, 'assistant', generated.text);
        return json(res, 200, { reply: generated.text, source: generated.source, memory: user.memory, dialogId, remembered: Object.keys(extracted).filter((key) => key !== 'lastRequest') });
      }
      if (pathname.startsWith('/api/admin')) {
        const session = await requireAuth(req, res); if (!session) return;
        const actor = await store.findById(session.userId);
        if (actor.role !== 'admin') return json(res, 403, { error: 'Доступ разрешён только администратору' });
        if (req.method === 'GET' && pathname === '/api/admin/users') return json(res, 200, { users: await store.list() });
        const match = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (req.method === 'PATCH' && match) {
          const body = await readBody(req);
          const user = await store.updateMemory(decodeURIComponent(match[1]), body.memory);
          return user ? json(res, 200, { user }) : json(res, 404, { error: 'Пользователь не найден' });
        }
        if (req.method === 'DELETE' && match) {
          const user = await store.deleteMemory(decodeURIComponent(match[1]), url.searchParams.get('key'));
          return user ? json(res, 200, { user }) : json(res, 404, { error: 'Пользователь не найден' });
        }
        return json(res, 404, { error: 'Не найдено' });
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Не найдено' });
      if (serveFiles) return serveStatic(req, res, pathname);
      return json(res, 404, { error: 'Не найдено' });
    } catch (error) {
      const expected = /логин|пароль|пользователь|JSON|запрос/.test(error.message);
      return json(res, expected ? 400 : 500, { error: expected ? error.message : 'Внутренняя ошибка сервера' });
    }
  };
}

function createApp({ databaseFile = DATABASE_FILE, seedDefaults = true, authSecret } = {}) {
  const store = new SqliteUserStore(databaseFile);
  if (seedDefaults) store.seedDefaults();
  const handler = createRequestHandler({ store, authSecret, serveFiles: true });
  const server = http.createServer(handler);
  return { server, store, handler };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '127.0.0.1', () => console.log(`Шальные Шнурки: http://127.0.0.1:${port}`));
}

module.exports = { createApp, createRequestHandler };
