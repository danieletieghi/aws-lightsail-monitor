# Deployment Guide

This guide provides detailed instructions for deploying the AWS Lightsail Monitor.

## Prerequisites

Before deploying, ensure you have:

1. **AWS CLI** installed and configured with appropriate credentials
2. **AWS SAM CLI** installed (version 1.50.0 or later)
3. **Node.js** 18.x or later
4. **jq** command-line JSON processor (for deployment script)
5. Appropriate AWS permissions (see IAM Permissions section)

## IAM Permissions

Your AWS user/role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "dynamodb:*",
        "sns:*",
        "events:*",
        "logs:*",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:PassRole",
        "lightsail:GetInstance",
        "lightsail:RebootInstance"
      ],
      "Resource": "*"
    }
  ]
}
```

## Step-by-Step Deployment

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/aws-lightsail-monitor.git
cd aws-lightsail-monitor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Your Settings

Copy the example configuration:

```bash
cp config/config.example.json config/config.json
```

Edit `config/config.json` with your settings:

```json
{
  "instanceName": "your-instance-name",
  "region": "us-east-1",
  "endpoints": [
    {
      "url": "https://your-website.com",
      "name": "Production Site",
      "timeout": 10000
    }
  ],
  "failureThreshold": 3,
  "checkInterval": 5,
  "notificationEmail": "your-email@example.com"
}
```

### 4. Deploy Using the Script

The easiest way to deploy:

```bash
./deploy.sh
```

### 5. Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
# Build the application
sam build

# Deploy with parameters
sam deploy \
  --stack-name lightsail-monitor \
  --parameter-overrides \
    InstanceName=your-instance-name \
    Endpoints='[{"url":"https://your-site.com","name":"Main Site"}]' \
    NotificationEmail=your-email@example.com \
  --capabilities CAPABILITY_IAM \
  --guided
```

## Deployment Parameters

| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| InstanceName | Lightsail instance name | - | Yes |
| Endpoints | JSON array of endpoints | - | Yes |
| FailureThreshold | Failures before restart | 3 | No |
| CheckInterval | Minutes between checks | 5 | No |
| CooldownMinutes | Wait time between restarts | 30 | No |
| NotificationEmail | Email for alerts | - | No |
| LogLevel | Logging verbosity | info | No |
| CostAllocationTag | Tag for cost tracking | lightsail-monitor | No |
| CustomTags | JSON object with custom tags | {} | No |

## Verifying Deployment

### 1. Check Stack Status

```bash
aws cloudformation describe-stacks \
  --stack-name lightsail-monitor \
  --query 'Stacks[0].StackStatus'
```

### 2. Test the Function

```bash
# Create a test event
echo '{}' > test-event.json

# Invoke the function
sam local invoke MonitorFunction -e test-event.json
```

### 3. View Logs

```bash
sam logs -n MonitorFunction --tail
```

## Updating the Deployment

To update configuration or code:

```bash
# Make your changes, then:
sam build
sam deploy
```

## Removing the Deployment

### Automated Uninstall

The easiest way to remove everything:

```bash
./uninstall.sh
```

### Manual Removal

To manually remove the monitor:

```bash
aws cloudformation delete-stack \
  --stack-name lightsail-monitor \
  --region us-east-1
```

### Cost Tracking

After deployment, you can track costs using:

```bash
./check-costs.sh
```

Make sure to activate the 'CostCenter' tag in AWS Billing Console for accurate cost allocation.

## Troubleshooting Deployment

### Common Issues

1. **"Stack already exists"**
   - Use a different stack name or delete the existing stack

2. **"Insufficient permissions"**
   - Ensure your AWS credentials have the required IAM permissions

3. **"Invalid parameter"**
   - Check that your Endpoints JSON is properly formatted

4. **"Function timeout"**
   - Increase the Lambda timeout in template.yaml

### Getting Help

- Check CloudFormation events for detailed error messages
- Review Lambda function logs in CloudWatch
- Open an issue on GitHub for assistance