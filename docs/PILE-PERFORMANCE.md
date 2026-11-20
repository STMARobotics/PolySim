# Pile collision performance · 0.16

The reproduced failure was physics contact work. Every Coral had 48 convex wall colliders and CCD enabled. Pushing several together made the engine consider large numbers of thin-wall pairs and repeated sweeps. A deliberately crowded 18-Coral case averaged 641.27 ms per tick before the change; most of that was inside Rapier's world step.

## Collision routing

- Field obstacles and the robot collide with 24 overlapping tangent wall boxes per Coral. The entire bore remains open. At the current Coral dimensions, the maximum outer-radius excess is below 0.5 mm. Primitive box contacts avoid repeated convex-hull contact calculations. Render geometry remains the same smooth hollow mesh.
- Coral-to-piece and flat-floor contact use one massless outer-cylinder collider per Coral. Collision groups prevent wall-to-wall pairs between game pieces and keep the cylinder away from complex field geometry and robot subsystems. Algae remains an exact sphere. The cylinder is a conservative exterior approximation for piece-to-piece contact; it can stop some angled rim interactions slightly early.
- The envelope optimization is enabled only when every season piece's smallest dimension exceeds every tube's bore diameter. Seasons with pieces that could fit through a bore fall back to detailed wall contacts.
- Physical scoring, direct handoff and release clearance retain the finer 48-part hollow query geometry. Scene rays and overlap queries omit the cylinder envelope, preventing false obstruction or scoring in the empty bore.
- Mass belongs to the wall parts; the extra envelope contributes zero mass. Per-type restitution and friction apply to all active colliders. CCD, physics timestep, graph timings and piece ownership are preserved.
- Subsystem colliders update only when geometry, orientation or collision settings change. Turrets and animated states continue updating as they move.

This uses Rapier's supported [collision groups and multiple-collider bodies](https://rapier.rs/docs/user_guides/javascript/colliders/). No triangle-mesh dynamics, solver-iteration reductions or physics-tick skipping are introduced.

## Reproduction

```sh
npm run benchmark:piles
# Optional machine-readable output:
npm run benchmark:piles -- pile-results.json
```

The fixture in `tests/fixtures/pile.ts` stages a crowded pile in front of the robot, drives through it, returns the robot after 180 ticks and drives into it again. Each case measures 240 ticks, including initial overlap separation. Cases include empty-field, 18/36 Coral, 36 mixed pieces and 36 Algae. Initial placements deliberately overlap, so the test is more demanding than evenly scattered floor pieces. Human-player feeding is disabled; normal field geometry and scoring receivers remain present.

Use an otherwise idle machine for comparisons. Timing is reported by a benchmark rather than enforced as a flaky unit-test threshold. The regression tests instead verify collision routing, an open bore, correct mass, branch passage, piece-to-piece collision, fast-projectile CCD, small-piece fallback, deterministic replay and conservation through a crowded pile. Existing pickup, scoring and outtake tests remain in the full suite.

The local 18-Coral case dropped from 641.27 ms mean / 923.95 ms p95 before the change to 3.17 ms mean / 4.69 ms p95 afterward. The final 36-piece mixed case measured 5.08 ms mean / 6.99 ms p95. The output report records all post-change cases. These are simulation CPU timings without browser rendering or FPS measurement. The deliberately overlapping 36-Coral case remains demanding at 8.60 ms mean / 11.07 ms p95, exceeding the 8.33 ms physics-tick budget on this machine. This change removes the reproduced severe stalls; it does not establish a universal 60 FPS guarantee for every device and pile size.

App 0.16.0 / engine 0.11.0. Document schemas and fixture versions are unchanged. The offline file still uses the shared in-page host for compatibility; HTTP playback prefers a worker.
