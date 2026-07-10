/**
 * api/calendar.js — Google Calendar Event Creator
 *
 * Creates events for each scheduled visit/appointment.
 */

const getAccessToken = async () => {
    const credsStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credsStr) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');

    let creds;
    try {
        creds = JSON.parse(credsStr);
    } catch {
        throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format');
    }

    const { createSign } = await import('crypto');
    const b64 = (s) => Buffer.from(s).toString('base64url');
    const sign = (t, k) => createSign('RSA-SHA256').update(t).sign(k, 'base64url');

    const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const c = b64(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    }));

    const sig = await sign(h + '.' + c, creds.private_key);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${h + '.' + c + '.' + sig}`
    });

    const data = await tokenRes.json();
    return data.access_token;
};

function getNextDate(dayName) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const targetIdx = days.indexOf(dayName);
    if (targetIdx === -1) return now;

    let diff = targetIdx - now.getDay();
    if (diff < 0) diff += 7; // Next occurrence
    const target = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
    return target.toISOString().split('T')[0];
}

export async function createOrderCalendarEvents(customer, items, paymentId, deliveryCost) {
    const CAL_ID = process.env.GOOGLE_CALENDAR_ID;
    if (!CAL_ID) return;

    try {
        const token = await getAccessToken();
        const byDay = {};

        for (const item of items) {
            if (!byDay[item.day]) byDay[item.day] = [];
            byDay[item.day].push(`${item.name} x${item.quantity}`);
        }

        for (const [day, dayItems] of Object.entries(byDay)) {
            const dateStr = getNextDate(day);
            const timeStr = customer.type === 'delivery' ? '19:00:00' : '17:30:00'; // Standard clinic/delivery times

            const event = {
                summary: `🏥 ${customer.name} — ${day} Appointment (#${paymentId.slice(-6)})`,
                description: [
                    `👤 Patient: ${customer.name}`,
                    `📞 Phone: ${customer.phone}`,
                    `📧 Email: ${customer.email || 'N/A'}`,
                    `📍 Type: ${customer.type === 'delivery' ? 'Home Visit' : 'Clinic Visit'}`,
                    `📝 Details: ${dayItems.join(', ')}`,
                    `💰 Paid: £${(items.filter(i => i.day === day).reduce((s, i) => s + (i.price * i.quantity), 0)).toFixed(2)}`,
                    `🆔 ID: ${paymentId}`
                ].join('\n'),
                start: { dateTime: `${dateStr}T${timeStr}`, timeZone: 'Asia/Kolkata' }, // Clinical visits in IST
                end: { dateTime: `${dateStr}T${new Date(new Date(`${dateStr}T${timeStr}`).getTime() + 30 * 60000).toISOString().split('T')[1]}`, timeZone: 'Asia/Kolkata' },
                location: customer.type === 'delivery' ? customer.address : 'Hope and Heal Clinic, Rajkot'
            };

            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${CAL_ID}/events`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
        }
    } catch (err) {
        console.error('Calendar error:', err.message);
    }
}
