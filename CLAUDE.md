# PolySim engineering instructions

## AWS cost policy

- Cost is the highest-priority requirement for this low-priority application and outweighs uptime or availability. Minimize fixed and usage costs, and avoid observability unit-cost overhead unless confirmed.
- Never add CloudWatch alarms or detailed metrics, SNS, WAF, Shield Advanced, NAT gateways, provisioned databases or DynamoDB capacity, cross-region replicas, AWS Backup, DynamoDB PITR, ALBs, RDS, OpenSearch, or similar paid/fixed-cost AWS services without asking the user to confirm the service and its estimated cost.
- Do not re-enable WAF or managed WAF rule groups.
- PITR, AWS Backup, CloudWatch alarms, SNS alerting and API Gateway detailed metrics are intentionally omitted and must remain omitted unless the user explicitly approves them.
- Prefer usage-based serverless resources already used by PolySim and report cheaper alternatives before fixed-cost alternatives.
- Before infrastructure changes, run focused CDK tests and synthesize. Verify no `AWS::WAFv2::WebACL`, `AWS::Backup::BackupPlan`, or `AWS::Backup::BackupVault` resource appears unless explicitly approved.

## Architecture

- `us-east-1`: ACM certificate and CloudFront certificate edge resources.
- `us-east-2`: API Gateway HTTP API, Lambda handlers, on-demand DynamoDB tables and short-retention logs.
- Frontend: private S3 origin with CloudFront, Route 53 aliases, OAC and same-origin `/api/*` forwarding.
- Authentication: Google OIDC and organization-domain checks with server-side opaque sessions.
- Keep API responses uncached, static assets private, IAM least-privilege and security headers enabled.
