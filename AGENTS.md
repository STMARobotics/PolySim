# PolySim agent instructions

Cost minimization is a high-priority product requirement. Before proposing or implementing an AWS resource that may have fixed cost, recurring fees, commitments, or significant usage charges, explain the cheaper alternatives and ask the user to confirm. This confirmation requirement includes WAF, Shield Advanced, NAT gateways, load balancers, provisioned databases, provisioned DynamoDB, cross-region replicas, AWS Backup, DynamoDB PITR, RDS, OpenSearch, and managed paid services.

Never re-enable WAF or AWS managed WAF rule groups. DynamoDB Point-in-Time Recovery and AWS Backup are intentionally disabled. Do not enable or add backup infrastructure unless the user explicitly requests and confirms it.

Basic architecture:

- `us-east-1`: ACM certificate for CloudFront.
- `us-east-2`: HTTP API Gateway, auth/robots/seasons Lambda functions, two on-demand DynamoDB tables, CloudWatch logs/alarms and SNS.
- Frontend: private versioned S3 bucket, CloudFront distribution, OAC, Route 53 aliases and same-origin API behavior.
- Authentication: Google OIDC with organization-domain checks and server-side opaque sessions.

Before infrastructure edits, add or update a focused assertion, run `npm run test:infra`, and run `npm run cdk:synth`. Confirm synthesized templates contain no unintended WAF or AWS Backup resources. Preserve private S3, no-store API responses, least-privilege IAM and security headers.
