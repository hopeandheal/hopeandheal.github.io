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
import { writeOrder, writeLog, readOrders, readLogs, readProducts, updateProducts } from './api/_lib/sheets.js';
import { createOrderCalendarEvents } from './api/_lib/calendar.js';

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

import notifyHandler from './api/notify.js';
import createOrderHandler from './api/create-razorpay-order.js';
import webhookHandler from './api/razorpay-webhook.js';

function adaptHandler(handlerFn) {
    return async (body, query, method, headers, req, res) => {
        return new Promise((resolve) => {
            const mockReq = {
                method,
                headers: headers || {},
                body: body || {},
                query: query ? Object.fromEntries(query.entries()) : {}
            };
            let statusCode = 200;
            const resHeaders = {};
            const mockRes = {
                status(code) {
                    statusCode = code;
                    return this;
                },
                setHeader(k, v) {
                    resHeaders[k] = v;
                    return this;
                },
                json(data) {
                    resolve({ status: statusCode, body: data, headers: resHeaders });
                },
                end(data) {
                    resolve({ status: statusCode, body: data || {}, headers: resHeaders });
                }
            };
            try {
                handlerFn(mockReq, mockRes).catch(err => {
                    resolve({ status: 500, body: { error: err.message } });
                });
            } catch (err) {
                resolve({ status: 500, body: { error: err.message } });
            }
        });
    };
}

const MOCK_HANDLERS = {
    '/api/notify': adaptHandler(notifyHandler),
    '/api/create-razorpay-order': async (body, query, method, headers, req, res) => {
        // If real Razorpay keys are present, use real handler; otherwise fallback to mock
        if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_ID.includes('mock')) {
            return adaptHandler(createOrderHandler)(body, query, method, headers, req, res);
        }
        // Dev mock fallback with validation
        if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
        const { items, deliveryCost } = body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return { status: 400, body: { error: 'Cart is empty' } };
        }
        const subtotal = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty || 1)), 0);
        const total = subtotal + (Number(deliveryCost) || 0);
        if (total <= 0) return { status: 400, body: { error: 'Invalid order amount' } };

        const orderId = 'order_mock_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        return {
            status: 200,
            body: {
                success: true,
                orderId: orderId,
                amount: Math.round(total * 100),
                keyId: 'rzp_test_mockkey'
            }
        };
    },
    '/api/razorpay-webhook': adaptHandler(webhookHandler),

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

        if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
            filePath = filePath + '.html';
        }
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
