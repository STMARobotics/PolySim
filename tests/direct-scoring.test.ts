import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,Simulation} from '../simulation/runtime';
import {createSeasonRobot,seasonFor} from '../seasons/registry';
import {syncSurfaceLinks,DT,type Vec3} from '../contracts/model';
import type {ScoringElement} from '../contracts/field';
import {pieceShapes} from '../simulation/piece-physics';
import {scoringPlanes} from '../simulation/field';
import {orientation} from '../contracts/geometry';
before(async()=>{await RAPIER.init();});
const input=(held:string[]=[])=>({x:0,y:0,turn:0,held});
function fixture(options:{type?:string;capacity?:number;count?:number;block?:boolean;faces?:ScoringElement['surfaces'][number]['faces'];accepted?:string;duration?:number;press?:boolean}={}) {
 const type=options.type ?? 'algae',count=options.count ?? 1,definition=seasonFor('reefscape-2025').pieceTypes.find(p=>p.id===type)!;
 const d=createSeasonRobot('reefscape-2025');d.subsystems[2].position=[0,0,1.5];d.subsystems[2].size=[.1,.1,.1];d.subsystems[2].solid=false;d.subsystems[2].capacity=count;
 const action=d.surfaces.find(s=>s.id==='outtake')!;Object.assign(action,{pitch:0,yaw:0,interval:.025,unitsX:count,unitsY:1,accepts:[type]});syncSurfaceLinks(d);
 const edge=d.edges.find(e=>e.target==='outtake')!;edge.duration=options.duration ?? 0;edge.trigger=options.press?'press':'hold';edge.key='k';
 const mouth:Vec3=[-2.95,1.8,1.5],release:Vec3=[mouth[0]+definition.radius+.045,mouth[1],mouth[2]];
 const goal:ScoringElement={id:'receiver',name:'Test receiver',position:[release[0]+.1,release[1],release[2]],size:[.2,3,1],yaw:0,pitch:0,roll:0,points:5,capacity:options.capacity ?? count,accepts:[options.accepted ?? type],surfaces:[{id:'receiver-face',name:'Entry',faces:options.faces ?? ['-X'],accepts:[options.accepted ?? type]}]};
 if(options.faces?.length===0)goal.surfaces=[];
 d.field={scoringElements:[goal],sources:[]};
 const sim=new Simulation(d);sim.robot.setTranslation({x:-3,y:1.8,z:0},true);
 if(options.block!==false)sim.world.createCollider(RAPIER.ColliderDesc.cuboid(.12,2,.3).setTranslation(...release));
 sim.step(input());
 for(let i=0;i<count;i++)sim.graph.tokens.set('handoff:'+i,{id:'handoff:'+i,pieceType:type,node:'launcher',owner:'launcher',arrived:0,captured:0});
 return {sim,goal:sim.document.field!.scoringElements[0],definition,mouth,release};
}
function assertConserved(sim:Simulation,extra:number){
 const free=[...sim.bodies.keys()],internal=[...sim.graph.tokens.keys()],stored=sim.field.snapshot().flatMap(row=>row.pieces.map(p=>p.id)),all=[...free,...internal,...stored,...sim.escaped];
 assert.equal(all.length,sim.season.pieces.length+extra);assert.equal(new Set(all).size,all.length);sim.graph.assertInvariants();
}

test('outtaking at a compatible scoring face transfers ownership before overlapping field geometry can block it',()=>{
 const {sim,release,definition}=fixture();
 try {
  assert.ok(pieceShapes(definition).some(shape=>sim.world.intersectionWithShape({x:release[0],y:release[1],z:release[2]},{x:0,y:0,z:0,w:1},shape)),'this placement must actually lack physical release clearance');
  sim.step(input(['k']));assert.equal(sim.score,5);assert.equal(sim.scored,1);assert.equal(sim.releases,1);assert.equal(sim.graph.tokens.has('handoff:0'),false);assert.equal(sim.bodies.has('handoff:0'),false);
  assert.deepEqual(sim.field.snapshot()[0].pieces,[{id:'handoff:0',type:'algae'}]);assert.equal(sim.blocked.length,0);assert.equal(sim.cycles.length,1);assertConserved(sim,1);
  for(let i=0;i<10;i++)sim.step(input(['k']));assert.equal(sim.score,5);assert.equal(sim.field.snapshot()[0].pieces.length,1);assertConserved(sim,1);
 }finally{sim.free();}
});

test('direct placements work for hollow Coral and preserve type and ID',()=>{
 const {sim}=fixture({type:'coral'});
 try{sim.step(input(['k']));assert.equal(sim.score,5);assert.deepEqual(sim.field.snapshot()[0].pieces,[{id:'handoff:0',type:'coral'}]);assertConserved(sim,1);}finally{sim.free();}
});

test('full or incompatible touching receivers retain the piece and report the receiver reason',()=>{
 for(const kind of ['full','incompatible']) {
  const {sim}=fixture({accepted:kind==='incompatible'?'coral':'algae',block:false});
  try {
   if(kind==='full')sim.field.inventory.get('receiver')!.push({id:'previous-score',type:'algae'});
   sim.step(input(['k']));assert.equal(sim.releases,0);assert.equal(sim.score,0);assert.ok(sim.graph.tokens.has('handoff:0'));assert.ok(!sim.bodies.has('handoff:0'));
   assert.ok(sim.blocked.some(s=>s.includes('Test receiver')&&s.includes(kind==='full'?'is full':'does not accept Algae')));
  }finally{sim.free();}
 }
});

test('unassigned faces and unrelated obstacles continue to block physical release',()=>{
 const {sim}=fixture({faces:['+Z']});
 try {sim.step(input(['k']));assert.equal(sim.score,0);assert.equal(sim.releases,0);assert.ok(sim.graph.tokens.has('handoff:0'));assert.ok(sim.blocked.some(s=>s.startsWith('Blocked outtake:')));}finally{sim.free();}
 const clear=fixture({faces:[],block:false});
 try {clear.sim.step(input(['k']));assert.equal(clear.sim.score,0);assert.equal(clear.sim.releases,1);assert.ok(clear.sim.bodies.has('handoff:0'));assertConserved(clear.sim,1);}finally{clear.sim.free();}
});

test('batch placements respect receiver capacity atomically and retain the shared action cooldown',()=>{
 const {sim,goal}=fixture({count:4,capacity:2});
 try {
  sim.step(input(['k']));assert.equal(sim.releases,2);assert.equal(sim.score,10);assert.equal(sim.field.snapshot()[0].pieces.length,2);assert.equal(sim.graph.tokens.size,2);assertConserved(sim,4);
  goal.capacity=4;sim.step(input(['k']));sim.step(input(['k']));assert.equal(sim.releases,2);
  sim.step(input(['k']));assert.equal(sim.releases,4);assert.equal(sim.score,20);assert.equal(sim.graph.tokens.size,0);assert.equal(sim.field.snapshot()[0].pieces.length,4);assertConserved(sim,4);
 }finally{sim.free();}
});

test('timed Press transfers place only after their delay and finish after the key is released',()=>{
 const {sim}=fixture({duration:3*DT,press:true});
 try {
  sim.step(input(['k']));assert.equal(sim.score,0);assert.ok(sim.graph.tokens.get('handoff:0')!.flight);
  sim.step(input());sim.step(input());assert.equal(sim.score,0);
  sim.step(input());assert.equal(sim.releases,1);assert.equal(sim.score,5);assertConserved(sim,1);
 }finally{sim.free();}
});

test('an overlapping incompatible receiver does not hide another eligible receiver',()=>{
 const {sim,goal}=fixture({accepted:'coral'});
 try {
  const eligible={...structuredClone(goal),id:'eligible',name:'Eligible receiver',points:7,accepts:['algae'],surfaces:[{id:'eligible-face',name:'Entry',faces:['-X'] as const,accepts:['algae']}]};
  // FieldEngine precomputes geometry, so construct a fresh simulation with both receiver definitions.
  const d=structuredClone(sim.document);d.field!.scoringElements.push({...eligible,surfaces:eligible.surfaces.map(s=>({...s,faces:[...s.faces]}))});
  const second=new Simulation(d);
  try {
   second.robot.setTranslation({x:-3,y:1.8,z:0},true);second.step(input());second.graph.tokens.set('handoff:0',{id:'handoff:0',pieceType:'algae',node:'launcher',owner:'launcher',arrived:0,captured:0});
   second.step(input(['k']));assert.equal(second.score,7);assert.equal(second.field.inventory.get('receiver')!.length,0);assert.equal(second.field.inventory.get('eligible')!.length,1);assertConserved(second,1);
  }finally{second.free();}
 }finally{sim.free();}
});

test('the empty Coral bore does not trigger a direct handoff',()=>{
 const {sim,release}=fixture({type:'coral',block:false});
 try {
  const d=structuredClone(sim.document);d.field!.scoringElements=[{id:'bore',name:'Bore probe',position:release,size:[.01,.01,.01],yaw:0,pitch:0,roll:0,points:5,capacity:1,accepts:['coral'],surfaces:[{id:'bore-face',name:'Entry',faces:['-X'],accepts:['coral']}]}];
  const second=new Simulation(d);
  try {second.robot.setTranslation({x:-3,y:1.8,z:0},true);second.step(input());second.graph.tokens.set('handoff:0',{id:'handoff:0',pieceType:'coral',node:'launcher',owner:'launcher',arrived:0,captured:0});second.step(input(['k']));assert.equal(second.score,0);assert.equal(second.releases,1);assert.ok(second.bodies.has('handoff:0'));}finally{second.free();}
 }finally{sim.free();}
});

test('a swept Coral wall can touch a scoring face between clear release endpoints',()=>{
 const {sim,mouth,release}=fixture({type:'coral',block:false});
 try {
  const d=structuredClone(sim.document);d.surfaces.find(s=>s.id==='outtake')!.pitch=Math.PI/2;
  // The vertical pipe passes sideways over this thin face. Its bore, rather than
  // its wall, surrounds the face when the center crosses the plane.
  const faceX=(mouth[0]+release[0])/2;
  d.field!.scoringElements=[{id:'swept',name:'Swept receiver',position:[faceX+.005,mouth[1],mouth[2]],size:[.01,.01,.7],yaw:0,pitch:0,roll:0,points:5,capacity:1,accepts:['coral'],surfaces:[{id:'swept-face',name:'Entry',faces:['-X'],accepts:['coral']}]}];
  const second=new Simulation(d);
  try {
   const plane=scoringPlanes(d.field!.scoringElements[0])[0],receiver=new RAPIER.Cuboid(...plane.size.map(v=>v/2) as Vec3);
   for(const at of [mouth,release,[faceX,mouth[1],mouth[2]] as Vec3])assert.ok(!pieceShapes(sim.season.pieceTypes.find(p=>p.id==='coral')!).some(shape=>{
    const contact=shape.contactShape({x:at[0],y:at[1],z:at[2]},orientation(0,-Math.PI/2),receiver,{x:plane.position[0],y:plane.position[1],z:plane.position[2]},plane.rotation,.002);
    return !!contact&&contact.distance<=.002;
   }),'endpoint and center-plane samples must miss the swept wall contact');
   second.robot.setTranslation({x:-3,y:1.8,z:0},true);second.step(input());second.graph.tokens.set('handoff:0',{id:'handoff:0',pieceType:'coral',node:'launcher',owner:'launcher',arrived:0,captured:0});
   second.step(input(['k']));assert.equal(second.score,5);assert.equal(second.releases,1);assert.ok(!second.bodies.has('handoff:0'));assertConserved(second,1);
  }finally{second.free();}
 }finally{sim.free();}
});
