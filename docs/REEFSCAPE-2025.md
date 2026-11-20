# REEFSCAPE 2025 fixture

## References read

- User-supplied `2025GameManual.pdf`, printed pages 19–20, 23–28, 32–34, 45, 47 and 50. These cover the physical field, structures, game-piece dimensions, initial staging and scoring locations/point values. No robot-construction or match-rule sections were needed.
- [WPILib v2025.3.2 welded field layout](https://raw.githubusercontent.com/wpilibsuite/allwpilib/v2025.3.2/apriltag/src/main/native/resources/edu/wpi/first/apriltag/2025-reefscape-welded.json). Reef centers are inferred from opposing reef tag faces, clarifying that the manual's 12 ft reference locates the near face. Processor X and corner-panel positions use the same layout as anchors. The manual's nominal field dimensions are retained.

## Fixed geometry

The trusted `seasons/reefscape.ts` fixture defines an approximately 690.875 × 317 inch floor, perimeter walls with processor gaps, four chamfered Coral station panels, two reefs, branch/post blocks, the barge, cages and simple Algae support pads. Coordinates are centered on the field with +Z normal to its floor. Blue is at negative X. Obstacles use rectangular blocks with optional rotation; there are no imported CAD meshes, cloth or high-fidelity mechanisms.

The reef/processor locations and scoring heights are anchored to reference dimensions. Block thicknesses, branch details, cage supports, net/prism center positions, source offsets and staging marks are approximations for local testing. Small rest pads keep reef Algae staged at usable heights. Fixed obstacle geometry cannot be selected, moved, resized or submitted as editable field configuration. It is compiled into the trusted simulation and offline bundle; authenticated clients can also read it from the season endpoint.

## Pieces

| Type | Physics/render proxy | Dimensions | Mass |
| --- | --- | --- | --- |
| Coral | Hollow rigid pipe; 24 dynamic wall boxes, 48 query wall sections | 11.875 in long, 4.5 in outside diameter, 4 in bore | 0.65 kg, within the manual's stated range |
| Algae | Sphere | 16.25 in diameter | 0.4 kg estimate; not specified in the inspected manual text |

Initial staging contains six floor-mark Coral, six stacked Algae and twelve reef Algae. No robot preload is enforced. Coral's compound collider retains its open bore and follows the configured release orientation. Each dynamic wall box has an equal share of the total mass. Dynamic outer-radius excess stays below 0.5 mm; the finer hollow query geometry has about 0.13 mm radial faceting. Piece-to-piece and flat-floor contact use an outer-cylinder envelope, as described below. The display uses a 64-segment lathed pipe, including inner wall and annular ends. Algae uses an exact spherical collider and a 48 × 32-segment display sphere. IDs and piece types persist through intake, travel, outtake, human-player release and scoring. Pieces remain rigid: deformation and material flex are not modeled.

Field overview exposes bounciness for every piece type, default 0.35, bounded to 0–1. All parts of a Coral body receive the configured coefficient. The same setting applies to initial, source-introduced and outtaken pieces. Field and robot colliders have zero restitution; game pieces use Rapier's Max combine rule, so their setting directly controls rebound against those surfaces and the more elastic coefficient wins for piece-to-piece contacts.

## Editable receivers

The default configuration has 88 rectangular receivers: six L1 trough faces and twelve locations at each of L2/L3/L4 for each reef, plus two processors and two nets. Defaults use TELEOP points: L1 2, L2 3, L3 4, L4 5, processor 6 and net 4. Branch capacity defaults to one, trough sections to twelve, processor/net to one hundred; these capacities are simulator defaults and can be changed.

Each receiver has points, capacity, accepted types and scoring-surface face groups. Surface types must be a subset of the receiver's accepted types. Geometry supports translation, dimensions, yaw, pitch and roll; inch fields and live transforms snap to half inches. Receivers have independent field coordinates and do not move with the robot.

Contact tests use the actual piece collision shape against a thin oriented scoring face. A swept crossing check prevents a fast piece from skipping a face between physics ticks. A piece is consumed once, retained as `{id,type}` in receiver inventory and awards the receiver's configured points. Capacity is shared across accepted types. Incompatible pieces, unassigned faces and full receivers do not consume pieces. Scoring does not require a prior robot release or a descending crossing.

This is the requested simplified contact model. It does not implement official branch occupancy judgments, end-of-match assessment, autonomous/teleop periods, robot contact exclusions, alliance restrictions, penalties, ranking points, cage/park scoring or processor recycling. Scored Algae stays in receiver capacity rather than being automatically reintroduced.

## Robot/field controls

Robot and Field share the existing inspector header. Field mode offers scoring elements, scoring surfaces and human-player releases. Click scoring boxes in the 3D view to select them; field picking uses the field object map rather than the robot map. Static obstacles remain outside editable object maps. Move/Resize applies to scoring boxes. Human-player releases use invisible transform anchors, selected from the hierarchy, with no floating blue cube geometry. Switching to Field frames the whole field; switching back restores the robot camera. No additional workspace tabs are added.

Hanging cage centers lie on X=0, as do new net receiver defaults. Existing pre-update net defaults at their original X offset are centered on first load; subsequent explicit edits retain their positions. The camera positions for stations 1–3 stay behind the alliance wall, 0.3 m from its plane and 1.9 m above the floor.

Subsystem Travel Path nodes expose Coral entry, Algae entry, Coral exit and Algae exit. Surface actions accept Coral, Algae or both. Each type has a persistent port color, a matching route and separate transition timing/binding. Permanent action/owner links are generated per compatible type. All types share subsystem capacity. Parallel typed routes use separated curves/labels. States retain their generic single entry/exit ports.

Targeting uses non-full scoring receivers compatible with the activated typed action. It remains a horizontal targeting approximation, not an automatic shot-validity or official-rule system.

## Pile physics

As of 0.16, robot/obstacle contact uses an open 24-box Coral wall shell with less than 0.5 mm outer-radius excess. Piece-to-piece and flat-floor contacts use a massless outer-cylinder envelope, avoiding thousands of convex wall-pair tests while retaining wall mass, restitution and CCD. Hollow 48-part queries remain in use for scoring and release clearance; rays/overlap queries exclude the envelope. Piece-to-piece contact is a conservative exterior approximation. See PILE-PERFORMANCE.md for the benchmark and scope.

## Direct outtake placement

An outtake can hand a piece directly to a compatible assigned scoring face touched by its actual shape at release or along the short action-face-to-release path. The receiver must have capacity. Acceptance consumes the logical token, records its original ID/type in field inventory and awards points once, without creating an overlapping rigid body. The hollow Coral wall is swept as a compound shape; its empty bore is not a scoring contact.

Full or wrong-type touching receivers hold the piece in the robot and show the receiver reason. If several receivers overlap, an eligible one takes priority. No assigned-face contact means normal physical release and collision checks. Transition timing, bindings and batch cooldowns apply to both paths. This introduces no general collision exemption for the robot or field.

## Human-player releases

Four Coral stations default to proximity release. Threshold is measured from robot center to release position in the floor plane. While within threshold, a piece is introduced whenever the configured cooldown expires. Continuous release ignores robot proximity and repeats at its cooldown. Sources can be enabled/disabled; piece type, position and release velocity are editable. Cooldowns are bounded to 0.1–300 seconds, and release settings are saved with the robot's field configuration.

Sources pause introduction while 256 free physical pieces are present. This bounds an unattended continuous feed; scoring/intake can free room. Piece IDs remain unique across a run. Restart clears introduced pieces, scored inventory and source timers. The fixture does not impose match stock limits.

## Persistence and validation

Robot revisions include a season ID and editable field configuration. The API lists by season and refuses season changes on an existing robot. New receivers/releases belong to that robot's saved test configuration; immutable season geometry is shared. New robots start from season defaults.

Field schemas cap receivers at 128, releases at 16 and surface groups at six per receiver. Receiver points/capacity, bounciness and type compatibility are bounded and validated. Field geometry injection is rejected. The client requires `season-field-v1` and `typed-pieces` capabilities before saving REEFSCAPE designs, plus `piece-physics-v2` when saving bounciness settings. Backend geometry and manifest measurements use SI; the inspector displays inches and m/s.

Browser storage moves to namespace v2, intentionally ignoring previous local recovery data. Existing exported JSON files are preserved. The offline app needs no account, backend connection or network to run.
