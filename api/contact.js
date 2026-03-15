/**
 * api/contact.js — Secure Contact Form Handler
 *
 * Provides a backend for general inquiries from the index page.
 * Includes rate limiting, sanitization, and honeypot protection.
 */

import log from './logger.js';
import { writeLog } from './sheets.js';

const MAX_BODY_BYTES = 4 * 1024;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000;
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const key = `contact::${ip}`;
    const entry = rateLimitMap.get(key) || { count: 0, windowStart: now };
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) { entry.count = 0; entry.windowStart = now; }
    entry.count++;
    rateLimitMap.set(key, entry);
    return entry.count > RATE_LIMIT_MAX;
}

function sanitise(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'
    })[c]).trim().slice(0, maxLen);
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();

    // Payload size check
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Payload too large' });

    // Anti-CSRF: Strict Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) return res.status(415).json({ error: 'Must be JSON' });

    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

    const { name, email, phone, message, organization, ...extra } = req.body || {};
    if (Object.keys(extra).length > 0) return res.status(400).json({ error: 'Invalid fields' });

    // Honeypot
    if (organization) {
        log.warn('contact_bot_intercepted', { ip });
        return res.status(200).json({ success: true, bot: true });
    }

    const cleanName = sanitise(name, 100);
    const cleanEmail = sanitise(email, 200);
    const cleanPhone = sanitise(phone, 30);
    const cleanMsg = sanitise(message, 2000);

    if (!cleanName || cleanEmail.length < 5 || !cleanMsg) return res.status(400).json({ error: 'Validation failed' });

    const SERVICE = process.env.EMAILJS_SERVICE_ID;
    const TEMPLATE = process.env.EMAILJS_TEMPLATE_OWNER;
    const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;

    if (!SERVICE || !TEMPLATE || !PUBLIC_KEY) {
        log.error('contact_env_missing');
        return res.status(500).json({ error: 'Service not configured' });
    }

    try {
        const ejsRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: SERVICE, template_id: TEMPLATE, user_id: PUBLIC_KEY,
                template_params: {
                    name: cleanName, email: cleanEmail, phone: cleanPhone,
                    message: cleanMsg, subject: `New Inquiry: ${cleanName}`
                }
            })
        });

        if (!ejsRes.ok) throw new Error(await ejsRes.text());

        await writeLog('INFO', 'contact_inquiry', { name: cleanName, email: cleanEmail });
        return res.status(200).json({ success: true });

    } catch (e) {
        log.error('contact_failed', { error: e.message });
        return res.status(500).json({ error: 'Delivery failed' });
    }
}
