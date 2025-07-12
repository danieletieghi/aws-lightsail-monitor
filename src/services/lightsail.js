const { LightsailClient, RebootInstanceCommand, GetInstanceCommand } = require('@aws-sdk/client-lightsail');
const logger = require('../utils/logger');

const client = new LightsailClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
});

async function restartInstance(instanceName) {
    try {
        logger.info('Attempting to restart instance', { instanceName });
        
        const getCommand = new GetInstanceCommand({ instanceName });
        const instanceData = await client.send(getCommand);
        
        if (!instanceData.instance) {
            throw new Error(`Instance ${instanceName} not found`);
        }
        
        const currentState = instanceData.instance.state?.name;
        logger.info('Current instance state', { instanceName, state: currentState });
        
        if (currentState !== 'running') {
            logger.warn('Instance not in running state', { instanceName, state: currentState });
            return {
                success: false,
                message: `Instance is in ${currentState} state, cannot restart`
            };
        }
        
        const command = new RebootInstanceCommand({ instanceName });
        const response = await client.send(command);
        
        logger.info('Instance restart initiated', { 
            instanceName, 
            operations: response.operations 
        });
        
        return {
            success: true,
            operationId: response.operations?.[0]?.id,
            message: `Instance ${instanceName} restart initiated`
        };
        
    } catch (error) {
        logger.error('Failed to restart instance', {
            instanceName,
            error: error.message,
            code: error.name
        });
        throw error;
    }
}

async function getInstanceStatus(instanceName) {
    try {
        const command = new GetInstanceCommand({ instanceName });
        const response = await client.send(command);
        
        return {
            name: response.instance.name,
            state: response.instance.state?.name,
            publicIp: response.instance.publicIpAddress,
            isStaticIp: response.instance.isStaticIp,
            hardware: {
                cpuCount: response.instance.hardware?.cpuCount,
                ramSizeInGb: response.instance.hardware?.ramSizeInGb
            }
        };
    } catch (error) {
        logger.error('Failed to get instance status', {
            instanceName,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    restartInstance,
    getInstanceStatus
};