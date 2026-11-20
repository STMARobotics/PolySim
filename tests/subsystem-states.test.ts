import {snapSize,snapPosition} from '../contracts/inch-grid';
import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {sampleRobot} from '../seasons/practice';
import {parseDocument,validate,syncSurfaceLinks} from '../contracts/model';
import {ensureStates,addState,duplicateSubsystem,easeState,syncDefaults} from '../contracts/states';
import {orientation,rotate3,inverse} from '../contracts/geometry';
import {outputTrajectories} from '../ui/trajectory';
import {propertyStep,displayValue,storedValue} from '../ui/units';
import {RAPIER,Simulation} from '../simulation/runtime';
import {documentInput} from '../service/documents';
before(async()=>{await RAPIER.init();});
function robot() {
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2],from=sub.states![0],to=addState(d,sub,from);
    to.name='Extended';to.size=[.8,.6,1];to.position=[.5,.2,1];to.pitch=Math.PI/6;to.roll=Math.PI/8;
    sub.stateTransitions!.push({id:'extend',source:from.id,target:to.id,key:'space',trigger:'press',duration:1});syncSurfaceLinks(d);
    return {d,sub,from,to};
}
const input=(held:string[]=[])=>({x:0,y:0,turn:0,held});
test('legacy robots migrate without changing geometry, action settings or historical collision flags',()=>{
    const old=sampleRobot();old.subsystems[0].solid=false;
    const geometry=structuredClone(old.subsystems),loaded=parseDocument(old);
    for(const [i,sub] of loaded.subsystems.entries()) {
        assert.equal(sub.states!.filter(s=>s.isDefault).length,1);assert.deepEqual(sub.states![0].size,geometry[i].size);assert.equal(sub.states![0].ignoreCollision,!geometry[i].solid);
    }
    assert.equal(loaded.subsystems[1].states![0].ignoreCollision,false);
    assert.ok(loaded.surfaces.every(s=>s.stateId));assert.deepEqual(parseDocument(loaded),loaded);
});
test('new states copy state-specific action settings with fresh IDs; duplicate subsystems preserve their state graphs',()=>{
    const {d,sub,from,to}=robot();
    assert.equal(to.isDefault,false);assert.notEqual(to.id,from.id);assert.equal(d.surfaces.filter(s=>s.owner===sub.id).length,2);
    const copy=duplicateSubsystem(d,sub);syncSurfaceLinks(d);
    assert.equal(copy.states!.length,2);assert.equal(copy.stateTransitions!.length,1);
    assert.ok(copy.states!.every(s=>!sub.states!.some(t=>t.id===s.id)));
    assert.ok(copy.states!.some(s=>s.id===copy.stateTransitions![0].source));assert.equal(validate(d).filter(i=>i.level==='error').length,0);
});
test('imports and server saves require exactly one default and preserve state properties and transitions',()=>{
    const {d,sub,to}=robot();
    const saved=documentInput(d).document.subsystems[2];assert.deepEqual(saved.stateTransitions,sub.stateTransitions);assert.deepEqual(saved.states!.find(s=>s.id===to.id),{...to,name:'Extended State',size:snapSize(to.size),position:snapPosition(to.position)});
    for(const all of [false,true]) {const bad=structuredClone(d);bad.subsystems[2].states!.forEach(s=>s.isDefault=all);assert.throws(()=>parseDocument(bad),/one default/);assert.throws(()=>documentInput(bad));}
    const restored=structuredClone(d);restored.subsystems[2].states!.forEach(s=>s.isDefault=s.id===to.id);syncDefaults(restored);assert.deepEqual(restored.subsystems[2].size,to.size);
});
test('timed state changes ease geometry at 120 Hz, honor key release, update collision shapes and reset to defaults',()=>{
    const {d,from,to}=robot(),sim=new Simulation(d);
    try {
        sim.step(input(['space']));assert.equal(sim.snapshot().subsystems![2].stateId,from.id);
        for(let i=0;i<30;i++)sim.step(input());
        const quarter=sim.snapshot().subsystems![2];assert.ok(Math.abs(quarter.size[2]-(from.size[2]+(to.size[2]-from.size[2])*easeState(.25)))<1e-9);
        assert.ok(quarter.transition);assert.equal(quarter.solid,true);
        assert.ok(Math.abs(sim.robot.collider(3).halfExtents().z-quarter.size[2]/2)<1e-6);
        for(let i=0;i<90;i++)sim.step(input());
        const final=sim.snapshot().subsystems![2];assert.equal(final.stateId,to.id);assert.equal(final.transition,undefined);assert.deepEqual(final.size,to.size);assert.equal(final.roll,to.roll);
        assert.ok(Math.abs(sim.robot.collider(3).halfExtents().z-.5)<1e-6);
        const fresh=new Simulation(d);try {assert.deepEqual(fresh.snapshot().subsystems![2].size,from.size);}finally{fresh.free();}
        assert.deepEqual(d.subsystems[2].size,from.size,'runtime must not mutate the design used for restart');
    }finally{sim.free();}
});
test('state capacity cannot drop below owned pieces and pending action pieces cannot be orphaned',()=>{
    const {d,sub,to}=robot();sub.states![0].capacity=3;to.capacity=1;syncDefaults(d);
    const sim=new Simulation(d);try {
        for(const id of ['a','b'])sim.graph.tokens.set(id,{id,node:sub.id,owner:sub.id,arrived:0,captured:0});
        sim.step(input(['space']));assert.equal(sim.states.flights.size,0);assert.ok(sim.blocked.some(s=>s.includes('State transition blocked')));sim.graph.assertInvariants();
    }finally{sim.free();}
});
test('inactive state actions do not start transfers and instant state switches activate only the new state',()=>{
    const {d,sub,to}=robot();sub.stateTransitions![0].duration=0;
    const sim=new Simulation(d);try {
        const oldAction=d.surfaces.find(s=>s.owner===sub.id&&s.stateId!==to.id)!,newAction=d.surfaces.find(s=>s.owner===sub.id&&s.stateId===to.id)!;
        assert.ok(sim.states.active(oldAction));assert.ok(!sim.states.active(newAction));
        sim.step(input(['space']));assert.ok(!sim.states.active(oldAction));assert.ok(sim.states.active(newAction));
    }finally{sim.free();}
});
test('3D rotation and inverse agree for yaw, pitch and roll on every axis',()=>{
    const q=orientation(.7,.4,-.3),v:[number,number,number]=[1,2,3],back=rotate3(rotate3(v,q),inverse(q));
    back.forEach((n,i)=>assert.ok(Math.abs(n-v[i])<1e-10));
});
test('launch previews cover every output grid cell, output face and 3D rotation',()=>{
    const d=sampleRobot(),sub=d.subsystems[2],action=d.surfaces[1];sub.pitch=.4;sub.roll=.2;action.unitsX=4;action.unitsY=2;
    for(const face of ['+X','-X','+Y','-Y','+Z','-Z'] as const) {
        action.faces=[face];const paths=outputTrajectories(sub,action);assert.equal(paths.length,8);assert.equal(new Set(paths.map(p=>p[0].join(','))).size,8);assert.ok(paths.every(p=>p.length>1&&p.flat().every(Number.isFinite)));
    }
    action.unitsX=1000000;action.unitsY=1000000;assert.deepEqual(outputTrajectories(sub,action),[]);
});
test('inch properties step by one half inch and speed is displayed directly in m/s',()=>{
    for(const p of ['state.position.0','state.size.2','sub.size.1','basics.length','basics.wheelDiameter'])assert.equal(propertyStep(p),'.5');
    for(const p of ['surface.speed','basics.loadedSpeed','basics.acceleration']){assert.equal(displayValue(p,2.5),2.5);assert.equal(storedValue(p,2.5),2.5);}
    assert.equal(propertyStep('state.pitch'),'.01');
});
