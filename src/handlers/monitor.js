const { performHealthCheck } = require('../services/healthCheck');
const { checkCertificates } = require('../services/certCheck');
const { restartInstance } = require('../services/lightsail');
const {
    getFailureCount,
    updateFailureCount,
    resetFailureCount,
    getInstanceState,
    updateInstanceState,
    shouldSendAlert,
    markAlertSent
} = require('../services/state');
const { sendNotification } = require('../services/notifications');
const logger = require('../utils/logger');

const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD || '3');
const INSTANCE_NAME = process.env.INSTANCE_NAME;
const COOLDOWN_MINUTES = parseInt(process.env.COOLDOWN_MINUTES || '30');
const CERT_WARN_DAYS = parseInt(process.env.CERT_WARN_DAYS || '21');
const ALERT_COOLDOWN_HOURS = parseInt(process.env.ALERT_COOLDOWN_HOURS || '12');

// Parse ENDPOINTS with better error handling
let ENDPOINTS = [];
try {
    if (process.env.ENDPOINTS) {
        ENDPOINTS = JSON.parse(process.env.ENDPOINTS);
    }
} catch (error) {
    logger.error('Failed to parse ENDPOINTS', {
        error: error.message,
        endpoints: process.env.ENDPOINTS
    });
    ENDPOINTS = [];
}

// Notifica al massimo una volta ogni ALERT_COOLDOWN_HOURS per chiave.
async function notifyOnce(alertKey, { subject, message }) {
    if (!await shouldSendAlert(INSTANCE_NAME, alertKey, ALERT_COOLDOWN_HOURS)) {
        logger.info('Alert suppressed by cooldown', { alertKey });
        return false;
    }
    await sendNotification({ subject, message });
    await markAlertSent(INSTANCE_NAME, alertKey);
    return true;
}

function describe(results) {
    return results
        .map(r => `  - ${r.name} (${r.url}): ${r.healthy ? 'OK' : `FALLITO [${r.reason || 'n/d'}] ${r.error || ''}`}`)
        .join('\n');
}

exports.handler = async (event, context) => {
    if (!INSTANCE_NAME) {
        throw new Error('INSTANCE_NAME environment variable is required');
    }

    if (!ENDPOINTS || ENDPOINTS.length === 0) {
        throw new Error('ENDPOINTS environment variable is required and must be a valid JSON array');
    }

    logger.info('Starting health check', { instanceName: INSTANCE_NAME, endpoints: ENDPOINTS });

    try {
        const healthCheckResults = await Promise.all(
            ENDPOINTS.map(endpoint => performHealthCheck(endpoint))
        );

        const allHealthy = healthCheckResults.every(result => result.healthy);
        const failures = healthCheckResults.filter(result => !result.healthy);
        const restartWorthy = failures.filter(result => result.restartWorthy);

        logger.info('Health check results', {
            results: healthCheckResults,
            allHealthy,
            failureCount: failures.length,
            restartWorthyCount: restartWorthy.length
        });

        // Scadenza certificati: avvisa in anticipo invece di scoprirlo a guasto
        // avvenuto. Un certificato scaduto ha causato 51 riavvii il 2026-08-30.
        await checkCertificateExpiry();

        if (allHealthy) {
            const previousFailures = await getFailureCount(INSTANCE_NAME);
            if (previousFailures > 0) {
                await resetFailureCount(INSTANCE_NAME);
                await sendNotification({
                    subject: `Lightsail Monitor: ${INSTANCE_NAME} is back online`,
                    message: `Instance ${INSTANCE_NAME} has recovered and is responding normally.`
                });
            }
            return response(200, {
                status: 'healthy',
                instance: INSTANCE_NAME,
                results: healthCheckResults
            });
        }

        // La VM risponde ma qualcosa non va (TLS, status inatteso). Riavviare non
        // ripara un certificato ne' un errore applicativo: notifica e basta.
        if (restartWorthy.length === 0) {
            await resetFailureCount(INSTANCE_NAME);

            const reasons = [...new Set(failures.map(f => f.reason || 'unknown'))].join(', ');
            await notifyOnce(`degraded-${reasons}`, {
                subject: `Lightsail Monitor: ${INSTANCE_NAME} degradato (nessun riavvio)`,
                message: `L'istanza ${INSTANCE_NAME} risponde, quindi non viene riavviata, ma alcuni controlli falliscono.\n\n`
                    + `Tipo di problema: ${reasons}\n\n`
                    + `Dettaglio:\n${describe(healthCheckResults)}\n\n`
                    + `Un riavvio non risolverebbe questa classe di guasto e per questo non viene eseguito. Serve un intervento manuale.`
            });

            logger.warn('Degraded but reachable, restart skipped', { reasons, results: healthCheckResults });

            return response(200, {
                status: 'degraded',
                instance: INSTANCE_NAME,
                restartSkipped: true,
                reasons,
                results: healthCheckResults
            });
        }

        // Da qui in poi: la VM risulta irraggiungibile, il riavvio ha senso.
        const currentFailures = await updateFailureCount(INSTANCE_NAME);
        logger.warn('Health check failed (unreachable)', {
            currentFailures,
            threshold: FAILURE_THRESHOLD,
            results: healthCheckResults
        });

        if (currentFailures >= FAILURE_THRESHOLD) {
            const lastRestart = await getLastRestartTime(INSTANCE_NAME);
            const minutesSinceRestart = lastRestart
                ? Math.floor((Date.now() - lastRestart) / 60000)
                : COOLDOWN_MINUTES + 1;

            if (minutesSinceRestart > COOLDOWN_MINUTES) {
                logger.info('Restarting instance', {
                    instanceName: INSTANCE_NAME,
                    failures: currentFailures
                });

                await restartInstance(INSTANCE_NAME);
                await resetFailureCount(INSTANCE_NAME);
                await updateLastRestartTime(INSTANCE_NAME);

                await sendNotification({
                    subject: `Lightsail Monitor: ${INSTANCE_NAME} has been restarted`,
                    message: `Instance ${INSTANCE_NAME} was unreachable for ${currentFailures * 5} minutes and has been restarted.\n\n`
                        + `Dettaglio:\n${describe(healthCheckResults)}`
                });

                return response(200, {
                    status: 'restarted',
                    instance: INSTANCE_NAME,
                    failureCount: currentFailures
                });
            }

            logger.info('Skipping restart due to cooldown', {
                minutesSinceRestart,
                cooldownMinutes: COOLDOWN_MINUTES
            });
        }

        return response(200, {
            status: 'unhealthy',
            instance: INSTANCE_NAME,
            failureCount: currentFailures,
            threshold: FAILURE_THRESHOLD,
            results: healthCheckResults
        });

    } catch (error) {
        logger.error('Monitor handler error', error);
        throw error;
    }
};

async function checkCertificateExpiry() {
    try {
        const { expiring } = await checkCertificates(ENDPOINTS, CERT_WARN_DAYS);
        if (expiring.length === 0) return;

        const detail = expiring
            .map(c => `  - ${c.hostname}: ${c.daysRemaining < 0 ? `SCADUTO da ${-c.daysRemaining} giorni` : `scade fra ${c.daysRemaining} giorni`} (${c.expiresAt})`)
            .join('\n');

        await notifyOnce('cert-expiry', {
            subject: `Lightsail Monitor: certificato TLS in scadenza su ${INSTANCE_NAME}`,
            message: `Uno o piu' certificati stanno per scadere o sono gia' scaduti.\n\n${detail}\n\n`
                + `Il rinnovo automatico gira ogni notte alle 04:20 UTC sulla VM.\n`
                + `Log: /var/log/letsencrypt-renew.log\n`
                + `Rinnovo manuale: sudo /opt/bitnami/letsencrypt/scripts/renew-certificate.sh`
        });
    } catch (error) {
        // Un problema qui non deve impedire il monitoraggio vero e proprio.
        logger.error('Certificate expiry check failed', { error: error.message });
    }
}

function response(statusCode, body) {
    return { statusCode, body: JSON.stringify(body) };
}

async function getLastRestartTime(instanceName) {
    const state = await getInstanceState(instanceName);
    return state?.lastRestart;
}

async function updateLastRestartTime(instanceName) {
    await updateInstanceState(instanceName, { lastRestart: Date.now() });
}
