#!/bin/bash

set -e

echo "AWS Lightsail Monitor - Uninstall Script"
echo "========================================"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if config file exists
if [ ! -f "config/config.json" ]; then
    echo "Error: config/config.json not found."
    echo "Please provide the instance name or create the config file."
    echo ""
    echo "Usage: ./uninstall.sh [instance-name]"
    exit 1
fi

# Get instance name from config or command line
if [ $# -eq 1 ]; then
    INSTANCE_NAME=$1
    echo "Using instance name from command line: $INSTANCE_NAME"
else
    CONFIG=$(cat config/config.json)
    INSTANCE_NAME=$(echo $CONFIG | jq -r '.instanceName')
    echo "Using instance name from config: $INSTANCE_NAME"
fi

REGION=$(echo $CONFIG | jq -r '.region // "us-east-1"')
# Sanitize instance name to match deployment script
SANITIZED_INSTANCE_NAME=$(echo "$INSTANCE_NAME" | sed 's/[^a-zA-Z0-9-]/-/g' | sed 's/--*/-/g')
STACK_NAME="lightsail-monitor-${SANITIZED_INSTANCE_NAME}"

echo ""
echo "This will remove the following:"
echo "  - CloudFormation Stack: $STACK_NAME"
echo "  - Lambda Function: ${STACK_NAME}-monitor"
echo "  - DynamoDB Table: ${STACK_NAME}-state"
echo "  - SNS Topic: ${STACK_NAME}-notifications (if exists)"
echo "  - CloudWatch Logs: /aws/lambda/${STACK_NAME}-monitor"
echo "  - CloudWatch Alarms and Events"
echo "  - S3 Deployment Bucket: lightsail-monitor-deploy-${REGION}-$(echo -n "${INSTANCE_NAME}" | md5sum | cut -c1-8)"
echo ""
echo "Region: $REGION"
echo ""

# Confirmation
read -p "Are you sure you want to uninstall? This cannot be undone. (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo ""
echo "Starting uninstall process..."

# Check if stack exists
STACK_EXISTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STACK_EXISTS" == "DOES_NOT_EXIST" ]; then
    echo "Stack $STACK_NAME does not exist in region $REGION"
    exit 0
fi

echo "Found stack with status: $STACK_EXISTS"

# Delete the CloudFormation stack
echo "Deleting CloudFormation stack..."
aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$REGION"

# Wait for stack deletion
echo "Waiting for stack deletion to complete..."
echo "This may take a few minutes..."

WAIT_TIME=0
MAX_WAIT=600  # 10 minutes

while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "DELETE_COMPLETE")
    
    if [ "$STACK_STATUS" == "DELETE_COMPLETE" ]; then
        echo ""
        echo "✅ Stack deletion completed successfully!"
        break
    elif [ "$STACK_STATUS" == "DELETE_FAILED" ]; then
        echo ""
        echo "❌ Stack deletion failed!"
        echo "Please check the CloudFormation console for error details."
        echo "You may need to manually delete some resources."
        exit 1
    else
        echo -n "."
        sleep 10
        WAIT_TIME=$((WAIT_TIME + 10))
    fi
done

if [ $WAIT_TIME -ge $MAX_WAIT ]; then
    echo ""
    echo "⚠️  Deletion is taking longer than expected."
    echo "Please check the CloudFormation console for status."
    echo "Stack name: $STACK_NAME"
    exit 1
fi

# Clean up any remaining CloudWatch Logs (sometimes they persist)
echo ""
echo "Cleaning up CloudWatch Logs..."
aws logs delete-log-group \
    --log-group-name "/aws/lambda/${STACK_NAME}-monitor" \
    --region "$REGION" 2>/dev/null || true

# Clean up S3 deployment bucket
echo "Cleaning up S3 deployment bucket..."
S3_BUCKET="lightsail-monitor-deploy-${REGION}-$(echo -n "${INSTANCE_NAME}" | md5sum | cut -c1-8)"
if aws s3 ls "s3://${S3_BUCKET}" --region "$REGION" 2>/dev/null; then
    echo "Removing S3 bucket: ${S3_BUCKET}"
    # First, delete all objects and versions
    aws s3 rm "s3://${S3_BUCKET}" --recursive --region "$REGION" 2>/dev/null || true
    
    # Delete all object versions (for versioned buckets)
    aws s3api list-object-versions --bucket "${S3_BUCKET}" --region "$REGION" --output json 2>/dev/null | \
    jq -r '.Versions[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
    while read -r line; do
        eval aws s3api delete-object --bucket "${S3_BUCKET}" --region "$REGION" $line 2>/dev/null || true
    done
    
    # Delete all delete markers
    aws s3api list-object-versions --bucket "${S3_BUCKET}" --region "$REGION" --output json 2>/dev/null | \
    jq -r '.DeleteMarkers[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
    while read -r line; do
        eval aws s3api delete-object --bucket "${S3_BUCKET}" --region "$REGION" $line 2>/dev/null || true
    done
    
    # Now delete the bucket
    aws s3 rb "s3://${S3_BUCKET}" --region "$REGION" 2>/dev/null || true
fi

echo ""
echo "🎉 Uninstall completed successfully!"
echo ""
echo "The following have been removed:"
echo "  ✅ Lambda function and associated IAM role"
echo "  ✅ DynamoDB state table"
echo "  ✅ CloudWatch Events rule"
echo "  ✅ CloudWatch Alarms"
echo "  ✅ SNS Topic and subscriptions (if configured)"
echo "  ✅ CloudWatch Logs"
echo "  ✅ S3 deployment bucket and all artifacts"
echo ""
echo "Your Lightsail instance was NOT affected by this uninstall."
echo ""

# Optional: Remove local config
read -p "Do you want to remove the local config file? (y/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f config/config.json
    echo "Local config file removed."
fi

echo "Done!"