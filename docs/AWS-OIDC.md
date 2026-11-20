# Current production deployment authorization

The deployment preflight validates only the AWS account and region. It uses
`sts:GetCallerIdentity` and never requests the OAuth secret. Secret access
remains isolated to the auth Lambda's role.

The workflow uses these existing FMEA roles:

| Job | Role | Expected default GitHub subject |
| --- | --- | --- |
| Push to main: deployment | `arn:aws:iam::738044534240:role/GitHubAction-AssumeRoleWithAction` | `repo:STMARobotics/PolySim:ref:refs/heads/main` |
| Pull request: read-only diff | `arn:aws:iam::738044534240:role/GitHubAction-PullRequestRole` | `repo:STMARobotics/PolySim:pull_request` |

Do not grant `ssm:GetParameter` to `GitHubAction-AssumeRoleWithAction` solely
for preflight validation. It is unnecessary and would broaden CI's access to
production secrets. The auth Lambda separately needs exact-parameter
`ssm:GetParameter` and KMS access to use the secret during login.

An earlier [run 44814632054](https://github.com/STMARobotics/PolySim/actions/runs/44814632054) failed at OIDC role assumption. The newer deployment run passed role assumption. The table above records the default GitHub subjects for future reference; customized subject templates can differ.

Rerun the automatic CI/deployment workflow after removing the preflight secret
check. Confirm deployment and smoke checks finish, then verify allowed/disallowed
Google logins and shared-save behavior. No IAM changes were made by this source
update.

References: [GitHub subject claim reference](https://docs.github.com/en/actions/reference/security/oidc).
