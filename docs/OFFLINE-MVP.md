# Offline prototype scope

This is the first development slice of the supplied FRC simulator design. The user's request to start offline takes precedence over the design's backend-first implementation order. The design is a requirements reference, not an authorization to deploy infrastructure, configure accounts, or publish team data.

## Implemented

- TypeScript frontend, independent Three.js viewport, Rapier 3D simulation host (worker or in-page compatibility mode), and framework-independent timed graph scheduler.
- Developer-authored `Practice Lab` and blocky 2025 REEFSCAPE fixtures, continuous Drive sessions and 120 Hz physics. Geometry and scoring are approximate; no official match-rule or legality claim.
- Rectangular subsystem boxes; numeric position/dimensions/yaw/capacity/collision editing; 3D move/resize handles and inch-based property inputs; deletion and duplication; undo/redo.
- Named intake/outtake face groups, distinct colors and text labels, transition bindings and hold/press triggers, minimum action intervals, speed/direction/spin editing, explicit release face.
- Directed graph with draggable nodes, pan/zoom/fit, port connections, transfer latency, binding, priority, concurrency, token progress, owner inventory, reservations and capacity wait diagnostics.
- Collision-aware planar drive with acceleration/deceleration limits, four-corner module speed desaturation, physical chassis/subsystem solids, ball CCD, gravity, floor/walls/obstacle, face capture, blocked spawn retention, moving-robot launch velocity and spin.
- Editable Edit/Graph workspaces, automatic Drive play with navigation/focus pause and resume, keyboard and mouse action buttons; basic standardized gamepad mapping.
- Browser-local robot library, recovery draft and robot JSON import/export. Run recording/reporting remains implemented internally; the Results and help buttons are removed from the current workspace header.
- Runtime event log; escaped balls retain an explicit terminal ledger entry. Completed deliveries, capacity wait, input wait, empty time, busy time, intake-to-release time, pickup/release counts, and practice scores are measured separately.

- Focused Field, Inspector and Travel Path views, plus a resizable Field/Travel Path split. Camera-preset tabs and repeated workspace text have been removed.
- Undoable 3D translation/scale handles synchronized with numeric fields; staggered new graph nodes; drag-and-drop connections with target highlights and a temporary preview.
- Opaque yellow inventory fill from the bottom upward, driven by actual ownership; press-to-record bindings support Space, Shift, Enter, arrows, function keys and punctuation.

## Explicit approximations

All geometry uses meters, seconds, kilograms and radians. Robot coordinates are +X forward, +Y left, +Z up. The editor currently supports yaw-only subsystem rotation, rather than arbitrary quaternion editing. Outtake direction is relative to the subsystem frame (+X when yaw/pitch are zero), independently of the chosen release face. Robot point velocity and angular velocity are added at release.

The sole piece type is a rigid sphere of radius 0.09 m and mass 0.27 kg. Friction 0.6 and restitution 0.35 are starting estimates. There is no drag, lift, compliance, or calibrated spin effect. Orientation has no effect on this spherical piece. Floor friction is 0.7; robot contact friction is 0.1. The robot uses a velocity-controlled dynamic planar body with translation acceleration limits and fixed 6 rad/s² angular acceleration. It is not a force/current/traction model.

The chassis collider uses the entered chassis envelope. Visual bumper strips and wheel meshes are illustrative, not additional collision geometry. Solid boxes are attached collision geometry; functional envelopes have no solid collider. Block volume never determines robot mass.

Intake sensors use a thin face region, swept center-plane checks for crossing candidates, and a simplified approach ray to reject intervening solids. This is not complete swept-volume accessibility analysis, particularly for high-speed moving/rotating sensors. Intake staging is one token per surface and counts toward its owner's capacity. A cross-subsystem transfer retains source ownership and reserves one destination slot until delivery. Internal edges do not allocate an extra slot. Durations round upward to integer ticks. Edges finish even after controls release. Press actions only sample rising edges, and a press cannot release a token that is still in transit.

The target awards one point for a released ball center crossing Z=1.8 m downward, fully inside the rectangular mouth. This is a practice scoring sensor above the basket rim, not an official FRC goal. Scored pieces retire from physics; balls below Z=-2 m or beyond 25 m retire as escaped/unscored. All retired IDs remain accounted for. Releases without a score are labeled unscored or unresolved; the app does not claim a completed success-rate denominator.

The simulation host never skips ticks to catch up. It reports lag and pauses after a two-second stall. It publishes snapshots around 25–30 Hz; graph/HUD updates are throttled to roughly 10 Hz. Rendering interpolates between snapshots on every animation frame. Input replay re-simulates the captured robot and the same initial practice fixture to the original run's exact end tick. It is not archival state playback or a promise of cross-platform determinism. Rendering and graph layout do not influence the scheduler.

## Deferred from the complete design

- Google OIDC, domain authorization, shared library, authenticated APIs, DynamoDB/S3, AWS CDK, cloud deployment and multiuser optimistic concurrency.
- Full local revision browser, archive/restore workflow, scenario editing, preloads, seeds/variability, occupancy time-series charts and periodic authoritative state playback.
- Official season packages, special interactions, multiple piece types/per-type capacity, a second mechanically distinct season, full rule coverage and calibrated physical fixtures.
- Arbitrary 3D box rotations, fully accessible graph port keyboard gestures, surface context menu/group gestures, and configurable controller action bindings.
- School-laptop performance benchmarking and full engineering release verification. The design's 20-block/100-piece performance target has not been established by this build.

## Verification

`npm test` exercises graph deadlines, source ownership and destination reservations, FIFO/priority competition, hold/press actions, capacity blocking, validation/import checks, physical/logical handoff, fixture wall collision, blocked releases, moving-robot launch transforms, scoring boundaries, same-build input replay and CSV output. `npm run build` type-checks the whole source before bundling. Browser smoke testing confirmed numeric edits, undo, run/pause, driving/capture, launch, results and local storage. The browser download check was interrupted when the browser tool became unavailable; CSV generation is covered by automated tests, but the download dialog was not verified.

The 0.2 update adds tests for non-letter key normalization/execution, 45 successive non-overlapping graph placements, fill fractions and scale limits. Browser checks confirmed focused views, split sizing, actual 3D move/resize drags updating numeric fields, a connection created by dragging between ports, Space/Shift/Enter capture, a live Space-triggered shot without pausing, and a visible one-third yellow hopper fill. The user robot was exported before testing and verified exactly equal after undoing test edits.

API references used during implementation: [Three.js documentation](https://threejs.org/docs/) and [Rapier JavaScript setup](https://rapier.rs/docs/user_guides/javascript/getting_started_js/). Backend reference work is deferred until the online phase; this build makes no claim of implementing the FMEA service patterns yet.

The standalone file uses the in-page host to avoid opaque-origin worker restrictions. Served builds prefer a worker, falling back to the same host if startup fails. Editing does not require physics initialization.

Display units: linear values in inches, speeds in in/s, acceleration in in/s², mass in pounds and angular quantities in degrees. Saved JSON and physics use SI values internally.

## 0.5 interaction and outtake update

- Geo retains uppercase styling; Mona Sans details and field labels use normal case.
- Edit camera uses right-button orbit, middle/Ctrl-right pan, cursor-directed wheel zoom, and Onshape-style keyboard navigation. Left-button dragging is reserved for editing handles.
- Drive rotation uses left/right arrows, with WASD translation; Q/E remain available for action bindings. The Drive timer is removed.
- Outtakes default to a 1 x 1 grid. Optional unitsX/unitsY configure simultaneous release columns/rows, at most 100 cells. Ready pieces spawn in a face-aligned grid with diameter-plus-clearance spacing. Blocked slots retain logical ownership, other slots can launch, and one shared interval applies per batch. Existing 1 x 1 behavior and incoming graph transfers are preserved. Engine version is now 0.3.0.

## 0.6 action ownership and rendering

- Surface/owner links are mandatory, instantaneous and inherited from the surface's key/trigger. Old links are repaired on load with existing IDs retained where possible. Only subsystem-to-subsystem links have editable time, concurrency and binding. Intake capture enters the owner immediately. Outtake takes ready owner pieces directly on activation; blocked pieces remain owned and batches still share the action interval.
- Renderer interpolates translation, yaw and game-piece transforms per animation frame. Yaw crosses ±180 degrees along the short route, and paused/reset snapshots snap exactly. Instanced game pieces reduce draw calls; shadow maps and pixel ratio are bounded. Hidden Graph updates are suppressed in Drive.
- Running snapshots transmit recording deltas rather than cloning the whole accumulated input log. Full paused snapshots preserve replay history and remain immutable across resume.
- Engine version 0.4.0; app version 0.6.0. Fifty-three tests cover migration, inherited bindings, same-tick capture/release, conservation, interpolation, instancing and history deltas alongside existing checks.

## 0.7 transition settings

- Key and trigger belong only to graph transitions. Action surfaces retain geometry, rate and launch settings.
- Mandatory owner links default to Instant (0 seconds), with editable travel times up to 60 seconds. Existing transition settings survive normalization; legacy surface key/trigger fields migrate only when a link is missing, then are removed.
- Intake transit reserves owner capacity; timed outtake transitions deliver and launch after key release. Batched releases and collision checks remain intact.
- New action names default to <owner name> Action. Two-line graph labels are centered on their curves: key first, travel time second.
- App 0.7.0 / engine 0.5.0. TypeScript and 55 tests pass.

## 0.8 hosted backend

The offline scope above is retained for the explicit offline build. The default build is now the authenticated hosted app: Google Workspace OIDC, server-side opaque sessions and a shared DynamoDB robot library with immutable revisions. AWS/CDK configuration, release gates and exact supported API scope are documented in BACKEND.md. No live production deployment has been performed in this workspace.

## 0.9 state editing

- Named subsystem states contain geometry (including pitch/roll), capacity, collision behavior and state-specific actions. Exactly one default is mandatory. UI accordion allows one open state; state list order is immaterial.
- States graph is scoped to one selected subsystem, with draggable nodes/ports, bindings, trigger modes and timed transitions. Smoothstep geometry changes run at 120 Hz and interpolate visually between snapshots. Collision shapes follow the same geometry.
- Transitions reserve the lower capacity while moving; blocked capacity or in-use action pieces prevent a switch. State action routes are inactive during movement; no pieces are deleted or teleported by a state change.
- Solid boxes are the default for newly created robots. Legacy solid flags migrate without changes. Ignore collision is the inverse property exposed in each state.
- Inches inputs step by 0.5; speed is m/s and acceleration m/s². Drag-and-drop face assignment replaces the subsystem face dropdown. Launch previews cover all faces, 3D rotations, active outtakes and grid cells. Preview excludes collision and inherited drive/actuator velocities.
- Drive Restart resets the original design's defaults and the entire fixture.

## 0.10 editor refinements

- Editable linear geometry accepts only half-inch multiples, including imported designs, API saves and live 3D move/resize handles. Non-grid numeric input rounds on application; bounds also lie on the grid.
- The properties heading is the editable subsystem name; its redundant name section is removed. Vector labels sit beside their inputs.
- All state names end in exactly one ` State` suffix. The inspector tree lists every subsystem, its states and all state-owned actions, including duplicate action names.
- Geo remains the structural typeface for headings, navigation and action controls; Mona Sans retains normal capitalization for property and graph details.
- Action assignment uses a raised, tapered beam from the stationary button to the cursor, snapping to a visible available face. Escape, pointer cancellation or focus loss cancels assignment. No native dragged-button image is used.

## 0.11 released-key transitions

- State and Travel Path trigger selectors include Not Pressed. It continuously permits new work while the assigned key is released, including at startup.
- Shared trigger evaluation covers state transitions, subsystem transfers, intake capture and outtake staging. Existing timing, capacity, cooldown and state-activity rules remain in force.
- Trigger values round-trip through JSON and the authenticated API. The client checks the server's `not-pressed-trigger` capability before saving a design that uses it.

## 0.12 subsystem targeting

- Subsystem-level Targeting Mode: Turret, SOTM Turret, Aim with Drivetrain and Manual (default). Old designs migrate to Manual; copies retain settings.
- Turrets rotate about the vertical axis through their centers. Both modes limit yaw to half of the configured total degrees of freedom on either side of startup yaw. Reference yaw remains fixed across state changes. Visual interpolation respects bounded intervals.
- Targets come from the trusted field manifest. The nearest valid target is selected; the practice fixture currently has one basket. Outtake launch orientation is respected. SOTM iterates horizontal time of flight with inherited translation and angular point velocity; speed and elevation remain configured by the user.
- Drivetrain aiming engages for the subsystem's active-state actions while their input is engaged, or while their transfers remain pending. Press keys keep aiming engaged while held. Driver translation is retained; normal turn control returns after disengagement.
- Runtime, collider and rendered yaw agree. Automatic targeting preserves saved geometry, supports deterministic replay and resets with Drive Restart. API saves retain mode/range and require the advertised subsystem-targeting capability.
- Targeting does not check obstruction or ballistic reachability, change elevation/speed, or wait for alignment before firing. Dotted setting previews retain their existing no-inherited-motion limitation.

## 0.13 season fields and typed pieces

REEFSCAPE adds trusted fixed block geometry, Coral/Algae physics and editable capacity-based scoring prisms. Robot/Field tabs share the inspector header. Scoring surfaces consume compatible pieces on contact, retain inventory and award configurable points. Human-player releases support proximity and continuous cooldowns. Travel Path ports/routes are typed per season; action compatibility, shared capacity and state copying retain those types. Robots are season-bound and the API validates/preserves field settings. Browser recovery starts in a fresh v2 namespace. See REEFSCAPE-2025.md for exact implemented scope, default values, sources and approximations.

## 0.16 pile collision performance

- Collision groups route Coral-to-piece and flat-floor contacts through one outer cylinder, avoiding wall-pair multiplication. Robot/obstacle contact retains an open 24-box wall shell with <0.5 mm outer-radius excess. Fine scoring/clearance geometry remains 48 parts and scene queries omit the envelope.
- Small-piece seasons fall back to wall contacts. CCD, 120 Hz physics, mass, bounciness and typed ownership remain intact. Unchanged subsystem transforms are cached.
- `npm run benchmark:piles` reproduces crowded 18/36-piece driving cases. See PILE-PERFORMANCE.md for measurements, contact approximations and browser FPS limitations. Engine version is 0.11.0.

## 0.15 direct scoring placements

- Outtake release tests assigned scoring faces before requiring physical spawn clearance. The actual piece shape is swept from the action face to its candidate release position; compatible receivers with room take ownership directly without spawning an overlapping body.
- Full or incompatible touching receivers retain ownership in the robot and identify the rejection reason. An eligible overlapping receiver takes priority. Other physical outtakes retain their collision checks.
- Transfers preserve IDs, types, points, capacity, cycle timing, trigger/delay behavior and shared batch cooldown. Coral contact tests retain the open bore. Engine version is 0.10.0; saved document schemas are unchanged.

## 0.14 field interaction and piece fidelity

Field-mode ray picking selects scoring elements directly. Source cubes are replaced by non-rendered transform anchors; hanging cage centers and default nets align on the field centerline. Driver cameras move close behind the wall and slightly higher. Coral uses a hollow 48-part convex compound collider and a smooth open pipe mesh; Algae uses an analytic sphere collider and smooth mesh. All compound parts participate in scoring and release-clearance checks. Per-type 0–1 bounciness settings live in Field overview and persist through saves, initial staging, sources and outtakes.
