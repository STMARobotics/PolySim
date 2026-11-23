# PolySim engineering instructions

## AWS cost policy

- Cost is the highest-priority requirement for this low-priority application and outweighs uptime or availability. Minimize fixed and usage costs, and avoid observability unit-cost overhead unless confirmed.
- Do not add CloudWatch alarms or detailed metrics, SNS, WAF, AWS Shield Advanced, NAT Gateways, provisioned databases, provisioned DynamoDB capacity, cross-region replicas, AWS Backup plans, DynamoDB PITR, ALBs, RDS, OpenSearch, or any other paid/fixed-cost AWS service without first asking the user to confirm the service and estimated cost.
- Prefer serverless, usage-based services already in this repository: CloudFront, S3, API Gateway, Lambda, DynamoDB on-demand, and AWS-managed secrets/logging.
- Do not re-enable CloudFront WAF or managed WAF rule groups.
- DynamoDB PITR and AWS Backup are intentionally disabled. Do not enable either unless explicitly requested and approved.
- When a cost tradeoff exists, show the cheapest working architecture and the most expensive alternative. Keep WAF, NAT, backup products, cross-region resources, and managed paid services out unless confirmed.
- Before changing infrastructure, run the smallest relevant CDK tests and synthesize the templates. Verify with template searches that no unintended `AWS::WAFv2::WebACL`, `AWS::Backup::BackupPlan`, or `AWS::Backup::BackupVault` resources were introduced.

## Architecture

- Certificate stack: ACM certificate in `us-east-1`.
- Frontend stack: private S3 origin, CloudFront, Route 53 records, and same-origin `/api/*` forwarding.
- Backend stack: API Gateway HTTP API in `us-east-2`, focused auth/robots/seasons Lambda functions, and two on-demand DynamoDB tables.
- Authentication: Google OIDC, HttpOnly opaque sessions, server-side authorization, and organization-domain restrictions.
- Persistence: immutable robot revisions and session/OAuth rows; TTL removes expired sessions and state.
- Keep static assets private and API responses uncached. Preserve security headers and least-privilege IAM.
