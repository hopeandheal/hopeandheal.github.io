/**
 * api/send-otp.js — OTP via Fast2SMS (free Indian SMS API)
 * POST { phone } → sends 6-digit OTP, stores server-side for verification
 * POST { phone, otp } → verifies OTP
 */

import log from './logger.js';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const otpStore = new Map(); // phone → { otp, expiry, attempts }
const MAX_OTP_ATTEMPTS = 5;

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { phone, otp: submittedOtp, action } = req.body || {};

    if (!phone || typeof phone !== 'string' || phone.length < 7) {
        return res.status(400).json({ error: 'Valid phone number required' });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10); // last 10 digits

    // ── VERIFY path ──────────────────────────────────────────────────────────
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

    // ── SEND path ─────────────────────────────────────────────────────────────
    const otp = generateOTP();
    otpStore.set(cleanPhone, { otp, expiry: Date.now() + OTP_EXPIRY_MS, attempts: 0 });

    const FAST2SMS_KEY = process.env.FAST2SMS_API_KEY;

    if (!FAST2SMS_KEY) {
        // Dev fallback: log OTP but don't send — to aid debugging
        log.info('otp_generated_no_sms_key', { phone: cleanPhone, otp });
        return res.status(200).json({ success: true, _devOtp: otp, note: 'SMS key not configured' });
    }

    try {
        const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
                'authorization': FAST2SMS_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                route: 'otp',
                variables_values: otp,
                numbers: cleanPhone,
                flash: 0
            })
        });

        const smsData = await smsRes.json();

        if (!smsData.return) {
            log.error('fast2sms_failed', { resp: JSON.stringify(smsData) });
            return res.status(500).json({ error: 'Failed to send SMS. Please try again.' });
        }

        log.info('otp_sent', { phone: cleanPhone });
        return res.status(200).json({ success: true });

    } catch (e) {
        log.error('otp_send_exception', { e: e.message });
        return res.status(500).json({ error: 'SMS service unavailable. Please try again.' });
    }
}
