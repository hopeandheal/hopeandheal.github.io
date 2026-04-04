/**
 * api/razorpay-order.js — Create Razorpay order
 * POST { amount, currency, paymentId } → returns { orderId, amount, currency, key }
 */

import log from './logger.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const KEY_ID = process.env.RAZORPAY_KEY_ID;
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

    // ── Verify Payment signature ──────────────────────────────────────────────
    if (req.method === 'GET' && req.query?.verify) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.query;
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSig = crypto.createHmac('sha256', KEY_SECRET).update(body).digest('hex');
        return res.status(200).json({ verified: expectedSig === razorpay_signature });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!KEY_ID || !KEY_SECRET) {
        return res.status(503).json({ error: 'Payment gateway not configured' });
    }

    const { amount, currency = 'INR', paymentId } = req.body || {};

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

        const order = await razorpay.orders.create({
            amount: Math.round(Number(amount) * 100), // paise
            currency,
            receipt: paymentId || `hh_${Date.now()}`,
            notes: { source: 'HopeAndHeal Website' }
        });

        log.info('razorpay_order_created', { orderId: order.id, amount });

        return res.status(200).json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: KEY_ID
        });

    } catch (e) {
        log.error('razorpay_create_failed', { e: e.message });
        return res.status(500).json({ error: 'Could not create payment order' });
    }
}
