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

export const config = {
    api: {
        bodyParser: false,
    },
};

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

    const busboy = Busboy({ headers: req.headers });

    return new Promise((resolve) => {
        busboy.on('file', (fieldname, file, info) => {
            const chunks = [];
            file.on('data', (data) => chunks.push(data));
            file.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                const base64Image = buffer.toString('base64');
                
                try {
                    const formData = new URLSearchParams();
                    formData.append('image', base64Image);
                    
                    const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                        method: 'POST',
                        body: formData,
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        res.status(200).json({
                            success: true,
                            url: data.data.url
                        });
                    } else {
                        res.status(500).json({ error: 'ImgBB upload failed', details: data.error?.message });
                    }
                } catch (err) {
                    console.error('ImgBB Upload Error:', err);
                    res.status(500).json({ error: 'Upload failed', details: err.message });
                }
                resolve();
            });
        });

        busboy.on('error', (err) => {
            console.error('Busboy error:', err);
            res.status(500).json({ error: 'Form parsing error' });
            resolve();
        });

        req.pipe(busboy);
    });
}
