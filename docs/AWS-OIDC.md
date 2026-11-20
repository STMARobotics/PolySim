# Current production deployment authorization

[GitHub run 44816166948](https://github.com/STMARobotics/PolySim/actions/runs/44816166948) passed its build/test/synthesis, offline build and OIDC authentication steps, then failed during **Check AWS account and OAuth parameter metadata** with:

```text
AccessDeniedException: ...GitHubAction-AssumeRoleWithAction/GitHubActions
is not authorized to perform: ssm:DescribeParameters
```

CDK deployment and the production smoke test were skipped in that run. Newer main commit d6b6e07 replaces the broad DescribeParameters call with GetParameter for the exact `/polysim/google-client-secret` name and WithDecryption=false. It checks SecureString type without decrypting or logging the value. The historical error no longer justifies granting DescribeParameters. This workspace has no AWS credentials to verify the new parameter or deployment role directly.

The workflow uses these existing FMEA roles:

| Job | Role | Expected default GitHub subject |
| --- | --- | --- |
| Push to main: deployment | `arn:aws:iam::738044534240:role/GitHubAction-AssumeRoleWithAction` | `repo:STMARobotics/PolySim:ref:refs/heads/main` |
| Pull request: read-only diff | `arn:aws:iam::738044534240:role/GitHubAction-PullRequestRole` | `repo:STMARobotics/PolySim:pull_request` |

If the new exact-name check lacks permission, an AWS administrator can review the following addition to `GitHubAction-AssumeRoleWithAction`, preserving its existing FMEA policies. A ready-to-review policy is in [deployment-preflight-policy.json](deployment-preflight-policy.json).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PolySimOAuthParameterCheck",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:us-east-2:738044534240:parameter/polysim/google-client-secret",
      "Condition": {
        "StringEquals": { "aws:RequestedRegion": "us-east-2" }
      }
    }
  ]
}
```

This policy permits retrieval of only the PolySim parameter in us-east-2. It adds no KMS decryption or parameter-write permission. GetParameter with WithDecryption=false returns the encrypted value, which the preflight does not log. Do not replace the deployment role's existing policies with this small addition. The auth Lambda separately needs GetParameter and KMS access to use the secret during login.

An earlier [run 44814632054](https://github.com/STMARobotics/PolySim/actions/runs/44814632054) failed at OIDC role assumption. The newer run passed that step, so additional trust-policy changes are not indicated by the latest evidence. The table above records the default GitHub subjects for future reference; customized subject templates can differ.

After SSM authorization is corrected, rerun the current automatic CI/deployment workflow. Confirm preflight, deployment and smoke checks finish, then verify allowed/disallowed Google logins and shared-save behavior. No IAM changes were made by this source update.

References: [AWS SSM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html), [DescribeParameters API](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeParameters.html), [GitHub subject claim reference](https://docs.github.com/en/actions/reference/security/oidc).
