/**
 * api/logger.js — Structured Logging Utility
 *
 * Centralized logging for all serverless functions.
 * Captures to both Vercel dashboard (console) and Google Sheets "Logs" tab.
 */

const log = {
    info: (event, details = {}) => {
        const payload = { level: 'INFO', event, timestamp: new Date().toISOString(), details };
        console.log(`[INF] ${event}:`, JSON.stringify(details));
        return payload;
    },
    warn: (event, details = {}) => {
        const payload = { level: 'WARN', event, timestamp: new Date().toISOString(), details };
        console.warn(`[WRN] ${event}:`, JSON.stringify(details));
        return payload;
    },
    error: (event, details = {}) => {
        const payload = { level: 'ERROR', event, timestamp: new Date().toISOString(), details };
        console.error(`[ERR] ${event}:`, JSON.stringify(details));
        return payload;
    }
};

export default log;
