# AWS Lightsail Monitor

An automated monitoring solution for AWS Lightsail instances that performs health checks and automatically restarts instances when they become unresponsive.

## Overview

This project provides a serverless monitoring system that:
- Performs health checks on your Lightsail-hosted websites every 5 minutes
- Tracks consecutive failures
- Automatically restarts the instance after 3 consecutive failures (15 minutes of downtime)
- Sends notifications about instance status changes
- Provides detailed logging for troubleshooting

## Features

- **Automated Health Checks**: HTTP/HTTPS endpoint monitoring every 5 minutes
- **Smart Failure Detection**: Configurable consecutive failure threshold before restart
- **Automatic Recovery**: Instance restart capability with cooldown period
- **Multi-Site Support**: Monitor multiple websites on the same instance
- **Notifications**: SNS integration for alerts on failures and restarts
- **Cost-Effective**: Serverless architecture using AWS Lambda
- **Easy Deployment**: Infrastructure as Code using AWS SAM/CloudFormation

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│                 │     │              │     │                 │
│  CloudWatch     │────▶│   Lambda     │────▶│   Lightsail     │
│  Events         │     │  Function    │     │   Instance      │
│  (Every 5 min)  │     │              │     │                 │
└─────────────────┘     └──────┬───────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │              │
                        │  DynamoDB    │
                        │  (State)     │
                        │              │
                        └──────────────┘
```

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Node.js 18.x or later
- AWS SAM CLI (for deployment)
- A Lightsail instance with one or more websites

### AWS Profile Configuration

If you have multiple AWS profiles configured (especially with AWS SSO), you need to specify the correct profile when deploying or uninstalling:

```bash
# Check your available profiles
cat ~/.aws/credentials | grep -E '^\[.*\]'

# Login to AWS SSO (if using SSO profiles)
aws sso login --profile YOUR_PROFILE_NAME

# Use the profile with deployment/uninstall scripts
AWS_PROFILE=YOUR_PROFILE_NAME ./deploy.sh
AWS_PROFILE=YOUR_PROFILE_NAME ./uninstall.sh
```

**Important:** Make sure to use the same AWS profile for both deployment and uninstallation to ensure the CloudFormation stack is found in the correct account/region.

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/yourusername/aws-lightsail-monitor.git
cd aws-lightsail-monitor
```

2. Install dependencies:
```bash
npm install
```

3. Configure your monitoring settings:
```bash
cp config/config.example.json config/config.json
# Edit config.json with your instance details
```

4. Deploy to AWS:
```bash
npm run deploy
```

## Restart Policy: what triggers a reboot

The monitor restarts the instance **only when the VM is unreachable at the network
level** (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH` and similar). Any other kind of
failure is reported but never triggers a restart:

| Failure | Classification | Restart? |
|---|---|---|
| Connection refused / timeout / host unreachable | `unreachable` | Yes, after `failureThreshold` checks |
| Expired or invalid TLS certificate | `tls` | No, notification only |
| Unexpected HTTP status (4xx, 5xx) | `application` | No, notification only |

The reasoning: if the server answers HTTP or presents a certificate, it is alive, and
rebooting cannot fix a certificate or an application error. It only produces a reboot
loop.

This rule was added after an incident on 2026-08-30: the Let's Encrypt certificate
expired, the `n8n` health check started failing with `CERT_HAS_EXPIRED`, and the
monitor rebooted the production VM **51 times over 32 hours** without ever addressing
the actual cause. See `docs/troubleshooting.md`.

Notifications for non-restart failures are rate limited to one every
`alertCooldownHours` (default 12) per failure type, so a persistent problem does not
generate a mail every 5 minutes.

## Certificate Expiry Monitoring

At every run the monitor reads the TLS certificate of each HTTPS endpoint and sends a
notification when one expires within `certWarnDays` (default 21). This surfaces a
pending expiry weeks before it can break anything.

## Configuration

Create a `config.json` file with your monitoring settings:

```json
{
  "instanceName": "your-lightsail-instance-name",
  "region": "us-east-1",
  "endpoints": [
    {
      "url": "https://your-website.com",
      "name": "Main Website",
      "timeout": 10000
    }
  ],
  "failureThreshold": 3,
  "checkInterval": 5,
  "notificationEmail": "your-email@example.com"
}
```

### Configuration Options

- `instanceName`: Name of your Lightsail instance
- `region`: AWS region where your instance is located
- `endpoints`: Array of websites to monitor
- `failureThreshold`: Number of consecutive failures before restart (default: 3)
- `checkInterval`: Minutes between checks (default: 5)
- `notificationEmail`: Email for alerts (optional)
- `costAllocationTag`: Tag value for cost tracking (default: 'lightsail-monitor')
- `customTags`: Additional tags to apply to all resources

## Development

### Project Structure

```
aws-lightsail-monitor/
├── src/
│   ├── handlers/
│   │   └── monitor.js      # Main Lambda handler
│   ├── services/
│   │   ├── healthCheck.js  # Health check logic
│   │   ├── lightsail.js    # Lightsail API interactions
│   │   └── state.js        # State management
│   └── utils/
│       └── logger.js       # Logging utilities
├── tests/
│   └── unit/               # Unit tests
├── template.yaml           # SAM template
├── config/
│   └── config.example.json # Example configuration
└── package.json
```

### Running Tests

```bash
npm test
```

### Local Testing

```bash
npm run test:local
```

## Deployment

### Using AWS SAM

```bash
sam build
sam deploy --guided
```

### Manual Deployment

See [deployment guide](docs/deployment.md) for detailed instructions.

## Monitoring and Logs

View Lambda logs:
```bash
aws logs tail /aws/lambda/lightsail-monitor --follow
```

Check DynamoDB state:
```bash
aws dynamodb scan --table-name lightsail-monitor-state
```

## Cost Estimation

Based on typical usage (checks every 5 minutes):
- Lambda: ~$0.20/month
- DynamoDB: ~$0.25/month
- CloudWatch Logs: ~$0.50/month
- **Total: Less than $1/month**

### Cost Tracking

All resources are tagged with a `CostCenter` tag for easy cost allocation:

```bash
# Check costs for your monitor
./check-costs.sh
```

To enable cost tracking:
1. Go to AWS Billing Console → Cost Allocation Tags
2. Activate the 'CostCenter' tag
3. Wait 24 hours for data to appear

## Uninstalling

To completely remove the monitor and all its resources:

```bash
./uninstall.sh
```

This will:
- Delete the CloudFormation stack
- Remove all Lambda functions, DynamoDB tables, and CloudWatch resources
- Clean up SNS topics and subscriptions
- **Your Lightsail instance will NOT be affected**

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure your Lambda has permissions to restart Lightsail instances
2. **Timeout Issues**: Increase Lambda timeout if health checks take longer
3. **False Positives**: Adjust timeout and retry settings for unreliable connections

See [troubleshooting guide](docs/troubleshooting.md) for more details.

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) before submitting PRs.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with AWS Lambda, DynamoDB, and Lightsail
- Inspired by the need for simple, cost-effective monitoring solutions

## Support

- Create an issue for bug reports or feature requests
- Check [existing issues](https://github.com/yourusername/aws-lightsail-monitor/issues) before creating new ones