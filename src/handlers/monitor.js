const { performHealthCheck } = require('../services/healthCheck');
const { restartInstance } = require('../services/lightsail');
const { getFailureCount, updateFailureCount, resetFailureCount } = require('../services/state');
const { sendNotification } = require('../services/notifications');
const logger = require('../utils/logger');

const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD || '3');
const INSTANCE_NAME = process.env.INSTANCE_NAME;
const COOLDOWN_MINUTES = parseInt(process.env.COOLDOWN_MINUTES || '30');

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

exports.handler = async (event, context) => {
    // Validate required parameters
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
        logger.info('Health check results', { results: healthCheckResults, allHealthy });

        if (allHealthy) {
            const previousFailures = await getFailureCount(INSTANCE_NAME);
            if (previousFailures > 0) {
                await resetFailureCount(INSTANCE_NAME);
                await sendNotification({
                    subject: `Lightsail Monitor: ${INSTANCE_NAME} is back online`,
                    message: `Instance ${INSTANCE_NAME} has recovered and is responding normally.`
                });
            }
            return {
                statusCode: 200,
                body: JSON.stringify({
                    status: 'healthy',
                    instance: INSTANCE_NAME,
                    results: healthCheckResults
                })
            };
        }

        const currentFailures = await updateFailureCount(INSTANCE_NAME);
        logger.warn('Health check failed', { 
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
                    message: `Instance ${INSTANCE_NAME} was unresponsive for ${currentFailures * 5} minutes and has been restarted.`
                });

                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        status: 'restarted',
                        instance: INSTANCE_NAME,
                        failureCount: currentFailures
                    })
                };
            } else {
                logger.info('Skipping restart due to cooldown', { 
                    minutesSinceRestart, 
                    cooldownMinutes: COOLDOWN_MINUTES 
                });
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: 'unhealthy',
                instance: INSTANCE_NAME,
                failureCount: currentFailures,
                threshold: FAILURE_THRESHOLD,
                results: healthCheckResults
            })
        };

    } catch (error) {
        logger.error('Monitor handler error', error);
        throw error;
    }
};

async function getLastRestartTime(instanceName) {
    const { getInstanceState } = require('../services/state');
    const state = await getInstanceState(instanceName);
    return state?.lastRestart;
}

async function updateLastRestartTime(instanceName) {
    const { updateInstanceState } = require('../services/state');
    await updateInstanceState(instanceName, { lastRestart: Date.now() });
}