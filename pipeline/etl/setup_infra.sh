#!/bin/bash
# Boyk ETL — AWS Infrastructure Setup
# Creates S3 bucket, Lambda function, EventBridge schedule, and Secrets Manager entries.
# Prerequisites: AWS CLI configured, Docker (for Lambda container image)

set -euo pipefail

S3_BUCKET="boyk-etl-staging"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
LAMBDA_FUNCTION="boyk-etl-pipeline"
SCHEDULE_NAME="boyk-etl-daily"

echo "=== Boyk ETL Infrastructure Setup ==="

# 1. Create S3 staging bucket
echo "[1/5] Creating S3 bucket..."
aws s3 mb "s3://${S3_BUCKET}" --region "${REGION}" 2>/dev/null || echo "Bucket already exists"

# 2. Create Secrets Manager entries
echo "[2/5] Setting up secrets..."
for secret_name in "boyk/neo4j-uri" "boyk/neo4j-password" "boyk/opensecrets-api-key" "boyk/followthemoney-api-key" "boyk/open-supply-hub-api-key"; do
    aws secretsmanager describe-secret --secret-id "${secret_name}" --region "${REGION}" 2>/dev/null || \
        aws secretsmanager create-secret --name "${secret_name}" --secret-string "PLACEHOLDER" --region "${REGION}"
done
echo "  Remember to update secret values in AWS Secrets Manager console!"

# 3. Create IAM role for Lambda
echo "[3/5] Creating IAM role..."
TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}'

ROLE_ARN=$(aws iam create-role \
    --role-name "${LAMBDA_FUNCTION}-role" \
    --assume-role-policy-document "${TRUST_POLICY}" \
    --query 'Role.Arn' --output text 2>/dev/null || \
    aws iam get-role --role-name "${LAMBDA_FUNCTION}-role" --query 'Role.Arn' --output text)

# Attach policies
aws iam attach-role-policy --role-name "${LAMBDA_FUNCTION}-role" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>/dev/null || true

# Custom policy for S3 + Secrets Manager
POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::'"${S3_BUCKET}"'", "arn:aws:s3:::'"${S3_BUCKET}"'/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:boyk/*"
    }
  ]
}'
aws iam put-role-policy --role-name "${LAMBDA_FUNCTION}-role" \
    --policy-name "${LAMBDA_FUNCTION}-policy" \
    --policy-document "${POLICY}"

echo "  IAM role: ${ROLE_ARN}"

# 4. Package and create Lambda function
echo "[4/5] Packaging Lambda function..."
cd "$(dirname "$0")"
rm -rf /tmp/boyk-lambda-pkg
mkdir -p /tmp/boyk-lambda-pkg
pip install -r requirements.txt -t /tmp/boyk-lambda-pkg --quiet
cp -r *.py enrichment/ /tmp/boyk-lambda-pkg/
cd /tmp/boyk-lambda-pkg && zip -r /tmp/boyk-etl.zip . -x '__pycache__/*' '*.pyc' > /dev/null

# Wait for role propagation
sleep 10

aws lambda create-function \
    --function-name "${LAMBDA_FUNCTION}" \
    --runtime "python3.12" \
    --role "${ROLE_ARN}" \
    --handler "lambda_handler.handler" \
    --zip-file "fileb:///tmp/boyk-etl.zip" \
    --timeout 900 \
    --memory-size 1024 \
    --environment "Variables={S3_BUCKET=${S3_BUCKET},NEO4J_URI=PLACEHOLDER,NEO4J_PASSWORD=PLACEHOLDER}" \
    --region "${REGION}" 2>/dev/null || \
    aws lambda update-function-code \
        --function-name "${LAMBDA_FUNCTION}" \
        --zip-file "fileb:///tmp/boyk-etl.zip" \
        --region "${REGION}"

echo "  Lambda function: ${LAMBDA_FUNCTION}"

# 5. Create EventBridge schedule (daily at 3 AM UTC)
echo "[5/5] Creating EventBridge schedule..."
LAMBDA_ARN=$(aws lambda get-function --function-name "${LAMBDA_FUNCTION}" --query 'Configuration.FunctionArn' --output text)

aws events put-rule \
    --name "${SCHEDULE_NAME}" \
    --schedule-expression "cron(0 3 * * ? *)" \
    --state "ENABLED" \
    --region "${REGION}" 2>/dev/null || true

aws events put-targets \
    --rule "${SCHEDULE_NAME}" \
    --targets "Id=1,Arn=${LAMBDA_ARN},Input={\"stage\":\"all\"}" \
    --region "${REGION}" 2>/dev/null || true

# Allow EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name "${LAMBDA_FUNCTION}" \
    --statement-id "eventbridge-daily" \
    --action "lambda:InvokeFunction" \
    --principal "events.amazonaws.com" \
    --source-arn "$(aws events describe-rule --name "${SCHEDULE_NAME}" --query 'Arn' --output text)" \
    --region "${REGION}" 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Update secrets in AWS Secrets Manager:"
echo "     - boyk/neo4j-uri       → your AuraDB bolt:// URI"
echo "     - boyk/neo4j-password  → your AuraDB password"
echo "     - boyk/opensecrets-api-key"
echo "     - boyk/followthemoney-api-key"
echo "     - boyk/open-supply-hub-api-key"
echo ""
echo "  2. Update Lambda environment variables:"
echo "     aws lambda update-function-configuration \\"
echo "       --function-name ${LAMBDA_FUNCTION} \\"
echo "       --environment 'Variables={NEO4J_URI=bolt+s://xxx.databases.neo4j.io:7687,NEO4J_PASSWORD=xxx}'"
echo ""
echo "  3. Test with: aws lambda invoke --function-name ${LAMBDA_FUNCTION} --payload '{\"stages\":[1,2]}' /dev/stdout"
