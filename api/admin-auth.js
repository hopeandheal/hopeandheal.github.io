/**
 * api/admin-auth.js — Issues a short-lived JWT to authenticate the admin dashboard.
 * 
 * Security:
 *  - Password compared in constant-time (prevents timing attacks)
 *  - Web Crypto API for zero-dependency JWT signing
 *  - IP locked after 3 consecutive failed attempts
 */

import log from './lib/logger.js';

// ─── IP Lockout ───────────────────────────────────────────────────────────────
const failMap = new Map();
const MAX_ATTEMPTS = 5; // Increased to be more forgiving
const LOCKOUT_MS = 15 * 60 * 1000; // 15 mins
const WINDOW_MS = 15 * 60 * 1000; // reset count after 15 min inactivity

function checkAndRecord(ip, resultType) {
    const now = Date.now();
    const key = `admin::${ip}`;
    const entry = failMap.get(key) || { count: 0, lockedUntil: 0, lastFail: 0 };

    // Check only mode (returned at start of handler)
    if (resultType === 'check') {
        return { locked: entry.lockedUntil > now, remaining: entry.lockedUntil - now };
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { locked: true, remaining: entry.lockedUntil - now };
    }

    if (resultType === 'success') {
        failMap.delete(key);
        return { locked: false };
    }

    // resultType === 'failure'
    if (now - entry.lastFail > WINDOW_MS) entry.count = 0;
    entry.count++;
    entry.lastFail = now;

    if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOCKOUT_MS;
        log.warn('admin_ip_locked', { ip, lockedUntil: new Date(entry.lockedUntil).toISOString() });
    }
    failMap.set(key, entry);
    return { locked: entry.lockedUntil > now, remaining: entry.lockedUntil - now };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
}

async function createJWT(payload, secret) {
    const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({ ...payload, iat: Math.floor(Date.now() / 1000) });
    const signingInput = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
        'raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, Buffer.from(signingInput));
    return `${signingInput}.${Buffer.from(sig).toString('base64url')}`;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();

    // Anti-CSRF: Strict Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
        return res.status(415).json({ error: 'Must be JSON' });
    }

    const pre = checkAndRecord(ip, 'check');
    if (pre.locked) {
        const mins = Math.ceil(pre.remaining / 60000);
        return res.status(429).json({ error: `Too many attempts. Locked for ${mins} mins.` });
    }

    const { password } = req.body || {};
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.ADMIN_PWD || 'dev-admin';
    const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-key-123';

    const correct = safeCompare(String(password || ''), ADMIN_PASS);

    if (!correct) {
        checkAndRecord(ip, 'failure');
        const entry = failMap.get(`admin::${ip}`);
        const left = Math.max(0, MAX_ATTEMPTS - (entry?.count || 0));
        log.warn('admin_auth_failed', { ip, left });
        return res.status(401).json({ error: `Invalid credentials. ${left} attempts remaining.` });
    }

    checkAndRecord(ip, 'success');
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 3600);
    const token = await createJWT({ role: 'admin', exp: expiresAt }, JWT_SECRET);

    log.info('admin_auth_success', { ip });
    return res.status(200).json({ token, expiresAt });
}
