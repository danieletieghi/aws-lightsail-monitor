const logLevel = process.env.LOG_LEVEL || 'info';

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

function shouldLog(level) {
    return levels[level] <= levels[logLevel];
}

function formatLog(level, message, data) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...data
    };
    
    return JSON.stringify(logEntry);
}

const logger = {
    error: (message, error = {}) => {
        if (shouldLog('error')) {
            const errorData = error instanceof Error ? {
                error: error.message,
                stack: error.stack,
                name: error.name
            } : error;
            
            console.error(formatLog('error', message, errorData));
        }
    },
    
    warn: (message, data = {}) => {
        if (shouldLog('warn')) {
            console.warn(formatLog('warn', message, data));
        }
    },
    
    info: (message, data = {}) => {
        if (shouldLog('info')) {
            console.log(formatLog('info', message, data));
        }
    },
    
    debug: (message, data = {}) => {
        if (shouldLog('debug')) {
            console.log(formatLog('debug', message, data));
        }
    }
};

module.exports = logger;