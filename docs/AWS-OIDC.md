# Current production deployment authorization

[GitHub run 44816166948](https://github.com/STMARobotics/PolySim/actions/runs/44816166948) for the latest remote main passed its build/test/synthesis, offline build and OIDC authentication steps, then failed during **Check AWS account and OAuth parameter metadata** with:

```text
AccessDeniedException: ...GitHubAction-AssumeRoleWithAction/GitHubActions
is not authorized to perform: ssm:DescribeParameters
```

CDK deployment and the production smoke test were skipped. The current failure concerns the deployment role's SSM permissions. This workspace has no AWS credentials to inspect or change the existing IAM role. The preflight checks parameter metadata without retrieving the OAuth secret value.

The workflow uses these existing FMEA roles:

| Job | Role | Expected default GitHub subject |
| --- | --- | --- |
| Push to main: deployment | `arn:aws:iam::738044534240:role/GitHubAction-AssumeRoleWithAction` | `repo:STMARobotics/PolySim:ref:refs/heads/main` |
| Pull request: read-only diff | `arn:aws:iam::738044534240:role/GitHubAction-PullRequestRole` | `repo:STMARobotics/PolySim:pull_request` |

An AWS administrator should review and add the following metadata-read permission to `GitHubAction-AssumeRoleWithAction`, preserving its existing FMEA policies. A ready-to-review policy is in [deployment-preflight-policy.json](deployment-preflight-policy.json).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PolySimOAuthParameterMetadata",
      "Effect": "Allow",
      "Action": "ssm:DescribeParameters",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "aws:RequestedRegion": "us-east-2" }
      }
    }
  ]
}
```

DescribeParameters does not support a parameter-specific resource ARN; the region condition limits this metadata-list permission to us-east-2. It does not grant GetParameter, decryption or parameter writes. The preflight itself filters the exact `/fmea/google-client-secret` name and checks that it is a SecureString. Do not replace the deployment role's existing policies with this small addition.

An earlier [run 44814632054](https://github.com/STMARobotics/PolySim/actions/runs/44814632054) failed at OIDC role assumption. The newer run passed that step, so additional trust-policy changes are not indicated by the latest evidence. The table above records the default GitHub subjects for future reference; customized subject templates can differ.

After SSM authorization is corrected, rerun the current automatic CI/deployment workflow. Confirm preflight, deployment and smoke checks finish, then verify allowed/disallowed Google logins and shared-save behavior. No IAM changes were made by this source update.

References: [AWS SSM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html), [DescribeParameters API](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeParameters.html), [GitHub subject claim reference](https://docs.github.com/en/actions/reference/security/oidc).
