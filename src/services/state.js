const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const logger = require('../utils/logger');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.STATE_TABLE_NAME || 'lightsail-monitor-state';

async function getFailureCount(instanceName) {
    try {
        const command = new GetCommand({
            TableName: TABLE_NAME,
            Key: { instanceName }
        });
        
        const response = await docClient.send(command);
        return response.Item?.failureCount || 0;
        
    } catch (error) {
        logger.error('Error getting failure count', { instanceName, error: error.message });
        return 0;
    }
}

async function updateFailureCount(instanceName) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { instanceName },
            UpdateExpression: 'SET failureCount = if_not_exists(failureCount, :zero) + :one, lastFailure = :now',
            ExpressionAttributeValues: {
                ':zero': 0,
                ':one': 1,
                ':now': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        });
        
        const response = await docClient.send(command);
        return response.Attributes.failureCount;
        
    } catch (error) {
        logger.error('Error updating failure count', { instanceName, error: error.message });
        throw error;
    }
}

async function resetFailureCount(instanceName) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { instanceName },
            UpdateExpression: 'SET failureCount = :zero, lastReset = :now',
            ExpressionAttributeValues: {
                ':zero': 0,
                ':now': new Date().toISOString()
            }
        });
        
        await docClient.send(command);
        logger.info('Failure count reset', { instanceName });
        
    } catch (error) {
        logger.error('Error resetting failure count', { instanceName, error: error.message });
        throw error;
    }
}

async function getInstanceState(instanceName) {
    try {
        const command = new GetCommand({
            TableName: TABLE_NAME,
            Key: { instanceName }
        });
        
        const response = await docClient.send(command);
        return response.Item || {};
        
    } catch (error) {
        logger.error('Error getting instance state', { instanceName, error: error.message });
        return {};
    }
}

async function updateInstanceState(instanceName, updates) {
    try {
        // UpdateCommand invece di PutCommand: un Put sovrascrive l'intero item e
        // cancellerebbe gli altri campi (per esempio failureCount) a ogni scrittura.
        const names = { '#lastUpdated': 'lastUpdated' };
        const values = { ':lastUpdated': new Date().toISOString() };
        const sets = ['#lastUpdated = :lastUpdated'];

        Object.entries(updates).forEach(([key, value], i) => {
            names[`#k${i}`] = key;
            values[`:v${i}`] = value;
            sets.push(`#k${i} = :v${i}`);
        });

        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { instanceName },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values
        });

        await docClient.send(command);
        logger.info('Instance state updated', { instanceName, updates });

    } catch (error) {
        logger.error('Error updating instance state', { instanceName, error: error.message });
        throw error;
    }
}

// Limita la frequenza delle notifiche ricorrenti: senza questo, un guasto che
// non provoca riavvio genererebbe una mail ogni 5 minuti all'infinito.
// Gli alert sono attributi flat (alert_<chiave>) e non una mappa annidata:
// DynamoDB rifiuta un'espressione che tocca sia un attributo sia un suo
// sotto-percorso ("Two document paths overlap with each other").
function alertAttr(alertKey) {
    return `alert_${alertKey}`;
}

async function shouldSendAlert(instanceName, alertKey, cooldownHours) {
    const state = await getInstanceState(instanceName);
    const last = state[alertAttr(alertKey)];
    if (!last) return true;
    return (Date.now() - new Date(last).getTime()) > cooldownHours * 3600000;
}

async function markAlertSent(instanceName, alertKey) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { instanceName },
            UpdateExpression: 'SET #key = :now',
            ExpressionAttributeNames: { '#key': alertAttr(alertKey) },
            ExpressionAttributeValues: { ':now': new Date().toISOString() }
        });
        await docClient.send(command);
    } catch (error) {
        logger.error('Error marking alert sent', { instanceName, alertKey, error: error.message });
    }
}

module.exports = {
    getFailureCount,
    updateFailureCount,
    resetFailureCount,
    getInstanceState,
    updateInstanceState,
    shouldSendAlert,
    markAlertSent
};