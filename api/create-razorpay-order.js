import Razorpay from 'razorpay';
import log from './lib/logger.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { items, deliveryCost, customer, paymentId } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }

        // Calculate total in Rupees
        const subtotal = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty || 1)), 0);
        const dc = Number(deliveryCost) || 0;
        const totalAmount = subtotal + dc;

        if (totalAmount <= 0) {
            return res.status(400).json({ error: 'Invalid order amount' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            log.error('razorpay_keys_missing', {});
            return res.status(500).json({ error: 'Payment gateway configuration error' });
        }

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });

        // Razorpay expects amount in paise (1 INR = 100 paise)
        const amountInPaise = Math.round(totalAmount * 100);

        // Prepare notes so Razorpay itself persists order metadata
        const notes = {};
        if (customer) {
            if (customer.name) notes.customer_name = String(customer.name).slice(0, 100);
            if (customer.phone) notes.customer_phone = String(customer.phone).slice(0, 50);
            if (customer.email) notes.customer_email = String(customer.email).slice(0, 100);
            if (customer.type) notes.customer_type = String(customer.type).slice(0, 30);
            if (customer.address) notes.customer_address = String(customer.address).slice(0, 250);
        }
        if (paymentId) notes.ref_id = String(paymentId).slice(0, 50);
        notes.delivery_cost = String(dc);
        
        // Compact item summary and JSON
        const itemsSummary = items.map(i => `${i.name || 'Item'} (x${i.qty || 1})`).join(', ').slice(0, 250);
        notes.items_summary = itemsSummary;
        try {
            notes.items_json = JSON.stringify(items.map(i => ({
                id: i.id,
                name: i.name,
                price: Number(i.price),
                qty: Number(i.qty || 1),
                day: i.day || 'Products'
            }))).slice(0, 500);
        } catch (_) {}

        const options = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: `rcpt_${Date.now().toString(36).toUpperCase()}`,
            payment_capture: 1, // Auto capture payment
            notes: notes
        };

        const order = await razorpay.orders.create(options);
        
        return res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            keyId: keyId
        });

    } catch (error) {
        console.error('Razorpay Error Details:', error);
        log.error('razorpay_order_creation_failed', { error: error });
        const errMsg = error?.error?.description || error.message || 'Failed to create payment gateway order';
        return res.status(500).json({ error: errMsg });
    }
}
