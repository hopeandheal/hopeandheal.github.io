/**
 * api/dev-server.js — Local Mock Server (Clinic Edition)
 *
 * Simulates all Vercel serverless functions for local testing.
 * Loads .env.local for credentials.
 */

import http from 'http';
import fs from 'fs';
import pathMod from 'path';
import { fileURLToPath } from 'url';
import { writeOrder, writeLog, readOrders, readLogs, readProducts, updateProducts } from './api/lib/sheets.js';
import { createOrderCalendarEvents } from './api/lib/calendar.js';

const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
const envPath = pathMod.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv');
    dotenv.config({ path: envPath });
    console.log('✅ Loaded .env.local via dotenv');
}

const PORT = 3002;
const HAS_GOOGLE = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID);
const HAS_CAL = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID);

const localOrders = [];
const localLogs = [];

const MOCK_HANDLERS = {
    '/api/notify': async (body, _q, method) => {
        if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
        console.log('\n🏥 [DEV] /api/notify called');
        
        const newOrder = {
            'Timestamp': new Date().toISOString(),
            'ID': body.paymentId || 'MOCK_' + Date.now(),
            'Name': body.customer?.name || 'Unknown',
            'Phone': body.customer?.phone || '',
            'Email': body.customer?.email || '',
            'Type': body.customer?.type === 'delivery' ? 'Home Visit' : 'Clinic',
            'Address': body.customer?.address || (body.customer?.type === 'pickup' ? 'Rajkot Clinic' : ''),
            'Total': (body.total || 0).toFixed(2),
            ...Object.fromEntries((body.items || []).map(i => [i.day || 'Products', i.name + ' (x' + (i.qty || 1) + ')']))
        };

        localOrders.unshift(newOrder);
        localLogs.unshift({ 'Timestamp': new Date().toISOString(), 'Level': 'INFO', 'Event': 'order_received', 'Details': `Customer: ${body.customer?.name}` });

        // Real Telegram notification
        const TG_TOKEN = process.env.TG_BOT_TOKEN;
        const TG_CHAT = process.env.TG_CHAT_ID;
        if (TG_TOKEN && TG_CHAT) {
            try {
                const customer = body.customer || {};
                const items = body.items || [];
                const cleanPhone = (customer.phone || '').replace(/\D/g, '');
                const waPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
                const waText = encodeURIComponent(`Hello ${(customer.name || '').split(' ')[0]}, your Hope & Heal order ${body.paymentId} is received!`);
                const breakdown = items.map(i => `• ${i.name} x${i.qty || 1}`).join('\n');
                const msg = `🌿 *NEW ORDER (DEV TEST)* 🌿\n\n` +
                    `👤 *Patient*: ${customer.name || 'Unknown'}\n` +
                    `📞 *Phone*: ${customer.phone || '—'}\n` +
                    `💬 [WhatsApp](https://wa.me/${waPhone}?text=${waText})\n` +
                    `📍 *Type*: ${customer.type === 'delivery' ? 'Home Delivery' : 'Clinic Pickup'}\n` +
                    `🏠 *Address*: ${customer.address || 'Clinic Pickup'}\n` +
                    `💳 *Payment*: ${customer.paymentMethod || 'online'}\n\n` +
                    `📋 *Items*:\n${breakdown}\n\n` +
                    `💰 *Total*: ₹${Number(body.total || 0).toFixed(2)}\n` +
                    `🆔 *Ref*: \`${body.paymentId}\``;
                await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' })
                });
                console.log('   ✅ Telegram notification sent');
            } catch (e) { console.error('   ❌ Telegram error:', e.message); }
        } else {
            console.log('   ⚠️  No Telegram credentials, skipping notification');
        }

        // Real Email via EmailJS
        const SERVICE = process.env.EMAILJS_SERVICE_ID;
        const KEY = process.env.EMAILJS_PUBLIC_KEY;
        const SECRET = process.env.EMAILJS_PRIVATE_KEY;
        const ownerTemplate = process.env.EMAILJS_TEMPLATE_OWNER;
        const customerTemplate = process.env.EMAILJS_TEMPLATE_CUSTOMER;
        if (SERVICE && KEY && ownerTemplate) {
            try {
                const customer = body.customer || {};
                const items = body.items || [];
                const breakdown = items.map(i => `• ${i.name} x${i.qty || 1}`).join('\n');
                await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: SERVICE,
                        template_id: ownerTemplate,
                        user_id: KEY,
                        accessToken: SECRET,
                        template_params: {
                            patient_name: customer.name || 'Customer',
                            patient_phone: customer.phone || '—',
                            address: customer.address || 'Clinic Pickup',
                            order_type: customer.type === 'delivery' ? 'Home Delivery' : 'Clinic Pickup',
                            treatments_breakdown: breakdown,
                            total: `₹${Number(body.total || 0).toFixed(2)}`,
                            payment_id: body.paymentId
                        }
                    })
                });
                console.log('   ✅ Owner email sent');
            } catch (e) { console.error('   ❌ Email error:', e.message); }
        }
        if (SERVICE && KEY && customerTemplate && body.customer?.email) {
            try {
                const customer = body.customer || {};
                const items = body.items || [];
                const breakdown = items.map(i => `• ${i.name} x${i.qty || 1}`).join('\n');
                await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: SERVICE,
                        template_id: customerTemplate,
                        user_id: KEY,
                        accessToken: SECRET,
                        template_params: {
                            to_name: (customer.name || 'Customer').split(' ')[0],
                            to_email: customer.email,
                            day_breakdown: breakdown,
                            total_amount: `₹${Number(body.total || 0).toFixed(2)}`,
                            ref_id: body.paymentId
                        }
                    })
                });
                console.log('   ✅ Customer email sent');
            } catch (e) { console.error('   ❌ Customer email error:', e.message); }
        }

        if (HAS_GOOGLE) {
            try {
                await writeOrder(body.customer, body.items, body.paymentId, body.deliveryCost || 0, body.total);
                await writeLog('INFO', 'order_received', { paymentId: body.paymentId, customer: body.customer?.name });
                console.log('   ✅ REAL Google Sheets written');
            } catch (e) { console.error('   ❌ Sheets error:', e.message); }
        } else { console.log('   ✅ Mock Sheets entry successful (Saved in-memory)'); }

        return { status: 200, body: { success: true, ref: body.paymentId } };
    },

    '/api/create-razorpay-order': async (body, _q, method) => {
        if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
        console.log('\n💳 [DEV] /api/create-razorpay-order called');
        const { items, deliveryCost } = body;
        const subtotal = (items || []).reduce((sum, item) => sum + (Number(item.price) * Number(item.qty || 1)), 0);
        const total = subtotal + (Number(deliveryCost) || 0);
        const orderId = 'order_mock_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        console.log(`   ✅ Mock Razorpay Order created: ${orderId} for amount: ₹${total.toFixed(2)}`);
        return {
            status: 200,
            body: {
                success: true,
                orderId: orderId,
                amount: Math.round(total * 100),
                keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey'
            }
        };
    },

    '/api/admin-auth': (body) => {
        const expected = process.env.ADMIN_PWD || 'dev-admin';
        console.log('\n🔐 [DEV] /api/admin-auth called');
        if (body?.password === expected) {
            console.log('   ✅ Auth success');
            return { status: 200, body: { token: 'mock-token-123', expiresAt: Date.now() / 1000 + 86400 } };
        }
        console.log('   ❌ Wrong password. Expected:', expected);
        return { status: 401, body: { error: 'Invalid password' } };
    },

    '/api/admin-data': async (_body, query, method, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };
        const type = query.get('type') || 'orders';

        if (type === 'orders') {
            let external = [];
            if (HAS_GOOGLE) external = await readOrders(50);
            return { status: 200, body: { orders: [...localOrders, ...external] } };
        }
        if (type === 'logs') {
            let external = [];
            if (HAS_GOOGLE) external = await readLogs(20);
            return { status: 200, body: { logs: [...localLogs, ...external] } };
        }
        if (type === 'products') {
            if (HAS_GOOGLE) return { status: 200, body: { products: await readProducts() } };
            return { status: 200, body: { products: [] } };
        }
        return { status: 400, body: { error: 'Invalid type' } };
    },

    '/api/admin-appointment': async (body, _q, method, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };
        console.log('\n👩‍⚕️ [DEV] /api/admin-appointment (Manual Order) called');

        const newOrder = {
            'Timestamp': new Date().toISOString(),
            'ID': 'MANUAL_' + Date.now(),
            'Name': body.customerName,
            'Phone': body.customerPhone,
            'Type': body.requestType,
            'Total': (body.totals?.total || 0).toFixed(2),
            ...body.days
        };
        localOrders.unshift(newOrder);
        localLogs.unshift({ 'Timestamp': new Date().toISOString(), 'Level': 'INFO', 'Event': 'manual_order_added', 'Details': body.customerName });

        return { status: 200, body: { success: true } };
    },

    '/api/products': async (_body, _q, method) => {
        if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
        if (HAS_GOOGLE) return { status: 200, body: { products: await readProducts() } };
        return { status: 200, body: { products: [] } };
    },

    '/api/admin-products': async (body, _q, method, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };

        if (method === 'GET') {
            if (HAS_GOOGLE) return { status: 200, body: { products: await readProducts() } };
            return { status: 200, body: { products: [] } };
        }
        if (method === 'POST') {
            if (HAS_GOOGLE) {
                await updateProducts(body.products);
                return { status: 200, body: { success: true } };
            }
            return { status: 200, body: { success: true, _mock: true } };
        }
        return { status: 405, body: { error: 'Method not allowed' } };
    },

    '/api/upload': async (req, res, query, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };
        if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

        console.log('\n📤 [DEV] /api/upload called (REAL)');
        // Actually call the real handler, but mock the token validation since real handler expects valid JWT
        // Wait, the real handler checks JWT using ADMIN_JWT_SECRET.
        // If we want the real handler to work, we need to pass a valid token.
        // Since we are mocking auth in dev-server, we can just inject process.env.ADMIN_JWT_SECRET
        // Actually, it's easier to just use the actual code from upload.js but bypass JWT:
        return new Promise(async (resolve) => {
            const { google } = await import('googleapis');
            const Busboy = (await import('busboy')).default;
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
            const authClient = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/drive.file'],
            });
            const drive = google.drive({ version: 'v3', auth: authClient });
            const busboy = Busboy({ headers: req.headers });

            busboy.on('file', (fieldname, file, info) => {
                const { filename, mimeType } = info;
                drive.files.create({
                    requestBody: { name: `product_${Date.now()}_${filename}`, mimeType, parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : [] },
                    media: { mimeType, body: file },
                    fields: 'id, webContentLink, webViewLink',
                    supportsAllDrives: true,
                    supportsTeamDrives: true
                }).then(async (driveRes) => {
                    await drive.permissions.create({ fileId: driveRes.data.id, requestBody: { role: 'reader', type: 'anyone' } });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, url: `https://drive.google.com/uc?id=${driveRes.data.id}`, fileId: driveRes.data.id }));
                    resolve({ status: 200, body: {} }); // Dummy return
                }).catch(err => {
                    console.error(err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Drive upload failed' }));
                    resolve({ status: 500, body: {} });
                });
            });
            req.pipe(busboy);
        });
    }
};


const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const [path, queryStr] = req.url.split('?');
    const query = new URLSearchParams(queryStr || '');

    const handler = MOCK_HANDLERS[path];
    if (handler) {
        if (path === '/api/upload') {
            // Do not consume stream, pass req directly to handler
            const { status, body: responseBody } = await handler(req, res, query, req.headers);
            if (!res.headersSent) {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(responseBody));
            }
            return;
        }

        let rawBody = '';
        req.on('data', chunk => rawBody += chunk.toString());
        req.on('end', async () => {
            let body = {};
            try { body = JSON.parse(rawBody || '{}'); } catch { }

            const { status, body: responseBody } = await handler(body, query, req.method, req.headers);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responseBody));
            return;
        });
        return;
    }

        // Serve static files
        let filePath = path === '/' ? '/index.html' : path;
        filePath = pathMod.join(process.cwd(), filePath);

        try {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                filePath = pathMod.join(filePath, 'index.html');
            }
            if (fs.existsSync(filePath)) {
                const ext = pathMod.extname(filePath).toLowerCase();
                let contentType = 'text/plain';
                if (ext === '.html') contentType = 'text/html';
                else if (ext === '.css') contentType = 'text/css';
                else if (ext === '.js') contentType = 'application/javascript';
                else if (ext === '.json') contentType = 'application/json';
                else if (ext === '.png') contentType = 'image/png';
                else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
                else if (ext === '.svg') contentType = 'image/svg+xml';

                res.writeHead(200, { 'Content-Type': contentType });
                fs.createReadStream(filePath).pipe(res);
                return;
            }
        } catch (e) {
            // Ignore stat errors for not found
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Not Found: ${path}` }));
});

server.listen(PORT, () => {
    console.log(`\n🏥 Hope and Heal Test Server running at http://localhost:${PORT}`);
    console.log('   Mocking: /api/notify, /api/admin-auth, /api/admin-data, /api/admin-products');
    console.log(`   Admin Password: ${process.env.ADMIN_PWD || 'dev-admin'}\n`);
});
