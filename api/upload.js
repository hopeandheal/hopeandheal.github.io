/**
 * api/upload.js — Google Drive Image Upload Adapter
 * 
 * Securely uploads clinical product images to Google Drive using the service account.
 * Sets the file to public and returns a direct thumbnail/view link.
 */

import { google } from 'googleapis';
import Busboy from 'busboy';
import { Readable } from 'stream';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-123';

async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [header, payload, sig] = parts;
        const signingInput = `${header}.${payload}`;
        const key = await crypto.subtle.importKey(
            'raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        const valid = await crypto.subtle.verify(
            'HMAC', key, Buffer.from(sig, 'base64url'), Buffer.from(signingInput)
        );
        if (!valid) return null;
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
        return decoded.role === 'admin' ? decoded : null;
    } catch { return null; }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Auth Check
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = await verifyJWT(token, ADMIN_JWT_SECRET);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    // 2. Setup Google Drive
    let auth;
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
    } catch (e) {
        return res.status(500).json({ error: 'Google configuration missing' });
    }

    const drive = google.drive({ version: 'v3', auth });
    const busboy = Busboy({ headers: req.headers });

    return new Promise((resolve) => {
        busboy.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;

            // Upload to Drive
            drive.files.create({
                requestBody: {
                    name: `product_${Date.now()}_${filename}`,
                    mimeType: mimeType,
                    parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : []
                },
                media: {
                    mimeType: mimeType,
                    body: file,
                },
                fields: 'id, webContentLink, webViewLink'
            }).then(async (driveRes) => {
                const fileId = driveRes.data.id;

                // Make Public
                await drive.permissions.create({
                    fileId: fileId,
                    requestBody: {
                        role: 'reader',
                        type: 'anyone',
                    },
                });

                // Return direct link format for images
                const directLink = `https://lh3.googleusercontent.com/u/0/d/${fileId}`;
                // Alternatively: `https://drive.google.com/uc?id=${fileId}` (though Google sometimes blocks this for direct embedding)

                res.status(200).json({
                    success: true,
                    url: `https://drive.google.com/uc?id=${fileId}`,
                    fileId: fileId
                });
                resolve();
            }).catch(err => {
                console.error('Drive Upload Error:', err);
                res.status(500).json({ error: 'Drive upload failed' });
                resolve();
            });
        });

        busboy.on('error', (err) => {
            res.status(500).json({ error: 'Form parsing error' });
            resolve();
        });

        req.pipe(busboy);
    });
}
