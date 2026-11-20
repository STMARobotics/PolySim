# Current production deployment blocker

[GitHub run 44814632054](https://github.com/STMARobotics/PolySim/actions/runs/44814632054) for remote main passed its build/test/synthesis and offline build steps, then failed at **Configure AWS Credentials via OIDC** with:

```text
Not authorized to perform sts:AssumeRoleWithWebIdentity
```

CDK deployment and the production smoke test were skipped. This is an AWS role authorization failure before the app stacks are deployed. It cannot be corrected by changing the OAuth application or application login code. This workspace has no AWS credentials to inspect or change the existing IAM role.

The workflow uses these existing FMEA roles:

| Job | Role | Expected default GitHub subject |
| --- | --- | --- |
| Push to main: deployment | `arn:aws:iam::738044534240:role/GitHubAction-AssumeRoleWithAction` | `repo:STMARobotics/PolySim:ref:refs/heads/main` |
| Pull request: read-only diff | `arn:aws:iam::738044534240:role/GitHubAction-PullRequestRole` | `repo:STMARobotics/PolySim:pull_request` |

An AWS administrator should inspect the deployment role's trust policy and the repository/organization's OIDC subject configuration. With GitHub's default subject format, the additional statement for the main role is:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::738044534240:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:STMARobotics/PolySim:ref:refs/heads/main"
    }
  }
}
```

Retain existing FMEA statements/subjects. Do not replace the whole role policy with this single statement or widen it to every repository. If subject customization or immutable-ID subjects are enabled, match the actual configured subject instead of the default example. Apply the PR subject only to the read-only PR role. The deployment role also needs the reviewed permissions required by the PolySim stacks; a successful trust change alone does not verify those permissions.

After IAM authorization is corrected, a main push runs the current automatic CI/deployment workflow. Confirm AWS preflight and deployment finish, then verify the production hostname, allowed/disallowed Google logins and shared-save behavior. No IAM changes were made by this source update.

References: [GitHub's AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [GitHub subject claim reference](https://docs.github.com/en/actions/reference/security/oidc).
