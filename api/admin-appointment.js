/**
 * api/admin-appointment.js — Add a manual WhatsApp/Call order directly to Google Sheets
 */
import log from './lib/logger.js';
import { writeOrder } from './lib/sheets.js';
import { createOrderCalendarEvents } from './lib/calendar.js';

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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-key-123';
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await verifyJWT(token, SECRET);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { customerName, customerPhone, requestType, deliveryCost, totals, days } = req.body;
        if (!customerName || !days) return res.status(400).json({ error: 'Missing logic' });

        const items = [];
        for (const [day, portions] of Object.entries(days)) {
            if (portions > 0) {
                items.push({ name: "Manual Entry", quantity: portions, day: day, price: 0 });
            }
        }

        const totalPortions = items.reduce((s, i) => s + i.quantity, 0);
        if (totalPortions > 0) {
            const price = ((totals.subtotal || 0) / totalPortions) || 0;
            items.forEach(i => i.price = price);
        }

        const customer = {
            name: customerName,
            phone: customerPhone || 'Manual',
            email: 'N/A',
            type: requestType || 'pickup',
            address: 'Manual Entry'
        };

        const paymentId = 'WA-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        await writeOrder(customer, items, paymentId, deliveryCost || 0, totals.total || 0, true);
        await createOrderCalendarEvents(customer, items, paymentId, deliveryCost || 0);

        return res.status(200).json({ success: true, paymentId });
    } catch (err) {
        log.error('admin_order_error', { e: err.message });
        return res.status(500).json({ error: 'Failed' });
    }
}
