const axios = require('axios');
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRY_COUNT = 2;

// Errori di rete: la VM non risponde affatto. Un riavvio puo' rimetterla in piedi.
const UNREACHABLE_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EHOSTDOWN',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND'
]);

// Se la VM risponde in HTTP o presenta un certificato, e' viva: il problema e'
// applicativo o di configurazione e un riavvio non lo risolve. Riavviare in
// questi casi produce solo un ciclo infinito, come accaduto il 2026-08-30,
// quando un certificato scaduto ha causato 51 riavvii in 32 ore.
function isUnreachable(errorCode) {
    return UNREACHABLE_CODES.has(errorCode);
}

function classifyFailure(errorCode) {
    if (isUnreachable(errorCode)) {
        return { reason: 'unreachable', restartWorthy: true };
    }
    if (typeof errorCode === 'string' && (errorCode.includes('CERT') || errorCode.includes('_SSL_') || errorCode.startsWith('ERR_TLS'))) {
        return { reason: 'tls', restartWorthy: false };
    }
    return { reason: 'application', restartWorthy: false };
}

async function performHealthCheck(endpoint) {
    const { url, name, timeout = DEFAULT_TIMEOUT, expectedStatus = 200 } = endpoint;

    logger.info('Performing health check', { url, name });

    for (let attempt = 1; attempt <= DEFAULT_RETRY_COUNT; attempt++) {
        const startTime = Date.now();

        try {
            const response = await axios.get(url, {
                timeout,
                validateStatus: () => true,
                headers: {
                    'User-Agent': 'AWS-Lightsail-Monitor/1.0'
                }
            });

            const healthy = response.status === expectedStatus;
            const responseTime = Date.now() - startTime;

            logger.info('Health check attempt completed', {
                url,
                name,
                attempt,
                status: response.status,
                healthy,
                responseTime
            });

            if (healthy) {
                return {
                    url,
                    name,
                    healthy: true,
                    status: response.status,
                    responseTime,
                    attempt
                };
            }

            if (attempt === DEFAULT_RETRY_COUNT) {
                // Il server ha risposto: e' vivo, quindi nessun riavvio.
                return {
                    url,
                    name,
                    healthy: false,
                    status: response.status,
                    error: `Unexpected status: ${response.status}`,
                    reason: 'application',
                    restartWorthy: false,
                    responseTime,
                    attempt
                };
            }

        } catch (error) {
            const classification = classifyFailure(error.code);

            logger.error('Health check error', {
                url,
                name,
                attempt,
                error: error.message,
                code: error.code,
                reason: classification.reason,
                restartWorthy: classification.restartWorthy
            });

            if (attempt === DEFAULT_RETRY_COUNT) {
                return {
                    url,
                    name,
                    healthy: false,
                    error: error.message,
                    code: error.code,
                    reason: classification.reason,
                    restartWorthy: classification.restartWorthy,
                    attempt
                };
            }

            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

module.exports = {
    performHealthCheck,
    classifyFailure
};
