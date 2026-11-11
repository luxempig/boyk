#!/bin/bash
# =============================================================================
# Setup: Wikidata Cache Infrastructure (S3 + Lambda + EventBridge)
# =============================================================================
#
# Creates:
#   1. S3 bucket for cache storage
#   2. Lambda function for weekly cache refresh
#   3. EventBridge rule (every Sunday 3am UTC)
#   4. IAM role with minimal permissions
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - Python 3.12 runtime available in your region
#
# Usage:
#   chmod +x setup_cache_infra.sh
#   ./setup_cache_infra.sh my-boyk-data us-east-1

set -euo pipefail

BUCKET="${1:?Usage: $0 <bucket-name> [region]}"
REGION="${2:-us-east-1}"
FUNCTION_NAME="boyk-wikidata-cache-refresh"
RULE_NAME="boyk-weekly-wikidata-refresh"
ROLE_NAME="boyk-lambda-cache-role"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "============================================"
echo "Boyk Wikidata Cache Infrastructure Setup"
echo "  Bucket:   $BUCKET"
echo "  Region:   $REGION"
echo "  Account:  $ACCOUNT_ID"
echo "============================================"

# ---- 1. S3 Bucket ----
echo ""
echo "[1/5] Creating S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    echo "  Bucket already exists."
else
    if [ "$REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
    else
        aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION"
    fi
    echo "  Created s3://$BUCKET"
fi

# Enable versioning (safety net for cache overwrites)
aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
echo "  Versioning enabled."

# Lifecycle: delete old versions after 30 days
cat > /tmp/lifecycle.json <<EOF
{
  "Rules": [
    {
      "ID": "cleanup-old-cache-versions",
      "Status": "Enabled",
      "Filter": {"Prefix": "wikidata-cache/"},
      "NoncurrentVersionExpiration": {"NoncurrentDays": 30}
    }
  ]
}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
    --lifecycle-configuration file:///tmp/lifecycle.json
echo "  Lifecycle: old versions expire after 30 days."

# ---- 2. IAM Role ----
echo ""
echo "[2/5] Creating IAM role..."

cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

if aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null; then
    echo "  Role already exists."
else
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --description "Lambda role for Wikidata cache refresh" \
        > /dev/null
    echo "  Created role: $ROLE_NAME"
fi

# Attach policies
cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::$BUCKET/wikidata-cache/*"
  }]
}
EOF

aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "s3-cache-access" \
    --policy-document file:///tmp/s3-policy.json

aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "  Policies attached."

# Wait for role propagation
echo "  Waiting for IAM role propagation..."
sleep 10

# ---- 3. Lambda Function ----
echo ""
echo "[3/5] Packaging and deploying Lambda..."

# Create deployment package
DEPLOY_DIR=$(mktemp -d)
cp lambda_cache_refresh.py "$DEPLOY_DIR/lambda_function.py"

# Bundle requests library
pip install requests -t "$DEPLOY_DIR" --quiet --no-deps 2>/dev/null || \
    pip install requests -t "$DEPLOY_DIR" --quiet --break-system-packages --no-deps

cd "$DEPLOY_DIR"
zip -r9 /tmp/lambda-cache.zip . > /dev/null
cd -

# Create or update function
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb:///tmp/lambda-cache.zip \
        --region "$REGION" > /dev/null
    echo "  Updated existing function."

    # Update config
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --timeout 900 \
        --memory-size 512 \
        --environment "Variables={CACHE_BUCKET=$BUCKET}" \
        --region "$REGION" > /dev/null
else
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime python3.12 \
        --handler lambda_function.lambda_handler \
        --role "$ROLE_ARN" \
        --zip-file fileb:///tmp/lambda-cache.zip \
        --timeout 900 \
        --memory-size 512 \
        --environment "Variables={CACHE_BUCKET=$BUCKET}" \
        --region "$REGION" > /dev/null
    echo "  Created function: $FUNCTION_NAME"
fi

LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# ---- 4. EventBridge Schedule ----
echo ""
echo "[4/5] Creating weekly EventBridge rule..."

# Every Sunday at 3:00 AM UTC
aws events put-rule \
    --name "$RULE_NAME" \
    --schedule-expression "cron(0 3 ? * SUN *)" \
    --description "Weekly Wikidata cache refresh for Boyk" \
    --region "$REGION" > /dev/null

aws events put-targets \
    --rule "$RULE_NAME" \
    --targets "Id=lambda-target,Arn=$LAMBDA_ARN" \
    --region "$REGION" > /dev/null

# Permission for EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "eventbridge-weekly" \
    --action "lambda:InvokeFunction" \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE_NAME}" \
    --region "$REGION" 2>/dev/null || true

echo "  Scheduled: Every Sunday 3:00 AM UTC"

# ---- 5. Initial cache build ----
echo ""
echo "[5/5] Running initial cache build..."
echo "  (This will take 5-10 minutes as it queries Wikidata)"
echo ""

aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --invocation-type Event \
    --region "$REGION" \
    /tmp/lambda-invoke-response.json > /dev/null

echo "  Lambda invoked asynchronously."
echo "  Monitor: aws logs tail /aws/lambda/$FUNCTION_NAME --follow"

# ---- Summary ----
echo ""
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "S3 cache:     s3://$BUCKET/wikidata-cache/"
echo "Lambda:       $FUNCTION_NAME"
echo "Schedule:     Every Sunday 3:00 AM UTC"
echo "Logs:         aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
echo ""
echo "Run ETL with cached data:"
echo "  python etl_gleif_wikidata_v3.py --run --cache-bucket $BUCKET"
echo ""
echo "Manual cache refresh:"
echo "  python wikidata_cache_builder.py --bucket $BUCKET"
echo ""
echo "Check cache status:"
echo "  aws s3 cp s3://$BUCKET/wikidata-cache/manifest.json - | python -m json.tool"
