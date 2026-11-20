# PolySim

A robot engineering playground with a serverless team backend. Choose **2025 REEFSCAPE** or **Practice Lab**, build a robot and test its geometry and travel paths on a blocky 3D field. The fresh offline workspace opens REEFSCAPE.

The hosted build uses Google Workspace login, API Gateway, Node.js 24 Lambdas, DynamoDB and CDK. Only verified **stmarobotics.org** Workspace users can authenticate. Shared robot saves create immutable revisions with optimistic concurrency and idempotent requests. Season fixtures use simplified geometry and estimated physics; official match rules are not implemented.

## Season and field editing (0.13)

Use the library's **Season** selector when creating a robot. A saved robot stays tied to that season. In Edit, click **Robot** or **Field** in the existing inspector header. Field mode edits scoring receivers and human-player release settings; fixed obstacles remain defined in the trusted season fixture. No field geometry editor is exposed.

Scoring elements are oriented rectangular boxes with points per piece, capacity, accepted game-piece types and assigned scoring faces. Drag **Scoring surface** onto a free box face, then tune its accepted types. A compatible physical piece touching an assigned face is removed from free physics, retained in that receiver's inventory and scored once. Full receivers stop consuming pieces. Boxes fill yellow from the bottom as inventory grows. Receiver and release settings save with the robot revision.

REEFSCAPE includes Coral and Algae. Every subsystem has one entry and exit port per type. Action rectangles show an exit port per accepted type; outtakes also have corresponding owner input ports. Choose accepted types in the action inspector. Routes carry one type, retain separate timing/bindings, and share subsystem capacity. Matching types are required when drawing connections. The States graph keeps its existing single-port layout.

Four default Coral station releases use **Proximity** mode. Each has a robot-distance threshold and cooldown while in range; **Continuous** mode uses its cooldown regardless of proximity. Releases can be enabled/disabled and their piece type, position and velocity tuned. Source IDs and physics replay are deterministic; Drive Restart resets field inventories and releases.

REEFSCAPE seeds L1–L4 Coral, processor and net Algae receivers with TELEOP point defaults. All scoring geometry is tunable. There are no match phases, autonomous bonuses, penalties, alliance restrictions or cage-scoring rules. Coral is a hollow rigid pipe with compound collision geometry; Algae uses an exact spherical collider and a smooth render mesh. See [season dimensions, sources and approximations](docs/REEFSCAPE-2025.md).

This update uses a fresh browser-storage namespace. Previous local recovery drafts/saves are ignored; original JSON backup files are untouched. Geo headings, normal-case Mona Sans details and the dark red/yellow/blue workspace remain in use.

### Field interaction and piece physics (0.14)

In **Edit → Field**, click a scoring box directly in the 3D view to select it. Human-player releases remain editable in the hierarchy; their floating cube markers are removed. Hanging cages and new net receiver defaults are centered on the field centerline. Untouched old net defaults are centered once when loading; later receiver edits are retained. Driver cameras sit 0.3 m behind the alliance-wall plane at a raised 1.9 m eye height.

**Field overview → Game piece bounciness** provides a separate 0–1 restitution value for every season piece type. Zero gives no rebound against the field, and one is fully elastic. Values apply to initial pieces, human-player releases and outtakes, and save with the field settings. Game-piece contacts use the larger of the two coefficients; static field and robot surfaces use zero.

Coral renders as an open 4-inch-bore, 4.5-inch-outer-diameter pipe. Scoring and spawn-clearance queries use 48 convex wall prisms. Dynamic field/robot contact uses 24 overlapping tangent wall boxes, preserving the bore, mass and release orientation with less than 0.5 mm outer-radius error. Algae remains an analytic sphere for collision and uses a smoother display mesh. These are rigid-body models; material flex/deformation remains outside the simulation.

### Direct scoring placements (0.15)

Outtakes can place pieces directly into scoring elements. At release, the engine tests the actual piece shape against assigned scoring faces across the short path from the action face to the release position. A compatible receiver with capacity takes ownership immediately, awards its points and fills its inventory; no overlapping physics body is spawned. Hollow Coral uses its pipe walls, so an object inside its empty bore does not count as contact.

A touching full or incompatible receiver retains the piece in the robot and reports the reason. If overlapping receivers exist, an eligible receiver takes priority. Unassigned faces do not accept pieces. Away from scoring faces, ordinary release-clearance checks still apply. Transition delays, triggers, batch capacity and shared cooldowns remain in effect. No collision toggle or additional editor control is required.

### Pile collision performance (0.16)

Coral-to-Coral collision previously expanded into thousands of thin-wall part pairs, with particularly expensive CCD when the robot pushed a pile. REEFSCAPE now routes piece-to-piece and flat-floor contact through one massless outer-cylinder envelope per Coral. Complex field obstacles and robot geometry still collide with the open wall shell; scoring, intake visibility and release-clearance queries exclude the envelope. Piece-to-piece envelope contacts are a conservative approximation of the exterior; seasons containing pieces small enough to fit through a tube bore automatically retain wall-to-wall contacts. CCD and 120 Hz physics remain enabled. Unchanged subsystem transforms no longer rewrite their colliders every tick.

Run `npm run benchmark:piles` for crowded 18/36-piece contact cases. The reproduced 18-Coral pile dropped from roughly 641 ms to 3 ms per simulation tick locally. These are CPU physics timings, not browser FPS. A deliberately congested 36-Coral case remains more demanding than mixed pieces; see [performance methodology and limitations](docs/PILE-PERFORMANCE.md).

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

Linear measurements accept only multiples of 0.5 inch. Typed values round to the nearest half inch when applied, and 3D move/resize handles snap to the same grid. Opening or importing a design rounds its editable geometry to this grid; existing backup files remain untouched. Linear speeds and acceleration use m/s and m/s². Mass uses pounds, angles use degrees, and time uses seconds. Documents and physics retain SI units internally.

The prepared offline ZIP contains built assets, the small dependency-free Node server, a Windows launcher and these instructions. Unzip it before launching; it does not require `npm install`. Node itself is not bundled.

## First test

1. **Edit** places the 3D editor beside the inspector on the right. **Hide** expands the view; **Inspector** restores the pane. Select a box and drag its **Move** or **Resize** handles, or enter inch measurements directly.
2. **Graph** keeps the same inspector on the right. Select modules or connections to edit their properties. Subsystems are square; actions are rectangular. Each module shows type, name and capacity. Action/owner links are permanent and default to instant. Select a transition to edit its key, trigger and travel time. Action surfaces have no key bindings.
3. Drag an output port onto a destination input/node to connect it. Drag cards to rearrange them. New modules receive staggered positions. Scroll to zoom, drag empty space to pan, or choose **Fit**.
4. Open **Drive** and play immediately. Hold **WASD** to translate and **Left/Right Arrow** to rotate. The sample uses **I** for intake/collector transfer, **J** to feed and **K** to launch. Choose station **1**, **2** or **3** for a fixed eye-height view that smoothly tracks the robot. Mouse action buttons and basic gamepad controls also work.
5. Leaving Drive pauses play. Returning resumes it; edits begin a fresh session. Focus loss also pauses play, and returning focus to Drive resumes it. There are no start/stop controls in the header.
6. Boxes fill solid yellow upward according to owned pieces divided by capacity. Click a binding button and press a key, including **Space**, **Shift** or **Enter**.

Outtake surfaces include **Units X** and **Units Y** under Launch configuration. X controls columns across the release face and Y controls rows up the face. A 4 × 1 grid releases up to four ready pieces in one tick, spaced one game-piece diameter plus clearance apart. A 2 × 2 grid uses two rows. Partial batches are centered; blocked cells retain their pieces. The entire batch shares the surface interval and its transition's trigger. Old robots default to 1 × 1. Pieces must be ready in the owner subsystem (ordinary subsystem transfers still apply), and the owner's capacity still applies.

Edit uses [Onshape-style navigation](https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm): right-drag orbits, middle-drag or Ctrl+right-drag pans, and the wheel zooms toward the pointer. Left-click selects and left-drag operates handles. In Edit, arrows rotate the camera 15 degrees; Shift uses 90 degrees, Ctrl uses 5 degrees, Ctrl+Shift+arrows pans, and Z/Shift+Z zooms out/in. In Drive, Left/Right Arrow rotates the robot and the fixed camera remains locked. The Drive HUD shows pickups and score without a timer.

In Practice Lab, the raised blue basket is a one-point target. Launch speed/direction must match your release location. Dotted trajectories preview every active outtake and every configured output grid cell, including rotated subsystems and every release face. They do not include inherited robot/actuator motion or collisions.

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

## Subsystem states and previews (0.9)

Each subsystem has named states with position, dimensions, yaw/pitch/roll, capacity, collision settings and state-specific action surfaces. Use the state accordion to edit one state at a time, and **Add state** below the list. Exactly one state per subsystem is the startup default. Setting another default replaces the previous choice with a warning; removing or unchecking the only default is blocked.

In **Graph**, choose **Travel Path** for material flow or **States** for the selected subsystem's state machine. Drag between state ports, then select the connection to set its key, trigger and transition time. State list order does not affect execution. State transitions ease position, dimensions and all three rotation angles while updating collision geometry and rendering smoothly between snapshots. A transition that would exceed the destination capacity or orphan pieces in an action is blocked with a status message. Actions pause while geometry is transitioning.

## Editor refinements (0.10)

The inspector heading is the editable subsystem name. X/Y/Z labels sit beside their numeric inputs. State names end in ` State`, and the robot tree lists **Subsystem → State → Action**, including same-named actions in different states.

Drag an Intake/Outtake button to draw a raised beam toward the cursor. It snaps to a nearby visible, available face and highlights that face; release to assign. The button stays in place. Escape, focus loss or pointer cancellation cancels the operation. Geo styles structural headings and controls; Mona Sans styles normal-case values, property labels and graph details.

## Transition triggers (0.11)

Both **Travel Path** and **States** transitions offer **Hold**, **Press**, and **Not Pressed**. Hold permits new work while the assigned key is down; Press permits new work on its initial press. Not Pressed continuously permits new work while the key is released, including startup. Existing time, capacity and action-interval limits still apply, and a timed transition completes even if its key changes afterward. For example, use Hold to extend a subsystem and Not Pressed on a reverse transition with the same key to return it when released. Hosted saves require the server's `not-pressed-trigger` capability.

## Subsystem targeting (0.12)

Select a subsystem and choose **Targeting Mode** above its states. **Manual** is the default, including for older robots. Targeting settings apply to the subsystem across its states.

- **Turret:** continuously points the subsystem's outtake bore toward the nearest valid scoring target during play. Without an outtake, its local +X axis is used.
- **SOTM Turret:** uses bounded flight-time iteration to lead that target against the robot's current translation and angular point velocity. It uses the outtake's configured speed and elevation.
- **Aim with Drivetrain:** automatically turns the chassis while an owned action is engaged, retaining driver translation. Hold and Press action keys engage aiming while held; Not Pressed engages it while released. Pending action transfers also keep aiming engaged. No ready piece is required. Inactive-state actions do not engage aiming.
- **Manual:** leaves geometry under its state settings and turning under driver control.

Turrets rotate about a field-vertical axis through the subsystem center, retaining position, pitch and roll. Both turret modes expose **Degrees of freedom**, a total range from 0–360°, default 360°. The range is centered on the startup state's saved yaw relative to the chassis: 120° allows ±60°. That reference remains fixed across state changes. Collision shapes and rendered geometry follow the same aimed yaw. A limited turret clamps at its stop; tracking does not bypass the limit.

The current practice field has one valid basket. The targeting solver supports multiple enabled targets and selects the nearest; invalid targets are excluded. With multiple outtakes, an engaged outtake is preferred, otherwise the first active-state outtake by ID. Competing drivetrain aim requests use the nearest target distance, then subsystem ID. Targeting controls azimuth only: it does not adjust speed/elevation, test line-of-sight, determine ballistic reachability or gate shots until aligned. SOTM is a horizontal flight-time estimate; the dotted preview still omits inherited motion and collisions. Hosted saves require the `subsystem-targeting` capability.

**Ignore collision** defaults to false on new subsystems and the guided sample. Imported robots preserve their previous collision behavior. Drag **Intake** or **Outtake** from the open state's inspector directly onto a 3D box face. Each state has independent face assignments. All active outtakes show dotted launch-setting trajectories, one for every configured output grid position, in Edit and Drive. These show unobstructed ballistic paths; they are not a collision prediction or a guarantee of scoring.

Drive includes **Restart**, which resets robot pose, default states, pieces and score. The server schema and cloud saves retain state definitions, transitions and graph positions; older robot files migrate to one Default state. Engine version is 0.6.0.
