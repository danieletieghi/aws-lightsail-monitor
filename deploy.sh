#!/bin/bash

set -e

echo "AWS Lightsail Monitor - Deployment Script"
echo "========================================="

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "Error: AWS SAM CLI is not installed. Please install it first."
    exit 1
fi

# Check if config file exists
if [ ! -f "config/config.json" ]; then
    echo "Error: config/config.json not found. Please copy config/config.example.json and customize it."
    exit 1
fi

# Read configuration
CONFIG=$(cat config/config.json)
INSTANCE_NAME=$(echo $CONFIG | jq -r '.instanceName')
REGION=$(echo $CONFIG | jq -r '.region')
ENDPOINTS=$(echo $CONFIG | jq -c '.endpoints')
FAILURE_THRESHOLD=$(echo $CONFIG | jq -r '.failureThreshold // 3')
CHECK_INTERVAL=$(echo $CONFIG | jq -r '.checkInterval // 5')
COOLDOWN_MINUTES=$(echo $CONFIG | jq -r '.cooldownMinutes // 30')
CERT_WARN_DAYS=$(echo $CONFIG | jq -r '.certWarnDays // 21')
ALERT_COOLDOWN_HOURS=$(echo $CONFIG | jq -r '.alertCooldownHours // 12')
NOTIFICATION_EMAIL=$(echo $CONFIG | jq -r '.notificationEmail // empty')
LOG_LEVEL=$(echo $CONFIG | jq -r '.logLevel // "info"')
COST_ALLOCATION_TAG=$(echo $CONFIG | jq -r '.costAllocationTag // "lightsail-monitor"')
CUSTOM_TAGS=$(echo $CONFIG | jq -c '.customTags // {}')

# Stack name - sanitize instance name (replace underscores and other invalid chars with hyphens)
SANITIZED_INSTANCE_NAME=$(echo "$INSTANCE_NAME" | sed 's/[^a-zA-Z0-9-]/-/g' | sed 's/--*/-/g')
STACK_NAME="lightsail-monitor-${SANITIZED_INSTANCE_NAME}"

echo ""
echo "Configuration:"
echo "  Instance Name: $INSTANCE_NAME"
echo "  Region: $REGION"
echo "  Failure Threshold: $FAILURE_THRESHOLD"
echo "  Check Interval: ${CHECK_INTERVAL} minutes"
echo "  Cost Allocation Tag: $COST_ALLOCATION_TAG"
echo "  Stack Name: $STACK_NAME"
echo "  Original Instance Name: $INSTANCE_NAME"
echo ""

# Install dependencies
echo "Installing dependencies..."
cd src && npm install --production && cd ..

# Build the application
echo "Building application..."
sam build

# Deploy the application
echo "Deploying to AWS..."

# Create a unique S3 bucket name for deployment artifacts
S3_BUCKET="lightsail-monitor-deploy-${REGION}-$(echo -n "${INSTANCE_NAME}" | md5sum | cut -c1-8)"

# Check if bucket exists, create if not
if ! aws s3 ls "s3://${S3_BUCKET}" --region "$REGION" 2>/dev/null; then
    echo "Creating S3 bucket: ${S3_BUCKET}"
    if [ "$REGION" = "us-east-1" ]; then
        aws s3 mb "s3://${S3_BUCKET}" --region "$REGION"
    else
        aws s3api create-bucket \
            --bucket "${S3_BUCKET}" \
            --region "$REGION" \
            --create-bucket-configuration "LocationConstraint=$REGION"
    fi
    
    # Enable versioning on the bucket
    aws s3api put-bucket-versioning \
        --bucket "${S3_BUCKET}" \
        --versioning-configuration Status=Enabled \
        --region "$REGION"
    
    # Add tags to the bucket
    echo "Adding tags to S3 bucket..."
    aws s3api put-bucket-tagging \
        --bucket "${S3_BUCKET}" \
        --tagging "TagSet=[{Key=Application,Value=${STACK_NAME}},{Key=CostCenter,Value=${COST_ALLOCATION_TAG}},{Key=ManagedBy,Value=lightsail-monitor}]" \
        --region "$REGION"
fi

# Create parameters string - use printf to handle special characters properly
PARAMS=""
PARAMS="$PARAMS InstanceName=\"$INSTANCE_NAME\""
PARAMS="$PARAMS FailureThreshold=\"$FAILURE_THRESHOLD\""
PARAMS="$PARAMS CheckInterval=\"$CHECK_INTERVAL\""
PARAMS="$PARAMS CooldownMinutes=\"$COOLDOWN_MINUTES\""
PARAMS="$PARAMS CertWarnDays=\"$CERT_WARN_DAYS\""
PARAMS="$PARAMS AlertCooldownHours=\"$ALERT_COOLDOWN_HOURS\""
PARAMS="$PARAMS NotificationEmail=\"$NOTIFICATION_EMAIL\""
PARAMS="$PARAMS LogLevel=\"$LOG_LEVEL\""
PARAMS="$PARAMS CostAllocationTag=\"$COST_ALLOCATION_TAG\""

# For JSON parameters, write to temp file and read back to avoid shell escaping issues
echo "$ENDPOINTS" > /tmp/endpoints.json
echo "$CUSTOM_TAGS" > /tmp/customtags.json

ENDPOINTS_PARAM=$(cat /tmp/endpoints.json | jq -c .)
CUSTOM_TAGS_PARAM=$(cat /tmp/customtags.json | jq -c .)

# Deploy with explicit parameter string
sam deploy \
    --stack-name "$STACK_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --s3-prefix "$STACK_NAME" \
    --region "$REGION" \
    --parameter-overrides $PARAMS \
        Endpoints="'$ENDPOINTS_PARAM'" \
        CustomTags="'$CUSTOM_TAGS_PARAM'" \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

# Cleanup temp files
rm -f /tmp/endpoints.json /tmp/customtags.json

echo ""
echo "Deployment complete!"
echo ""
echo "To view logs:"
echo "  sam logs -n MonitorFunction --stack-name $STACK_NAME --tail"
echo ""
echo "To delete the stack:"
echo "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION"