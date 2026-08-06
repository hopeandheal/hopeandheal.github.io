/**
 * api/notify.js — Unified Notification Pipeline (Clinic Edition)
 *
 * Handling:
 * 1. Rate limiting
 * 2. Payload validation (clinic/visit specific)
 * 3. Telegram alert to Doctors
 * 4. Admin email (clinic log)
 * 5. Patient receipt email
 * 6. Google Sheets visit log
 * 7. Google Calendar appointment creation
 */

import crypto from 'crypto';
import log from './lib/logger.js';
import { writeOrder, writeLog } from './lib/sheets.js';
import { createOrderCalendarEvents } from './lib/calendar.js';

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
const RATE_LIMIT_MAX = 5;
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
    
    // Server-side total verification (no service fee)
    const subtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
    const dc = typeof deliveryCost === 'number' ? deliveryCost : 0;
    const serverTotal = subtotal + dc;
    
    if (Math.abs(serverTotal - Number(total)) > 0.1) return 'Security alert: Total mismatch';

    return null;
}

function buildDayBreakdown(items) {
    const byDay = {};
    items.forEach(i => {
        const day = i.day || 'Products';
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(`${i.name} x${i.qty || 1}`);
    });

    return Object.entries(byDay)
        .map(([day, lines]) => `📅 ${day.toUpperCase()}\n${lines.map(l => `   • ${l}`).join('\n')}`)
        .join('\n\n');
}

async function sendTelegram(customer, items, paymentId, total) {
    const TG_TOKEN = process.env.TG_BOT_TOKEN;
    const TG_CHAT = process.env.TG_CHAT_ID;
    if (!TG_TOKEN || !TG_CHAT) return;

    const isDelivery = customer.type === 'delivery';
    const cleanPhone = sanitise(customer.phone).replace(/\D/g, '');
    const waPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
    const waText = encodeURIComponent(`Hello ${customer.name.split(' ')[0]}, your Hope & Heal order ${paymentId} is received!`);
    
    const breakdown = buildDayBreakdown(items);

    const msg =
        `🌿 *NEW CLINIC ORDER* 🌿\n\n` +
        `👤 *Patient*: ${sanitise(customer.name)}\n` +
        `📞 *Phone*: ${sanitise(customer.phone)}\n` +
        `💬 [WhatsApp](https://wa.me/${waPhone}?text=${waText})\n` +
        `📍 *Type*: ${sanitise(isDelivery ? 'Home Delivery' : 'Clinic Pickup')}\n` +
        `🏠 *Address*: ${sanitise(isDelivery ? customer.address : 'Rajkot Clinic')}\n` +
        `💳 *Payment*: ${sanitise(customer.paymentMethod || 'online')}\n\n` +
        `📋 *Treatments*:\n${breakdown}\n\n` +
        `💰 *Total*: ₹${Number(total).toFixed(2)}\n` +
        `🆔 *Ref*: \`${sanitise(paymentId)}\``;

    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' })
    });
}

async function sendEmail(templateId, params, label) {
    const SERVICE = process.env.EMAILJS_SERVICE_ID;
    const KEY = process.env.EMAILJS_PUBLIC_KEY;
    const SECRET = process.env.EMAILJS_PRIVATE_KEY;
    if (!SERVICE || !templateId || !KEY) {
        log.error('emailjs_config_missing', { label });
        return;
    }

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            service_id: SERVICE, 
            template_id: templateId, 
            user_id: KEY, 
            accessToken: SECRET,
            template_params: params 
        })
    });
    
    if (!res.ok) {
        const errText = await res.text();
        log.error('emailjs_send_failed', { label, err: errText });
    }
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

    const shortPaymentId = paymentId;
    const adminRefId = `${paymentId} (Razorpay: ${razorpay_payment_id})`;
    log.info('appointment_received', { customer: customer.name, paymentId: adminRefId });

    const breakdown = buildDayBreakdown(items);

    // ── 1. Telegram
    try { await sendTelegram(customer, items, adminRefId, total); } catch (e) { log.error('telegram_failed', { e: e.message }); }

    // ── 2. Sheets
    try { await writeOrder(customer, items, adminRefId, deliveryCost || 0, total); } catch (e) { log.error('sheets_failed', { e: e.message }); }

    // ── 3. Calendar
    try { await createOrderCalendarEvents(customer, items, adminRefId, deliveryCost || 0); } catch (e) { log.error('calendar_failed', { e: e.message }); }

    // ── 4. Emails (Server-Side)
    const ownerTemplate = process.env.EMAILJS_TEMPLATE_OWNER;
    const customerTemplate = process.env.EMAILJS_TEMPLATE_CUSTOMER;

    if (ownerTemplate) {
        try {
            await sendEmail(ownerTemplate, {
                patient_name: sanitise(customer.name),
                patient_phone: sanitise(customer.phone),
                address: sanitise(customer.address || 'Clinic Pickup'),
                order_type: customer.type === 'delivery' ? 'Home Delivery' : 'Clinic Pickup',
                treatments_breakdown: breakdown,
                total: `\u20B9${Number(total).toFixed(2)}`,
                payment_id: adminRefId
            }, 'owner');
        } catch (e) { 
            log.error('email_owner_failed', { e: e.message });
            try { await writeLog('ERROR', 'email_owner_failed', { error: e.message, paymentId: adminRefId }); } catch (swallow) {}
        }
    }

    if (customerTemplate && customer.email) {
        try {
            await sendEmail(customerTemplate, {
                to_name: sanitise(customer.name).split(' ')[0],
                to_email: sanitise(customer.email),
                day_breakdown: breakdown,
                total_amount: `\u20B9${Number(total).toFixed(2)}`,
                ref_id: shortPaymentId
            }, 'customer');
        } catch (e) { 
            log.error('email_customer_failed', { e: e.message });
            try { await writeLog('ERROR', 'email_customer_failed', { error: e.message, paymentId: shortPaymentId }); } catch (swallow) {}
        }
    }

    return res.status(200).json({ success: true, ref: shortPaymentId });
}
