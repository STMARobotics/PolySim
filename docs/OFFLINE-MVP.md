# Offline prototype scope

This is the first development slice of the supplied FRC simulator design. The user's request to start offline takes precedence over the design's backend-first implementation order. The design is a requirements reference, not an authorization to deploy infrastructure, configure accounts, or publish team data.

## Implemented

- TypeScript frontend, independent Three.js viewport, Rapier 3D simulation host (worker or in-page compatibility mode), and framework-independent timed graph scheduler.
- One developer-authored `Practice Lab` ball fixture, fixed initial setup, continuous Drive sessions, 120 Hz physics. No official-season or legality claim.
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
