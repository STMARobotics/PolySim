import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {sampleRobot,practice} from '../seasons/practice';
import {ensureStates,addState,duplicateSubsystem} from '../contracts/states';
import {parseDocument,validate,type Vec3,type Subsystem,type Surface} from '../contracts/model';
import {DEFAULT_TARGETING_FREEDOM,type ScoringTarget} from '../contracts/targeting';
import {faceFrame,orientation,rotate3,launchDirection} from '../contracts/geometry';
import {nearestTarget,solveTurretAim,angleDelta} from '../simulation/targeting';
import {RAPIER,Simulation} from '../simulation/runtime';
import {documentInput} from '../service/documents';
import {displayValue,storedValue} from '../ui/units';
import {blendSubsystemYaw} from '../ui/render-frames';

before(async()=>{await RAPIER.init();});
const input=(held:string[]=[],turn=0)=>({x:0,y:0,turn,held});
const target=(x:number,y:number,id='target',valid=true):ScoringTarget=>({id,position:[x,y,1.8],valid});
const close=(a:number,b:number,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
function launch(sub:Subsystem,surface:Surface,yaw:number,pose:{x:number;y:number;yaw:number}) {
    const aimed={...sub,yaw},frame=faceFrame(aimed,surface),local=frame.center.map((v,i)=>v+frame.normal[i]*(practice.radius+.045)) as Vec3;
    const offset=rotate3(local,orientation(pose.yaw)),direction=rotate3(launchDirection(surface,frame.q),orientation(pose.yaw));
    return {origin:[pose.x+offset[0],pose.y+offset[1],offset[2]] as Vec3,offset,direction};
}

test('old documents default to Manual, and targeting settings survive import, copy, and server saves',()=>{
    const doc=parseDocument(sampleRobot());assert.ok(doc.subsystems.every(s=>s.targetingMode==='manual'&&s.targetingFreedom===DEFAULT_TARGETING_FREEDOM));
    doc.subsystems[2].targetingMode='sotm-turret';doc.subsystems[2].targetingFreedom=Math.PI/2;
    const copy=duplicateSubsystem(doc,doc.subsystems[2]);assert.equal(copy.targetingMode,'sotm-turret');assert.equal(copy.targetingFreedom,Math.PI/2);
    const saved=documentInput(JSON.parse(JSON.stringify(doc)));assert.equal(saved.runnable,true);
    assert.equal(saved.document.subsystems[2].targetingMode,'sotm-turret');assert.equal(saved.document.subsystems[2].targetingFreedom,Math.PI/2);
    for(const freedom of [-1,Math.PI*2+.01,NaN]) {const bad=structuredClone(doc);bad.subsystems[2].targetingFreedom=freedom;assert.throws(()=>parseDocument(bad));assert.throws(()=>documentInput(bad));}
    const bad=structuredClone(doc);Object.assign(bad.subsystems[2],{targetingMode:'unknown'});assert.throws(()=>parseDocument(bad));assert.ok(validate(bad).some(i=>i.message==='Unknown targeting mode.'));
    close(displayValue('sub.targetingFreedom',Math.PI),180);close(storedValue('sub.targetingFreedom',120),2*Math.PI/3);
});

test('nearest targeting excludes invalid or unusable targets and resolves ties consistently',()=>{
    assert.equal(nearestTarget([0,0,0],[target(1,0,'disabled',false),target(NaN,0,'nan'),target(0,0,'coincident'),target(3,0,'far'),target(2,0,'b'),target(-2,0,'a')])?.id,'a');
    assert.equal(nearestTarget([0,0,0],[]),undefined);
});

test('stationary turrets aim the configured bore at the target through a vertical axis at their center',()=>{
    const d=sampleRobot(),sub=d.subsystems[2],surface=d.surfaces[1],pose={x:-2,y:-1,yaw:.7},motion={x:0,y:0,omega:0};
    sub.pitch=.35;sub.roll=.5;sub.yaw=.2;surface.yaw=.3;surface.pitch=.4;
    const original=structuredClone(sub),goal=target(5,3),aim=solveTurretAim(sub,sub.yaw,pose,motion,[goal],surface)!;
    const shot=launch(sub,surface,aim.yaw,pose),dx=goal.position[0]-shot.origin[0],dy=goal.position[1]-shot.origin[1];
    close(angleDelta(Math.atan2(shot.direction[1],shot.direction[0]),Math.atan2(dy,dx)),0);
    assert.deepEqual(sub,original,'aim solver must not change geometry or the saved design');
    const before=rotate3([1,2,3],orientation(sub.yaw,sub.pitch,sub.roll));
    const after=rotate3([1,2,3],orientation(aim.yaw,sub.pitch,sub.roll));
    const verticalRotation=rotate3(before,orientation(aim.yaw-sub.yaw));after.forEach((v,i)=>close(v,verticalRotation[i]));
});

test('turret range is half the configured total on each side, including zero and wraparound',()=>{
    const sub=sampleRobot().subsystems[2],pose={x:0,y:0,yaw:0},motion={x:0,y:0,omega:0};sub.position=[0,0,0];sub.targetingFreedom=Math.PI/3;
    close(solveTurretAim(sub,0,pose,motion,[target(0,10)])!.yaw,Math.PI/6);
    close(solveTurretAim(sub,0,pose,motion,[target(0,-10)])!.yaw,-Math.PI/6);
    sub.targetingFreedom=0;close(solveTurretAim(sub,.4,pose,motion,[target(0,10)])!.yaw,.4);
    sub.targetingFreedom=Math.PI/3;
    const wrap=solveTurretAim(sub,Math.PI-.1,pose,motion,[target(-10,-1)])!;
    assert.ok(Math.abs(wrap.yaw-(Math.PI-.1))<Math.PI/6);assert.equal(wrap.limited,false);
});

test('SOTM flight-time iteration compensates inherited translation and robot angular point velocity',()=>{
    const d=sampleRobot(),sub=d.subsystems[2],surface=d.surfaces[1],pose={x:0,y:0,yaw:.3},motion={x:.6,y:2,omega:.8},goal=target(8,2);
    const aim=solveTurretAim(sub,0,pose,motion,[goal],surface,true)!;
    const shot=launch(sub,surface,aim.yaw,pose),time=aim.timeOfFlight;
    close(shot.origin[0]+(surface.speed*shot.direction[0]+motion.x-motion.omega*shot.offset[1])*time,goal.position[0],1e-5);
    close(shot.origin[1]+(surface.speed*shot.direction[1]+motion.y+motion.omega*shot.offset[0])*time,goal.position[1],1e-5);
    const stationary=solveTurretAim(sub,0,pose,motion,[goal],surface)!;assert.ok(Math.abs(aim.yaw-stationary.yaw)>.05);
    for(const velocity of [motion,{x:100,y:100,omega:100}]) {
        const result=solveTurretAim(sub,0,pose,velocity,[goal],surface,true)!;assert.ok([result.yaw,result.heading,result.timeOfFlight].every(Number.isFinite));assert.ok(result.timeOfFlight<=10);
    }
});

test('runtime turret yaw, collider and snapshot agree while center/pitch/roll and restart reference stay fixed',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2];sub.targetingMode='turret';sub.targetingFreedom=Math.PI/3;
    sub.states![0].yaw=Math.PI/2;sub.states![0].pitch=.2;sub.states![0].roll=.3;
    const design=structuredClone(d),sim=new Simulation(d);
    try {
        for(let i=0;i<15;i++)sim.step(input());
        const geometry=sim.snapshot().subsystems![2];close(geometry.yaw,Math.PI/2-Math.PI/6);
        assert.deepEqual(geometry.position,sub.states![0].position);close(geometry.pitch,.2);close(geometry.roll,.3);
        const q=sim.robot.collider(3).rotationWrtParent()!,expected=orientation(geometry.yaw,.2,.3);
        close(q.x,expected.x,1e-6);close(q.y,expected.y,1e-6);close(q.z,expected.z,1e-6);close(q.w,expected.w,1e-6);
        assert.deepEqual(d,design);
        const restarted=new Simulation(d);try{close(restarted.snapshot().subsystems![2].yaw,geometry.yaw);}finally{restarted.free();}
    }finally{sim.free();}
});

test('targeting limits stay anchored at startup yaw across named state changes',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2],from=sub.states![0],to=addState(d,sub,from);
    from.yaw=Math.PI/2;to.yaw=-Math.PI/2;sub.targetingMode='turret';sub.targetingFreedom=Math.PI/3;
    sub.stateTransitions!.push({id:'change',source:from.id,target:to.id,key:'space',trigger:'press',duration:0});
    const sim=new Simulation(d);try{sim.step(input(['space']));assert.equal(sim.states.current.get(sub.id),to.id);close(sim.snapshot().subsystems![2].yaw,Math.PI/3);}finally{sim.free();}
});

test('drivetrain aiming requires an active owned action, tracks while held, and releases driver control afterward',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2];sub.targetingMode='aim-with-drivetrain';
    const sim=new Simulation(d);try {
        sim.robot.setRotation(orientation(1),true);
        sim.step(input());close(sim.robot.angvel().z,0);
        sim.step(input(['i']));close(sim.robot.angvel().z,0);
        for(let i=0;i<240;i++)sim.step(input(['k'],1));
        assert.ok(Math.abs(sim.pose().yaw)<.05,'auto aim must override manual turn while the action is held');
        assert.equal(sim.releases,0,'aiming does not require available pieces or shoot automatically');
        for(let i=0;i<40;i++)sim.step(input([],1));assert.ok(sim.robot.angvel().z>1);
    }finally{sim.free();}
});

test('Manual leaves subsystem yaw and drivetrain under the configured state and driver controls',()=>{
    const d=ensureStates(sampleRobot());d.subsystems[2].states![0].yaw=.8;
    const sim=new Simulation(d);try{for(let i=0;i<20;i++)sim.step(input(['k'],1));close(sim.snapshot().subsystems![2].yaw,.8);assert.ok(sim.pose().yaw>0);}finally{sim.free();}
});

test('drivetrain aiming follows Press and Not Pressed action activation, excluding inactive-state actions',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2];sub.targetingMode='aim-with-drivetrain';
    d.edges.find(e=>e.id==='shoot')!.trigger='press';
    const extra=addState(d,sub,sub.states![0]),extraAction=d.surfaces.find(s=>s.stateId===extra.id)!;
    Object.assign(d.edges.find(e=>e.target===extraAction.id)!,{key:'space',trigger:'not-pressed'});
    const sim=new Simulation(d);
    try {
        sim.robot.setRotation(orientation(1),true);
        for(let i=0;i<5;i++)sim.step(input());close(sim.robot.angvel().z,0);
        for(let i=0;i<240;i++)sim.step(input(['k']));assert.ok(Math.abs(sim.pose().yaw)<.05);
    }finally{sim.free();}
    d.edges.find(e=>e.id==='shoot')!.trigger='not-pressed';
    const released=new Simulation(d);
    try {
        released.robot.setRotation(orientation(1),true);
        released.step(input(['k']));close(released.robot.angvel().z,0);
        released.step(input());assert.ok(released.robot.angvel().z<0);
    }finally{released.free();}
});

test('SOTM runtime release applies compensated yaw to the physical projectile',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2],state=sub.states![0];sub.targetingMode='sotm-turret';
    state.position=[0,0,2];state.size=[.1,.1,.1];state.ignoreCollision=true;
    const sim=new Simulation(d);
    try {
        sim.robot.setLinvel({x:0,y:2,z:0},true);
        const pose=sim.pose(),solution=solveTurretAim({...sub,...state},state.yaw,pose,{x:0,y:2,omega:0},practice.scoringTargets,d.surfaces[1],true)!;
        const shot=launch({...sub,...state},d.surfaces[1],solution.yaw,pose);
        sim.graph.tokens.set('shot',{id:'shot',node:sub.id,owner:sub.id,arrived:0,captured:0});
        sim.step(input(['k']));assert.equal(sim.releases,1);
        const v=sim.bodies.get('shot')!.linvel();
        close(v.x,d.surfaces[1].speed*shot.direction[0],1e-5);
        close(v.y,d.surfaces[1].speed*shot.direction[1]+2,1e-5);
        close(shot.origin[0]+v.x*solution.timeOfFlight,practice.target.x,1e-5);
        close(shot.origin[1]+v.y*solution.timeOfFlight,practice.target.y,1e-5);
    }finally{sim.free();}
});

test('bounded turret interpolation stays inside its allowed range instead of crossing the rear stop',()=>{
    const sub=sampleRobot().subsystems[2];sub.targetingMode='turret';sub.targetingFreedom=340*Math.PI/180;
    const limit=sub.targetingFreedom/2;
    for(let i=0;i<=10;i++)assert.ok(Math.abs(blendSubsystemYaw(limit,-limit,i/10,sub))<=limit);
    close(blendSubsystemYaw(limit,-limit,.5,sub),0);
    sub.targetingFreedom=2*Math.PI;close(blendSubsystemYaw(limit,-limit,.5,sub),Math.PI);
});

test('automatic targeting replays deterministically without modifying the saved design',()=>{
    const d=ensureStates(sampleRobot());d.subsystems[2].targetingMode='sotm-turret';d.subsystems[0].targetingMode='aim-with-drivetrain';
    const first=new Simulation(d);
    try {
        for(let i=0;i<180;i++)first.step({x:i<90?.5:0,y:.3,turn:.4,held:i>30?['i']:[]});
        const expected=first.snapshot(),replay=new Simulation(d,expected.recording);
        try {
            for(let i=0;i<180;i++)replay.step();
            const actual=replay.snapshot();assert.deepEqual(actual.pose,expected.pose);assert.deepEqual(actual.subsystems,expected.subsystems);assert.deepEqual(actual.pieces,expected.pieces);
        }finally{replay.free();}
    }finally{first.free();}
});
