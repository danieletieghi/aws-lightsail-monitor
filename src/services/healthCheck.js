const axios = require('axios');
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRY_COUNT = 2;

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
                return {
                    url,
                    name,
                    healthy: false,
                    status: response.status,
                    error: `Unexpected status: ${response.status}`,
                    responseTime,
                    attempt
                };
            }
            
        } catch (error) {
            logger.error('Health check error', {
                url,
                name,
                attempt,
                error: error.message,
                code: error.code
            });
            
            if (attempt === DEFAULT_RETRY_COUNT) {
                return {
                    url,
                    name,
                    healthy: false,
                    error: error.message,
                    code: error.code,
                    attempt
                };
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

module.exports = {
    performHealthCheck
};