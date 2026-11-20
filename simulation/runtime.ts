import RAPIER from '@dimforge/rapier3d-compat';
import { normalizeBinding } from '../contracts/bindings';
import { DT, clone, ticksFor, validate, syncSurfaceLinks, type RobotDocument, type Surface, type Vec3 } from '../contracts/model';
import { practice } from '../seasons/practice';
import { GraphEngine } from './graph';
import { outtakeOffsets } from './outtake-grid';
import type { Controls, InputFrame, Snapshot } from './protocol';
const qz = (angle: number) => ({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) });
const rotate = (x: number, y: number, a: number): [
    number,
    number
] => [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
const zero = (): Controls => ({ x: 0, y: 0, turn: 0, held: [] });
export class Simulation {
    world: RAPIER.World;
    robot: RAPIER.RigidBody;
    graph: GraphEngine;
    bodies = new Map<string, RAPIER.RigidBody>();
    previous = new Map<string, Vec3>();
    tick = 0;
    score = 0;
    pickups = 0;
    releases = 0;
    scored = 0;
    cycles: number[] = [];
    escaped: string[] = [];
    log: string[] = [];
    blocked: string[] = [];
    recording: InputFrame[] = [];
    private lastInput = '';
    private prevHeld = new Set<string>();
    private cooldown = new Map<string, number>();
    private released = new Set<string>();
    private replayIndex = 0;
    private replayControls = zero();
    constructor(public document: RobotDocument, private replay?: InputFrame[]) {
        document = this.document = syncSurfaceLinks(clone(document));
        const errors = validate(document).filter(i => i.level === 'error');
        if (errors.length)
            throw Error(errors[0].message);
        this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
        this.world.timestep = DT;
        this.graph = new GraphEngine(document);
        const fixed = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z).setFriction(0.7).setRestitution(0.25));
        fixed(0, 0, -0.1, practice.length, practice.width, 0.2);
        fixed(-6.1, 0, 0.3, 0.2, 8.4, 0.6);
        fixed(6.1, 0, 0.3, 0.2, 8.4, 0.6);
        fixed(0, -4.1, 0.3, 12.4, 0.2, 0.6);
        fixed(0, 4.1, 0.3, 12.4, 0.2, 0.6);
        const o = practice.obstacle;
        fixed(o.x, o.y, o.height / 2, o.length, o.width, o.height);
        const t = practice.target;
        fixed(t.x, t.y, t.height - 0.4, t.depth, t.width, 0.12);
        fixed(t.x + t.depth / 2, t.y, t.height - 0.25, 0.08, t.width, 0.3);
        fixed(t.x - t.depth / 2, t.y, t.height - 0.25, 0.08, t.width, 0.3);
        fixed(t.x, t.y - t.width / 2, t.height - 0.25, t.depth, 0.08, 0.3);
        fixed(t.x, t.y + t.width / 2, t.height - 0.25, t.depth, 0.08, 0.3);
        const b = document.basics;
        this.robot = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(practice.start[0], practice.start[1], 0).setGravityScale(0).setCcdEnabled(true));
        this.robot.setEnabledTranslations(true, true, false, true);
        this.robot.setEnabledRotations(false, false, true, true);
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.length / 2, b.width / 2, b.height / 2).setTranslation(0, 0, b.height / 2).setMass(b.mass).setFriction(0.1), this.robot);
        for (const s of document.subsystems)
            if (s.solid)
                this.world.createCollider(RAPIER.ColliderDesc.cuboid(...s.size.map(n => n / 2) as Vec3).setTranslation(...s.position).setRotation(qz(s.yaw)).setDensity(0), this.robot);
        for (const p of practice.pieces)
            this.spawn(p.id, p.position, [0, 0, 0], [0, 0, 0]);
        this.world.step();
    }
    pose() { const p = this.robot.translation(), q = this.robot.rotation(); return { x: p.x, y: p.y, yaw: 2 * Math.atan2(q.z, q.w) }; }
    private event(s: string) { this.log.unshift(`${(this.tick * DT).toFixed(2)} s  ${s}`); this.log.length = Math.min(40, this.log.length); }
    private spawn(id: string, position: Vec3, velocity: Vec3, spin: Vec3) {
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...position).setLinvel(...velocity).setAngvel({ x: spin[0], y: spin[1], z: spin[2] }).setCcdEnabled(true));
        this.world.createCollider(RAPIER.ColliderDesc.ball(practice.radius).setMass(practice.mass).setFriction(0.6).setRestitution(0.35), body);
        this.bodies.set(id, body);
    }
    private surfaceFrame(s: Surface) {
        const b = this.document.subsystems.find(b => b.id === s.owner)!, pose = this.pose();
        const face = s.faces[0], axis = face.endsWith('X') ? 0 : face.endsWith('Y') ? 1 : 2, sign = face[0] === '+' ? 1 : -1;
        const normal: Vec3 = [0, 0, 0];
        normal[axis] = sign;
        const offset: Vec3 = [0, 0, 0];
        offset[axis] = b.size[axis] / 2 * sign;
        const r = rotate(offset[0], offset[1], b.yaw);
        const center: Vec3 = [b.position[0] + r[0], b.position[1] + r[1], b.position[2] + offset[2]];
        const w = rotate(center[0], center[1], pose.yaw), n = rotate(normal[0], normal[1], pose.yaw + b.yaw);
        return { b, axis, sign, angle: pose.yaw + b.yaw, center: [pose.x + w[0], pose.y + w[1], center[2]] as Vec3, normal: [n[0], n[1], normal[2]] as Vec3 };
    }
    step(input: Controls = zero()) {
        this.tick++;
        this.blocked = [];
        if (this.replay) {
            while (this.replayIndex < this.replay.length && this.replay[this.replayIndex].tick <= this.tick)
                this.replayControls = this.replay[this.replayIndex++].controls;
            input = this.replayControls;
        }
        const key = JSON.stringify(input);
        if (key !== this.lastInput) {
            this.recording.push({ tick: this.tick, controls: clone(input) });
            this.lastInput = key;
        }
        const held = new Set(input.held), pressed = new Set(input.held.filter(k => !this.prevHeld.has(k)));
        this.prevHeld = held;
        this.graph.tick(this.tick, held, pressed);
        const enabled = (s: Surface) => { const e = this.graph.transition(s.id); return (e.trigger === 'hold' ? held : pressed).has(normalizeBinding(e.key)!) && this.tick >= (this.cooldown.get(s.id) ?? 0); };
        // Staged outtakes retain ownership until a collision-free physical spawn exists.
        for (const s of this.document.surfaces.filter(s => s.type === 'outtake' && this.tick >= (this.cooldown.get(s.id) ?? 0))) {
            const candidates = [...this.graph.tokens.values()].filter(t => t.node === s.id && !t.flight);
            const frame = this.surfaceFrame(s);
            const offsets = outtakeOffsets(s.unitsX ?? 1, s.unitsY ?? 1, candidates.length, frame.axis, 2 * practice.radius + .02);
            let released = 0;
            for (const [index, offset] of offsets.entries()) {
                const token = candidates[index], tangent = rotate(offset[0], offset[1], frame.angle);
                const p = frame.center.map((n, i) => n + frame.normal[i] * (practice.radius + .045) + (i === 2 ? offset[2] : tangent[i])) as Vec3;
                const blocked = this.world.intersectionWithShape({ x: p[0], y: p[1], z: p[2] }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(practice.radius));
                if (blocked) {
                    this.blocked.push(`Blocked outtake: ${s.name}`);
                    continue;
                }
                const pose = this.pose(), v = this.robot.linvel(), omega = this.robot.angvel().z;
                const dir = rotate(Math.cos(s.pitch) * Math.cos(s.yaw), Math.cos(s.pitch) * Math.sin(s.yaw), frame.angle);
                const velocity: Vec3 = [v.x - omega * (p[1] - pose.y) + s.speed * dir[0], v.y + omega * (p[0] - pose.x) + s.speed * dir[1], s.speed * Math.sin(s.pitch)];
                const spin = rotate(s.spin[0], s.spin[1], frame.angle);
                this.spawn(token.id, p, velocity, [spin[0], spin[1], s.spin[2] + omega]);
                this.graph.tokens.delete(token.id);
                this.released.add(token.id);
                this.releases++;
                released++;
                this.cycles.push((this.tick - token.captured) * DT);
                this.event(`Released ${token.id}`);
            }
            if (released) this.cooldown.set(s.id, this.tick + ticksFor(s.interval));
        }

        const b = this.document.basics, pose = this.pose();
        let x = input.x * b.loadedSpeed, y = input.y * b.loadedSpeed, w = input.turn * b.angularSpeed;
        // Desaturate translation and rotation together at the four module positions.
        const max = Math.max(...[-1, 1].flatMap(sx => [-1, 1].map(sy => Math.hypot(x - w * sy * b.width / 2, y + w * sx * b.length / 2))));
        if (max > b.loadedSpeed) {
            const f = b.loadedSpeed / max;
            x *= f;
            y *= f;
            w *= f;
        }
        const current = this.robot.linvel(), dx = x - current.x, dy = y - current.y, mag = Math.hypot(dx, dy), limit = b.acceleration * DT;
        this.robot.setLinvel({ x: current.x + dx * Math.min(1, limit / (mag || 1)), y: current.y + dy * Math.min(1, limit / (mag || 1)), z: 0 }, true);
        const oldW = this.robot.angvel().z;
        this.robot.setAngvel({ x: 0, y: 0, z: oldW + Math.max(-6 * DT, Math.min(6 * DT, w - oldW)) }, true);
        this.previous.clear();
        for (const [id, body] of this.bodies) {
            const p = body.translation();
            this.previous.set(id, [p.x, p.y, p.z]);
        }
        this.world.step();
        // A descending center crossing the fixture opening is the sole scoring rule.
        const target = practice.target;
        for (const [id, body] of this.bodies) {
            const p = body.translation(), prev = this.previous.get(id)!;
            if (this.released.has(id) && prev[2] >= target.height && p.z < target.height) {
                const f = (prev[2] - target.height) / (prev[2] - p.z), x = prev[0] + (p.x - prev[0]) * f, y = prev[1] + (p.y - prev[1]) * f;
                if (Math.abs(x - target.x) < target.depth / 2 - practice.radius && Math.abs(y - target.y) < target.width / 2 - practice.radius) {
                    this.world.removeRigidBody(body);
                    this.bodies.delete(id);
                    this.released.delete(id);
                    this.scored++;
                    this.score++;
                    this.event(`Scored ${id}`);
                    continue;
                }
            }
            if (p.z < -2 || Math.abs(p.x) > 25 || Math.abs(p.y) > 25) {
                this.world.removeRigidBody(body);
                this.bodies.delete(id);
                this.released.delete(id);
                this.escaped.push(id);
                this.event(`${id} left fixture (retired, unscored)`);
            }
        }
        for (const s of this.document.surfaces.filter(s => s.type === 'intake' && enabled(s))) {
            let captured = false;
            for (const face of s.faces) {
                const frame = this.surfaceFrame({ ...s, faces: [face] });
                for (const [id, body] of [...this.bodies].sort(([a], [b]) => a.localeCompare(b))) {
                    const p = body.translation(), prev = this.previous.get(id) ?? [p.x, p.y, p.z];
                    const toLocal = (v: Vec3): Vec3 => { const r = rotate(v[0] - frame.center[0], v[1] - frame.center[1], -frame.angle); return [r[0], r[1], v[2] - frame.center[2]]; };
                    const a = toLocal(prev), z = toLocal([p.x, p.y, p.z]), axis = frame.axis;
                    const da = a[axis] * frame.sign, dz = z[axis] * frame.sign;
                    const near = Math.abs(dz) < practice.radius + 0.055 && dz >= -0.035;
                    const crossed = da > practice.radius && dz < practice.radius && dz >= -practice.radius;
                    if (!near && !crossed)
                        continue;
                    const f = crossed ? Math.min(1, Math.max(0, (da - practice.radius) / (da - dz))) : 1;
                    const sample = a.map((v, i) => v + (z[i] - v) * f);
                    if (sample.some((n, i) => i !== axis && Math.abs(n) > frame.b.size[i] / 2 + practice.radius * 0.7))
                        continue;
                    // Check the contact approach against solid field and other solid subsystem geometry.
                    const origin = { x: frame.center[0] + frame.normal[0] * 0.025, y: frame.center[1] + frame.normal[1] * 0.025, z: frame.center[2] + frame.normal[2] * 0.025 };
                    const delta = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
                    const hit = this.world.castRay(new RAPIER.Ray(origin, delta), 1, true, undefined, undefined, undefined, undefined, c => c.parent()?.handle !== body.handle);
                    if (hit)
                        continue;
                    if (this.graph.capture(id, s.id, this.tick)) {
                        this.world.removeRigidBody(body);
                        this.bodies.delete(id);
                        this.pickups++;
                        this.cooldown.set(s.id, this.tick + ticksFor(s.interval));
                        this.event(`Captured ${id}`);
                        captured = true;
                        break;
                    }
                }
                if (captured)
                    break;
            }
        }
        this.graph.assertInvariants();
        void pose;
    }
    snapshot(running = false, slow = false, includeRecording = true): Snapshot {
        return { tick: this.tick, running, pose: this.pose(), pieces: [...this.bodies].map(([id, b]) => { const p = b.translation(), q = b.rotation(); return { id, position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] }; }), tokens: this.graph.snapshot(), edgeMetrics: clone(this.graph.metrics), score: this.score, pickups: this.pickups, releases: this.releases, scored: this.scored, escaped: [...this.escaped], cycles: [...this.cycles], log: [...this.log], blocked: [...this.blocked], recording: includeRecording ? clone(this.recording) : [], slow };
    }
    free() { this.world.free(); }
}
export { RAPIER };
