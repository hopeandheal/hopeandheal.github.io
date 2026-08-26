/**
 * api/admin-data.js — Protected Client/Log Retrieval
 *
 * Security: Web Crypto API for zero-dependency JWT verification.
 */

import { readOrders, readLogs } from './_lib/sheets.js';
import log from './_lib/logger.js';

async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [header, payload, sig] = parts;
        const signingInput = `${header}.${payload}`;

        const key = await crypto.subtle.importKey(
            'raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        const valid = await crypto.subtle.verify(
            'HMAC', key, Buffer.from(sig, 'base64url'), Buffer.from(signingInput)
        );
        if (!valid) return null;

        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
        if (decoded.role !== 'admin') return null;

        return decoded;
    } catch { return null; }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-key-123';

    if (!token) return res.status(401).json({ error: 'No token' });

    const decoded = await verifyJWT(token, SECRET);
    if (!decoded) {
        log.warn('admin_unauthorized', { ip: (req.headers['x-forwarded-for'] || '').split(',')[0] });
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const type = req.query.type || 'orders';
    try {
        if (type === 'orders') {
            const orders = await readOrders(100);
            return res.status(200).json({ orders });
        }
        if (type === 'logs') {
            const logs = await readLogs(100);
            return res.status(200).json({ logs });
        }
        return res.status(400).json({ error: 'Invalid type' });
    } catch (e) {
        log.error('admin_data_error', { e: e.message });
        return res.status(500).json({ error: 'Fetch failed' });
    }
}
