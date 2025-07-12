# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with AWS Lightsail Monitor.

## Monitoring Issues

### Health Checks Always Fail

**Symptoms:**
- All health checks return as failed
- Instance is actually running and accessible

**Possible Causes:**
1. **Network Security**
   - Check Lightsail firewall rules
   - Ensure ports 80/443 are open
   - Verify security groups

2. **URL Configuration**
   - Confirm URLs in config are correct
   - Check for typos or wrong protocols
   - Ensure HTTPS certificates are valid

3. **Timeout Too Short**
   - Increase timeout value for slow sites
   - Default 10 seconds may be insufficient

**Solutions:**
```json
// Increase timeout in config
{
  "endpoints": [{
    "url": "https://slow-site.com",
    "timeout": 30000  // 30 seconds
  }]
}
```

### False Positives

**Symptoms:**
- Site is accessible but monitor reports failures
- Intermittent false alarms

**Solutions:**
1. Adjust retry logic in healthCheck.js
2. Increase failure threshold
3. Add custom headers if site blocks bots

### Instance Not Restarting

**Symptoms:**
- Failures exceed threshold but no restart
- Logs show restart attempts but instance unchanged

**Possible Causes:**
1. **IAM Permissions**
   ```bash
   # Check Lambda role permissions
   aws iam get-role-policy \
     --role-name lightsail-monitor-role \
     --policy-name LightsailAccess
   ```

2. **Cooldown Period Active**
   - Check DynamoDB for lastRestart timestamp
   - Wait for cooldown to expire

3. **Instance State**
   - Instance might be stopped or in transition
   - Check Lightsail console

## Lambda Function Issues

### Function Timeouts

**Symptoms:**
- Function execution exceeds 30 seconds
- Incomplete health checks

**Solutions:**
1. Increase Lambda timeout in template.yaml:
   ```yaml
   Timeout: 60  # Increase to 60 seconds
   ```

2. Optimize health check logic
3. Reduce number of endpoints

### Memory Errors

**Symptoms:**
- "Runtime exited with error: signal: killed"
- Function runs out of memory

**Solutions:**
```yaml
# Increase memory in template.yaml
MemorySize: 512  # Increase from 256
```

### Cold Start Issues

**Symptoms:**
- First execution after idle period is slow
- Occasional timeouts

**Solutions:**
1. Use provisioned concurrency
2. Increase timeout to accommodate cold starts
3. Implement Lambda warmup

## DynamoDB Issues

### State Not Persisting

**Symptoms:**
- Failure counts reset unexpectedly
- State not maintained between executions

**Debugging:**
```bash
# Check table items
aws dynamodb scan \
  --table-name lightsail-monitor-state
```

**Solutions:**
1. Verify table exists and is accessible
2. Check IAM permissions for DynamoDB
3. Ensure table name matches environment variable

## CloudWatch Events Issues

### Schedule Not Triggering

**Symptoms:**
- Function not executing on schedule
- No invocations in Lambda console

**Debugging:**
```bash
# List rules
aws events list-rules \
  --name-prefix lightsail-monitor

# Check rule state
aws events describe-rule \
  --name lightsail-monitor-schedule
```

**Solutions:**
1. Ensure rule is ENABLED
2. Check EventBridge permissions
3. Verify schedule expression

## Notification Issues

### Not Receiving Emails

**Symptoms:**
- No email notifications on failures/restarts
- SNS topic exists but no delivery

**Solutions:**
1. **Confirm SNS Subscription**
   - Check email for confirmation
   - Resend confirmation if needed

2. **Check Spam Folder**
   - AWS emails often filtered

3. **Verify Topic ARN**
   ```bash
   aws sns list-subscriptions-by-topic \
     --topic-arn arn:aws:sns:region:account:topic
   ```

## Debugging Tools

### View Lambda Logs

```bash
# Real-time logs
sam logs -n MonitorFunction --tail

# Search logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/lightsail-monitor \
  --filter-pattern "ERROR"
```

### Test Function Locally

```bash
# Create test event
cat > event.json << EOF
{
  "source": "aws.events",
  "detail-type": "Scheduled Event"
}
EOF

# Run locally
sam local invoke MonitorFunction -e event.json
```

### Check Metrics

```bash
# Function metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=lightsail-monitor \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

## Common Error Messages

### "AccessDeniedException"
- Check IAM role permissions
- Ensure Lambda can access Lightsail API

### "ResourceNotFoundException"
- Verify instance name is correct
- Check region configuration

### "ThrottlingException"
- Reduce check frequency
- Implement exponential backoff

### "NetworkingError"
- Lambda might not have internet access
- Check VPC configuration if applicable

## Getting Additional Help

1. **Enable Debug Logging**
   ```bash
   # Set LOG_LEVEL to debug
   aws lambda update-function-configuration \
     --function-name lightsail-monitor \
     --environment Variables={LOG_LEVEL=debug}
   ```

2. **Collect Diagnostic Information**
   - Lambda function logs
   - CloudFormation stack events
   - DynamoDB table contents
   - IAM role policies

3. **Open an Issue**
   - Visit GitHub repository
   - Include diagnostic information
   - Describe expected vs actual behavior