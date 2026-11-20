# FRC Simulator — Design Document

Version 1.1 • November 19, 2026

## 1. Product purpose

Build a private, browser-based engineering simulator for approximately 30 robotics team members. Users quickly construct functional robot abstractions, drive them on a season-specific field, and compare design choices using measured simulation results.

The central workflow is: select a season and robot, draw subsystem boxes directly on the field, assign Action Surfaces, connect the Travel Path Graph, and test. Users describe what mechanisms do without modeling rollers, belts, conveyors, or internal game-piece physics.

The simulator should answer questions such as: Does added storage improve cycle time? Is intake placement accessible? Where does the transfer path bottleneck? What launch velocity and angle reach a target? How do drivetrain choices change a repeatable route?

This is not a multiplayer competition game, a CAD replacement, or a substitute for physical testing. A useful result must identify its assumptions and distinguish measured inputs from estimates.

### Required product behavior

- Domain-specific Google login; team-wide shared robot library.
- Main menu with season selection and robot selection or New Robot.
- Field-based 3D editor with white rectangular-prism subsystems.
- Green intake faces, red outtake faces, and purple special faces.
- One Action Surface may group multiple faces of the same subsystem.
- A Unity Animator-style 2D Travel Path Graph containing subsystem and surface nodes, connected by directed arrows.
- Every arrow has a direction, keyboard/controller binding, and transfer time. Every surface has its own action binding.
- Outtakes define exit velocity, exit orientation, and exit angular velocity.
- Physical pieces disappear when captured and become logical pieces inside the graph; outtakes return them to physical simulation.
- Seasons are implemented and deployed by developers. There is no season upload or season-authoring UI.

The detailed semantics below are proposed implementation decisions where the requested behavior leaves choices open.

## 2. Architecture and relationship to FMEA

### Backend reference and scope

Use [STMARobotics/fmea-app](https://github.com/STMARobotics/fmea-app) as the reference for the simulator's backend only: its TypeScript Node service, focused Lambda handlers behind API Gateway, DynamoDB persistence, Google OIDC authentication, server-side sessions, and AWS CDK infrastructure. Its README describes an opaque HttpOnly session cookie, and its local Node server invokes the same handlers as the deployed API.

Build a separate simulator application with its own data and deployment configuration. Follow the backend patterns without coupling simulator records to the FMEA database or treating FMEA subsystem records as simulator geometry.

The frontend architecture is independent. FMEA does not prescribe the simulator's UI framework, component library, styling, navigation, state management, graph editor, or frontend build tooling. Select those for the 3D editor and simulation workflow. Angular and Angular Material are not requirements, and frontend package versions do not need to match FMEA.

| Area | Simulator design |
| --- | --- |
| UI | Independent TypeScript web frontend; UI framework and component library selected during implementation for the simulator's needs |
| 3D rendering | Three.js behind a framework-independent viewport adapter |
| External physics | Rapier 3D WebAssembly behind a physics adapter |
| Graph editor | Node editor with pan/zoom, ports, selection, and drag behavior; select a compatible graph library or implement an SVG connection layer after choosing the UI stack |
| Simulation | Framework-independent TypeScript core plus physics adapter, executed in a Web Worker |
| API | FMEA-style API Gateway HTTP API with focused TypeScript Lambda handlers |
| Persistence | FMEA-style DynamoDB patterns for metadata, revisions, sessions, and summaries; private S3 for large run artifacts |
| Hosting | Proposed S3 and CloudFront deployment with Route 53, ACM, and same-origin `/api/*` routing; compatible with independently built frontend assets |
| Infrastructure | AWS CDK; separate development and production resources |
| Authentication | FMEA-style Google OIDC, server-side domain verification, and opaque server session |

Three.js, Rapier, and the graph editor are simulator-specific choices, independent of FMEA. The graph editor's appearance resembles Unity Animator, but its semantics are a timed material-flow network rather than an animation state machine. Frontend hosting is a deployment choice, not a requirement to copy FMEA's frontend architecture. Preserve authenticated API behavior and disable caching of session and team-data responses regardless of the frontend stack.

### Responsibility boundaries

The browser owns rendering, input, geometry editing, graph execution, physics, scoring, and metrics during a run. The server owns authentication, authorization, validation of persisted data, robot revisions, shared-library queries, and saved results. Simulation ticks never cross the network. Thirty users run thirty independent local simulations; no game server or multiplayer synchronization is required.

The frontend document store holds editable robot state and low-frequency UI state independently of the chosen UI framework. The worker holds authoritative runtime state. Three.js consumes snapshots; it never independently decides ownership, scoring, or transfer completion. Keep the render loop separate from UI component updates, while inspectors update at a throttled rate.

Recommended simulator repository areas, organized by responsibility rather than copied from the FMEA frontend:

| Path | Responsibility |
| --- | --- |
| `ui/` | App shell, library, editor, viewport, graph, controls, results |
| `service/` | Authentication and focused API handlers; local server |
| `cdk/` | Backend, frontend, certificates, deployment configuration |
| `contracts/` | Shared schemas, versioned DTOs, error shapes, fixtures |
| `simulation/` | Graph scheduler, ownership ledger, drive model, worker protocol, physics adapter |
| `seasons/` | Developer-authored season modules and asset manifests |
| `docs/` | Model assumptions, calibration, season implementation guides |

## 3. Access and shared ownership

Use `stmarobotics.org` as the initial configurable allowed domain, matching the FMEA README. On the OAuth callback, validate signature, issuer, audience, expiry, verified email, and Google hosted-domain claim. A login hint or frontend email suffix check is not authorization. Validate OAuth state and nonce, use PKCE, and keep the client secret server-side in Parameter Store.

Use a host-only Secure, HttpOnly, SameSite session cookie. Enforce session expiry server-side on every request rather than relying on database TTL cleanup. Logout revokes the session. Protect mutations with same-origin checks and a CSRF token. Do not place Google tokens in browser local storage. A dedicated app session can reuse the user's Google login without sharing a broad cross-subdomain cookie.

Proposed permissions:

| Role | Permissions |
| --- | --- |
| Team member | Read, run, duplicate, and revise shared robots; save runs and scenarios |
| Administrator | All member permissions, archive/restore shared records, manage allowed membership and administrative configuration |
| Developer | Adds or updates seasons through source changes and deployment, not an in-app role |

Domain membership grants team access only if that domain is exclusively team-managed. Otherwise additionally require an administrator-managed membership allowlist. Enforce this server-side. All robots are shared; per-user personal drafts are recovery copies rather than private library items.

Record authorship and revision history. Use optimistic concurrency, not last-writer-wins: if two users load revision 7, the second save after revision 8 exists receives a conflict and can reload or save a copy. No real-time collaborative editing is necessary.

Static application code and generic season assets may be publicly downloadable, as with a conventional SPA. All team data and API actions require authentication; a route guard alone does not protect them.

## 4. Screens and primary workflow

### Main menu

After sign-in, display a season selector, shared robot cards, and New Robot. Each card shows name, season, creator, last editor, modification time, and validation status. Provide search, duplicate, and revision history. Filter by selected season. Cross-season reuse is an explicit Copy to Season operation requiring game-piece and special-action remapping.

Selecting a robot opens the selected field in Edit mode. New Robot opens the same workspace with a default chassis and Robot Basics inspector. No separate CAD screen or wizard is required.

### Field workspace

- Center: 3D field, robot, grid, axes, and selection handles.
- Left: subsystem hierarchy, surface children, and Add Subsystem.
- Right: selected robot, subsystem, surface, or edge properties.
- Top: robot name, save state, undo/redo, Travel Path Graph, Run, Pause, Reset, and Results.
- Bottom: validation issues and optional runtime event log.

Provide perspective orbit, top/front/side orthographic views, frame-selection, and a driver camera. The field is the geometric context for both editing and testing.

Draw a subsystem by dragging a rectangle on a chosen construction plane and then setting height. Numeric dimensions and offsets remain editable. Snap to a configurable grid, duplicate boxes, and use translation/rotation handles. Subsystems remain rectangular prisms even when rotated.

Click a subsystem to select it and edit properties. Right-click a face to choose Intake, Outtake, Special, Add to Existing Action Surface, or Remove Assignment. Selecting an existing group and shift-clicking additional faces allows multi-face assignment. A context-menu equivalent is available in the inspector for keyboard accessibility.

Unassigned faces are white. Intake is green, outtake red, special purple. Add icons, text labels, and a legend so color is not the only indication. Selected objects use an outline rather than replacing action colors. A face belongs to at most one Action Surface in the initial release; different faces on one subsystem may have different types.

### Edit and Run separation

Run validates the document, compiles an immutable runtime snapshot, and resets the scenario. Invalid drafts may be saved but cannot run. During Run, geometry and graph structure are read-only. Pause supports inspection and single-tick stepping. Returning to Edit preserves the run results, but applying a design change requires a reset before the next run. Reset restores field pieces, graph inventory, timers, score, and robot pose from the scenario.

## 5. Robot and subsystem model

### Units and reference frames

Store all values in SI units: meters, seconds, kilograms, radians, meters per second, and radians per second. Display inches/feet and degrees where useful, with explicit unit labels and one conversion boundary.

Robot coordinates: +X forward, +Y left, +Z up. Robot origin is the chassis footprint center at the nominal floor plane. Subsystem positions reference their box centers relative to that origin; local rotations are stored as quaternions. Named box faces are `+X`, `-X`, `+Y`, `-Y`, `+Z`, and `-Z`, independent of camera angle. Configure rendering and physics adapters consistently for Z-up.

### Robot Basics

Required inputs: name, frame length/width/height, bumper envelope, drive reduction, wheel diameter, and motor preset or explicitly entered free speed. Drive reduction is motor revolutions per wheel revolution; show this definition next to the input.

Also provide mass, module positions or wheelbase/trackwidth, maximum acceleration/deceleration, maximum angular speed and acceleration, and a measured loaded-speed override. Supply visibly labeled starting estimates rather than making users complete every advanced field.

Gear ratio alone is not a drivetrain model. The theoretical free-speed estimate is:

`speed = motorRPM / 60 / driveReduction × π × wheelDiameter`

Use a measured loaded speed when available. The initial model applies acceleration limits and per-module speed limits to holonomic commands. Combined translation and rotation must be desaturated together. Use collision-aware chassis motion without teleporting through field obstacles. Treat the model as planar, calibrated swerve behavior; do not imply motor-current, traction, battery-sag, or tipping accuracy without implementing and validating those effects.

### Subsystem properties

| Field | Meaning |
| --- | --- |
| Stable ID and name | References survive renaming and graph layout changes |
| Local position/rotation | Attachment to robot origin |
| Box dimensions | Positive width, depth, and height |
| Capacity | Maximum total logical pieces owned by this subsystem |
| Accepted piece types | Season-defined type IDs; optional per-type limits within total capacity |
| Action Surfaces | Named face groups with stable IDs |
| Collision policy | Explicit solid block or functional envelope |

Default blocks represent solid simplified geometry. A functional-envelope setting preserves face interactions but disables the block's solid collision, making hollow intakes/storage abstractions possible. Display that setting clearly because it changes physical accessibility. Never infer mass from the volume of these abstract boxes.

Subsystems are rigidly attached in the first release. Movable arms, elevators, turrets, or compliant mechanisms require a later kinematics capability or a defined season-specific special action. Fixed boxes must not silently pretend to simulate those mechanisms.

## 6. Action Surface definitions

Every surface has ID, name, owner subsystem, one or more face IDs, type, accepted game-piece types, logical action binding, trigger mode, and cycle/cooldown settings. Multi-face groups share these settings and one action state. Contact with two faces of the same group never captures the same piece twice.

### Intake — green

An enabled intake captures a compatible physical piece when it intersects the outward-facing sensor region and passes accessibility, capacity, and season legality checks. The sensor is a thin face-aligned volume with an explicit tolerance; it is not the entire subsystem box. Use swept tests or continuous collision detection where fast motion could skip it. Solid geometry must not allow capture through an intervening wall.

Intake admission also requires an outgoing graph route. On acceptance, reserve one slot in the owning subsystem, remove the piece's physical body, and create one logical token at the intake surface node. Both changes occur atomically. If full, disabled, incompatible, or blocked, the piece stays physical. Default intake staging capacity is one token per surface, configurable only within subsystem capacity.

An intake cycle interval limits repeated captures. Graph transfer duration alone must not accidentally grant unlimited external capture throughput.

### Outtake — red

An outtake stages a logical token at its surface node until its action is enabled, its cooldown has elapsed, and a valid spawn pose exists. Only successful release removes the token from internal inventory.

Required outtake configuration:

- Exit speed, in meters per second, relative to the robot at the release point.
- Exit direction, with local yaw/pitch and a visible arrow.
- Exit orientation of the game piece, expressed as local rotation. This is distinct from travel direction and matters for nonspherical pieces.
- Exit angular velocity vector in radians per second in the surface's defined launch frame.
- Release face and position on that face; default to its center. A multi-face group has one explicitly selected release face, not simultaneous releases from every face.
- Minimum release interval and compatible piece types.

At release, transform the configured pose into world coordinates. Add robot translational velocity and the robot rotation contribution at the launch point:

`pieceVelocityWorld = robotLinearVelocity + robotAngularVelocity × releaseOffsetWorld + rotationWorld × exitVelocityLocal`

By default, add robot angular velocity to the rotated configured piece spin; document that convention in the inspector. Spawn the full piece just outside the selected face, accounting for its orientation and dimensions. Check for obstruction. A blocked spawn retains the token and reports Blocked Outtake; never delete it or force it through geometry. After a valid release, normal physical collision resumes. Any release-contact grace is limited to the owning surface and cannot suppress field collisions.

### Special — purple

Special is an extension point with a concrete season-defined behavior ID, not a generic score button. The selected season supplies a label, parameter schema, eligibility rules, timing, and runtime implementation. Examples could include constrained placement or engaging a field interaction.

A special behavior declares whether it consumes, emits, holds, or transforms game-piece tokens, or operates without a piece. Its graph ports follow that declaration. Non-piece actions cannot be connected as if they were storage. Unsupported behaviors produce a validation error. Actions may update score only through the season rules engine after required geometry and state conditions are satisfied.

## 7. Travel Path Graph

### Visual design

Open the graph using the on-screen Travel Path Graph button. Use a resizable overlay or split view so the field remains available. Show subsystem inventory nodes and their Action Surface nodes, with labeled arrows, draggable positions, pan/zoom, zoom-to-fit, and an overview map when needed.

Select a node to select its corresponding 3D object. Select an arrow to edit transfer time and binding. Display edge labels such as `Feed • 0.35 s`. In Run mode, show token counts, in-flight progress, reserved capacity, and block reasons. Graph layout has no physical meaning and never changes transfer time.

### Supported connections

| Source | Destination | Semantics |
| --- | --- | --- |
| Intake surface | Its owning subsystem | Complete capture staging into available subsystem inventory |
| Subsystem | Another subsystem | Transfer internally; destination acquires ownership after delivery |
| Subsystem | Its own outtake surface | Stage a piece for physical release |
| Subsystem or piece-capable special surface | Compatible special/subsystem port | Follow the special behavior's declared token contract |

For simplicity, initial-release intake and outtake surfaces attach to their owning subsystem in the graph. To feed another mechanism, connect the two subsystem nodes. Direct intake-to-outtake and arbitrary surface-to-surface connections are rejected unless a future schema gives them explicit ownership semantics. This preserves the requested subsystem/surface workflow while avoiding ambiguous storage capacity.

Each edge stores stable ID, source/target node IDs, duration, binding, trigger mode, accepted piece types, priority, and concurrency limit. Default concurrency is one in-flight piece per edge. Two-way transport requires two arrows. Cycles are permitted with positive durations. Self-loops and zero-duration transfer edges are invalid in the initial release.

### Button behavior

Define logical actions such as Intake, Feed, and Shoot, mapped to keyboard keys and controller buttons. Surface and edge inspectors each expose a binding field. They may select the same logical action, allowing one button to enable an intake surface and its outgoing edge together. Save default mappings in the robot; allow per-user device remapping without changing robot behavior.

Support Hold and Press modes. Hold continuously permits new work while active. Press grants one operation request on the rising edge; discard it at the end of the tick if ineligible, avoiding unexpected delayed shots. Default intake/transfer to Hold and single-shot outtake to Press; users may choose Hold for repeated shooting.

A transfer already started completes even if its binding is released. Button release prevents new starts. Pause freezes simulation time. Reset cancels all transfers and reconstructs initial state. Focus loss or controller disconnection clears input and pauses the run. While typing in an inspector, simulation controls do not receive keyboard events.

Shared bindings are allowed. If they enable competing edges from the same source, use explicit priority, then stable edge ID as a deterministic tie-breaker. Warn about ambiguous equal priorities. Input is sampled once per tick; browser key-repeat events do not create extra presses.

### Ownership, capacity, and scheduling

A physical piece and a logical token represent the same stable piece ID. Exactly one representation may own it at any moment. Token locations include intake staging, subsystem inventory, in-flight transfer, and outtake/special staging.

All staged and in-flight tokens count against an owning subsystem. A surface is not extra capacity. For a cross-subsystem transfer, the source keeps ownership while in transit and the destination reserves a slot. On completion, ownership moves to the destination and its reservation converts to occupancy. Transfers within one subsystem do not reserve a second capacity slot. This conservative rule prevents a robot from temporarily exceeding its modeled storage by filling its arrows.

Scheduler invariants:

- `ownedTokens + incomingCrossSubsystemReservations <= capacity` for every subsystem, including per-type limits.
- A token has at most one active transfer; a destination slot has at most one reservation.
- Only compatible, available tokens may start. Select FIFO by arrival tick, then piece ID.
- At start, lock the token, reserve the destination if needed, and record completion tick.
- Edge concurrency limits throughput; duration is travel latency. With concurrency one, an edge taking 0.4 seconds can deliver at most 2.5 pieces/second in steady operation.
- With no destination room, the token remains at the source and reports Capacity Blocked.
- A capacity deadlock is visible in diagnostics; the engine never breaks it by teleporting or deleting pieces.
- Completion events cannot fail for capacity because their reservations already exist.

### Example robot

Create Collector (capacity 1), Hopper (capacity 4), and Launcher (capacity 1). Assign a green face group to Collector and a red face to Launcher. Connect:

| Connection | Action | Duration |
| --- | --- | --- |
| Collector Intake → Collector | Intake | 0.10 s |
| Collector → Hopper | Intake | 0.25 s |
| Hopper → Launcher | Feed | 0.35 s |
| Launcher → Launcher Outtake | Shoot | 0.05 s |

Holding Intake captures pieces and moves them into Hopper as room becomes available. Holding Feed fills Launcher. Configure Shoot as Hold on both the final edge and the outtake to move and release pieces with one held button. If Shoot uses Press for both, the initial press starts the edge but cannot also release a token that has not arrived; a second press is required. The editor explains this interaction and recommends Hold for chained operations.

## 8. Simulation runtime

Use a fixed proposed physics tick of 1/120 second, independent of render rate, with integer tick deadlines for graph events. Quantize durations upward to ticks and show the effective duration. Validate the tick rate against actual season collision and projectile tests rather than assuming it is sufficient for every piece.

Each tick executes in a documented order:

1. Sample normalized controls and apply phase restrictions.
2. Complete due graph transfers in stable order.
3. Start eligible transfers using a snapshot of currently available tokens; a token can start only one edge per tick.
4. Execute eligible outtake/special actions and create resulting physical bodies.
5. Apply drive commands and advance external physics.
6. Resolve intake capture candidates atomically in stable order.
7. Process season scoring, penalties, field state, and match clock.
8. Append events and metrics, then publish a render snapshot when due.

Capture admission rejects pieces already made ineligible by an earlier event. Season event resolution must assign each piece transition once, including ties between scoring and capture volumes. The season defines contact priority where generic ordering is insufficient.

The worker owns the clock. Rendering interpolates between snapshots. If computation falls behind, report reduced simulation speed or pause; do not skip physics ticks and silently change results. Background tabs pause by default.

### Physical scope

Simulate field obstacles, bumpers/chassis collision, configured subsystem solids, loose game pieces, launched trajectories, gravity, and season scoring geometry. Internal transport remains entirely logical.

A game-piece definition provides mass, visual mesh, collider or compound colliders, dimensions, inertia where needed, friction, restitution, and optional validated aerodynamic behavior. Support a registration interface for new shapes and force models. “Any game piece” means extensible developer support, not that one sphere model faithfully represents every object. Rings, compressible balls, irregular pieces, and flexible pieces may require approximations or new models. Label those approximations in results.

Simple ballistic prediction does not automatically model lift, drag, deformation, or spin-dependent flight. A season must explicitly enable and calibrate those effects when needed. Likewise, planar drive behavior cannot substantiate tipping or climbing-force conclusions.

### Repeatability

Save the exact robot revision, scenario, season version, engine/physics versions, initial state, random seed, and normalized tick-indexed inputs. Seed any shot or intake variability. Promise repeatability only within the tested engine/build environment; record periodic authoritative state snapshots for replay and diagnosis across environments. Playback from recorded states and re-simulation from inputs are separate modes.

## 9. Developer-authored seasons

A season package contains:

| Component | Contents |
| --- | --- |
| Manifest | Season ID/year/title, semantic version, engine compatibility, asset hashes |
| Field | Render meshes, collision shapes, dimensions, reference frames, starting positions |
| Piece registry | Type IDs, geometry, physical properties, allowed initial placements |
| Match model | Phases, duration, enabled actions, starting inventory and field state |
| Rules | Scoring predicates, possession restrictions, relevant penalties, reset behavior |
| Interaction registry | Special behavior implementations and inspector parameter schemas |
| Test scenarios | Known scoring cases, boundary conditions, trajectory/contact fixtures |
| Calibration notes | Data sources, measured coefficients, approximations, unsupported rules |

Season hooks expose controlled operations for registering field objects, validating robots, evaluating interactions, advancing field state, and handling score events. All code is trusted and bundled through the normal build; user-supplied executable scripts are forbidden.

Adding a season means implementing a package, adding tests and assets, registering it, reviewing its rule coverage, and deploying. No user-facing season create/edit/upload endpoints exist. A new deployment adds the season to the main menu automatically.

Separate official-rule constraints from simulation capabilities. Offer Rules-Constrained and Experimental scenarios. Experimental runs clearly label violations such as impossible capacity or envelope; they do not silently change the robot. Rules-Constrained runs enforce only rules implemented by that season, and display the coverage list. A result must not claim comprehensive FRC legality from a partial rules model.

Pin runs to immutable season versions. Updating a season never silently rewrites saved results. Keep required historical packages/assets available for replay, or mark a run as archival playback-only if re-simulation is unavailable.

## 10. Data contracts and persistence

### Core records

| Record | Required content |
| --- | --- |
| RobotDocument | Schema version, robot ID, season ID, name, basics, subsystems, surfaces, graph edges/layout, default control map, assumptions |
| RobotRevision | Immutable document, revision number, author, timestamp, validation summary |
| RobotMetadata | Current revision, season, searchable name, creator/editor, archive state |
| Scenario | Season/version, field setup, start pose, preloads, duration, rule mode, seed, optional scripted controls |
| Run | Robot revision, scenario snapshot, engine/season versions, timestamps, metrics, model warnings, artifact references |
| Session | Opaque session hash, Google subject, role, expiration and revocation state |

Keep immutable definition data separate from runtime tokens, physical bodies, occupancy, reservations, and timers. Graph layout and camera position are editor metadata; they cannot affect physics.

### DynamoDB access patterns

Use an app-owned on-demand table. Proposed keys: `ROBOT#{id}` with `METADATA` and `REV#{number}` sort keys; `SCENARIO#{id}` with version records; `RUN#{id}` with `METADATA`; and `SIM_SESSION#{hash}` with session metadata. Use a season-scoped index for robot listing and a robot-scoped chronological index for run listing. Paginate all list endpoints.

Commit a revision and update the current-revision pointer atomically with a condition on the expected prior revision. Apply schema, graph, authorization, and size validation on the server. Invalid but well-formed drafts may be persisted with a non-runnable status; malformed or unsafe payloads are rejected. Names are display strings, never identifiers.

Keep robot documents within an explicit serialized size budget, initially proposed at 250 KiB including a reserve for database attribute overhead. Enforce limits on nodes, edges, and strings. If realistic models exceed that budget, move immutable definition bodies to private S3 before raising limits. Keep large input streams, trajectories, and replay snapshots in private S3; database records reference object keys and hashes. Use short-lived authorized upload/download URLs and a finalize step that checks size, type, ownership, and existence.

Retain production data on stack deletion, enable backups and point-in-time recovery, and retain revisions. Archive robots instead of destructive deletion. Keep backups and run artifacts under an explicit retention policy chosen during deployment.

### API surface

| Method and route | Behavior |
| --- | --- |
| `GET /api/auth/start`, `GET /api/auth/callback` | Google login flow |
| `GET /api/auth/session`, `POST /api/auth/logout` | Session status and revocation |
| `GET /api/seasons` | Published season summaries |
| `GET /api/seasons/{id}` | Manifest and supported capabilities |
| `GET /api/robots?seasonId=...` | Paginated shared library |
| `POST /api/robots` | Create initial shared draft |
| `GET /api/robots/{id}` | Metadata and current document |
| `POST /api/robots/{id}/revisions` | Save with expected revision and request idempotency key |
| `GET /api/robots/{id}/revisions/{revision}` | Load immutable version |
| `POST /api/robots/{id}/duplicate` | Create independent copy; validate season mapping |
| `PATCH /api/robots/{id}/archive` | Administrator archive/restore |
| `GET/POST /api/scenarios` | List/create shared scenario snapshots |
| `POST /api/runs` | Save run summary and artifact manifest |
| `GET /api/runs?robotId=...`, `GET /api/runs/{id}` | List and inspect saved results |
| `POST /api/runs/{id}/artifacts`, `POST /api/runs/{id}/finalize` | Authorized large-artifact upload and completion |

Return structured field errors and stable error codes. Return a conflict for stale revisions, unauthenticated/forbidden responses for access failures, and explicit request-size errors. No frame-by-frame network persistence, WebSocket infrastructure, or background simulation Lambda is required.

Autosave recoverable local drafts separately from explicit shared revision saves. On network loss, keep editing and testing a loaded robot, show Unsynced, and retry only after checking the current shared revision. Clear user-scoped recovery data on logout or offer an explicit discard policy for shared computers.

## 11. Engineering outputs

Each run shows duration, score by category, penalties where modeled, pickups, successful releases, scoring success, cycle times, pieces delivered per second, subsystem occupancy over time, edge utilization, and time blocked by capacity, input, cooldown, or missing pieces. Show transfer bottlenecks directly on the graph.

Define metrics precisely: throughput counts completed deliveries, not transfer starts. Intake-to-release time follows the stable piece ID. A scoring attempt begins at release and ends with a season-defined success/failure outcome or a declared timeout; denominator and unresolved attempts remain visible. Separate idle time from blocked time.

Allow comparison of two robot revisions using the same saved scenario and input sequence. Also support manual runs, but label them as driver-dependent rather than controlled comparisons. The minimum engineering release needs repeatable input recording, metric export to CSV, and side-by-side summaries. Parameter sweeps and scripted autonomous routes can follow later.

Every results view includes robot/season/engine versions, rule mode, calibration assumptions, and unsupported effects. Distinguish estimated parameters from measured parameters. Report sensitivity ranges when uncertainty materially changes a decision; do not present false precision.

## 12. Validation and usability

Validation issues link to the offending object, face, or arrow. Errors prevent Run; warnings permit it with visible assumptions.

Errors include invalid dimensions, non-finite numbers, missing bindings, missing node references, unknown piece types, impossible face references, unsupported special behaviors, zero/negative transfer durations, incompatible ports, and preloads exceeding capacity. Each surface group must stay on one subsystem, and each face must have a single assignment.

Warnings include unreachable storage, intakes without useful delivery routes, subsystems without an exit, potentially deadlocked cycles, equal-priority competing routes, trapped outtake spawn positions, uncalibrated drivetrain/trajectory parameters, and season-rule violations in Experimental mode. Deleting a referenced object previews affected edges and removes them only with the same undoable edit command.

Support undo/redo for geometry, properties, surface assignment, and graph changes. Numeric editing must be as capable as mouse gestures. Keep bindings visible in Run mode. Provide a small guided sample robot so a new user can draw, assign, connect, and run without understanding the implementation.

## 13. Verification and release criteria

| Area | Required verification |
| --- | --- |
| Ownership | Capture removes exactly one physical body; release creates exactly one; pieces cannot duplicate across simultaneous contacts |
| Capacity | Staged/in-flight pieces and reservations enforce total and per-type limits; full destinations block safely |
| Timing | Tick-quantized transfers complete at the defined time; rendering at different frame rates does not alter graph outcomes |
| Inputs | Hold/Press semantics, shared bindings, release during transfer, focus loss, and controller disconnect behave as specified |
| Graph | Cycles, parallel edges, multiple intake faces, priority contention, and deadlocks produce predictable behavior |
| Outtake | World transforms, moving-robot velocity, angular velocity, nonspherical orientation, and blocked spawning pass fixtures |
| Physics | No fast-piece tunneling in supported fixtures; obstacle collisions and scoring boundaries are checked |
| Seasons | At least two mechanically distinct piece/interaction test packages prove the extension boundary; published season rules have fixtures |
| Persistence | Stale save rejected; simultaneous writers cannot overwrite; network recovery preserves work; old revisions remain reproducible |
| Access | Wrong domain, expired/revoked sessions, forged records, unauthorized archival, and cross-site mutations rejected |
| End-to-end | Login → season → new robot → draw → assign → graph → save → run → compare → reopen on another account |

Initial performance target, to be measured on the team's actual school laptops: one robot with 20 subsystems, 40 Action Surfaces, 80 edges, and 100 active pieces; target 60 FPS rendering with stable fixed-step simulation. This is a benchmark target, not a verified capability. Complex seasons need their own benchmark. Reduce visual effects before reducing simulation fidelity. Load season assets lazily and report WebGL/WebAssembly initialization failures clearly.

Before relying on results for decisions, calibrate straight-line acceleration and loaded speed, compare timed real mechanism transfers with graph timings, and compare several real launches across distances. Record test conditions and acceptable error for each model. Improvements to a model increment its version and trigger relevant regression tests.

## 14. Implementation sequence

1. **Foundation:** FMEA-style serverless backend, Google access, shared robot CRUD, immutable revisions, schemas, and local development isolation. Independently select and scaffold the simulator frontend, including its UI framework and graph editor integration.
2. **Editor:** Field viewport, chassis basics, draw/edit subsystem prisms, face selection/grouping/colors, inspector, undo/redo, save/reload.
3. **Graph engine:** Node/edge editor, bindings, logical inventory, reservations, timed transfers, validation, deterministic fixtures.
4. **Simulation integration:** Worker, calibrated drive abstraction, external physics, intake capture, outtake transforms, pause/reset/step.
5. **First usable season:** Developer-authored field/pieces/rules, concrete special behavior where required, supported-rule display, calibration fixtures.
6. **Decision support:** Recorded scenarios/inputs, saved results, bottleneck diagnostics, CSV export, revision comparison, performance/access/concurrency testing.

The first engineering release includes all six stages. A visually complete editor without trustworthy measurements does not meet the product purpose. Add a second distinct season test package before declaring the architecture season-independent. Defer multiplayer, full CAD, full drivetrain electrical physics, automatic robot optimization, and general articulated-mechanism authoring.

## 15. Sources and architecture traceability

Repository sources inspected November 19, 2026, on `main`; links are live branch references rather than immutable commit pins. Only backend, authentication, persistence, and infrastructure patterns inform FMEA alignment; frontend sources do not constrain the simulator UI. Proposed simulator behavior and frontend technology choices are independent.

- [FMEA README — local service, Google OIDC, API and DynamoDB patterns](https://github.com/STMARobotics/fmea-app/blob/main/README.md)
- [FMEA service package — AWS SDK and Google authentication library](https://github.com/STMARobotics/fmea-app/blob/main/service/package.json)
- [FMEA deployment infrastructure — S3, CloudFront and API routing only](https://github.com/STMARobotics/fmea-app/blob/main/cdk/lib/frontend-stack.ts)
- [FMEA backend stack — DynamoDB, Lambda, API Gateway and session authorization](https://github.com/STMARobotics/fmea-app/blob/main/cdk/lib/backend-stack.ts)
- [Three.js official site](https://threejs.org/)
- [Rapier JavaScript documentation — WebAssembly initialization and separate rendering](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)

Deployment-time choices: application hostname, first production season, administrator list, target school-device benchmark, retention period, and measured model tolerances. These are configuration/release decisions; none require changing the core editor and graph model.
