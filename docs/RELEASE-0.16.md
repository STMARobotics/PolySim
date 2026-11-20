# PolySim 0.16 release verification

This release brings the accumulated editor, subsystem-state, targeting and REEFSCAPE updates into the authenticated application, backend document schema and season manifests. It also adds direct scoring placement and optimizes congested game-piece collisions. App version is 0.16.0; engine version is 0.11.0.

## Reproducible checks

```sh
npm ci
npm audit --omit=dev --audit-level=moderate
npm run verify
npm run build:offline
node scripts/build-standalone.mjs
```

The clean-install check found an incorrect integrity hash on the nested Rapier 0.14.0 dependency used by the Three.js types. The lockfile now matches npm's published metadata and downloaded tarball. The application still uses Rapier 0.19.3. No integrity checks were disabled.

The release suite has 170 tests: 128 simulator, 35 backend and 7 infrastructure/build tests. Additional DOM integration checks run in the local editor harness. Production dependencies have zero reported audit advisories. The full development-tool audit still reports two moderate package findings for the existing minimatch advisory in CDK tooling; see BACKEND.md.

Production-specific checks include:

- The HTML entry opens the login gate and loads the editor only after a valid session. Backend tests reject unauthenticated requests and unauthorized Google identities.
- A hosted-client/handler integration test creates and revises a REEFSCAPE robot, preserves typed paths, action grids, named states, full geometry rotation, Not Pressed triggers, targeting and field settings, reopens it for another approved session, then runs the reopened design in the simulation. Logout revokes access. The test uses the real client/handlers with local session/storage fixtures, not live DynamoDB or Google.
- A separate test starts the actual built production worker in a Node worker with a browser messaging shim. Its bundled WASM initializes REEFSCAPE and advances driving through 60 physics ticks. This verifies the published worker artifact, not just TypeScript source; it does not verify browser CSP or WebGL rendering.
- Infrastructure assertions verify private static hosting, API authentication/caching configuration, security headers, isolated tables, secret permissions and backend-before-frontend dependencies. Lambda bundles exclude local test storage/providers. The season bundle identifies the current engine.
- CDK synthesis builds the three production stacks without AWS credentials. Explicit offline builds remain separate from the deployed `dist` artifact.

## Live deployment status

On November 20, 2026, the public smoke check could not resolve `polysim.7028robotics.com` (`ENOTFOUND`). This workspace also has no AWS credentials, so AWS preflight, deployment diff and live infrastructure checks cannot run here. Source/build validation does not establish that production is deployed or fully verified.

Pushing `main` runs verification CI. Deployment remains the separate, manually dispatched **Deploy PolySim production** workflow using the configured production environment and AWS role. The push does not deploy AWS resources or configure Google OAuth.

Before making the app available, complete the AWS/Google release gates in BACKEND.md: verify the shared client's callback, deploy the stacks, confirm DNS/TLS, run the public smoke script, complete allowed/disallowed-account login and shared-save checks, and verify alert delivery and recovery. Browser FPS and live WebGL remain unmeasured; extreme all-Coral piles can still exceed the physics-tick budget described in PILE-PERFORMANCE.md.
