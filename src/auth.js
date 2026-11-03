const crypto = require('node:crypto');

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken({ userId, dialogId }, secret, lifetimeSeconds = 60 * 60 * 24 * 7) {
  const payload = encode({ userId, dialogId, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds });
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret) {
  try {
    const [payload, signature] = String(token).split('.');
    if (!payload || !signature) return null;
    const expected = sign(payload, secret);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!value.userId || value.exp < Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch { return null; }
}

module.exports = { issueToken, verifyToken };
