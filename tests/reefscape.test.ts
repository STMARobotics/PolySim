import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonRobot,seasonFor} from '../seasons/registry';
import {ensureStates,addState} from '../contracts/states';
import {syncSurfaceLinks,parseDocument,validate,type Vec3} from '../contracts/model';
import {documentInput} from '../service/documents';
import {GraphEngine} from '../simulation/graph';
import {FieldEngine,scoringPlanes} from '../simulation/field';
import {Simulation,RAPIER} from '../simulation/runtime';
import {nodePorts,transitionCurve} from '../ui/graph-model';
import type {ScoringElement} from '../contracts/field';
import {storedValue,displayValue} from '../ui/units';
before(async()=>{await RAPIER.init();});
const input=(held:string[]=[])=>({x:0,y:0,turn:0,held});
const goal=():ScoringElement=>({id:'test-goal',name:'Test goal',position:[2,0,1],size:[.5,.5,.2],yaw:0,pitch:0,roll:0,points:5,capacity:1,accepts:['coral'],surfaces:[{id:'test-face',name:'Top',faces:['+Z'],accepts:['coral']}]});
function scoringRobot(g=goal()){const d=createSeasonRobot('reefscape-2025');d.field={scoringElements:[g],sources:[]};return d;}
const spawn=(sim:Simulation,id:string,type:string,position:Vec3,velocity:Vec3=[0,0,0])=>(sim as any).spawn(id,position,velocity,[0,0,0],type);

test('REEFSCAPE has a fixed blocky field, two physical piece types, and default scoring at all levels',()=>{
 const s=seasonFor('reefscape-2025'),d=createSeasonRobot(s.id);
 assert.ok(Math.abs(s.length-690.875*.0254)<1e-9);assert.ok(Math.abs(s.width-317*.0254)<1e-9);
 assert.equal(s.pieces.filter(p=>p.type==='coral').length,6);assert.equal(s.pieces.filter(p=>p.type==='algae').length,18);
 assert.equal(s.pieceTypes.find(p=>p.id==='coral')!.shape,'tube');assert.equal(s.pieceTypes.find(p=>p.id==='algae')!.shape,'sphere');
 assert.equal(d.field!.scoringElements.length,88);assert.equal(d.field!.sources.length,4);
 assert.deepEqual(new Set(d.field!.scoringElements.filter(g=>g.name.includes('L4')).map(g=>g.points)),new Set([5]));
 assert.equal(validate(ensureStates(d)).filter(i=>i.level==='error').length,0);assert.equal(documentInput(d).runnable,true);
});

test('travel graph provides separate Coral/Algae entry and exit ports while state ports stay generic',()=>{
 const d=createSeasonRobot('reefscape-2025'),ports=nodePorts(d,'hopper'),actions=nodePorts(d,'intake');
 assert.deepEqual(ports.inputs.map(p=>p.type),['coral','algae']);assert.deepEqual(ports.outputs.map(p=>p.type),['coral','algae']);assert.notEqual(ports.inputs[0].y,ports.inputs[1].y);
 const lanes=[0,1].map(lane=>transitionCurve([0,96],[288,96],{width:144,portY:ports.outputs[lane].y},{portY:ports.inputs[lane].y},76,lane));assert.notEqual(lanes[0].path,lanes[1].path);for(const lane of lanes)assert.ok(lane.center.every(n=>n%24===0));
 assert.deepEqual(actions.outputs.map(p=>p.type),['coral','algae']);assert.equal(nodePorts(d,'hopper',true).inputs.length,1);
 d.surfaces[0].accepts=['coral'];syncSurfaceLinks(d);assert.deepEqual(nodePorts(d,'intake').outputs.map(p=>p.type),['coral']);
 d.surfaces[0].accepts=['algae'];assert.equal(nodePorts(d,'intake').outputs[0].color,ports.outputs[1].color);
});

test('typed transfers only move their game piece type and share subsystem capacity',()=>{
 const d=createSeasonRobot('reefscape-2025');d.subsystems[0].capacity=2;
 for(const e of d.edges.filter(e=>e.source==='collector'&&e.target==='hopper'))Object.assign(e,{duration:.025,key:e.pieceType==='coral'?'c':'a'});
 const graph=new GraphEngine(d);assert.ok(graph.capture('c','intake',0,'coral'));assert.ok(graph.capture('a','intake',0,'algae'));assert.equal(graph.capture('extra','intake',0,'algae'),false);
 graph.tick(1,new Set(['c']),new Set());assert.ok(graph.tokens.get('c')!.flight);assert.equal(graph.tokens.get('a')!.flight,undefined);
 for(let tick=2;tick<=4;tick++)graph.tick(tick,new Set(),new Set());assert.equal(graph.tokens.get('c')!.owner,'hopper');assert.equal(graph.tokens.get('a')!.owner,'collector');
 graph.tick(5,new Set(['a']),new Set());assert.ok(graph.tokens.get('a')!.flight);graph.assertInvariants();
});

test('action compatibility rejects unsupported captures and duplicated states retain each typed link',()=>{
 const d=ensureStates(createSeasonRobot('reefscape-2025')),sub=d.subsystems[0],intake=d.surfaces[0];
 const to=addState(d,sub,sub.states![0]);syncSurfaceLinks(d);const copy=d.surfaces.find(s=>s.owner===sub.id&&s.stateId===to.id)!;
 assert.equal(d.edges.filter(e=>e.source===copy.id).length,2);
 intake.accepts=['coral'];syncSurfaceLinks(d);const graph=new GraphEngine(d);assert.equal(graph.capture('algae','intake',1,'algae'),false);assert.equal(graph.capture('coral','intake',1,'coral'),true);
});

test('scoring consumes one compatible physical piece, awards points and retains capacity inventory',()=>{
 const d=scoringRobot(),sim=new Simulation(d);
 try {
  spawn(sim,'wrong','algae',[2,0,1.23]);sim.step(input());assert.equal(sim.score,0);assert.ok(sim.bodies.has('wrong'));
  sim.world.removeRigidBody(sim.bodies.get('wrong')!);sim.bodies.delete('wrong');
  spawn(sim,'score','coral',[2,0,1.14]);sim.step(input());assert.equal(sim.score,5);assert.equal(sim.scored,1);assert.equal(sim.bodies.has('score'),false);
  assert.deepEqual(sim.snapshot().fieldInventory![0].pieces,[{id:'score',type:'coral'}]);
  spawn(sim,'full','coral',[2,0,1.14]);sim.step(input());assert.equal(sim.score,5);assert.ok(sim.bodies.has('full'));assert.equal(sim.field.targets()[0].valid,false);
 }finally{sim.free();}
});

test('unassigned faces do not score and swept contact catches fast pieces crossing thin scoring faces',()=>{
 const sim=new Simulation(scoringRobot());
 try {
  spawn(sim,'inside','coral',[2,0,1]);sim.step(input());assert.equal(sim.score,0);
  sim.world.removeRigidBody(sim.bodies.get('inside')!);sim.bodies.delete('inside');
  spawn(sim,'fast','coral',[2,0,1.45],[0,0,-80]);sim.step(input());assert.equal(sim.score,5);assert.equal(sim.bodies.has('fast'),false);
 }finally{sim.free();}
});

test('rotated scoring surfaces are placed on their prism faces and score only once per piece ID',()=>{
 const g=goal();g.yaw=.6;g.pitch=.3;g.roll=.2;g.surfaces[0].faces=['+X'];const plane=scoringPlanes(g)[0];
 assert.notDeepEqual(plane.position,[g.position[0]+g.size[0]/2,g.position[1],g.position[2]]);
 const f=new FieldEngine({scoringElements:[g],sources:[]});assert.equal(f.score('id','coral',plane.position,plane.position,()=>true)?.points,5);assert.equal(f.score('id','coral',plane.position,plane.position,()=>true),undefined);
});

test('human-player releases obey proximity, repeat interval, continuous mode and disabled settings',()=>{
 const source={id:'source',name:'Source',position:[0,0,1] as Vec3,velocity:[0,0,-1] as Vec3,pieceType:'coral',enabled:true,mode:'proximity' as const,proximity:1,cooldown:.1};
 const f=new FieldEngine({scoringElements:[],sources:[source]});assert.equal(f.releases(1,[2,0,0]).length,0);assert.equal(f.releases(2,[.9,0,0]).length,1);assert.equal(f.releases(13,[0,0,0]).length,0);assert.equal(f.releases(14,[0,0,0]).length,1);
 const continuous=new FieldEngine({scoringElements:[],sources:[{...source,mode:'continuous'}]});assert.equal(continuous.releases(1,[20,20,0]).length,1);assert.equal(continuous.releases(12,[20,20,0]).length,0);assert.equal(continuous.releases(13,[20,20,0]).length,1);
 const disabled=new FieldEngine({scoringElements:[],sources:[{...source,enabled:false}]});assert.equal(disabled.releases(100,[0,0,0]).length,0);
});

test('physical human-player releases carry type and repeat with unique IDs',()=>{
 const d=scoringRobot();d.field!.sources=[{id:'test-source',name:'Source',position:[2,1,2],velocity:[0,0,-1],pieceType:'algae',enabled:true,mode:'continuous',proximity:1,cooldown:.1}];
 const sim=new Simulation(d);try {
  sim.step(input());for(let i=0;i<12;i++)sim.step(input());
  const introduced=sim.snapshot().pieces.filter(p=>p.id.startsWith('source:'));assert.equal(introduced.length,2);assert.ok(introduced.every(p=>p.type==='algae'));assert.notEqual(introduced[0].id,introduced[1].id);
 }finally{sim.free();}
});

test('typed outtakes retain physical piece shape and identity',()=>{
 const d=createSeasonRobot('reefscape-2025');d.subsystems[2].capacity=2;d.field!.sources=[];
 for(const e of d.edges.filter(e=>e.target==='outtake'))e.key=e.pieceType==='algae'?'a':'c';
 const sim=new Simulation(d);try {
  sim.robot.setTranslation({x:-3,y:1.8,z:0},true);sim.step(input());
  for(const type of ['coral','algae'])sim.graph.tokens.set(type,{id:type,pieceType:type,node:'launcher',owner:'launcher',arrived:0,captured:0});
  sim.step(input(['a']));assert.equal(sim.releases,1);assert.ok(sim.bodies.get('algae')!.collider(0).shape instanceof RAPIER.Ball);assert.ok(sim.graph.tokens.has('coral'));assert.equal(sim.snapshot().pieces.find(p=>p.id==='algae')!.type,'algae');
   for(let i=0;i<31;i++)sim.step(input(['c']));assert.ok(sim.bodies.get('coral')!.collider(0).shape instanceof RAPIER.Cuboid);assert.ok(Math.abs(sim.bodies.get('coral')!.rotation().y)>.05);
 }finally{sim.free();}
});

test('field configuration is bounded, typed and separate from immutable season geometry',()=>{
 const d=createSeasonRobot('reefscape-2025'),before=structuredClone(seasonFor(d.seasonId).geometry);
 d.field!.scoringElements[0].points=12;d.field!.scoringElements[0].capacity=5;const saved=documentInput(d).document;assert.equal(saved.field!.scoringElements[0].points,12);assert.deepEqual(seasonFor(d.seasonId).geometry,before);
 assert.throws(()=>documentInput({...d,field:{...d.field,geometry:[]}}));
 const bad=structuredClone(d);bad.field!.sources[0].pieceType='ball';assert.throws(()=>parseDocument(bad));
 assert.equal(displayValue('goal.position.0',storedValue('goal.position.0',300.13)),300);assert.equal(displayValue('source.proximity',storedValue('source.proximity',30.2)),30);
});

test('reefscape restart clears scored inventory and sources replay deterministically',()=>{
 const d=scoringRobot();d.field!.sources=[{id:'source',name:'Source',position:[2,1,2],velocity:[0,0,-1],pieceType:'coral',enabled:true,mode:'continuous',proximity:1,cooldown:.2}];
 const a=new Simulation(d);try {
  for(let i=0;i<50;i++)a.step(input());const expected=a.snapshot(),b=new Simulation(d,expected.recording);
  try{for(let i=0;i<50;i++)b.step();assert.deepEqual(b.snapshot().pieces,expected.pieces);assert.deepEqual(b.snapshot().fieldInventory,expected.fieldInventory);}finally{b.free();}
  const fresh=new Simulation(d);try{assert.equal(fresh.score,0);assert.equal(fresh.field.inventory.get('test-goal')!.length,0);}finally{fresh.free();}
 }finally{a.free();}
});

test('automatic targeting chooses a scoring target compatible with the activated typed action',()=>{
 const d=createSeasonRobot('reefscape-2025'),coral=goal(),algae=goal();
 coral.position=[2,2,1];algae.position=[2,-2,1];algae.id='algae-goal';algae.accepts=['algae'];algae.surfaces=[{id:'algae-face',name:'Face',faces:['+Z'],accepts:['algae']}];
 d.field={scoringElements:[coral,algae],sources:[]};d.subsystems[2].targetingMode='turret';
 for(const edge of d.edges.filter(e=>e.target==='outtake'))edge.key=edge.pieceType==='algae'?'a':'c';
 const sim=new Simulation(d);try {
  sim.targeting.update({x:0,y:0,yaw:0},{x:0,y:0,omega:0},new Set(['a']),new Set());assert.ok(sim.document.subsystems[2].yaw<0);
  sim.targeting.update({x:0,y:0,yaw:0},{x:0,y:0,omega:0},new Set(['c']),new Set());assert.ok(sim.document.subsystems[2].yaw>0);
 }finally{sim.free();}
});
