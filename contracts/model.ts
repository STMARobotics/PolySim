import { normalizeBinding } from './bindings';
export type Vec3 = [
    number,
    number,
    number
];
export type Face = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export const FACES: Face[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
export type Trigger = 'hold' | 'press';
export interface Subsystem {
    id: string;
    name: string;
    position: Vec3;
    size: Vec3;
    yaw: number;
    capacity: number;
    solid: boolean;
}
export interface Surface {
    id: string;
    name: string;
    owner: string;
    faces: Face[];
    type: 'intake' | 'outtake';
    interval: number;
    speed: number;
    yaw: number;
    pitch: number;
    spin: Vec3;
    unitsX?: number;
    unitsY?: number;
}
export interface Edge {
    id: string;
    source: string;
    target: string;
    duration: number;
    key: string;
    trigger: Trigger;
    priority: number;
    concurrency: number;
}
export interface RobotDocument {
    schemaVersion: 1;
    id: string;
    name: string;
    seasonId: string;
    revision: number;
    basics: {
        length: number;
        width: number;
        height: number;
        mass: number;
        wheelDiameter: number;
        reduction: number;
        motorRPM: number;
        loadedSpeed: number;
        acceleration: number;
        angularSpeed: number;
    };
    subsystems: Subsystem[];
    surfaces: Surface[];
    edges: Edge[];
    layout: Record<string, [
        number,
        number
    ]>;
}
export interface Issue {
    level: 'error' | 'warning';
    object: string;
    message: string;
}
export const DT = 1 / 120;
export const ENGINE_VERSION = '0.5.0';
export const id = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const ticksFor = (seconds: number) => Math.max(1, Math.ceil(seconds / DT - 1e-9));
export const freeSpeed = (d: RobotDocument) => d.basics.motorRPM / 60 / d.basics.reduction * Math.PI * d.basics.wheelDiameter;
export const ownerOf = (d: RobotDocument, node: string) => d.subsystems.find(s => s.id === node)?.id ?? d.surfaces.find(s => s.id === node)?.owner;
export const nodeName = (d: RobotDocument, node: string) => [...d.subsystems, ...d.surfaces].find(s => s.id === node)?.name ?? 'Missing node';
export function surfaceForEdge(d: RobotDocument, e: Pick<Edge, 'source' | 'target'>): Surface | undefined {
    return d.surfaces.find(s => s.type === 'intake' ? e.source === s.id && e.target === s.owner : e.source === s.owner && e.target === s.id);
}
// Owner connections stay permanent; timing and bindings belong to transitions.
// Legacy surface bindings are used only when a transition needs to be created.
export function syncSurfaceLinks(d: RobotDocument): RobotDocument {
    const original = d.edges, surfaceIds = new Set(d.surfaces.map(s => s.id));
    const used = new Set([d.id, ...d.subsystems.map(s => s.id), ...surfaceIds, ...original.map(e => e.id)]);
    d.edges = original.filter(e => !surfaceIds.has(e.source) && !surfaceIds.has(e.target));
    for (const s of d.surfaces) {
        const source = s.type === 'intake' ? s.id : s.owner, target = s.type === 'intake' ? s.owner : s.id;
        const existing = original.find(e => e.source === source && e.target === target);
        let linkId = existing?.id ?? `action:${s.id}`;
        if (!existing) { while (used.has(linkId)) linkId += ':'; }
        used.add(linkId);
        const legacy = s as Surface & {key?: string; trigger?: Trigger};
        d.edges.push({id: linkId, source, target, duration: existing?.duration ?? 0, key: existing?.key ?? legacy.key ?? (s.type === 'intake' ? 'i' : 'k'), trigger: existing?.trigger ?? legacy.trigger ?? 'hold', priority: existing?.priority ?? 0, concurrency: 100});
        delete legacy.key;
        delete legacy.trigger;
    }
    const links = d.edges.filter(e => surfaceForEdge(d, e)), byId = new Map(links.map(e => [e.id, e]));
    const ordered = original.filter(e => (!surfaceIds.has(e.source) && !surfaceIds.has(e.target)) || byId.has(e.id)).map(e => byId.get(e.id) ?? e);
    for (const link of links) if (!ordered.some(e => e.id === link.id)) ordered.push(link);
    d.edges = ordered;
    return d;
}
export function createAction(owner: Subsystem, type: Surface['type'], face: Face): Surface {
    return {id: id(), name: `${owner.name} Action`, owner: owner.id, faces: [face], type, interval: .2, speed: 8, yaw: 0, pitch: .45, spin: [0,0,0], unitsX: 1, unitsY: 1};
}
export function validConnection(d: RobotDocument, source: string, target: string): boolean {
    if (source === target)
        return false;
    const a = d.subsystems.find(s => s.id === source), b = d.subsystems.find(s => s.id === target);
    const sa = d.surfaces.find(s => s.id === source), sb = d.surfaces.find(s => s.id === target);
    return !!((a && b) || (sa?.type === 'intake' && b?.id === sa.owner) || (a && sb?.type === 'outtake' && sb.owner === a.id));
}
export function validate(d: RobotDocument): Issue[] {
    const issues: Issue[] = [], error = (object: string, message: string) => issues.push({ level: 'error', object, message });
    const positive = (object: string, name: string, n: number, max = 1000) => {
        if (!Number.isFinite(n) || n <= 0 || n > max)
            error(object, `${name} must be between 0 and ${max}.`);
    };
    if (!d.name.trim() || d.name.length > 100)
        error(d.id, 'Robot name must contain 1–100 characters.');
    if (d.seasonId !== 'practice-balls')
        error(d.id, 'Unsupported season. Only Practice Lab is implemented.');
    if (d.subsystems.length > 50 || d.surfaces.length > 100 || d.edges.length > 200)
        error(d.id, 'Document exceeds the offline model size limit.');
    for (const [name, n] of Object.entries(d.basics))
        positive(d.id, name, n, name === 'motorRPM' ? 30000 : 1000);
    if (d.basics.length > 3 || d.basics.width > 3 || d.basics.height > 3)
        error(d.id, 'Chassis dimensions must be at most 3 m.');
    const used = new Set<string>([d.id]);
    for (const item of [...d.subsystems, ...d.surfaces, ...d.edges]) {
        if (!item.id || used.has(item.id))
            error(item.id, 'IDs must be nonempty and unique.');
        if ('name' in item && (!item.name.trim() || item.name.length > 100))
            error(item.id, 'Name must contain 1–100 characters.');
        used.add(item.id);
    }
    const assigned = new Set<string>();
    for (const s of d.subsystems) {
        s.size.forEach(n => positive(s.id, 'Dimension', n, 3));
        if (!s.position.every(n => Number.isFinite(n) && Math.abs(n) <= 5) || !Number.isFinite(s.yaw))
            error(s.id, 'Position or rotation is invalid.');
        if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 100)
            error(s.id, 'Capacity must be an integer from 1 to 100.');
        if (!d.edges.some(e => e.source === s.id))
            issues.push({ level: 'warning', object: s.id, message: `${s.name} has no outgoing route.` });
    }
    for (const s of d.surfaces) {
        if (!d.subsystems.some(b => b.id === s.owner))
            error(s.id, 'Surface owner is missing.');
        if (!s.faces.length)
            error(s.id, 'Assign at least one face.');
        for (const face of s.faces) {
            const key = `${s.owner}:${face}`;
            if (!FACES.includes(face) || assigned.has(key))
                error(s.id, 'A face must be valid and assigned only once.');
            assigned.add(key);
        }
        positive(s.id, 'Action interval', s.interval, 60);
        if (s.type === 'outtake')
            positive(s.id, 'Exit speed', s.speed, 50);
        if (s.type === 'outtake') {
            const x = s.unitsX ?? 1, y = s.unitsY ?? 1;
            if (![x, y].every(n => Number.isInteger(n) && n >= 1 && n <= 20) || x * y > 100)
                error(s.id, 'Simultaneous outtake X/Y must be integers from 1 to 20, with at most 100 pieces per batch.');
        }
        if (![s.speed, s.yaw, s.pitch, ...s.spin].every(Number.isFinite))
            error(s.id, 'Launch values must be finite.');
        if (!d.edges.some(e => s.type === 'intake' ? e.source === s.id : e.target === s.id))
            error(s.id, `${s.name} needs a graph route.`);
    }
    for (const e of d.edges) {
        if (!validConnection(d, e.source, e.target))
            error(e.id, 'Unsupported or missing graph connection.');
        const action = surfaceForEdge(d, e);
        if (action) {
            if (!Number.isFinite(e.duration) || e.duration < 0 || e.duration > 60)
                error(e.id, 'Action transition time must be from 0 to 60 seconds.');
        } else positive(e.id, 'Transfer time', e.duration, 60);
        if (!normalizeBinding(e.key))
            error(e.id, 'Choose a keyboard key.');
        if (!['hold', 'press'].includes(e.trigger))
            error(e.id, 'Unknown trigger mode.');
        if (!action && (!Number.isFinite(e.priority) || !Number.isInteger(e.concurrency) || e.concurrency < 1 || e.concurrency > 20))
            error(e.id, 'Invalid priority or concurrency.');
    }
    issues.push({ level: 'warning', object: d.id, message: 'Practice fixture · estimated drive and ball coefficients · no official FRC rules, drag, traction, tipping, or articulation.' });
    return issues;
}
// Treat imported JSON as untrusted data before giving it to the typed editor or worker.
export function parseDocument(raw: unknown): RobotDocument {
    const x = raw as RobotDocument;
    if (!x || typeof x !== 'object' || x.schemaVersion !== 1 || typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.seasonId !== 'string' || !Number.isInteger(x.revision) || !x.basics || !x.layout || typeof x.layout !== 'object')
        throw Error('Not a PolySim schema v1 document.');
    const base = ['length', 'width', 'height', 'mass', 'wheelDiameter', 'reduction', 'motorRPM', 'loadedSpeed', 'acceleration', 'angularSpeed'];
    if (!base.every(k => typeof (x.basics as any)[k] === 'number'))
        throw Error('Robot basics are incomplete.');
    if (![x.subsystems, x.surfaces, x.edges].every(Array.isArray))
        throw Error('Missing document collections.');
    if (x.subsystems.length > 50 || x.surfaces.length > 100 || x.edges.length > 200)
        throw Error('Document is too large.');
    const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number');
    for (const s of x.subsystems)
        if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !vector(s.position) || !vector(s.size) || typeof s.yaw !== 'number' || typeof s.capacity !== 'number' || typeof s.solid !== 'boolean')
            throw Error('Malformed subsystem.');
    for (const s of x.surfaces)
        if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.owner !== 'string' || !['intake', 'outtake'].includes(s.type) || !Array.isArray(s.faces) || !s.faces.every(f => typeof f === 'string') || !vector(s.spin) || !['interval', 'speed', 'yaw', 'pitch'].every(k => typeof (s as any)[k] === 'number'))
            throw Error('Malformed action surface.');
    for (const s of x.surfaces)
        if ((s.unitsX !== undefined && typeof s.unitsX !== 'number') || (s.unitsY !== undefined && typeof s.unitsY !== 'number'))
            throw Error('Malformed simultaneous outtake dimensions.');
    for (const e of x.edges)
        if (!e || !['id', 'source', 'target', 'key', 'trigger'].every(k => typeof (e as any)[k] === 'string') || !['duration', 'priority', 'concurrency'].every(k => typeof (e as any)[k] === 'number'))
            throw Error('Malformed graph edge.');
    for (const p of Object.values(x.layout))
        if (!Array.isArray(p) || p.length !== 2 || !p.every(n => Number.isFinite(n) && Math.abs(n) < 10000))
            throw Error('Malformed graph layout.');
    if (JSON.stringify(x).length > 250 * 1024)
        throw Error('Document exceeds 250 KiB.');
    return syncSurfaceLinks(clone(x));
}
