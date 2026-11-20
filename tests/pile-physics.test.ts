import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER} from '../simulation/runtime';
import {pieceColliderDescriptors,supportsPieceEnvelopes,TUBE_WALL_COLLIDERS,ENVIRONMENT_COLLISION_GROUPS,FLOOR_COLLISION_GROUPS,PHYSICAL_QUERY_GROUPS} from '../simulation/piece-physics';
import {seasonFor} from '../seasons/registry';
import type {PieceDefinition} from '../contracts/field';
import {createPile,drivePile} from './fixtures/pile';
before(async()=>{await RAPIER.init();});
const pieces=seasonFor('reefscape-2025').pieceTypes,coral=pieces.find(p=>p.id==='coral')!,algae=pieces.find(p=>p.id==='algae')!;
const origin={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1};
const interacts=(a:number,b:number)=>!!(((a>>>16)&b&0xffff)&&((b>>>16)&a&0xffff));
function addPiece(world:RAPIER.World,piece:PieceDefinition,x=0,speed=0){
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,0,0).setLinvel(speed,0,0).setCcdEnabled(true));
 for(const descriptor of pieceColliderDescriptors(piece,true))world.createCollider(descriptor.setFriction(.6),body);
 return body;
}
test('collision groups route piece contacts to one envelope while environment contacts keep hollow walls',()=>{
 const pipe=pieceColliderDescriptors(coral,true),ball=pieceColliderDescriptors(algae,true)[0],wall=pipe[0],envelope=pipe.at(-1)!;
 assert.equal(pipe.length,TUBE_WALL_COLLIDERS+1);
 assert.ok(!interacts(wall.collisionGroups,wall.collisionGroups));
 assert.ok(!interacts(wall.collisionGroups,ball.collisionGroups));
 assert.ok(!interacts(wall.collisionGroups,envelope.collisionGroups));
 assert.ok(interacts(envelope.collisionGroups,envelope.collisionGroups));
 assert.ok(interacts(envelope.collisionGroups,ball.collisionGroups));
 assert.ok(interacts(ball.collisionGroups,ball.collisionGroups));
 assert.ok(interacts(ENVIRONMENT_COLLISION_GROUPS,wall.collisionGroups));
 assert.ok(interacts(ENVIRONMENT_COLLISION_GROUPS,ball.collisionGroups));
 assert.ok(!interacts(ENVIRONMENT_COLLISION_GROUPS,envelope.collisionGroups));
 assert.ok(interacts(FLOOR_COLLISION_GROUPS,envelope.collisionGroups));
 assert.ok(interacts(FLOOR_COLLISION_GROUPS,ball.collisionGroups));
 assert.ok(!interacts(FLOOR_COLLISION_GROUPS,wall.collisionGroups));
});
test('physical scene queries see pipe walls and the open bore without hitting the piece envelope',()=>{
 const world=new RAPIER.World(origin);
 try{
  const body=addPiece(world,coral);world.step();
  assert.ok(Math.abs(body.mass()-coral.mass)<1e-6);
  assert.equal(world.intersectionWithShape(origin,identity,new RAPIER.Ball(.004),undefined,PHYSICAL_QUERY_GROUPS),null);
  assert.ok(world.intersectionWithShape({x:0,y:(coral.innerRadius!+coral.size[1]/2)/2,z:0},identity,new RAPIER.Ball(.002),undefined,PHYSICAL_QUERY_GROUPS));
  assert.equal(world.castRay(new RAPIER.Ray({x:-.5,y:0,z:0},{x:1,y:0,z:0}),1,true,undefined,PHYSICAL_QUERY_GROUPS),null);
  assert.ok(world.intersectionWithShape(origin,identity,new RAPIER.Ball(.004)),'the excluded envelope must actually occupy the probe location');
  assert.ok(coral.size[1]/2*(1/Math.cos(Math.PI/TUBE_WALL_COLLIDERS)-1)<.0005,'outer slab error stays below half a millimeter');
 }finally{world.free();}
});
test('a branch can pass through the optimized dynamic pipe bore',()=>{
 const world=new RAPIER.World(origin);world.timestep=1/120;
 try{
  const body=addPiece(world,coral,-.4,1);
  world.createCollider(RAPIER.ColliderDesc.cylinder(.25,.0175).setRotation({x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2}).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS));
  for(let i=0;i<120;i++)world.step();assert.ok(body.translation().x>.59);assert.equal(body.numColliders(),TUBE_WALL_COLLIDERS+1);
 }finally{world.free();}
});
test('Coral and Algae still collide with other game pieces',()=>{
 for(const other of [coral,algae]){
  const world=new RAPIER.World(origin);world.timestep=1/120;
  try{
   const a=addPiece(world,coral,-.5,2),b=addPiece(world,other,.5,-2);
   for(let i=0;i<90;i++)world.step();
   const minimum=coral.size[0]/2+(other.shape==='sphere'?other.radius:other.size[0]/2);
   assert.ok(b.translation().x-a.translation().x>minimum-.01,other.name+' cannot pass through Coral');
  }finally{world.free();}
 }
});
test('fast Coral keeps CCD and cannot tunnel through a thin field wall',()=>{
 const world=new RAPIER.World(origin);world.timestep=1/120;
 try{
  const body=addPiece(world,coral,-.6,20);
  world.createCollider(RAPIER.ColliderDesc.cuboid(.0025,.5,.5).setCollisionGroups(ENVIRONMENT_COLLISION_GROUPS));
  for(let i=0;i<30;i++)world.step();assert.ok(body.translation().x<-coral.size[0]/2+.01);assert.ok(body.isCcdEnabled());
 }finally{world.free();}
});
test('optimized floor contact supports Coral and Algae and preserves their bounciness',()=>{
 for(const piece of [coral,algae]){
  const drop=(bounce:number)=>{
   const world=new RAPIER.World({x:0,y:0,z:-9.81});world.timestep=1/120;
   try{
    const body=addPiece(world,piece);body.setTranslation({x:0,y:0,z:1},true);
    for(let i=0;i<body.numColliders();i++)body.collider(i).setRestitution(bounce);
    world.createCollider(RAPIER.ColliderDesc.cuboid(2,2,.1).setTranslation(0,0,-.1).setCollisionGroups(FLOOR_COLLISION_GROUPS).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max));
    let peakUp=0;for(let i=0;i<180;i++){world.step();peakUp=Math.max(peakUp,body.linvel().z);}
    assert.ok(world.intersectionWithShape({x:0,y:0,z:-.1},identity,new RAPIER.Ball(.001),undefined,PHYSICAL_QUERY_GROUPS));
    return {peakUp,z:body.translation().z,speed:Math.abs(body.linvel().z)};
   }finally{world.free();}
  };
  const settled=drop(0);assert.ok(settled.speed<.02);assert.ok(Math.abs(settled.z-(piece.shape==='sphere'?piece.radius:piece.size[1]/2))<.01);
  const elastic=drop(.9);assert.ok(elastic.peakUp>2&&elastic.peakUp>5*settled.peakUp);
 }
});
test('seasons with game pieces small enough for a bore retain detailed piece-to-piece contacts',()=>{
 const small={...algae,id:'small',size:[.02,.02,.02] as [number,number,number],radius:.01};
 assert.ok(supportsPieceEnvelopes(pieces));assert.ok(!supportsPieceEnvelopes([...pieces,small]));
 const pipe=pieceColliderDescriptors(coral,false),probe=pieceColliderDescriptors(small,false)[0];
 assert.equal(pipe.length,TUBE_WALL_COLLIDERS);assert.ok(pipe.every(wall=>interacts(wall.collisionGroups,probe.collisionGroups)));
});
test('driving through a crowded mixed pile conserves pieces and replays deterministically',()=>{
 const run=()=>{
  const sim=createPile('mixed',18);
  try{
   for(let tick=0;tick<180;tick++)drivePile(sim,tick);
   const snapshot=sim.snapshot();assert.equal(snapshot.pieces.length,18);assert.equal(new Set(snapshot.pieces.map(p=>p.id)).size,18);
   assert.ok(snapshot.pieces.every(p=>[...p.position,...p.rotation].every(Number.isFinite)));assert.ok(snapshot.pose.x>-3);
   return {pieces:snapshot.pieces,pose:snapshot.pose};
  }finally{sim.free();}
 };
 assert.deepEqual(run(),run());
});
