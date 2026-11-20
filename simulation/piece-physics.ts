import RAPIER from '@dimforge/rapier3d-compat';
import type {PieceDefinition} from '../contracts/field';

export const TUBE_COLLISION_SEGMENTS=48;
export const TUBE_WALL_COLLIDERS=24;
// Environment/robot, detailed piece walls, piece envelopes, and the flat floor.
const ENVIRONMENT=1,DETAIL=2,PIECE=4,FLOOR=8;
const groups=(membership:number,filter:number)=>(membership<<16)|filter;
export const ENVIRONMENT_COLLISION_GROUPS=groups(ENVIRONMENT,ENVIRONMENT|DETAIL);
export const FLOOR_COLLISION_GROUPS=groups(FLOOR,DETAIL|PIECE);
export const PHYSICAL_QUERY_GROUPS=groups(ENVIRONMENT|DETAIL|PIECE|FLOOR,ENVIRONMENT|DETAIL|FLOOR);
export function supportsPieceEnvelopes(pieces:readonly PieceDefinition[]):boolean {
 const tubes=pieces.filter(p=>p.shape==='tube');
 // Conservative outer contacts are suitable when pieces cannot fit through
 // the bore. Fall back to wall contacts for seasons with smaller pieces.
 return tubes.length>0&&tubes.every(tube=>pieces.every(piece=>(piece.shape==='sphere'?2*piece.radius:Math.min(...piece.size))>2*tube.innerRadius!));
}
export function pieceColliderDescriptors(piece:PieceDefinition,envelopes:boolean):RAPIER.ColliderDesc[] {
 const tube=piece.shape==='tube',collisionGroups=!envelopes?groups(DETAIL,ENVIRONMENT|DETAIL|FLOOR):tube?groups(DETAIL,ENVIRONMENT):groups(DETAIL|PIECE,ENVIRONMENT|PIECE|FLOOR);
 let descriptors:RAPIER.ColliderDesc[];
 if(tube){
  // Tangent wall slabs retain the full bore and overlap at their seams. Primitive
  // box contacts avoid GJK work for every thin convex wedge. The outer error for
  // REEFSCAPE Coral is <0.5 mm; scoring/clearance keep the finer query geometry.
  const outer=piece.size[1]/2,inner=piece.innerRadius!,middle=(outer+inner)/2;
  descriptors=Array.from({length:TUBE_WALL_COLLIDERS},(_,i)=>{
   const angle=i*2*Math.PI/TUBE_WALL_COLLIDERS;
   return RAPIER.ColliderDesc.cuboid(piece.size[0]/2,(outer-inner)/2,outer*Math.tan(Math.PI/TUBE_WALL_COLLIDERS))
    .setTranslation(0,middle*Math.cos(angle),middle*Math.sin(angle))
    .setRotation({x:Math.sin(angle/2),y:0,z:0,w:Math.cos(angle/2)})
    .setMass(piece.mass/TUBE_WALL_COLLIDERS).setCollisionGroups(collisionGroups);
  });
 }else {
  const shapes=pieceShapes(piece);descriptors=shapes.map(shape=>new RAPIER.ColliderDesc(shape).setMass(piece.mass/shapes.length).setCollisionGroups(collisionGroups));
 }
 if(tube&&envelopes)descriptors.push(RAPIER.ColliderDesc.cylinder(piece.size[0]/2,piece.size[1]/2)
  .setRotation({x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2})
  .setMass(0).setCollisionGroups(groups(PIECE,PIECE|FLOOR)));
 return descriptors;
}
const cache=new Map<string,RAPIER.Shape[]>();
// Fine convex wall geometry retains the pipe opening in scoring/clearance queries.
// All part coordinates are relative to the same body origin, along local X.
export function pieceShapes(piece:PieceDefinition):readonly RAPIER.Shape[] {
 const key=JSON.stringify([piece.shape,piece.size,piece.radius,piece.innerRadius]);
 const previous=cache.get(key);if(previous)return previous;
 let shapes:RAPIER.Shape[];
 if(piece.shape==='sphere')shapes=[new RAPIER.Ball(piece.radius)];
 else if(piece.shape==='box')shapes=[new RAPIER.Cuboid(piece.size[0]/2,piece.size[1]/2,piece.size[2]/2)];
 else {
  const outer=piece.size[1]/2,inner=piece.innerRadius!;
  if(!(inner>0&&inner<outer))throw Error('A tube needs a valid inner radius.');
  shapes=Array.from({length:TUBE_COLLISION_SEGMENTS},(_,i)=>{
   const vertices:number[]=[];
   for(const x of [-piece.size[0]/2,piece.size[0]/2])for(const theta of [i*2*Math.PI/TUBE_COLLISION_SEGMENTS,(i+1)*2*Math.PI/TUBE_COLLISION_SEGMENTS])for(const radius of [inner,outer])vertices.push(x,radius*Math.cos(theta),radius*Math.sin(theta));
   return new RAPIER.ConvexPolyhedron(new Float32Array(vertices));
  });
 }
 cache.set(key,shapes);return shapes;
}
