/**
 * api/notify.js — Unified Notification Pipeline (Clinic Edition)
 *
 * Handling:
 * 1. Rate limiting
 * 2. Payload validation (clinic/visit specific)
 * 3. Razorpay Signature verification
 * 4. Unified order fulfillment (Sheets, Telegram, Emails, Calendar) with deduplication
 */

import crypto from 'crypto';
import log from './lib/logger.js';
import { fulfillOrder } from './lib/order-fulfillment.js';

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const isDev = process.env.NODE_ENV === 'development' || !process.env.VERCEL_ENV;
    if (isDev && signature === 'mock-signature') {
        return true;
    }
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return false;
    const generated = crypto
        .createHmac('sha256', secret)
        .update(orderId + '|' + paymentId)
        .digest('hex');
    return generated === signature;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ITEMS = 30; // Clinic visits/treatments
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000;
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const key = `notify::${ip}`;
    const entry = rateLimitMap.get(key) || { count: 0, windowStart: now };
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) { entry.count = 0; entry.windowStart = now; }
    entry.count++;
    rateLimitMap.set(key, entry);
    return entry.count > RATE_LIMIT_MAX;
}

function sanitise(str, maxLen = 200) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]
    )).trim().slice(0, maxLen);
}

function validatePayload(body) {
    const { 
        customer, 
        items, 
        paymentId, 
        total, 
        deliveryCost, 
        razorpay_order_id, 
        razorpay_payment_id, 
        razorpay_signature, 
        ...extra 
    } = body;
    
    // Anti-Mass-Assignment
    if (Object.keys(extra).length > 0) return `Unknown fields: ${Object.keys(extra).join(', ')}`;

    if (razorpay_order_id && typeof razorpay_order_id !== 'string') return 'Invalid Razorpay Order ID';
    if (razorpay_payment_id && typeof razorpay_payment_id !== 'string') return 'Invalid Razorpay Payment ID';
    if (razorpay_signature && typeof razorpay_signature !== 'string') return 'Invalid Razorpay Signature';

    if (!customer || typeof customer !== 'object') return 'Missing patient data';
    const { name, email, phone, type, address, paymentMethod, ...custExtra } = customer;
    if (Object.keys(custExtra).length > 0) return 'Invalid patient fields';

    if (!name || sanitise(name).length < 2) return 'Invalid name';
    if (!phone || !/^[\d\s+()-]{7,20}$/.test(phone)) return 'Invalid phone';
    if (!['delivery', 'pickup'].includes(type)) return 'Invalid visit type';
    
    if (!Array.isArray(items) || items.length === 0) return 'No treatments selected';
    if (items.length > MAX_ITEMS) return 'Too many items per order';
    
    for (const item of items) {
        if (!item.name || typeof item.name !== 'string') return 'Invalid item name';
        if (typeof item.price !== 'number' || item.price < 0) return 'Invalid price';
        if (!Number.isInteger(item.qty) || item.qty < 1) return 'Invalid quantity';
    }

    if (!paymentId || typeof paymentId !== 'string' || paymentId.length > 100) return 'Invalid session ID';
    
    // Server-side total verification
    const subtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
    const dc = typeof deliveryCost === 'number' ? deliveryCost : 0;
    const serverTotal = subtotal + dc;
    
    if (Math.abs(serverTotal - Number(total)) > 0.1) return 'Security alert: Total mismatch';

    return null;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Payload size check
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Payload too large' });

    // Anti-CSRF: Strict Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) return res.status(415).json({ error: 'Must be JSON' });

    const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();
    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

    const error = validatePayload(req.body);
    if (error) {
        log.warn('submission_validation_failed', { ip, error });
        return res.status(400).json({ error });
    }

    const { 
        customer, 
        items, 
        paymentId, 
        total, 
        deliveryCost,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature 
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        log.warn('submission_rejected_missing_payment', { ip, paymentId });
        return res.status(400).json({ error: 'Missing payment confirmation parameters' });
    }

    const isSignatureValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isSignatureValid) {
        log.error('security_alert_signature_mismatch', { ip, paymentId, razorpay_order_id });
        return res.status(400).json({ error: 'Security Alert: Invalid payment signature' });
    }

    try {
        const result = await fulfillOrder({
            customer,
            items,
            paymentId,
            total,
            deliveryCost: deliveryCost || 0,
            razorpay_payment_id,
            razorpay_order_id,
            source: 'client_notify'
        });

        return res.status(200).json({ success: true, ref: paymentId });
    } catch (err) {
        log.error('notify_fulfillment_error', { error: err.message });
        return res.status(500).json({ error: 'Internal order processing error' });
    }
}
