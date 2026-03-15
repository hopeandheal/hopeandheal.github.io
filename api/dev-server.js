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
import { writeOrder, writeLog, readOrders, readLogs, readProducts, updateProducts } from './sheets.js';
import { createOrderCalendarEvents } from './calendar.js';

const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
const envPath = pathMod.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && val) process.env[key] = val;
    }
    console.log('✅ Loaded .env.local');
}

const PORT = 3002;
const HAS_GOOGLE = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID);
const HAS_CAL = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID);

const MOCK_HANDLERS = {
    '/api/notify': async (body, _q, method) => {
        if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
        console.log('\n🏥 [DEV] /api/notify called');
        console.log('   Patient:', body.customer?.name);
        console.log('   Items:', body.items?.map(i => `${i.day}: ${i.name}`).join(', '));
        console.log('   Total: ₹' + (body.total || 0).toFixed(2));

        if (HAS_GOOGLE) {
            try {
                await writeOrder(body.customer, body.items, body.paymentId, body.deliveryCost || 0, body.total);
                await writeLog('INFO', 'order_received', { paymentId: body.paymentId, customer: body.customer?.name });
                console.log('   ✅ REAL Google Sheets written');
            } catch (e) { console.error('   ❌ Sheets error:', e.message); }
        } else { console.log('   ✅ Mock Sheets entry successful (simulated)'); }

        if (HAS_CAL) {
            try {
                await createOrderCalendarEvents(body.customer, body.items, body.paymentId, body.deliveryCost || 0);
                console.log('   ✅ REAL Google Calendar event created');
            } catch (e) { console.error('   ❌ Calendar error:', e.message); }
        } else { console.log('   ✅ Mock Calendar entry successful (simulated)'); }

        return { status: 200, body: { success: true, _mock: true } };
    },

    '/api/admin-auth': (body) => {
        console.log('\n🔐 [DEV] /api/admin-auth called');
        if (body?.password === 'dev-admin') {
            console.log('   ✅ Auth success');
            return { status: 200, body: { token: 'mock-token-123', expiresAt: Date.now() / 1000 + 86400 } };
        }
        console.log('   ❌ Wrong password');
        return { status: 401, body: { error: 'Invalid password' } };
    },

    '/api/admin-data': async (_body, query, method, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };
        const type = query.get('type') || 'orders';
        console.log(`\n📊 [DEV] /api/admin-data?type=${type} called`);

        if (type === 'orders') {
            if (HAS_GOOGLE) return { status: 200, body: { orders: await readOrders(50) } };
            return { status: 200, body: { orders: [{ 'Timestamp': new Date().toISOString(), 'Name': 'Mock Patient', 'Total': '500.00' }] } };
        }
        if (type === 'logs') {
            if (HAS_GOOGLE) return { status: 200, body: { logs: await readLogs(20) } };
            return { status: 200, body: { logs: [{ 'Timestamp': new Date().toISOString(), 'Level': 'INFO', 'Event': 'mock_event' }] } };
        }
        if (type === 'products') {
            if (HAS_GOOGLE) return { status: 200, body: { products: await readProducts() } };
            return { status: 200, body: { products: [] } };
        }
        return { status: 400, body: { error: 'Invalid type' } };
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

    '/api/upload': async (_body, _q, method, headers) => {
        const auth = headers?.authorization || '';
        if (!auth.startsWith('Bearer mock-token-123')) return { status: 401, body: { error: 'Unauthorized' } };
        if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

        console.log('\n📤 [DEV] /api/upload called');
        // Return a high-quality placeholder image for local testing
        return {
            status: 200,
            body: {
                success: true,
                url: 'https://images.unsplash.com/photo-1576091160550-217359f48f4c?auto=format&fit=crop&q=80&w=800',
                _mock: true
            }
        };
    }
};


const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const [path, queryStr] = req.url.split('?');
    const query = new URLSearchParams(queryStr || '');

    let rawBody = '';
    req.on('data', chunk => rawBody += chunk.toString());
    req.on('end', async () => {
        let body = {};
        try { body = JSON.parse(rawBody || '{}'); } catch { }

        const handler = MOCK_HANDLERS[path];
        if (handler) {
            const { status, body: responseBody } = await handler(body, query, req.method, req.headers);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responseBody));
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
});

server.listen(PORT, () => {
    console.log(`\n🏥 Hope and Heal Test Server running at http://localhost:${PORT}`);
    console.log('   Mocking: /api/notify, /api/admin-auth, /api/admin-data');
    console.log('   Admin Password: dev-admin\n');
});
