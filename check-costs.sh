#!/bin/bash

set -e

echo "AWS Lightsail Monitor - Cost Check"
echo "=================================="
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Get configuration
if [ -f "config/config.json" ]; then
    CONFIG=$(cat config/config.json)
    COST_TAG=$(echo $CONFIG | jq -r '.costAllocationTag // "lightsail-monitor"')
    REGION=$(echo $CONFIG | jq -r '.region // "us-east-1"')
else
    COST_TAG=${1:-"lightsail-monitor"}
    REGION=${2:-"us-east-1"}
fi

echo "Checking costs for tag: CostCenter=$COST_TAG"
echo "Region: $REGION"
echo ""

# Get current date and 30 days ago
END_DATE=$(date +%Y-%m-%d)
START_DATE=$(date -d "30 days ago" +%Y-%m-%d 2>/dev/null || date -v-30d +%Y-%m-%d)

echo "Period: $START_DATE to $END_DATE"
echo ""

# Query costs using Cost Explorer
echo "Fetching cost data..."
COSTS=$(aws ce get-cost-and-usage \
    --time-period Start=$START_DATE,End=$END_DATE \
    --granularity MONTHLY \
    --metrics UnblendedCost \
    --filter '{
        "Tags": {
            "Key": "CostCenter",
            "Values": ["'$COST_TAG'"]
        }
    }' \
    --group-by Type=DIMENSION,Key=SERVICE \
    --region us-east-1 \
    2>/dev/null || echo "FAILED")

if [ "$COSTS" == "FAILED" ]; then
    echo "⚠️  Unable to fetch cost data. This might be because:"
    echo "  - Cost Explorer API is not enabled for your account"
    echo "  - You don't have permissions to access Cost Explorer"
    echo "  - The cost allocation tag is not activated"
    echo ""
    echo "To activate cost allocation tags:"
    echo "1. Go to AWS Billing Console"
    echo "2. Navigate to Cost Allocation Tags"
    echo "3. Activate the 'CostCenter' tag"
    echo "4. Wait 24 hours for data to appear"
    echo ""
else
    echo "Cost breakdown by service:"
    echo "$COSTS" | jq -r '
        .ResultsByTime[].Groups[] | 
        select(.Metrics.UnblendedCost.Amount != "0") |
        "\(.Keys[0]): $\(.Metrics.UnblendedCost.Amount) \(.Metrics.UnblendedCost.Unit)"
    ' 2>/dev/null || echo "No cost data available yet"
    
    echo ""
    echo "Total monthly cost:"
    echo "$COSTS" | jq -r '
        .ResultsByTime[].Total.UnblendedCost |
        "$\(.Amount) \(.Unit)"
    ' 2>/dev/null || echo "No cost data available yet"
fi

echo ""
echo "Estimated monthly costs (based on usage):"
echo "  - Lambda: ~$0.20 (8,640 invocations @ 256MB)"
echo "  - DynamoDB: ~$0.25 (on-demand, minimal usage)"
echo "  - CloudWatch Logs: ~$0.50 (7-day retention)"
echo "  - SNS: ~$0.00 (free tier covers email notifications)"
echo "  - Total: ~$0.95/month"
echo ""

# Show current resource usage
echo "Current resource usage:"

# Lambda invocations
LAMBDA_NAME="lightsail-monitor-*"
echo -n "  Lambda invocations (last 24h): "
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
    --statistics Sum \
    --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-24H +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 86400 \
    --region $REGION \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "N/A"

# DynamoDB consumed capacity
echo "  DynamoDB: Pay-per-request mode (no reserved capacity)"

echo ""
echo "💡 Tips to minimize costs:"
echo "  - Increase check interval if 5 minutes is too frequent"
echo "  - Reduce CloudWatch Logs retention period"
echo "  - Use fewer endpoints to monitor"
echo ""