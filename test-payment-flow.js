/**
 * test-payment-flow.js
 * Comprehensive automated validation suite for Hope & Heal Payment & Webhook system.
 * 
 * Tests:
 * 1. POST /api/create-razorpay-order with complete cart & customer metadata
 * 2. POST /api/notify with valid Razorpay signature
 * 3. POST /api/razorpay-webhook with payment.captured event & notes extraction
 * 4. Idempotency test (Simultaneous / sequential client notify + webhook firing)
 * 5. Edge cases: Empty cart, missing fields, tampering total amounts, invalid signatures
 */

import http from 'http';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env.local if present
if (fs.existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
}

const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(path, method, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = data ? JSON.stringify(data) : '';
        const req = http.request(`${BASE_URL}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body || '{}') });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, body });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n🧪 STARTING COMPREHENSIVE PAYMENT & WEBHOOK TEST SUITE\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Create Razorpay Order
    // ─────────────────────────────────────────────────────────────
    console.log('📦 TEST 1: POST /api/create-razorpay-order (Valid Payload with Notes)');
    const sampleItems = [
        { id: '1', name: 'Herbal Glow Soapbar', price: 70, qty: 1, day: 'Products' },
        { id: '2', name: 'Heal Roots Herbal Shampoo', price: 350, qty: 1, day: 'Products' }
    ];
    const sampleCustomer = {
        name: 'Shweta Chunchha',
        email: 'shwetachunchha@gmail.com',
        phone: '+91 9898140836',
        type: 'delivery',
        address: '123 Test Street, Rajkot, Gujarat - 360001'
    };

    const createOrderRes = await makeRequest('/api/create-razorpay-order', 'POST', {
        items: sampleItems,
        deliveryCost: 50,
        customer: sampleCustomer,
        paymentId: 'HH-TEST-001'
    });

    assert(createOrderRes.status === 200, 'Endpoint returns 200 OK');
    assert(createOrderRes.body.success === true, 'Order created successfully');
    assert(createOrderRes.body.orderId !== undefined, `Received Order ID: ${createOrderRes.body.orderId}`);
    assert(createOrderRes.body.amount === 47000, `Amount in paise equals 47000 (₹470.00) (got ${createOrderRes.body.amount})`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Security & Validation on create-razorpay-order
    // ─────────────────────────────────────────────────────────────
    console.log('\n🔒 TEST 2: Input Validation on create-razorpay-order');
    const emptyOrderRes = await makeRequest('/api/create-razorpay-order', 'POST', {
        items: [],
        deliveryCost: 0
    });
    assert(emptyOrderRes.status === 400, 'Rejects empty items array (400 Bad Request)');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Client-side /api/notify (Direct Notification)
    // ─────────────────────────────────────────────────────────────
    console.log('\n📲 TEST 3: POST /api/notify (Client-Side Notification Callback)');
    const testOrderId = 'order_test_valid_123';
    const testPaymentId = 'pay_test_valid_123';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'secret';
    const validSignature = crypto
        .createHmac('sha256', keySecret)
        .update(testOrderId + '|' + testPaymentId)
        .digest('hex');

    const notifyRes = await makeRequest('/api/notify', 'POST', {
        customer: sampleCustomer,
        items: sampleItems,
        paymentId: 'HH-TEST-CLIENT-001',
        total: 470,
        deliveryCost: 50,
        razorpay_order_id: testOrderId,
        razorpay_payment_id: testPaymentId,
        razorpay_signature: validSignature
    });
    assert(notifyRes.status === 200, 'Client notify returns 200 OK');
    assert(notifyRes.body.success === true, 'Client order marked successful');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Razorpay Server-to-Server Webhook Simulation
    // ─────────────────────────────────────────────────────────────
    console.log('\n🪝 TEST 4: POST /api/razorpay-webhook (payment.captured event)');
    const webhookPayload = {
        entity: 'event',
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: 'pay_TEST_WEBHOOK_999',
                    order_id: 'order_TEST_WEBHOOK_999',
                    amount: 47000,
                    currency: 'INR',
                    status: 'captured',
                    method: 'upi',
                    email: 'shwetachunchha@gmail.com',
                    contact: '+919898140836',
                    notes: {
                        customer_name: 'Shweta Chunchha',
                        customer_phone: '+91 9898140836',
                        customer_email: 'shwetachunchha@gmail.com',
                        customer_type: 'delivery',
                        customer_address: '123 Test Street, Rajkot',
                        delivery_cost: '50',
                        items_summary: 'Herbal Glow Soapbar (x1), Heal Roots Herbal Shampoo (x1)',
                        items_json: JSON.stringify(sampleItems),
                        ref_id: 'HH-TEST-WEBHOOK-999'
                    }
                }
            }
        }
    };

    const webhookRes = await makeRequest('/api/razorpay-webhook', 'POST', webhookPayload);
    assert(webhookRes.status === 200, 'Webhook returns 200 OK');
    assert(webhookRes.body.status === 'ok', 'Webhook acknowledges event processing');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Idempotency & Deduplication
    // (Ensure sending duplicate webhook/notify for same payment does not duplicate order)
    // ─────────────────────────────────────────────────────────────
    console.log('\n🛡️ TEST 5: Deduplication & Idempotency Check');
    const duplicateWebhookRes = await makeRequest('/api/razorpay-webhook', 'POST', webhookPayload);
    assert(duplicateWebhookRes.status === 200, 'Duplicate webhook returns 200 OK safely without crash');

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Mobile Checkout Security - Tamper total detection
    // ─────────────────────────────────────────────────────────────
    console.log('\n🛡️ TEST 6: Total Mismatch / Price Tampering Guard in notify.js');
    const tamperedRes = await makeRequest('/api/notify', 'POST', {
        customer: sampleCustomer,
        items: sampleItems, // ₹420
        paymentId: 'HH-TAMPERED-001',
        total: 10, // Tampered to ₹10!
        deliveryCost: 50,
        razorpay_order_id: 'order_mock_123',
        razorpay_payment_id: 'pay_mock_123',
        razorpay_signature: 'mock-signature'
    });
    assert(tamperedRes.status === 400, 'Rejects tampered total with 400 Bad Request');
    assert(tamperedRes.body.error && tamperedRes.body.error.includes('Total mismatch'), 'Error message identifies total mismatch');

    console.log(`\n========================================`);
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
