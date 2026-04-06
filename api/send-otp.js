/**
 * api/send-otp.js — OTP via Fast2SMS (Quick route, no DLT required)
 * POST { phone } → sends 6-digit OTP, stores server-side for verification
 * POST { phone, otp, action:'verify' } → verifies OTP
 * Fallback: if SMS fails, OTP is sent to admin Telegram
 */

import log from './logger.js';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const otpStore = new Map(); // phone → { otp, expiry, attempts }
const MAX_OTP_ATTEMPTS = 5;

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendViaTelegram(phone, otp) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return;
    const msg = `🔐 OTP for order verification\nPhone: +91${phone}\nOTP: *${otp}*\n\nShare this with the customer.`;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        });
    } catch (e) { /* silent */ }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { phone, otp: submittedOtp, action } = req.body || {};

    if (!phone || typeof phone !== 'string' || phone.length < 7) {
        return res.status(400).json({ error: 'Valid phone number required' });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10); // last 10 digits

    // ── VERIFY path ───────────────────────────────────────────────────────────
    if (action === 'verify') {
        if (!submittedOtp) return res.status(400).json({ error: 'OTP required' });

        const record = otpStore.get(cleanPhone);
        if (!record) return res.status(400).json({ error: 'OTP expired or not sent. Please request a new one.' });
        if (Date.now() > record.expiry) {
            otpStore.delete(cleanPhone);
            return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
        }

        record.attempts = (record.attempts || 0) + 1;
        if (record.attempts > MAX_OTP_ATTEMPTS) {
            otpStore.delete(cleanPhone);
            return res.status(429).json({ error: 'Too many attempts. Please request a new OTP.' });
        }

        if (submittedOtp.toString() !== record.otp) {
            return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
        }

        otpStore.delete(cleanPhone);
        return res.status(200).json({ success: true, verified: true });
    }

    // ── SEND path ──────────────────────────────────────────────────────────────
    const otp = generateOTP();
    otpStore.set(cleanPhone, { otp, expiry: Date.now() + OTP_EXPIRY_MS, attempts: 0 });

    // Test number bypass
    if (cleanPhone === '0000000000') {
        otpStore.set(cleanPhone, { otp: '000000', expiry: Date.now() + OTP_EXPIRY_MS, attempts: 0 });
        return res.status(200).json({ success: true, note: 'Test number bypassed' });
    }

    const FAST2SMS_KEY = process.env.FAST2SMS_API_KEY;

    if (!FAST2SMS_KEY) {
        log.info('otp_generated_no_sms_key', { phone: cleanPhone, otp });
        await sendViaTelegram(cleanPhone, otp);
        return res.status(200).json({ success: true, note: 'OTP via Telegram (no SMS key)' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'authorization': FAST2SMS_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                route: 'q',
                message: `Your Hope & Heal verification code is ${otp}. Valid for 10 minutes. Do not share with anyone.`,
                numbers: cleanPhone,
                flash: 0
            })
        });
        clearTimeout(timeout);

        const smsData = await smsRes.json();

        if (smsData.return) {
            log.info('otp_sent_sms', { phone: cleanPhone });
            return res.status(200).json({ success: true });
        }

        // SMS failed — fall back to Telegram so admin can relay OTP to customer
        log.warn('fast2sms_failed_telegram_fallback', { resp: JSON.stringify(smsData), phone: cleanPhone });
        await sendViaTelegram(cleanPhone, otp);
        return res.status(200).json({ success: true, note: 'OTP via Telegram (SMS provider issue)' });

    } catch (e) {
        // Network error / timeout — fall back to Telegram
        log.error('otp_send_exception', { e: e.message });
        await sendViaTelegram(cleanPhone, otp);
        return res.status(200).json({ success: true, note: 'OTP via Telegram (network error)' });
    }
}
