const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const logger = require('../utils/logger');

const client = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

async function sendNotification({ subject, message }) {
    if (!TOPIC_ARN) {
        logger.info('No SNS topic configured, skipping notification');
        return;
    }
    
    try {
        const command = new PublishCommand({
            TopicArn: TOPIC_ARN,
            Subject: subject,
            Message: message,
            MessageAttributes: {
                'notification_type': {
                    DataType: 'String',
                    StringValue: 'lightsail-monitor'
                }
            }
        });
        
        const response = await client.send(command);
        logger.info('Notification sent', { messageId: response.MessageId });
        
        return response.MessageId;
        
    } catch (error) {
        logger.error('Failed to send notification', {
            error: error.message,
            subject
        });
    }
}

module.exports = {
    sendNotification
};