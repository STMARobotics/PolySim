import {DT,ticksFor,type RobotDocument,type SubsystemState} from '../contracts/model';
import {applyState,blendState,ensureStates} from '../contracts/states';
import {triggerActive} from '../contracts/triggers';
import type {GraphEngine} from './graph';
export interface ActiveGeometry {id:string;stateId:string;transition?:string;position:[number,number,number];size:[number,number,number];yaw:number;pitch:number;roll:number;capacity:number;solid:boolean}
export class StateEngine {
    current=new Map<string,string>();
    flights=new Map<string,{edge:string;from:SubsystemState;to:SubsystemState;start:number;end:number}>();
    constructor(private document:RobotDocument) {ensureStates(document);for(const sub of document.subsystems){const state=sub.states!.find(s=>s.isDefault)!;this.current.set(sub.id,state.id);applyState(sub,state);}}
    active(surface:{owner:string;stateId?:string}) {return !this.flights.has(surface.owner) && (!surface.stateId || surface.stateId===this.current.get(surface.owner));}
    tick(tick:number,held:Set<string>,pressed:Set<string>,graph:GraphEngine):string[] {
        const warnings:string[]=[];
        for(const sub of this.document.subsystems) {
            let flight=this.flights.get(sub.id);
            if(flight && tick>=flight.end) {applyState(sub,flight.to);this.current.set(sub.id,flight.to.id);this.flights.delete(sub.id);flight=undefined;}
            else if(flight)applyState(sub,blendState(flight.from,flight.to,(tick-flight.start)/(flight.end-flight.start)));
            if(!flight) {
                // Restore authored geometry before automatic targeting overlays yaw.
                applyState(sub,sub.states!.find(s=>s.id===this.current.get(sub.id))!);
                const edge=sub.stateTransitions!.filter(e=>e.source===this.current.get(sub.id)).sort((a,b)=>a.id.localeCompare(b.id)).find(e=>triggerActive(e.trigger,e.key,held,pressed));
                if(edge) {
                    const to=sub.states!.find(s=>s.id===edge.target)!,from=sub.states!.find(s=>s.id===edge.source)!;
                    const pending=[...graph.tokens.values()].some(t=>t.owner===sub.id && (this.document.surfaces.some(s=>s.owner===sub.id && s.id===t.node) || (t.flight && this.document.surfaces.some(s=>s.id===t.flight!.target || s.id===t.node))));
                    if(to.capacity<graph.owned(sub.id)+graph.reserved(sub.id) || pending)warnings.push(`State transition blocked: ${sub.name} has pieces in use or exceeds the destination capacity.`);
                    else if(edge.duration===0) {applyState(sub,to);this.current.set(sub.id,to.id);}
                    else {this.flights.set(sub.id,{edge:edge.id,from,to,start:tick,end:tick+ticksFor(edge.duration)});applyState(sub,blendState(from,to,0));}
                }
            }
            const mirror=graph.document.subsystems.find(s=>s.id===sub.id)!;mirror.capacity=sub.capacity;
        }
        return warnings;
    }
    snapshot():ActiveGeometry[] {return this.document.subsystems.map(s=>({id:s.id,stateId:this.current.get(s.id)!,transition:this.flights.get(s.id)?.edge,position:[...s.position],size:[...s.size],yaw:s.yaw,pitch:s.pitch??0,roll:s.roll??0,capacity:s.capacity,solid:s.solid}));}
}
