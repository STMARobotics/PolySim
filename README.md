# PolySim

A robot engineering playground with a serverless team backend, built from the BlockSim/FRC Simulator design document. Start with the bundled Collector → Hopper → Launcher robot, change its geometry or transfer times, and test it on a 3D practice field.

The hosted build uses Google Workspace login, API Gateway, Node.js 24 Lambdas, DynamoDB and CDK. Only verified **stmarobotics.org** Workspace users can authenticate. Shared robot saves create immutable revisions with optimistic concurrency and idempotent requests. Physics still uses the estimated Practice Lab fixture; it does not implement official FRC rules.

## Hosted backend

Deployment target: **https://polysim.7028robotics.com**, AWS account **738044534240**, backend region **us-east-2**, CloudFront certificate/WAF region **us-east-1**. This matches FMEA's public deployment coordinates and reuses its OAuth client and `/polysim/google-client-secret` SecureString. PolySim has independent stacks, tables, sessions and frontend storage.

```sh
npm ci
npm run verify
npm run cdk:diff
npm run cdk:deploy
```

Build and deployment details, OAuth registration, AWS access requirements, recovery procedures and remaining live-release checks are in [the backend deployment guide](docs/BACKEND.md). Synthesis is credential-free; deployment and live validation require authenticated AWS access. No infrastructure has been deployed by this local implementation.

`npm run build` produces the authenticated frontend in `dist/` and Lambda bundles in `service-dist/`. It has no offline login fallback. The authenticated app opens the editor only after the server verifies its session. Google tokens never enter browser storage; the browser receives a host-only opaque HttpOnly session cookie.

For local backend development, copy `service/.env.example` to `service/.env`, then run `npm run service:local` and `npm run dev` in two terminals. The API uses isolated memory storage and real Google login, never production DynamoDB. Local login requires the localhost callback to be registered on the shared Google client and AWS credentials that can read the OAuth secret. Set `AWS_REGION=us-east-2` as shown in the example.

## Run offline locally

The prepared **PolySim-Play.html** demo opens directly in Chrome or Edge. It bundles the renderer, styles, fonts and physics engine in one file and requires no server, Node installation or internet connection. The Windows launcher uses this file when present. File-based saves use their own browser storage, separate from the HTTP-served app.

Requires Node.js 24 or newer. Installation/build needs the internet once. Running the built app needs no internet, account, API, CDN, or cloud service.

```sh
npm ci
npm run build:offline
npm run preview
```

Open **http://127.0.0.1:4173**. On Windows, after the build, double-click **Start-PolySim.cmd** to start the server and open your browser. Keep the server terminal open while using the app. Close it or press Ctrl+C to stop. The launcher also recognizes this machine's existing Codex Node runtime.

For development:

```sh
npm run dev:offline
```

Use the URL Vite prints. Data is local to the browser profile and origin: the development URL and built-app URL have separate libraries. Do not open `dist-offline/index.html` directly; the worker requires an HTTP origin.

To generate the server-free single-file version from source, run `npm run standalone`, then open `dist-offline/PolySim-Play.html`. This special bundle runs the physics engine directly in the page for file URLs, avoiding browser restrictions on blob workers; the offline multi-file `dist-offline/index.html` still needs the local server.

The interface uses **Geo** for navigation, tools and structural headings and **Mona Sans** for normal-case property labels, inputs and graph details. Dark surfaces balance red, yellow and blue accents. Both fonts are bundled offline.

Opening **Drive** starts play automatically. Leaving Drive pauses the simulation, and returning resumes it. Design changes start a fresh practice session. File-based playback uses the same physics engine in the page. HTTP playback prefers a worker and falls back automatically if worker startup is blocked. Initialization failures restore editable controls.

Linear measurements use inches; speeds and acceleration use in/s and in/s². Mass uses pounds, angles use degrees, and time uses seconds. Existing JSON documents and physics retain SI values internally; the UI converts at the input/display boundary without changing saved robot dimensions.

The prepared offline ZIP contains built assets, the small dependency-free Node server, a Windows launcher and these instructions. Unzip it before launching; it does not require `npm install`. Node itself is not bundled.

## First test

1. **Edit** places the 3D editor beside the inspector on the right. **Hide** expands the view; **Inspector** restores the pane. Select a box and drag its **Move** or **Resize** handles, or enter inch measurements directly.
2. **Graph** keeps the same inspector on the right. Select modules or connections to edit their properties. Subsystems are square; actions are rectangular. Each module shows type, name and capacity. Action/owner links are permanent and default to instant. Select a transition to edit its key, trigger and travel time. Action surfaces have no key bindings.
3. Drag an output port onto a destination input/node to connect it. Drag cards to rearrange them. New modules receive staggered positions. Scroll to zoom, drag empty space to pan, or choose **Fit**.
4. Open **Drive** and play immediately. Hold **WASD** to translate and **Left/Right Arrow** to rotate. The sample uses **I** for intake/collector transfer, **J** to feed and **K** to launch. Choose station **1**, **2** or **3** for a fixed eye-height view that smoothly tracks the robot. Mouse action buttons and basic gamepad controls also work.
5. Leaving Drive pauses play. Returning resumes it; edits begin a fresh session. Focus loss also pauses play, and returning focus to Drive resumes it. There are no start/stop controls in the header.
6. Boxes fill solid yellow upward according to owned pieces divided by capacity. Click a binding button and press a key, including **Space**, **Shift** or **Enter**.

Outtake surfaces include **Units X** and **Units Y** under Launch configuration. X controls columns across the release face and Y controls rows up the face. A 4 × 1 grid releases up to four ready pieces in one tick, spaced one game-piece diameter plus clearance apart. A 2 × 2 grid uses two rows. Partial batches are centered; blocked cells retain their pieces. The entire batch shares the surface interval and its transition’s Hold/Press trigger. Old robots default to 1 × 1. Pieces must be ready in the owner subsystem (ordinary subsystem transfers still apply), and the owner's capacity still applies.

Edit uses [Onshape-style navigation](https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm): right-drag orbits, middle-drag or Ctrl+right-drag pans, and the wheel zooms toward the pointer. Left-click selects and left-drag operates handles. In Edit, arrows rotate the camera 15 degrees; Shift uses 90 degrees, Ctrl uses 5 degrees, Ctrl+Shift+arrows pans, and Z/Shift+Z zooms out/in. In Drive, Left/Right Arrow rotates the robot and the fixed camera remains locked. The Drive HUD shows pickups and score without a timer.

The raised blue basket is a one-point practice target. Launch speed/direction must match your release location. The dashed edit-mode arc is a stationary, no-drag preview for the first +X outtake. It does not include robot motion or collisions.

**Save** creates a shared immutable revision in hosted mode or a numbered local save in offline mode. Editing also writes a recovery draft. Use **Export JSON** for backups or transfer between browsers/devices. Hosted mode keeps recovery drafts scoped to the signed-in Google subject and clears them on logout or account change. Stale shared saves return a conflict and offer an independent copy. Saved run reports remain browser-local; scenarios and cloud run-artifact storage are not part of this backend slice.

## Source structure

| Area | Responsibility |
| --- | --- |
| `contracts/` | Document schema/types, import boundary, validation, unit and graph helpers |
| `simulation/` | Ownership/reservation scheduler, Rapier runtime, worker and message protocol |
| `seasons/` | Bundled trusted practice fixture and guided sample |
| `ui/` | App shell, local persistence, inspectors, SVG graph and Three.js adapter |
| `service/` | OIDC, opaque sessions, schema validation and versioned robot API; isolated local adapter |
| `cdk/` | Independent PolySim certificate/WAF, backend and frontend stacks |
| `scripts/` | Backend bundling, offline server, deployment preflight and smoke checks |
| `tests/` | Deterministic graph and physical integration fixtures |
| `docs/` | Supplied design reference, model limits and implementation status |

## Verify

```sh
npm test
npm run build
```

The offline build needs no account or backend. The default hosted build requires its API and Google login. Local launch scripts do not deploy infrastructure. Official seasons, cloud run artifacts and scenario persistence remain separate future work.

## Action transitions and smooth rendering

Intake → owner and owner → outtake links are created automatically and cannot be deleted independently. Each transition owns its key, trigger and travel time. Time defaults to 0 seconds (Instant) and can be increased to 60 seconds. Select a line label, or choose **Edit transition** from the surface inspector, to edit these settings. Labels sit on the connection with the key on the first line and time on the second. New actions are named **<owner name> Action**. Legacy surface bindings migrate into missing transitions; existing transition settings take precedence. Timed transfers finish after the key is released, and intake transit still occupies owner capacity.

Physics remains fixed at 120 Hz. Robot and game-piece poses interpolate on every display frame instead of jumping at the roughly 25–30 Hz snapshot rate. Piece meshes share one instanced draw, shadows use a 1024 map, display resolution is capped at 1.5×, Drive avoids hidden graph rebuilds, and live snapshots send only new recorded inputs. Paused snapshots retain complete replay data.

For local performance checks, append `?profile=1` to show frame-rate diagnostics. Add `&simulation=local` to test the same in-page physics backend used by the standalone file. The Atlas sample measured 99.5–100.1 fps at 1280×544 with the local backend, with 95th-percentile frame times of 10.8–15.1 ms. These measurements are environment-specific; 60 fps corresponds to 16.7 ms per frame. Your Test backup's physics benchmark averaged 0.184 ms per 120 Hz tick. See the packaged performance report for details.
