/**
 * api/lib/order-fulfillment.js — Unified Order Fulfillment Pipeline
 * 
 * Shared between:
 * 1. api/notify.js (Client-side immediate confirmation)
 * 2. api/razorpay-webhook.js (Server-side guaranteed webhook)
 * 
 * Features:
 * - In-memory and storage-level deduplication (idempotent)
 * - Google Sheets sync
 * - Telegram alert to Clinic Doctors
 * - Patient & Owner Email via EmailJS
 * - Google Calendar appointment sync
 */

import log from './logger.js';
import { writeOrder, writeLog, readOrders } from './sheets.js';
import { createOrderCalendarEvents } from './calendar.js';

// In-memory set of recently processed payment / order IDs (kept during serverless instance warm state)
const processedPayments = new Set();

function sanitise(str, maxLen = 300) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]
    )).trim().slice(0, maxLen);
}

function buildDayBreakdown(items) {
    const byDay = {};
    (items || []).forEach(i => {
        const day = (i.day === 'Product' || !i.day) ? 'Products' : i.day;
        if (!byDay[day]) byDay[day] = [];
        const itemName = (i.name || i.title || i.product || 'Herbal Product').trim();
        const itemQty = i.qty || i.quantity || 1;
        byDay[day].push(`${itemName} x${itemQty}`);
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
        `💳 *Payment*: ${sanitise(customer.paymentMethod || 'Online (UPI/Card)')}\n\n` +
        `📋 *Treatments / Items*:\n${breakdown}\n\n` +
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

/**
 * Fulfills an order with complete deduplication protection.
 */
export async function fulfillOrder({
    customer,
    items,
    paymentId,
    total,
    deliveryCost = 0,
    razorpay_payment_id = '',
    razorpay_order_id = '',
    source = 'client'
}) {
    const rzpId = razorpay_payment_id || '';
    const dedupeKey = `${paymentId || ''}_${rzpId}_${razorpay_order_id || ''}`;

    // Fast-path in-memory deduplication check
    if (dedupeKey && processedPayments.has(dedupeKey)) {
        log.info('order_fulfillment_skipped_memory_duplicate', { dedupeKey, source });
        return { success: true, alreadyProcessed: true };
    }

    // Secondary deduplication check against Google Sheets
    try {
        const existingOrders = await readOrders(30);
        const isDuplicateInSheets = existingOrders.some(o => {
            const id = o.ID || '';
            return (
                (paymentId && id.includes(paymentId)) ||
                (rzpId && id.includes(rzpId)) ||
                (razorpay_order_id && id.includes(razorpay_order_id))
            );
        });

        if (isDuplicateInSheets) {
            log.info('order_fulfillment_skipped_sheets_duplicate', { dedupeKey, source });
            if (dedupeKey) processedPayments.add(dedupeKey);
            return { success: true, alreadyProcessed: true };
        }
    } catch (e) {
        // If checking sheets fails, proceed with fulfillment to avoid dropping orders
        log.warn('sheets_duplicate_check_error', { error: e.message });
    }

    // Mark as processed in memory
    if (dedupeKey) {
        processedPayments.add(dedupeKey);
        // Keep memory bounded
        if (processedPayments.size > 500) {
            const first = processedPayments.values().next().value;
            processedPayments.delete(first);
        }
    }

    const fullPaymentRef = rzpId 
        ? `${paymentId || 'HH-ONLINE'} (Razorpay: ${rzpId})`
        : (paymentId || `HH-${Date.now().toString(36).toUpperCase()}`);

    log.info('fulfilling_order', { 
        customer: customer.name, 
        phone: customer.phone, 
        total, 
        ref: fullPaymentRef,
        source 
    });

    const breakdown = buildDayBreakdown(items);

    // 1. Google Sheets Order Record
    try {
        await writeOrder(customer, items, fullPaymentRef, deliveryCost, total, false);
    } catch (e) {
        log.error('fulfillment_sheets_failed', { error: e.message, ref: fullPaymentRef });
    }

    // 2. Telegram Alert
    try {
        await sendTelegram(customer, items, fullPaymentRef, total);
    } catch (e) {
        log.error('fulfillment_telegram_failed', { error: e.message, ref: fullPaymentRef });
    }

    // 3. Google Calendar
    try {
        await createOrderCalendarEvents(customer, items, fullPaymentRef, deliveryCost);
    } catch (e) {
        log.error('fulfillment_calendar_failed', { error: e.message, ref: fullPaymentRef });
    }

    // 4. Server-side Emails via EmailJS
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
                payment_id: fullPaymentRef
            }, 'owner');
        } catch (e) {
            log.error('fulfillment_email_owner_failed', { error: e.message });
            try { await writeLog('ERROR', 'email_owner_failed', { error: e.message, paymentId: fullPaymentRef }); } catch (_) {}
        }
    }

    if (customerTemplate && customer.email) {
        try {
            await sendEmail(customerTemplate, {
                to_name: sanitise(customer.name).split(' ')[0],
                to_email: sanitise(customer.email),
                day_breakdown: breakdown,
                total_amount: `\u20B9${Number(total).toFixed(2)}`,
                ref_id: paymentId || rzpId
            }, 'customer');
        } catch (e) {
            log.error('fulfillment_email_customer_failed', { error: e.message });
            try { await writeLog('ERROR', 'email_customer_failed', { error: e.message, paymentId: paymentId || rzpId }); } catch (_) {}
        }
    }

    return { success: true, ref: fullPaymentRef };
}
