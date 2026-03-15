/**
 * api/sheets.js — Google Sheets Writer
 *
 * Appends orders and logs to a Google Sheet.
 * Columns: Timestamp | ID | Name | Phone | Email | Type | Address | Mon | Tue | Wed | Thu | Fri | Sat | Total
 * Row-based architecture for clinic management.
 */

async function getAccessToken() {
    const credsStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credsStr) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');

    let creds;
    try {
        creds = JSON.parse(credsStr);
    } catch {
        throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format');
    }

    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const claim = b64(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    }));

    const key = creds.private_key;
    const signature = await sign(header + '.' + claim, key);
    const jwt = header + '.' + claim + '.' + signature;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!res.ok) throw new Error('Google Auth Failed: ' + await res.text());
    const data = await res.json();
    return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function b64(str) { return Buffer.from(str).toString('base64url'); }
async function sign(text, privateKey) {
    const { createSign } = await import('crypto');
    const signer = createSign('RSA-SHA256');
    signer.update(text);
    return signer.sign(privateKey, 'base64url');
}

/**
 * Appends an order to the "Orders" sheet.
 */
export async function writeOrder(customer, items, paymentId, deliveryCost, total, isManual = false) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return;

    try {
        const token = await getAccessToken();
        const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });

        // Build per-category portions
        const storage = { Monday: '', Tuesday: '', Wednesday: '', Thursday: '', Friday: '', Saturday: '', Products: '' };
        for (const item of items) {
            // Map 'Product' category to 'Products' column
            const key = item.day === 'Product' ? 'Products' : item.day;
            if (storage[key] !== undefined) {
                storage[key] = (storage[key] ? storage[key] + ', ' : '') + `${item.name} (x${item.quantity})`;
            } else {
                storage.Products = (storage.Products ? storage.Products + ', ' : '') + `${item.name} (x${item.quantity})`;
            }
        }

        const values = [[
            timestamp,
            paymentId,
            customer.name,
            customer.phone,
            customer.email || 'N/A',
            customer.type === 'delivery' ? 'Delivery' : 'Clinic',
            customer.address || 'Clinic Pickup',
            storage.Monday, storage.Tuesday, storage.Wednesday, storage.Thursday, storage.Friday, storage.Saturday, storage.Products,
            Number(total).toFixed(2),
            isManual ? 'MANUAL' : 'ONLINE'
        ]];

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Orders!A:A:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values })
        });

    } catch (err) {
        console.error('Sheets write error:', err.message);
        throw err;
    }
}

/**
 * Appends a log entry to the "Logs" sheet.
 */
export async function writeLog(level, event, details = {}) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return;

    try {
        const token = await getAccessToken();
        const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });
        const values = [[timestamp, level, event, JSON.stringify(details)]];

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Logs!A:A:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values })
        });
    } catch (err) {
        console.error('Log write error:', err.message);
    }
}

export async function readOrders(limit = 100) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return [];

    try {
        const token = await getAccessToken();
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Orders!A1:O${limit + 1}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const rows = data.values || [];
        if (rows.length < 2) return [];
        const headers = rows[0];
        return rows.slice(1).reverse().map(row => {
            const obj = {};
            headers.forEach((h, i) => obj[h] = row[i]);
            return obj;
        });
    } catch (err) {
        console.error('Read orders error:', err.message);
        return [];
    }
}

export async function readLogs(limit = 50) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return [];

    try {
        const token = await getAccessToken();
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Logs!A1:D${limit + 1}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const rows = data.values || [];
        if (rows.length < 2) return [];
        const headers = rows[0];
        return rows.slice(1).reverse().map(row => {
            const obj = {};
            headers.forEach((h, i) => obj[h] = row[i]);
            return obj;
        });
    } catch (err) {
        console.error('Read logs error:', err.message);
        return [];
    }
}

/**
 * Dynamic Product Management
 */

const PRODUCT_HEADERS = ['ID', 'Name', 'Price', 'Description', 'ImageURL', 'Category', 'Active'];

async function ensureSheet(token, name, headers) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const sheets = (data.sheets || []).map(s => s.properties.title);

    if (!sheets.includes(name)) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{ addSheet: { properties: { title: name } } }]
            })
        });
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${name}!A1:append?valueInputOption=RAW`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [headers] })
        });
    }
}

export async function readProducts() {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return [];
    try {
        const token = await getAccessToken();
        await ensureSheet(token, 'Products', PRODUCT_HEADERS);
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Products!A:G`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const rows = data.values || [];
        if (rows.length < 2) return [];
        const headers = rows[0];
        return rows.slice(1).map(row => {
            const obj = {};
            headers.forEach((h, i) => obj[h] = row[i] || '');
            return obj;
        });
    } catch (err) {
        console.error('Read products error:', err.message);
        return [];
    }
}

export async function updateProducts(products) {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SHEET_ID) return;
    try {
        const token = await getAccessToken();
        await ensureSheet(token, 'Products', PRODUCT_HEADERS);

        // Clear existing
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Products!A:G:clear`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Write new list
        const values = [PRODUCT_HEADERS, ...products.map(p => [
            p.ID, p.Name, p.Price, p.Description, p.ImageURL, p.Category, p.Active
        ])];

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Products!A1?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values })
        });
    } catch (err) {
        console.error('Update products error:', err.message);
        throw err;
    }
}

