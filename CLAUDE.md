# PolySim engineering instructions

## AWS cost policy

- Minimize AWS cost and fixed monthly charges; this is a high-priority requirement.
- Never add WAF, Shield Advanced, NAT Gateways, provisioned databases or DynamoDB capacity, cross-region replicas, AWS Backup, DynamoDB PITR, ALBs, RDS, OpenSearch, or similar paid/fixed-cost AWS services without asking the user to confirm the service and its estimated cost.
- Do not re-enable WAF or managed WAF rule groups.
- PITR and AWS Backup are intentionally disabled and must remain disabled unless the user explicitly approves them.
- Prefer usage-based serverless resources already used by PolySim and report cheaper alternatives before fixed-cost alternatives.
- Before infrastructure changes, run focused CDK tests and synthesize. Verify no `AWS::WAFv2::WebACL`, `AWS::Backup::BackupPlan`, or `AWS::Backup::BackupVault` resource appears unless explicitly approved.

## Architecture

- `us-east-1`: ACM certificate and CloudFront certificate edge resources.
- `us-east-2`: API Gateway HTTP API, Lambda handlers, on-demand DynamoDB tables, logs, alarms and SNS.
- Frontend: private S3 origin with CloudFront, Route 53 aliases, OAC and same-origin `/api/*` forwarding.
- Authentication: Google OIDC and organization-domain checks with server-side opaque sessions.
- Keep API responses uncached, static assets private, IAM least-privilege and security headers enabled.
