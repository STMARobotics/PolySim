import {clone,id,type RobotDocument,type Subsystem,type SubsystemState} from './model';
import {DEFAULT_TARGETING_FREEDOM} from './targeting';
export function stateName(value:string) {
    const base=value.trim().replace(/(?:\s+state)+$/i,'').trim();
    return `${(!base || /^state$/i.test(base) ? 'Untitled' : base).slice(0,94).trimEnd()} State`;
}
export function ensureStates(d:RobotDocument) {
    for(const sub of d.subsystems) {
        sub.targetingMode ??='manual';sub.targetingFreedom ??=DEFAULT_TARGETING_FREEDOM;
        if(!sub.states) sub.states=[{id:`${sub.id}:default`,name:'Default State',isDefault:true,position:[...sub.position],size:[...sub.size],yaw:sub.yaw,pitch:sub.pitch ?? 0,roll:sub.roll ?? 0,capacity:sub.capacity,ignoreCollision:!sub.solid}];
        for(const state of sub.states)state.name=stateName(state.name);
        sub.stateTransitions ??=[];sub.stateLayout ??={};
        for(const surface of d.surfaces.filter(s=>s.owner===sub.id))surface.stateId ??=sub.states.find(s=>s.isDefault)?.id;
    }
    return d;
}
export function applyState(sub:Subsystem,state:SubsystemState) {
    sub.position=[...state.position];sub.size=[...state.size];sub.yaw=state.yaw;sub.pitch=state.pitch;sub.roll=state.roll;sub.capacity=state.capacity;sub.solid=!state.ignoreCollision;
}
export function syncDefaults(d:RobotDocument) {
    ensureStates(d);
    for(const sub of d.subsystems) {const state=sub.states!.find(s=>s.isDefault);if(state)applyState(sub,state);}
    return d;
}
export function addState(d:RobotDocument,sub:Subsystem,source:SubsystemState) {
    const state={...clone(source),id:id(),name:sub.states!.length===1?'New State':`New ${sub.states!.length} State`,isDefault:false};
    sub.states!.push(state);
    const index=sub.states!.length-1;sub.stateLayout![state.id]=[48+index%3*288,96+Math.floor(index/3)*240];
    for(const action of d.surfaces.filter(s=>s.owner===sub.id && s.stateId===source.id)) {
        const copy={...clone(action),id:id(),stateId:state.id};d.surfaces.push(copy);
        const links=d.edges.filter(e=>e.source===action.id || e.target===action.id);
        for(const link of links)d.edges.push({...clone(link),id:id(),source:link.source===action.id?copy.id:sub.id,target:link.target===action.id?copy.id:sub.id});
    }
    return state;
}
export function duplicateSubsystem(d:RobotDocument,original:Subsystem) {
    const sub=clone(original),states=new Map(original.states!.map(s=>[s.id,id()]));
    sub.id=id();sub.name+=' copy';sub.states=sub.states!.map(s=>({...s,id:states.get(s.id)!,position:[s.position[0],s.position[1]+.4,s.position[2]]}));
    sub.stateTransitions=sub.stateTransitions!.map(e=>({...e,id:id(),source:states.get(e.source)!,target:states.get(e.target)!}));
    sub.stateLayout=Object.fromEntries(Object.entries(sub.stateLayout ?? {}).map(([key,p])=>[states.get(key)!,p]));
    applyState(sub,sub.states.find(s=>s.isDefault)!);d.subsystems.push(sub);
    for(const action of d.surfaces.filter(s=>s.owner===original.id)) {
        const copy={...clone(action),id:id(),owner:sub.id,stateId:states.get(action.stateId!)};d.surfaces.push(copy);
        const links=d.edges.filter(e=>e.source===action.id||e.target===action.id);
        for(const link of links)d.edges.push({...clone(link),id:id(),source:link.source===action.id?copy.id:sub.id,target:link.target===action.id?copy.id:sub.id});
    }
    return sub;
}
export function previewDocument(d:RobotDocument,open:Record<string,string|undefined>) {
    const out=clone(d);ensureStates(out);
    for(const sub of out.subsystems) {const state=sub.states!.find(s=>s.id===open[sub.id]) ?? sub.states!.find(s=>s.isDefault)!;applyState(sub,state);}
    out.surfaces=out.surfaces.filter(s=>s.stateId===(open[s.owner] ?? out.subsystems.find(b=>b.id===s.owner)?.states?.find(t=>t.isDefault)?.id));
    return out;
}
export const easeState=(t:number)=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v);};
export const blendAngle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
export function blendState(a:SubsystemState,b:SubsystemState,t:number):SubsystemState {
    const f=easeState(t);
    return {...a,position:a.position.map((v,i)=>v+(b.position[i]-v)*f) as typeof a.position,size:a.size.map((v,i)=>v+(b.size[i]-v)*f) as typeof a.size,yaw:blendAngle(a.yaw,b.yaw,f),pitch:blendAngle(a.pitch,b.pitch,f),roll:blendAngle(a.roll,b.roll,f),capacity:Math.min(a.capacity,b.capacity)};
}
