import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Viewport} from '../ui/viewport';
import {pieceGeometry} from '../ui/piece-geometry';
import {pieceShapes,TUBE_COLLISION_SEGMENTS,TUBE_WALL_COLLIDERS,ENVIRONMENT_COLLISION_GROUPS} from '../simulation/piece-physics';
import {RAPIER,Simulation} from '../simulation/runtime';
import {createSeasonRobot,seasonFor} from '../seasons/registry';
import {ensureField} from '../contracts/field-validation';
import {parseDocument,type Vec3} from '../contracts/model';
import {documentInput} from '../service/documents';
import type {ScoringElement} from '../contracts/field';
before(async()=>{await RAPIER.init();});
const origin={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1};
const input=(held:string[]=[])=>({x:0,y:0,turn:0,held});
const close=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const coral=seasonFor('reefscape-2025').pieceTypes[0];

test('Field clicks pick scoring boxes instead of nearer robot boxes and refresh world matrices',()=>{
 const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(1,0,4);camera.lookAt(1,0,0);camera.updateMatrixWorld();
 const field=new THREE.Mesh(new THREE.BoxGeometry(.4,.4,.4),new THREE.MeshBasicMaterial({wireframe:true}));field.position.set(1,0,0);field.userData.id='goal';
 const robot=new THREE.Mesh(field.geometry,field.material);robot.position.set(1,0,1);robot.userData.id='robot';
 const picks:{id:string;face?:string}[]=[],state:any={fieldEditing:true,fieldMeshes:new Map([['goal',field]]),meshes:new Map([['robot',robot]]),ray:new THREE.Raycaster(),onSelect:(id:string,face?:string)=>picks.push({id,face})};
 state.coords=()=>state.ray.setFromCamera(new THREE.Vector2(0,0),camera);
 try {
  (Viewport.prototype as any).hit.call(state,{},false);assert.deepEqual(picks[0],{id:'goal',face:undefined});
  (Viewport.prototype as any).hit.call(state,{},true);assert.equal(picks[1].face,'+Z');
  state.fieldEditing=false;(Viewport.prototype as any).hit.call(state,{},false);assert.equal(picks[2].id,'robot');
 }finally{field.geometry.dispose();(field.material as THREE.Material).dispose();}
});

test('release points use non-rendered transform anchors and cages/default nets center on X=0',()=>{
 const d=createSeasonRobot('reefscape-2025'),proto=Viewport.prototype as any;
 let attached:THREE.Object3D|undefined;
 const state:any={document:d,scoringVisual:new THREE.Group(),fieldMeshes:new Map(),fieldFills:new Map(),selected:d.field!.sources[0].id,fieldEditing:true,disposeGroup:proto.disposeGroup,transform:{attach:(o:THREE.Object3D)=>attached=o}};
 proto.renderScoring.call(state);
 try {
  assert.ok(attached && !(attached instanceof THREE.Mesh));assert.deepEqual(attached!.position.toArray(),d.field!.sources[0].position);
  assert.equal(state.fieldMeshes.size,88);assert.ok(!state.fieldMeshes.has(d.field!.sources[0].id));
  assert.equal(state.scoringVisual.children.filter((o:THREE.Object3D)=>!(o instanceof THREE.Mesh)).length,4);
  const cages=seasonFor(d.seasonId).geometry.filter(g=>g.id.includes(':cage:'));assert.equal(cages.length,12);
  for(let i=0;i<cages.length;i+=2)close((cages[i].position[0]+cages[i+1].position[0])/2,0);
  assert.ok(d.field!.scoringElements.filter(g=>g.id.endsWith(':net')).every(g=>g.position[0]===0));
 }finally{proto.disposeGroup.call(state,state.scoringVisual);}
});

test('Coral render mesh has open ends and Algae render mesh is smooth',()=>{
 const tube=pieceGeometry(coral),sphere=pieceGeometry(seasonFor('reefscape-2025').pieceTypes[1]);
 try {
  assert.ok(tube instanceof THREE.LatheGeometry);assert.ok(tube.getAttribute('position').count>300);
  const positions=tube.getAttribute('position');let minRadius=Infinity,maxRadius=0,minX=Infinity,maxX=-Infinity;
  for(let i=0;i<positions.count;i++){const radius=Math.hypot(positions.getY(i),positions.getZ(i));minRadius=Math.min(minRadius,radius);maxRadius=Math.max(maxRadius,radius);minX=Math.min(minX,positions.getX(i));maxX=Math.max(maxX,positions.getX(i));}
  close(minRadius,coral.innerRadius!);close(maxRadius,coral.size[1]/2);close(maxX-minX,coral.size[0]);
  assert.ok(sphere instanceof THREE.SphereGeometry);assert.ok(sphere.getAttribute('position').count>1500);
 }finally{tube.dispose();sphere.dispose();}
});

test('Coral collider retains an empty bore and colliding pipe wall with the correct mass',()=>{
 const parts=pieceShapes(coral),probe=new RAPIER.Ball(.003);assert.equal(parts.length,TUBE_COLLISION_SEGMENTS);
 assert.ok(parts.every(shape=>!shape.intersectsShape(origin,identity,new RAPIER.Ball(coral.innerRadius!*.8),origin,identity)));
 assert.ok(parts.some(shape=>shape.intersectsShape(origin,identity,probe,{x:0,y:(coral.innerRadius!+coral.size[1]/2)/2,z:0},identity)));
 const world=new RAPIER.World({x:0,y:0,z:0});
 try {
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-.4,0,0).setLinvel(1,0,0).setCcdEnabled(true));
  for(const shape of parts)world.createCollider(new RAPIER.ColliderDesc(shape).setMass(coral.mass/parts.length),body);
  world.createCollider(RAPIER.ColliderDesc.cylinder(.25,.0175).setRotation({x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2}));
  close(body.mass(),coral.mass);assert.equal(body.numColliders(),48);world.timestep=1/120;
  for(let i=0;i<120;i++)world.step();assert.ok(body.translation().x>.59,'the pipe must slide along the rod through its bore');
 }finally{world.free();}
});

test('scoring tests the tube wall rather than treating the empty bore as solid',()=>{
 function run(y:number){
  const goal:ScoringElement={id:'probe-goal',name:'Probe',position:[2,y,2],size:[.01,.01,.01],yaw:0,pitch:0,roll:0,points:3,capacity:1,accepts:['coral'],surfaces:[{id:'probe-face',name:'Face',faces:['+X'],accepts:['coral']}]};
  const d=createSeasonRobot('reefscape-2025');d.field={scoringElements:[goal],sources:[]};const sim=new Simulation(d);
  try{(sim as any).spawn('tube',[2,0,2],[0,0,0],[0,0,0],'coral');sim.step(input());return sim.score;}finally{sim.free();}
 }
 assert.equal(run(0),0);assert.equal(run((coral.innerRadius!+coral.size[1]/2)/2),3);
});

test('outtake clearance allows a real branch through the Coral bore',()=>{
 const d=createSeasonRobot('reefscape-2025');d.field={scoringElements:[],sources:[]};d.subsystems[2].position=[0,0,1.5];d.subsystems[2].size=[.1,.1,.1];d.subsystems[2].solid=false;d.surfaces[1].yaw=0;d.surfaces[1].pitch=0;
 const sim=new Simulation(d);
 try {
  sim.robot.setTranslation({x:-3,y:1.8,z:0},true);sim.step(input());
  const x=-3+.05+coral.radius+.045;
  sim.world.createCollider(RAPIER.ColliderDesc.cylinder(.3,.0175).setTranslation(x,1.8,1.5).setRotation({x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2}).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS));sim.step(input());
  sim.graph.tokens.set('tube',{id:'tube',pieceType:'coral',node:'launcher',owner:'launcher',arrived:0,captured:0});sim.step(input(['k']));
  assert.equal(sim.releases,1);assert.ok(sim.bodies.get('tube')!.translation().x>x);assert.equal(sim.bodies.get('tube')!.numColliders(),TUBE_WALL_COLLIDERS+1);
 }finally{sim.free();}
});

test('bounciness settings round-trip, reject invalid values and keep new net edits after one-time migration',()=>{
 const d=ensureField(createSeasonRobot('reefscape-2025'));d.field!.bounciness={coral:0,algae:.9};
 assert.deepEqual(documentInput(d).document.field!.bounciness,{coral:0,algae:.9});
 const invalid:Record<string,number>[]=[{coral:-.1},{algae:1.01},{coral:NaN},{ball:.3}];
 for(const values of invalid){const bad=structuredClone(d);bad.field!.bounciness=values;assert.throws(()=>parseDocument(bad));assert.throws(()=>documentInput(bad));}
 const old=structuredClone(d);delete old.field!.bounciness;old.field!.scoringElements.find(g=>g.id==='blue:net')!.position[0]=-.3048;
 const migrated=parseDocument(old);assert.equal(migrated.field!.scoringElements.find(g=>g.id==='blue:net')!.position[0],0);
 migrated.field!.scoringElements.find(g=>g.id==='blue:net')!.position[0]=.3048;assert.equal(parseDocument(migrated).field!.scoringElements.find(g=>g.id==='blue:net')!.position[0],.3048);
});

test('zero bounciness settles on the floor while high bounciness rebounds',()=>{
 function rebound(bounce:number){const d=ensureField(createSeasonRobot('practice-balls'));d.field!.bounciness!.ball=bounce;d.field!.scoringElements=[];
  const sim=new Simulation(d);try{(sim as any).spawn('probe',[3,-2,2],[0,0,0],[0,0,0],'ball');let peak=0;for(let i=0;i<120;i++){sim.step(input());peak=Math.max(peak,sim.bodies.get('probe')!.linvel().z);}return peak;}finally{sim.free();}}
 assert.ok(rebound(0)<.2);assert.ok(rebound(.9)>4);
 const d=ensureField(createSeasonRobot('reefscape-2025'));d.field!.bounciness={coral:.1,algae:.8};const sim=new Simulation(d);
 try{for(const type of ['coral','algae']){const id=sim.season.pieces.find(p=>p.type===type)!.id,body=sim.bodies.get(id)!;for(let i=0;i<body.numColliders();i++)close(body.collider(i).restitution(),d.field!.bounciness![type]);}}finally{sim.free();}
});
