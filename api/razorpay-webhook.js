/**
 * api/razorpay-webhook.js — Guaranteed Server-to-Server Payment Webhook
 * 
 * Automatically captures payments and fulfills orders directly from Razorpay.
 * Guarantees that orders are NEVER lost, even if:
 * - Customer closes the browser immediately after UPI payment
 * - Mobile browser tab gets unloaded in background
 * - Customer loses internet before redirecting
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import log from './_lib/logger.js';
import { fulfillOrder } from './_lib/order-fulfillment.js';

function verifyWebhookSignature(rawBody, signature, secret) {
    if (!signature || !secret) return false;
    try {
        const expected = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
        return false;
    }
}

// Disable default body parser if needed for raw body verification in Node/Vercel
export const config = {
    api: {
        bodyParser: false,
    },
};

async function getRawBody(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let rawBodyBuffer;
    let body;

    try {
        if (req.body) {
            if (Buffer.isBuffer(req.body)) {
                rawBodyBuffer = req.body;
                body = JSON.parse(req.body.toString('utf-8'));
            } else if (typeof req.body === 'object') {
                body = req.body;
                rawBodyBuffer = Buffer.from(JSON.stringify(req.body));
            } else if (typeof req.body === 'string') {
                rawBodyBuffer = Buffer.from(req.body);
                body = JSON.parse(req.body);
            }
        } else if (typeof req[Symbol.asyncIterator] === 'function' && !req.readableEnded) {
            rawBodyBuffer = await getRawBody(req);
            body = JSON.parse(rawBodyBuffer.toString('utf-8'));
        } else {
            body = {};
            rawBodyBuffer = Buffer.from('{}');
        }
    } catch (err) {
        log.error('webhook_body_parse_error', { error: err.message });
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify signature if a dedicated webhook secret is configured
    if (webhookSecret && signature) {
        const isValid = verifyWebhookSignature(rawBodyBuffer, signature, webhookSecret);
        if (!isValid) {
            log.error('webhook_signature_verification_failed', { signature });
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }
    }

    const event = body.event;
    log.info('razorpay_webhook_event_received', { event });

    // Handle payment.captured or order.paid
    if (event === 'payment.captured' || event === 'order.paid') {
        try {
            const paymentEntity = body.payload?.payment?.entity || {};
            const orderEntity = body.payload?.order?.entity || {};

            const paymentId = paymentEntity.id || '';
            const orderId = paymentEntity.order_id || orderEntity.id || '';

            // Double security verification: If no webhook secret was set, verify payment status via Razorpay API
            if (!webhookSecret && paymentId && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
                try {
                    const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
                    const fetchedPayment = await rzp.payments.fetch(paymentId);
                    if (fetchedPayment.status !== 'captured' && fetchedPayment.status !== 'authorized') {
                        log.error('webhook_payment_status_invalid', { paymentId, status: fetchedPayment.status });
                        return res.status(400).json({ error: 'Payment not captured' });
                    }
                } catch (e) {
                    log.warn('webhook_api_verification_error', { error: e.message });
                }
            }
            const totalRupees = paymentEntity.amount ? (paymentEntity.amount / 100) : (orderEntity.amount / 100);

            // Fetch order notes if not already attached to payment
            let notes = { ...(orderEntity.notes || {}), ...(paymentEntity.notes || {}) };

            // If notes are empty and we have Razorpay keys, fetch order from Razorpay API
            const keyId = process.env.RAZORPAY_KEY_ID;
            const keySecret = process.env.RAZORPAY_KEY_SECRET;
            if (Object.keys(notes).length === 0 && orderId && keyId && keySecret) {
                try {
                    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
                    const rzpOrder = await rzp.orders.fetch(orderId);
                    notes = { ...notes, ...(rzpOrder.notes || {}) };
                } catch (e) {
                    log.warn('webhook_order_fetch_notes_failed', { error: e.message });
                }
            }

            // Extract customer info from notes or payment
            const customerName = notes.customer_name || paymentEntity.notes?.customer_name || paymentEntity.email?.split('@')[0] || 'Clinic Patient';
            const customerEmail = notes.customer_email || paymentEntity.email || '';
            const customerPhone = notes.customer_phone || notes.full_phone || paymentEntity.contact || '';
            const customerType = notes.customer_type || (notes.customer_address?.includes('Clinic Pickup') ? 'pickup' : 'delivery');
            const customerAddress = notes.customer_address || (customerType === 'pickup' ? 'Clinic Pickup (Rajkot)' : 'Address on phone/WhatsApp');
            const deliveryCost = Number(notes.delivery_cost || 0);

            // Parse items
            let items = [];
            if (notes.items_json) {
                try {
                    const parsed = JSON.parse(notes.items_json);
                    if (Array.isArray(parsed)) {
                        items = parsed.map(i => ({
                            id: i.id || '',
                            name: (i.name || i.title || i.product || notes.items_summary || 'Herbal Product').trim(),
                            price: Number(i.price || 0),
                            qty: Number(i.qty || i.quantity || 1),
                            day: i.day || 'Products'
                        }));
                    }
                } catch (_) {}
            }
            
            if (!items.length && notes.items_summary) {
                items = [{ name: notes.items_summary, price: totalRupees - deliveryCost, qty: 1, day: 'Products' }];
            }

            if (!items.length) {
                items = [{ name: `Herbal Products Order (${orderId || paymentId})`, price: totalRupees - deliveryCost, qty: 1, day: 'Products' }];
            }

            const customer = {
                name: customerName,
                email: customerEmail,
                phone: customerPhone,
                type: customerType,
                address: customerAddress,
                paymentMethod: paymentEntity.method ? `online (${paymentEntity.method})` : 'online'
            };

            const refId = notes.ref_id || `HH-${Date.now().toString(36).toUpperCase()}`;

            await fulfillOrder({
                customer,
                items,
                paymentId: refId,
                total: totalRupees,
                deliveryCost,
                razorpay_payment_id: paymentId,
                razorpay_order_id: orderId,
                source: 'razorpay_webhook'
            });

            return res.status(200).json({ status: 'ok', processed: true });

        } catch (err) {
            console.error('Webhook processing error:', err);
            log.error('webhook_processing_failed', { error: err.message });
            return res.status(500).json({ error: 'Webhook processing error' });
        }
    }

    // Acknowledge any other events safely
    return res.status(200).json({ status: 'ignored' });
}
