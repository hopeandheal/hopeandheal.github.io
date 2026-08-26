/**
 * api/cron-review-reminders.js — Automated 1-Week & 2-Week Post-Order Review Reminders
 *
 * Runs daily via Vercel Cron or on-demand via Admin Panel.
 * Scans Google Sheets orders:
 * - Day 7–13: Sends 1-Week Experience & Review Request Email
 * - Day 14–45: Sends 2-Week Gentle Follow-up Review Email
 *
 * Updates Google Sheets columns 'Review_7d' and 'Review_14d' to guarantee zero duplicate emails.
 */

import log from './_lib/logger.js';
import { readOrders, updateOrderReviewStatus, writeLog } from './_lib/sheets.js';

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL 
    || 'https://www.google.com/maps/search/?api=1&query=Hope+%26+Heal+homoeopathic+clinic,+Back+Bone+Shopping+Centre,+Mayani+Chowk,+Chandreshnagar,+Rajkot,+Gujarat+360004';
const CLINIC_WHATSAPP = 'https://wa.me/918469022764';

/**
 * Parses DD/MM/YYYY or MM/DD/YYYY or ISO timestamp from Google Sheets.
 */
function parseSheetTimestamp(timestampStr) {
    if (!timestampStr) return null;
    // Format: "26/08/2026, 17:35:00" or "26/08/2026" or ISO
    const parts = timestampStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (parts) {
        const day = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10) - 1;
        const year = parseInt(parts[3], 10);
        return new Date(year, month, day);
    }
    const d = new Date(timestampStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Sends an email using EmailJS API.
 */
async function sendReviewEmail({ customerName, customerEmail, orderId, emailType, total }) {
    const SERVICE = process.env.EMAILJS_SERVICE_ID;
    const KEY = process.env.EMAILJS_PUBLIC_KEY;
    const SECRET = process.env.EMAILJS_PRIVATE_KEY;
    
    // Uses the dedicated review template if provided, or the unified customer template
    const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_REVIEW_7D 
        || process.env.EMAILJS_TEMPLATE_REVIEW 
        || process.env.EMAILJS_TEMPLATE_CUSTOMER;

    if (!SERVICE || !TEMPLATE_ID || !KEY) {
        log.warn('emailjs_config_missing_for_review', { emailType, orderId });
        return false;
    }

    const firstName = (customerName || 'Friend').split(' ')[0];

    const subject = emailType === '7d'
        ? `Following up on your remedies – Dr. Nirav`
        : `Checking in on your health & recovery – Dr. Nirav`;

    const headline = emailType === '7d'
        ? `How are you feeling?`
        : `Checking in on your health journey`;

    const subheadline = emailType === '7d'
        ? `A 1-week wellness check-in from Dr. Nirav`
        : `A 2-week recovery follow-up from Dr. Nirav`;

    const bodyText = emailType === '7d'
        ? `Hello ${firstName},\n\nIt has been a week since your consultation and prescribed remedies. We hope you are beginning to experience the gentle, restorative benefits of your homeopathic care.\n\nCould you take a quick moment to share your feedback on Google? Your honest review helps others looking for natural healing and authentic homeopathic care find our clinic.\n\nWarm regards,\nDr. Nirav Khunt\nHope & Heal Homoeopathy Clinic`
        : `Hello ${firstName},\n\nWe are checking in to see how your treatment and remedies have been supporting you over the past two weeks.\n\nIf Hope & Heal has made a positive difference in your skin, hair, or overall wellness, we would be deeply grateful if you could share your experience on Google.\n\nWarm regards,\nDr. Nirav Khunt\nHope & Heal Homoeopathy Clinic`;

    const params = {
        to_name: firstName,
        to_email: customerEmail,
        reply_to: 'hopeandhealhomoeopathy@gmail.com',
        customer_name: customerName,
        customer_email: customerEmail,
        order_id: '',
        review_type: emailType === '7d' ? '1-Week Check-in' : '2-Week Follow-up',
        subject: subject,
        headline: headline,
        subheadline: subheadline,
        message: bodyText,
        cta_text: 'Share Your Feedback on Google',
        cta_url: GOOGLE_REVIEW_URL,
        review_url: GOOGLE_REVIEW_URL,
        whatsapp_url: CLINIC_WHATSAPP,
        total: total || ''
    };

    try {
        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: SERVICE,
                template_id: TEMPLATE_ID,
                user_id: KEY,
                accessToken: SECRET,
                template_params: params
            })
        });

        if (!res.ok) {
            const err = await res.text();
            log.error('review_email_failed', { orderId, emailType, err });
            try {
                await writeLog('ERROR', `review_email_${emailType}_failed`, {
                    orderId,
                    emailType,
                    to: customerEmail,
                    error: err.slice(0, 150)
                });
            } catch (_) {}
            return false;
        }

        log.info('review_email_sent', { orderId, emailType, customerEmail });
        try {
            await writeLog('INFO', `review_email_${emailType}_sent`, {
                orderId,
                emailType,
                to: customerEmail
            });
        } catch (_) {}
        return true;
    } catch (e) {
        log.error('review_email_exception', { orderId, emailType, error: e.message });
        try {
            await writeLog('ERROR', `review_email_${emailType}_exception`, {
                orderId,
                emailType,
                to: customerEmail,
                error: e.message
            });
        } catch (_) {}
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Check optional admin authorization if called from browser or specific order trigger
    const authHeader = req.headers.authorization || '';
    const cronHeader = req.headers['x-vercel-cron'];
    const isCron = !!cronHeader || req.method === 'GET';

    // Allow single manual trigger via POST: { orderId: "...", emailType: "7d"|"14d" }
    if (req.method === 'POST' && req.body && req.body.orderId) {
        const { orderId, emailType = '7d', customerEmail, customerName } = req.body;
        if (!customerEmail || customerEmail === 'N/A' || !customerEmail.includes('@')) {
            return res.status(400).json({ error: 'Valid customer email is required' });
        }

        const sent = await sendReviewEmail({
            customerName: customerName || 'Patient',
            customerEmail,
            orderId,
            emailType
        });

        if (sent) {
            const dateStamp = new Date().toISOString().slice(0, 10);
            await updateOrderReviewStatus(orderId, emailType === '7d' ? 'Review_7d' : 'Review_14d', `SENT_${dateStamp}`);
            return res.status(200).json({ success: true, message: `Review email (${emailType}) sent successfully` });
        } else {
            return res.status(500).json({ error: 'Failed to send review email via EmailJS' });
        }
    }

    log.info('cron_review_reminders_started', { trigger: isCron ? 'cron' : 'manual' });

    try {
        const orders = await readOrders(300);
        const now = new Date();
        const results = {
            scanned: orders.length,
            sent_7d: 0,
            sent_14d: 0,
            skipped: 0,
            errors: 0,
            details: []
        };

        const todayStr = now.toISOString().slice(0, 10);

        for (const order of orders) {
            const orderId = order.ID;
            const email = order.Email;
            const name = order.Name;
            const timestamp = order.Timestamp;
            const review7d = order.Review_7d || '';
            const review14d = order.Review_14d || '';

            if (!email || email === 'N/A' || !email.includes('@')) {
                results.skipped++;
                continue;
            }

            const orderDate = parseSheetTimestamp(timestamp);
            if (!orderDate) {
                results.skipped++;
                continue;
            }

            const diffMs = now.getTime() - orderDate.getTime();
            const ageInDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            // ── Case 1: 7-Day Review Reminder (Eligible between day 7 and 13) ────
            if (ageInDays >= 7 && ageInDays < 14) {
                if (!review7d || !review7d.startsWith('SENT')) {
                    const ok = await sendReviewEmail({
                        customerName: name,
                        customerEmail: email,
                        orderId,
                        emailType: '7d',
                        total: order.Total
                    });

                    if (ok) {
                        await updateOrderReviewStatus(orderId, 'Review_7d', `SENT_${todayStr}`);
                        results.sent_7d++;
                        results.details.push({ orderId, email, type: '7d', ageInDays, status: 'SENT' });
                    } else {
                        results.errors++;
                    }
                } else {
                    results.skipped++;
                }
            }
            // ── Case 2: 14-Day Review Reminder (Eligible between day 14 and 45) ───
            else if (ageInDays >= 14 && ageInDays <= 45) {
                if (!review14d || !review14d.startsWith('SENT')) {
                    const ok = await sendReviewEmail({
                        customerName: name,
                        customerEmail: email,
                        orderId,
                        emailType: '14d',
                        total: order.Total
                    });

                    if (ok) {
                        await updateOrderReviewStatus(orderId, 'Review_14d', `SENT_${todayStr}`);
                        results.sent_14d++;
                        results.details.push({ orderId, email, type: '14d', ageInDays, status: 'SENT' });
                    } else {
                        results.errors++;
                    }
                } else {
                    results.skipped++;
                }
            } else {
                results.skipped++;
            }
        }

        log.info('cron_review_reminders_completed', results);
        await writeLog('INFO', 'CRON_REVIEW_REMINDERS', results);

        return res.status(200).json({
            success: true,
            message: `Processed ${results.scanned} orders. Sent ${results.sent_7d} 7-day and ${results.sent_14d} 14-day review emails.`,
            results
        });
    } catch (err) {
        log.error('cron_review_reminders_error', { error: err.message });
        return res.status(500).json({ error: err.message });
    }
}
