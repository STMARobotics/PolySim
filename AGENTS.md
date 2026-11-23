# PolySim agent instructions

Cost minimization is the highest-priority product requirement and is more important than uptime or availability for this low-priority application. Before proposing or implementing an AWS resource that may have fixed cost, recurring fees, commitments, significant usage charges, or observable unit-cost overhead, explain the cheaper or serverless alternatives and ask the user to confirm. This confirmation requirement includes CloudWatch alarms and metrics, SNS, WAF, Shield Advanced, NAT gateways, load balancers, provisioned databases, provisioned DynamoDB, cross-region replicas, AWS Backup, DynamoDB PITR, RDS, OpenSearch, and managed paid services.

Never re-enable WAF or AWS managed WAF rule groups. DynamoDB Point-in-Time Recovery, AWS Backup, CloudWatch alarms, SNS alerting and API Gateway detailed metrics are intentionally disabled or omitted. Do not enable backup or observability infrastructure unless the user explicitly requests and confirms it.

Basic architecture:

- `us-east-1`: ACM certificate for CloudFront.
- `us-east-2`: HTTP API Gateway, auth/robots/seasons Lambda functions, two on-demand DynamoDB tables and short-retention CloudWatch logs.
- Frontend: private versioned S3 bucket, CloudFront distribution, OAC, Route 53 aliases and same-origin API behavior.
- Authentication: Google OIDC with organization-domain checks and server-side opaque sessions.

Before infrastructure edits, add or update a focused assertion, run `npm run test:infra`, and run `npm run cdk:synth`. Confirm synthesized templates contain no unintended WAF or AWS Backup resources. Preserve private S3, no-store API responses, least-privilege IAM and security headers.
