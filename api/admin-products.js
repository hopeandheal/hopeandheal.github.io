/**
 * api/admin-products.js — Product Catalog Management
 */

import { readProducts, updateProducts, writeLog } from './lib/sheets.js';
import log from './lib/logger.js';

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
        return decoded.role === 'admin' ? decoded : null;
    } catch { return null; }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-key-123';
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await verifyJWT(token, SECRET);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    try {
        if (req.method === 'GET') {
            const products = await readProducts();
            return res.status(200).json({ products });
        }
        if (req.method === 'POST') {
            const { products } = req.body;
            if (!Array.isArray(products)) return res.status(400).json({ error: 'Invalid payload' });
            await updateProducts(products);
            await writeLog('INFO', 'admin_update_products', { count: products.length });
            return res.status(200).json({ success: true });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        log.error('admin_products_error', { e: err.message });
        return res.status(500).json({ error: 'Backend error' });
    }
}
