const crypto = require('crypto');
const config = require('./config');

const COOKIE_NAME = 'family_tracker_session';
const SESSION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// In-memory session store. Fine for a single-instance, low-traffic personal
// app; the tradeoff is everyone needs to log in again after a server
// restart/redeploy, but never otherwise (no more repeated browser popups).
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

function createSession() {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { expires: Date.now() + SESSION_MS });
  return id;
}

function setSessionCookie(req, res, sessionId) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session || session.expires < Date.now()) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

function requireLogin(req, res, next) {
  if (isAuthenticated(req)) return next();
  // req.path is relative to the mount point (e.g. '/state' inside the '/api'
  // router), so check the full original URL instead.
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  return res.redirect('/login');
}

function checkCredentials(user, pass) {
  return user === config.dashboard.user && pass === config.dashboard.pass;
}

module.exports = {
  requireLogin,
  isAuthenticated,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  checkCredentials,
  parseCookies,
};
