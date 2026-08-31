const tls = require('tls');
const { URL } = require('url');
const logger = require('../utils/logger');

const CONNECT_TIMEOUT = 8000;

// Legge la scadenza del certificato TLS senza validarlo: serve poter ispezionare
// anche un certificato gia' scaduto, che e' proprio il caso da intercettare.
function readCertificate(hostname, port = 443) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };

        const socket = tls.connect({
            host: hostname,
            port,
            servername: hostname,
            rejectUnauthorized: false,
            timeout: CONNECT_TIMEOUT
        }, () => {
            const cert = socket.getPeerCertificate();
            socket.end();

            if (!cert || !cert.valid_to) {
                return done({ hostname, error: 'no certificate returned' });
            }

            const expiresAt = new Date(cert.valid_to);
            const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);

            done({
                hostname,
                subject: cert.subject?.CN,
                expiresAt: expiresAt.toISOString(),
                daysRemaining
            });
        });

        socket.on('timeout', () => {
            socket.destroy();
            done({ hostname, error: 'connection timeout' });
        });

        socket.on('error', (error) => {
            done({ hostname, error: error.message });
        });
    });
}

// Controlla i certificati degli endpoint HTTPS monitorati e restituisce quelli
// in scadenza entro warnDays (o gia' scaduti).
async function checkCertificates(endpoints, warnDays) {
    const hostnames = [...new Set(
        endpoints
            .map(e => {
                try {
                    const parsed = new URL(e.url);
                    return parsed.protocol === 'https:' ? parsed.hostname : null;
                } catch (error) {
                    logger.warn('Endpoint URL non valido, salto il controllo certificato', { url: e.url });
                    return null;
                }
            })
            .filter(Boolean)
    )];

    const results = await Promise.all(hostnames.map(h => readCertificate(h)));

    const expiring = results.filter(r => typeof r.daysRemaining === 'number' && r.daysRemaining <= warnDays);

    logger.info('Certificate check completed', { results, warnDays, expiringCount: expiring.length });

    return { results, expiring };
}

module.exports = {
    checkCertificates,
    readCertificate
};
