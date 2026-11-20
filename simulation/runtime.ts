import {StateEngine} from './states';
import {TargetingEngine,aimingTurn,angleDelta} from './targeting';
import {orientation,rotate3,inverse,faceFrame,launchDirection,multiply,type Quat} from '../contracts/geometry';
import RAPIER from '@dimforge/rapier3d-compat';
import {triggerActive} from '../contracts/triggers';
import { DT, clone, ticksFor, validate, syncSurfaceLinks, type RobotDocument, type Surface, type Vec3 } from '../contracts/model';
import {seasonFor,acceptedTypes} from '../seasons/registry';
import type {SeasonDefinition} from '../contracts/field';
import {ensureField} from '../contracts/field-validation';
import {FieldEngine} from './field';
import {pieceShapes,pieceColliderDescriptors,supportsPieceEnvelopes,ENVIRONMENT_COLLISION_GROUPS,FLOOR_COLLISION_GROUPS,PHYSICAL_QUERY_GROUPS} from './piece-physics';
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
    states: StateEngine;
    season:SeasonDefinition;
    field:FieldEngine;
    pieceTypes=new Map<string,string>();
    private introduced=0;
    private pieceEnvelopes=false;
    targeting: TargetingEngine;
    private subsystemColliders = new Map<string,RAPIER.Collider>();
    private colliderShapes = new Map<string,string>();
    private colliderTransforms = new Map<string,string>();
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
        document = this.document = syncSurfaceLinks(ensureField(clone(document)));
        this.season=seasonFor(document.seasonId);this.field=new FieldEngine(document.field!);
        this.pieceEnvelopes=supportsPieceEnvelopes(this.season.pieceTypes);
        const errors = validate(document).filter(i => i.level === 'error');
        if (errors.length)
            throw Error(errors[0].message);
        this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
        this.world.timestep = DT;
        this.states = new StateEngine(document);
        this.graph = new GraphEngine(document);
        this.targeting = new TargetingEngine(document,this.states,this.graph,this.field.targets(),this.season.pieceTypes[0].radius+.045);
        const fixed = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z).setFriction(0.7).setRestitution(0).setCollisionGroups(FLOOR_COLLISION_GROUPS));
        fixed(0,0,-.1,this.season.length,this.season.width,.2);
        for(const g of this.season.geometry)if(g.solid)this.world.createCollider(RAPIER.ColliderDesc.cuboid(...g.size.map(v=>v/2) as Vec3).setTranslation(...g.position).setRotation(orientation(g.yaw ?? 0,g.pitch,g.roll)).setFriction(.7).setRestitution(0).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS));
        const b = document.basics;
        this.robot = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(this.season.start[0], this.season.start[1], 0).setGravityScale(0).setCcdEnabled(true));
        this.robot.setEnabledTranslations(true, true, false, true);
        this.robot.setEnabledRotations(false, false, true, true);
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.length / 2, b.width / 2, b.height / 2).setTranslation(0, 0, b.height / 2).setMass(b.mass).setFriction(0.1).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS), this.robot);
        for (const s of document.subsystems) {
            const collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(...s.size.map(n=>n/2) as Vec3).setTranslation(...s.position).setRotation(orientation(s.yaw,s.pitch,s.roll)).setDensity(0).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS),this.robot);
            collider.setEnabled(s.solid);this.subsystemColliders.set(s.id,collider);
        }
        for (const p of this.season.pieces)
            this.spawn(p.id,p.position,[0,0,0],[0,0,0],p.type);
        this.world.step();
        this.targeting.update(this.pose(),{x:0,y:0,omega:0},new Set(),new Set());
        this.updateSubsystemColliders();
    }
    pose() { const p = this.robot.translation(), q = this.robot.rotation(); return { x: p.x, y: p.y, yaw: 2 * Math.atan2(q.z, q.w) }; }
    private event(s: string) { this.log.unshift(`${(this.tick * DT).toFixed(2)} s  ${s}`); this.log.length = Math.min(40, this.log.length); }
    private spawn(id: string, position: Vec3, velocity: Vec3, spin: Vec3,type=this.season.pieceTypes[0].id,rotation:Quat={x:0,y:0,z:0,w:1}) {
        const definition=this.season.pieceTypes.find(p=>p.id===type)!;this.pieceTypes.set(id,type);
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...position).setRotation(rotation).setLinvel(...velocity).setAngvel({ x: spin[0], y: spin[1], z: spin[2] }).setCcdEnabled(true));
        const bounce=this.document.field!.bounciness![type];
        for(const descriptor of pieceColliderDescriptors(definition,this.pieceEnvelopes))this.world.createCollider(descriptor.setFriction(.6).setRestitution(bounce).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),body);
        this.bodies.set(id, body);
    }
    private surfaceFrame(s: Surface) {
        const b=this.document.subsystems.find(b=>b.id===s.owner)!,pose=this.pose(),local=faceFrame(b,s),robotQ=orientation(pose.yaw);
        const center=rotate3(local.center,robotQ),normal=rotate3(local.normal,robotQ);
        return {...local,b,center:[pose.x+center[0],pose.y+center[1],center[2]] as Vec3,normal,world:(v:Vec3)=>rotate3(rotate3(v,local.q),robotQ),local:(v:Vec3)=>rotate3(rotate3(v,inverse(robotQ)),inverse(local.q))};
    }
    private updateSubsystemColliders() {
        for(const sub of this.document.subsystems) {
            const collider=this.subsystemColliders.get(sub.id)!;
            const shape=sub.size.join(',');
            if(this.colliderShapes.get(sub.id)!==shape) {collider.setShape(new RAPIER.Cuboid(...sub.size.map(n=>n/2) as Vec3));this.colliderShapes.set(sub.id,shape);}
            const transform=[...sub.position,sub.yaw,sub.pitch,sub.roll,sub.solid].join(',');
            if(this.colliderTransforms.get(sub.id)===transform)continue;
            this.colliderTransforms.set(sub.id,transform);
            collider.setTranslationWrtParent({x:sub.position[0],y:sub.position[1],z:sub.position[2]});collider.setRotationWrtParent(orientation(sub.yaw,sub.pitch,sub.roll));collider.setEnabled(sub.solid);
        }
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
        this.blocked.push(...this.states.tick(this.tick,held,pressed,this.graph));
        const currentPose=this.pose();
        if(this.bodies.size<256)for(const source of this.field.releases(this.tick,[currentPose.x,currentPose.y,0]))if(this.bodies.size<256)this.spawn(`source:${source.id}:${++this.introduced}`,source.position,source.velocity,[0,0,0],source.pieceType);
        this.targeting.setTargets(this.field.targets());
        const velocity=this.robot.linvel();
        const aimHeading=this.targeting.update(this.pose(),{x:velocity.x,y:velocity.y,omega:this.robot.angvel().z},held,pressed);
        this.updateSubsystemColliders();
        this.graph.tick(this.tick, held, pressed,s=>this.states.active(s));
        const enabled = (s: Surface,type:string) => { if(!this.states.active(s)||!acceptedTypes(this.document,s).includes(type))return false; const e = this.graph.transition(s.id,type); return !!e && triggerActive(e.trigger,e.key,held,pressed) && this.tick >= (this.cooldown.get(s.id) ?? 0); };
        // A touching scoring face can take ownership directly; other outtakes need physical clearance.
        for (const s of this.document.surfaces.filter(s => s.type === 'outtake' && this.tick >= (this.cooldown.get(s.id) ?? 0))) {
            const candidates = [...this.graph.tokens.values()].filter(t => t.node === s.id && !t.flight);
            const frame = this.surfaceFrame(s);
            const spacing=Math.max(...candidates.map(t=>this.season.pieceTypes.find(p=>p.id===(t.pieceType ?? this.season.pieceTypes[0].id))!.radius),this.season.pieceTypes[0].radius)*2+.02;
            const offsets = outtakeOffsets(s.unitsX ?? 1, s.unitsY ?? 1, candidates.length, frame.axis,spacing);
            let released = 0;
            for (const [index, offset] of offsets.entries()) {
                const token = candidates[index], tangent = frame.world(offset);
                const definition=this.season.pieceTypes.find(p=>p.id===(token.pieceType ?? this.season.pieceTypes[0].id))!;
                const p = frame.center.map((n, i) => n + frame.normal[i] * (definition.radius + .045) + tangent[i]) as Vec3;
                const pose=this.pose(),releaseRotation=multiply(orientation(pose.yaw+frame.b.yaw,frame.b.pitch,frame.b.roll),orientation(s.yaw,-s.pitch));
                const shapes=pieceShapes(definition),mouth=frame.center.map((n,i)=>n+tangent[i]) as Vec3;
                const handoff=this.field.tryReceive(token.id,definition.id,mouth,p,(plane,at)=>{
                    const receiver=new RAPIER.Cuboid(...plane.size.map(v=>v/2) as Vec3);
                    return shapes.some(shape=>{
                        const contact=shape.contactShape({x:at[0],y:at[1],z:at[2]},releaseRotation,receiver,{x:plane.position[0],y:plane.position[1],z:plane.position[2]},plane.rotation,.002);
                        return !!contact&&contact.distance<=.002;
                    });
                },definition.radius,(plane,from,to)=>{
                    const receiver=new RAPIER.Cuboid(...plane.size.map(v=>v/2) as Vec3);
                    return shapes.some(shape=>!!shape.castShape(
                        {x:from[0],y:from[1],z:from[2]},releaseRotation,
                        {x:to[0]-from[0],y:to[1]-from[1],z:to[2]-from[2]},
                        receiver,{x:plane.position[0],y:plane.position[1],z:plane.position[2]},plane.rotation,
                        {x:0,y:0,z:0},.002,1,true));
                });
                if(handoff.kind==='accepted'){
                    this.graph.tokens.delete(token.id);this.pieceTypes.set(token.id,definition.id);
                    this.releases++;released++;this.scored++;this.score+=handoff.element.points;
                    this.cycles.push((this.tick-token.captured)*DT);this.event(`Placed ${token.id} · ${handoff.element.name}`);
                    continue;
                }
                if(handoff.kind==='full'||handoff.kind==='incompatible'){
                    this.blocked.push(`Blocked outtake: ${s.name} · ${handoff.element.name} ${handoff.kind==='full'?'is full':'does not accept '+definition.name}`);continue;
                }
                if(handoff.kind==='already-scored'){this.blocked.push(`Blocked outtake: ${s.name} · piece already scored`);continue;}
                const blocked = shapes.some(shape=>this.world.intersectionWithShape({x:p[0],y:p[1],z:p[2]},releaseRotation,shape,undefined,PHYSICAL_QUERY_GROUPS));
                if (blocked) {
                    this.blocked.push(`Blocked outtake: ${s.name}`);
                    continue;
                }
                const v = this.robot.linvel(), omega = this.robot.angvel().z;
                const dir = frame.world([Math.cos(s.pitch)*Math.cos(s.yaw),Math.cos(s.pitch)*Math.sin(s.yaw),Math.sin(s.pitch)]);
                const velocity: Vec3 = [v.x - omega * (p[1] - pose.y) + s.speed * dir[0], v.y + omega * (p[0] - pose.x) + s.speed * dir[1], s.speed * dir[2]];
                const spin = frame.world(s.spin);
                this.spawn(token.id,p,velocity,[spin[0],spin[1],spin[2]+omega],definition.id,releaseRotation);
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
        if(aimHeading!==undefined)w=aimingTurn(angleDelta(aimHeading,pose.yaw),b.angularSpeed);
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
        for (const [id,body] of this.bodies) {
            const p=body.translation(),prev=this.previous.get(id)!,type=this.pieceTypes.get(id)!;
            const goal=this.field.score(id,type,prev,[p.x,p.y,p.z],(plane,at)=>{
                const shape=new RAPIER.Cuboid(...plane.size.map(v=>v/2) as Vec3);
                for(const wall of pieceShapes(this.season.pieceTypes.find(p=>p.id===type)!)){
                    const contact=wall.contactShape({x:at[0],y:at[1],z:at[2]},body.rotation(),shape,{x:plane.position[0],y:plane.position[1],z:plane.position[2]},plane.rotation,.002);
                    if(contact&&contact.distance<=.002)return true;
                }return false;
            },this.season.pieceTypes.find(p=>p.id===type)!.radius);
            if(goal){this.world.removeRigidBody(body);this.bodies.delete(id);this.released.delete(id);this.scored++;this.score+=goal.points;this.event('Scored '+id+' · '+goal.name);continue;}
            if (p.z < -2 || Math.abs(p.x) > 25 || Math.abs(p.y) > 25) {
                this.world.removeRigidBody(body);
                this.bodies.delete(id);
                this.released.delete(id);
                this.escaped.push(id);
                this.event(`${id} left fixture (retired, unscored)`);
            }
        }
        for (const s of this.document.surfaces.filter(s => s.type === 'intake' && this.states.active(s))) {
            let captured = false;
            for (const face of s.faces) {
                const frame = this.surfaceFrame({ ...s, faces: [face] });
                for (const [id, body] of [...this.bodies].sort(([a], [b]) => a.localeCompare(b))) {
                    const type=this.pieceTypes.get(id)!,definition=this.season.pieceTypes.find(p=>p.id===type)!;if(!enabled(s,type))continue;
                    const p = body.translation(), prev = this.previous.get(id) ?? [p.x, p.y, p.z];
                    const toLocal = (v: Vec3): Vec3 => frame.local(v.map((p,i)=>p-frame.center[i]) as Vec3);
                    const a = toLocal(prev), z = toLocal([p.x, p.y, p.z]), axis = frame.axis;
                    const da = a[axis] * frame.sign, dz = z[axis] * frame.sign;
                    const near = Math.abs(dz) < definition.radius + 0.055 && dz >= -0.035;
                    const crossed = da > definition.radius && dz < definition.radius && dz >= -definition.radius;
                    if (!near && !crossed)
                        continue;
                    const f = crossed ? Math.min(1, Math.max(0, (da - definition.radius) / (da - dz))) : 1;
                    const sample = a.map((v, i) => v + (z[i] - v) * f);
                    if (sample.some((n, i) => i !== axis && Math.abs(n) > frame.b.size[i] / 2 + definition.radius * 0.7))
                        continue;
                    // Check the contact approach against solid field and other solid subsystem geometry.
                    const origin = { x: frame.center[0] + frame.normal[0] * 0.025, y: frame.center[1] + frame.normal[1] * 0.025, z: frame.center[2] + frame.normal[2] * 0.025 };
                    const delta = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
                    const hit = this.world.castRay(new RAPIER.Ray(origin, delta), 1, true, undefined, PHYSICAL_QUERY_GROUPS, undefined, undefined, c => c.parent()?.handle !== body.handle);
                    if (hit)
                        continue;
                    if (this.graph.capture(id,s.id,this.tick,type)) {
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
        return { fieldInventory:this.field.snapshot(),subsystems:this.states.snapshot(), tick: this.tick, running, pose: this.pose(), pieces: [...this.bodies].map(([id, b]) => { const p = b.translation(), q = b.rotation(); return { id,type:this.pieceTypes.get(id),position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] }; }), tokens: this.graph.snapshot(), edgeMetrics: clone(this.graph.metrics), score: this.score, pickups: this.pickups, releases: this.releases, scored: this.scored, escaped: [...this.escaped], cycles: [...this.cycles], log: [...this.log], blocked: [...this.blocked], recording: includeRecording ? clone(this.recording) : [], slow };
    }
    free() { this.world.free(); }
}
export { RAPIER };
