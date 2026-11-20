# PolySim backend and deployment

## Release status

The backend, authenticated frontend integration and CDK source are implemented. Local tests, browser QA and credential-free synthesis do not establish that a production deployment works. This workspace has no AWS credentials. AWS deployment, the actual shared Google OAuth client redirect registration, a real allowed/disallowed-account login test, DynamoDB integration, alarms and restore verification remain live release gates. Do not call the service production-verified until those checks pass.

The current scope is authentication, developer-published season manifests and team-wide robot CRUD through immutable revisions. All approved domain members can read and edit shared robots. Archive/restore is restricted to explicitly configured Google subject IDs. Scenario persistence, cloud run summaries and large replay artifacts are not implemented; existing run reports remain local. Physics continues in the browser and is never run in Lambda.

## Verified FMEA alignment

Reference: [STMARobotics/fmea-app](https://github.com/STMARobotics/fmea-app), inspected November 19, 2026. Its backend stack and deployment workflow specify the following public values. Google client reuse was explicitly requested by the user.

| Setting | PolySim value |
| --- | --- |
| AWS account | `738044534240` |
| Backend/frontend region | `us-east-2` |
| Certificate and CloudFront WAF region | `us-east-1` |
| Application URL | `https://polysim.7028robotics.com` |
| Route 53 hosted zone | `Z014656337LGZWAE9JKJP` / `7028robotics.com` |
| Google OAuth client | `574028865613-kh9gccmi9ccfqsv7s89rdttf7cc1ohj4.apps.googleusercontent.com` |
| OAuth secret | SSM SecureString `/polysim/google-client-secret`, `us-east-2` |
| Authorized Workspace domain | `stmarobotics.org` |

PolySim does not access FMEA records or share its session cookie. Rotating the shared OAuth secret affects both apps; coordinate that change. The secret is cached by the auth Lambda for at most five minutes. No secret is stored in source, CDK context, frontend configuration or deployment outputs.

## Architecture and access control

Browser → CloudFront (`polysim.7028robotics.com`) → private S3 for static assets; `/api/*` → API Gateway HTTP API → focused auth, robot and season Lambdas. The app UI imports its editor only after `/api/auth/session` succeeds. Static code and bundled practice assets contain no confidential team data; every data request is authorized on the server independently of the UI.

The auth Lambda uses Google OIDC authorization-code flow with S256 PKCE, random state, random nonce and a separate browser-binding cookie. OAuth state is held in DynamoDB under a hash and consumed with a conditional atomic delete. State expires after five minutes and cannot be replayed. Callback redirects are fixed, with no caller-supplied return URL.

Google's library verifies RSA signature, issuer, audience and expiry. The application additionally checks nonce, issued-at time, authorized party when present, nonempty subject, verified email, exact hosted-domain claim and matching email domain. A login hint or email suffix alone never authorizes a user. Rejected accounts receive no session.

The browser stores only `__Host-polysim-session`: Secure, HttpOnly, SameSite=Lax, host-only, path `/`. Session IDs have 256 bits of entropy; DynamoDB stores their SHA-256 hashes. The application enforces an eight-hour absolute expiration on every request even when expired rows remain pending TTL deletion. Logout deletes the session immediately. Auth/data handlers do not cache authorization. Mutations require exact Origin, same-origin fetch metadata when present, and a timing-safe CSRF check. GET session responses expose a session-derived CSRF token, never the raw cookie or Google tokens.

Google Workspace account suspension/domain membership changes are rechecked at the next Google login; existing app sessions can remain valid until their eight-hour expiration unless explicitly revoked in the sessions table. Operational offboarding must revoke active PolySim sessions. Roles are re-derived from the checked-in verified-email allowlist on every request. The initial administrators are `zack.osowski@stmarobotics.org` and `andy.gasser@stmarobotics.org`. Administrator changes require a source review and deployment; no GitHub variable or secret is involved.

User recovery data is namespaced by Google subject. Logout, account changes and observed session expiry clear scoped local drafts, local reports and revision pointers. Other tabs respond to local logout; a periodic session check detects server expiry/revocation. Network outages retain the loaded editor and draft; explicit shared saves report failure. The application does not silently overwrite shared data when reconnecting.

## Persistence and concurrency

Two independent on-demand DynamoDB tables:

- Robot data: `TEAM#stmarobotics.org#ROBOT#{uuid}` / `METADATA` and `REV#{zero-padded-number}`. `GSI1` lists season-scoped active/archived metadata by update time. Revision bodies are never projected into the metadata index.
- Sessions: `SESSION#{sha256}` / `SESSION` and `OAUTH#{state-sha256}` / `STATE`. TTL is cleanup, not an authorization mechanism.

Server schema validation strips unexpected fields, rejects prototype-sensitive identifiers, bounds arrays/strings/numbers and limits documents to 250 KiB of serialized UTF-8. Full stored revision records are capped at 300 KiB, leaving space below DynamoDB's 400 KiB item limit. Structurally safe but non-runnable drafts retain validation issues and `runnable=false`.

Saving a revision uses one transaction: conditional immutable revision insert, conditional current metadata replacement, and conditional idempotency record insert. `expectedRevision` prevents lost updates. The `Idempotency-Key` is scoped to actor and operation; reuse for different content conflicts. Retrying the same request returns its original immutable revision even if newer revisions exist. Idempotency records have a minimum 24-hour retention; TTL cleanup is asynchronous. After that retry window, callers must reload before starting a new save.

List APIs are paginated, at most 50 items per request. Cursors are scoped to the requested partition and team. Listings use an eventually consistent GSI; recently saved robots can take a moment to appear. Current metadata and revision reads are strongly consistent. Archive preserves all revisions. No destructive robot DELETE endpoint exists.

## Implemented API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/auth/start` | Begin Google OIDC |
| GET | `/api/auth/callback` | Verify callback and create session |
| GET | `/api/auth/session` | User, expiration and CSRF token; otherwise 401 |
| POST | `/api/auth/logout` | CSRF-protected revocation |
| GET | `/api/seasons`, `/api/seasons/{id}` | Bundled read-only Practice Lab manifest |
| GET | `/api/robots?seasonId=practice-balls&limit=20&cursor=...` | Shared active library |
| POST | `/api/robots` | Create `{document}` with `Idempotency-Key` |
| GET | `/api/robots/{id}` | Current metadata and document |
| POST | `/api/robots/{id}/revisions` | Save `{document, expectedRevision}` with `Idempotency-Key` |
| GET | `/api/robots/{id}/revisions` | Paginated revision metadata |
| GET | `/api/robots/{id}/revisions/{revision}` | Immutable document |
| PATCH | `/api/robots/{id}/archive` | Admin-only `{archived, expectedRevision}` |

Errors use `{error:{code,message,details?},requestId}`. Payload/schema errors, forbidden actions, missing login, missing records and stale saves have distinct statuses. Unexpected failures return a redacted 503; logs contain request ID and exception type, not request bodies, OAuth codes, Google tokens, cookies or secret values.

## CDK and deployment

The root package contains three stacks: `polysim-certificate`, `polysim-backend`, `polysim-frontend`. Cross-region certificate/WAF references are managed by CDK; no manual certificate ARN copying is needed. None changes FMEA's stacks. The only shared dependency is its existing OAuth SecureString and public OAuth client.

1. In the existing Google OAuth web client, verify/add the exact redirect URI `https://polysim.7028robotics.com/api/auth/callback`. Keep FMEA's redirect URIs intact. Verify the client remains restricted appropriately to the organization. PolySim always applies its own server-side hosted-domain check.
2. Authenticate AWS access to account `738044534240`. Both regions must have the CDK bootstrap resources. If absent, an administrator must review and run `npx cdk bootstrap aws://738044534240/us-east-1 aws://738044534240/us-east-2` using the organization's deployment policies.
3. Run `npm ci`, `npm run verify`, and `node scripts/deployment-preflight.mjs`. Preflight checks account identity and SecureString metadata without fetching/printing the decrypted value. Its caller needs `sts:GetCallerIdentity` and `ssm:GetParameter` for the exact parameter ARN; the deployed auth role separately needs the exact parameter's GetParameter/KMS permissions.
4. Review `npm run cdk:diff`. Then run `npm run cdk:deploy`. CloudFormation creates billable WAF, CloudFront, API, Lambda, DynamoDB, backup, logs and SNS resources.
5. Run `node scripts/smoke-production.mjs https://polysim.7028robotics.com`. It checks public gate headers, 401s for unauthenticated APIs and PKCE login redirect/cookie configuration. It does not perform a Google login or verify the authorized redirect registration.
6. Complete the real-user release checks below and subscribe the operations team to the SNS topic emitted in the backend outputs. Verify delivery with an approved test notification before opening access.

The single `.github/workflows/deploy.yml` workflow matches FMEA's triggers and gates: pushes to every branch and pull requests run validation, pull requests configure the read-only `GitHubAction-PullRequestRole` and run `cdk diff`, and only pushes to `main` build/test/synthesize and deploy with `GitHubAction-AssumeRoleWithAction`. Both role ARNs are checked into the workflow; there are no GitHub repository variables, secrets, or action commit SHA pins. Deployment is automatic only for `main`; branch builds never receive the deployment role. Add AWS IAM trust/policy for the two existing FMEA OIDC roles only if they are not already authorized for `STMARobotics/PolySim`.

The public API has no CORS policy because frontend and API share one origin through CloudFront. API/auth responses use no-store and CloudFront caching is disabled. A private S3 origin uses OAC and TLS. CloudFront applies CSP with WASM support, frame denial, HSTS, no-referrer and disabled camera/microphone/geolocation. WAF rate-limits auth starts and general requests and applies AWS's known-bad-input rule set. API Gateway and Lambda impose additional rate/concurrency limits. Direct API Gateway calls remain authenticated and throttled; WAF applies at CloudFront only.

## Local development and validation

Requires Node 24. The production build is the default. `npm run build` performs type checking, builds the authenticated client and bundles the handlers. `npm run cdk:synth` reads local build artifacts and makes no AWS lookups. `npm run verify` runs simulator, backend and infrastructure checks and synthesis.

For local API development, copy `service/.env.example` to `service/.env`, use an AWS profile with access to the shared OAuth secret and run `npm run service:local` plus `npm run dev`. The API binds only to `127.0.0.1:3000`; Vite proxies `/api`. Register `http://127.0.0.1:5173/api/auth/callback` on Google for this local flow. The local adapter uses isolated memory storage and real Google authentication; restarting clears its data. No local route issues a fake production identity or disables authentication.

The explicit `npm run build:offline` / `npm run standalone` workflows produce `dist-offline/`. Those contain the earlier offline simulator and local storage. They are never the CDK frontend artifact. The standalone packaging script embeds fonts, WASM and worker code and requires no API. Existing offline backups are not auto-uploaded: import and explicitly save a robot after login.

Local browser QA used a synthetic Google provider in an ignored, loopback-only test harness and the real handlers against MemoryStore. It verified gating, two-tab saves/conflicts, copying a preserved draft, the shared library, Drive under CSP and logout across tabs. Real signature tests use generated RSA keys with Google's verifier. DynamoStore tests inspect SDK commands and conditional failure behavior; they do not substitute for a live DynamoDB transaction test.

## Operations, recovery and remaining release gates

Both tables have encryption, point-in-time recovery, deletion protection and retain-on-delete/update-replacement. Robot data also has daily AWS Backup snapshots with 35-day retention in a retained vault. Frontend S3 is private, versioned and retained. Application logs retain one month; API access logs record route keys rather than OAuth query strings. Lambda errors, throttling and high duration plus API 5xx alarms publish to the operations SNS topic. Subscribe operators and verify notifications; creating an unsubscribed topic is not a complete paging setup.

To recover robot data, restore PITR/backup into a **new table**. Inspect revision consistency, then update the stack's data-table binding through a reviewed deployment. Do not delete the original table during recovery. Restoring session data can resurrect revoked sessions: never restore sessions into service without revoking them all. Retaining history has ongoing storage costs; select a separate archive policy before imposing automated deletion. Test restoration and record the measured recovery time before production sign-off; no RPO/RTO has yet been measured.

Frontend rollback should redeploy a known-good source commit through the same build/deployment flow. Schema v1 is unchanged and revisions remain immutable. Avoid destructive stack replacement. DynamoDB deletion protection and retain policies intentionally require operator intervention for removal.

Release gates still requiring actual AWS/Google access:

- Verify shared Google client callback registration and secret decryption by the deployed auth role.
- Complete allowed Workspace login; reject personal Gmail, another Workspace and an email-domain lookalike; check logout/revocation and session expiry.
- Save/reopen on a second account/device, force a live concurrent revision conflict and retry an ambiguous save. Verify existing immutable revisions remain intact.
- Confirm DynamoDB transaction/IAM behavior, CloudFront cookies/no-store behavior, WAF and CSP including the worker, Route 53 and ACM validation.
- Subscribe/test operational alerts and complete/record a backup restore drill.
- Review dependency advisories and deployment diff; verify costs, quota headroom and the approved admin subject list.

Dependency audit at implementation: `npm audit --omit=dev` reports zero advisories. Full audit reports a moderate `minimatch` glob-amplification advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) in the current CDK package's bundled tooling. Downgrading CDK introduced additional high-severity tooling advisories and was rejected. CDK only processes this repository's trusted build paths and is not bundled in the Lambda runtime or frontend. Track the upstream fix and update the pinned CDK release; do not describe the full development toolchain as advisory-free.
