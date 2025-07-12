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
        const item = {
            instanceName,
            ...updates,
            lastUpdated: new Date().toISOString()
        };
        
        const command = new PutCommand({
            TableName: TABLE_NAME,
            Item: item
        });
        
        await docClient.send(command);
        logger.info('Instance state updated', { instanceName, updates });
        
    } catch (error) {
        logger.error('Error updating instance state', { instanceName, error: error.message });
        throw error;
    }
}

module.exports = {
    getFailureCount,
    updateFailureCount,
    resetFailureCount,
    getInstanceState,
    updateInstanceState
};