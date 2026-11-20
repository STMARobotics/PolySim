import { DT, ownerOf, ticksFor, syncSurfaceLinks, surfaceForEdge, clone, type Edge, type RobotDocument } from '../contracts/model';
import {triggerActive} from '../contracts/triggers';
import {pieceTypesFor,acceptedTypes} from '../seasons/registry';
export interface Token {
    pieceType?: string;
    id: string;
    node: string;
    owner: string;
    arrived: number;
    captured: number;
    flight?: {
        edge: string;
        target: string;
        owner: string;
        start: number;
        end: number;
    };
}
export interface EdgeMetric {
    deliveries: number;
    busyTicks: number;
    capacityTicks: number;
    inputTicks: number;
    emptyTicks: number;
}
export class GraphEngine {
    tokens = new Map<string, Token>();
    metrics: Record<string, EdgeMetric> = {};
    private transfers: Edge[];
    private links = new Map<string, Edge>();
    private nextBatch = new Map<string, number>();
    constructor(public document: RobotDocument) {
        this.document = syncSurfaceLinks(clone(document));
        this.transfers = this.document.edges.filter(e => surfaceForEdge(this.document, e)?.type !== 'intake').sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
        for (const e of this.document.edges) {
            this.metrics[e.id] = { deliveries: 0, busyTicks: 0, capacityTicks: 0, inputTicks: 0, emptyTicks: 0 };
            const surface = surfaceForEdge(this.document, e);
            if (surface) this.links.set(surface.id+':'+(e.pieceType ?? pieceTypesFor(this.document)[0].id), e);
        }
    }
    transitions(surfaceId:string) {return [...this.links.values()].filter(e=>e.source===surfaceId||e.target===surfaceId);}
    transition(surfaceId: string,pieceType=pieceTypesFor(this.document)[0].id) { return this.links.get(surfaceId+':'+pieceType)!; }
    owned(owner: string) { return [...this.tokens.values()].filter(t => t.owner === owner).length; }
    reserved(owner: string) { return [...this.tokens.values()].filter(t => t.flight?.owner === owner && t.owner !== owner).length; }
    available(owner: string) { return this.owned(owner) + this.reserved(owner) < (this.document.subsystems.find(s => s.id === owner)?.capacity ?? 0); }
    capture(id: string, surfaceId: string, tick: number,pieceType=pieceTypesFor(this.document)[0].id): boolean {
        const surface = this.document.surfaces.find(s => s.id === surfaceId && s.type === 'intake'), link = this.transition(surfaceId,pieceType);
        if (!surface || !link || this.tokens.has(id) || !this.available(surface.owner)) return false;
        const token: Token = {id,pieceType,node: link.duration === 0 ? surface.owner : surface.id, owner: surface.owner, arrived: tick, captured: tick};
        if (link.duration > 0) {
            token.flight = {edge:link.id,target:surface.owner,owner:surface.owner,start:tick,end:tick+ticksFor(link.duration)};
            this.metrics[link.id].busyTicks++;
        } else this.metrics[link.id].deliveries++;
        this.tokens.set(id, token);
        return true;
    }
    tick(tick: number, held: Set<string>, pressed: Set<string>, enabledAction: (surface: {owner:string;stateId?:string})=>boolean = ()=>true) {
        const ordered = [...this.tokens.values()].sort((a, b) => (a.flight?.end ?? Infinity) - (b.flight?.end ?? Infinity) || a.id.localeCompare(b.id));
        for (const t of ordered) if (t.flight && t.flight.end <= tick) {
            const flight = t.flight;
            t.node = flight.target; t.owner = flight.owner; t.arrived = tick; t.flight = undefined;
            this.metrics[flight.edge].deliveries++;
        }
        for (const s of this.document.surfaces.filter(s=>s.type==='intake')) {
            for(const link of this.transitions(s.id))if ([...this.tokens.values()].some(t=>t.flight?.edge===link.id)) this.metrics[link.id].busyTicks++;
        }
        const available = [...this.tokens.values()].filter(t => !t.flight).sort((a, b) => a.arrived - b.arrived || a.id.localeCompare(b.id));
        for (const e of this.transfers) {
            const m = this.metrics[e.id], action = surfaceForEdge(this.document,e);
            if (action && !enabledAction(action)) continue;
            const active = [...this.tokens.values()].filter(t => t.flight?.edge === e.id).length;
            if (active) m.busyTicks++;
            let limit = e.concurrency - active;
            if (action) {
                const staged = [...this.tokens.values()].filter(t=>t.node===action.id && !t.flight).length;
                limit = Math.min(limit, (action.unitsX ?? 1)*(action.unitsY ?? 1)-active-staged);
                if (tick < (this.nextBatch.get(action.id) ?? 0)) continue;
            }
            if (limit <= 0) continue;
            const candidates = available.filter(t=>t.node===e.source && !t.flight && (t.pieceType ?? pieceTypesFor(this.document)[0].id)===(e.pieceType ?? pieceTypesFor(this.document)[0].id)).slice(0,action ? limit : 1);
            if (!candidates.length) { m.emptyTicks++; continue; }
            if (!triggerActive(e.trigger,e.key,held,pressed)) {m.inputTicks++;continue;}
            let started = 0;
            for (const token of candidates) {
                const owner = ownerOf(this.document, e.target)!;
                if (token.owner !== owner && !this.available(owner)) { m.capacityTicks++; continue; }
                if (e.duration === 0) {
                    token.node=e.target;token.owner=owner;token.arrived=tick;m.deliveries++;
                } else token.flight = { edge: e.id, target: e.target, owner, start: tick, end: tick + ticksFor(e.duration) };
                started++;
            }
            if (started && e.duration > 0 && !active) m.busyTicks++;
            if (started && action) this.nextBatch.set(action.id,tick+ticksFor(action.interval));
        }
    }
    snapshot() { return [...this.tokens.values()].map(t => structuredClone(t)); }
    assertInvariants() {
        for (const s of this.document.subsystems) if (this.owned(s.id) + this.reserved(s.id) > s.capacity) throw Error(`Capacity violated: ${s.name}`);
        for (const t of this.tokens.values()) if (!ownerOf(this.document, t.node)) throw Error('Orphan token');
    }
    throughput(edge: string, tick: number) { return this.metrics[edge].deliveries / Math.max(DT, tick * DT); }
}
