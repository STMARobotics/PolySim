import {FACES,type Vec3} from '../contracts/model';
import type {FieldConfiguration,ScoringElement,ScoringSurface} from '../contracts/field';
import {orientation,rotate3,inverse,type Quat} from '../contracts/geometry';
import type {ScoringTarget} from '../contracts/targeting';
export interface ScoringPlane {element:ScoringElement;surface:ScoringSurface;position:Vec3;size:Vec3;rotation:Quat;axis:number;localPlane:number;radius:number}
export type ReceiveResult={kind:'accepted'|'full'|'incompatible';element:ScoringElement}|{kind:'none'|'already-scored'};
export function scoringPlanes(element:ScoringElement):ScoringPlane[] {
 const rotation=orientation(element.yaw,element.pitch,element.roll);
 return element.surfaces.flatMap(surface=>surface.faces.map(face=>{
  const axis=Math.floor(FACES.indexOf(face)/2),offset:Vec3=[0,0,0],size=[...element.size] as Vec3;
  offset[axis]=element.size[axis]/2*(face[0]==='+'?1:-1);size[axis]=.006;
  const v=rotate3(offset,rotation);
  return {element,surface,position:element.position.map((p,i)=>p+v[i]) as Vec3,size,rotation,axis,localPlane:offset[axis],radius:Math.hypot(...size)/2};
 }));
}
export class FieldEngine {
 inventory=new Map<string,{id:string;type:string}[]>();
 private consumed=new Set<string>();
 private planes:ScoringPlane[];
 private nextRelease=new Map<string,number>();
 constructor(private configuration:FieldConfiguration){this.planes=configuration.scoringElements.flatMap(scoringPlanes);for(const g of configuration.scoringElements)this.inventory.set(g.id,[]);}
 score(id:string,type:string,previous:Vec3,current:Vec3,contact:(plane:ScoringPlane,position:Vec3)=>boolean,pieceRadius=.25) {
  const result=this.receive(id,type,previous,current,contact,pieceRadius,false);
  return result.kind==='accepted'?result.element:undefined;
 }
 tryReceive(id:string,type:string,previous:Vec3,current:Vec3,contact:(plane:ScoringPlane,position:Vec3)=>boolean,pieceRadius=.25,sweep?:(plane:ScoringPlane,previous:Vec3,current:Vec3)=>boolean):ReceiveResult {
  return this.receive(id,type,previous,current,contact,pieceRadius,true,sweep);
 }
 private receive(id:string,type:string,previous:Vec3,current:Vec3,contact:(plane:ScoringPlane,position:Vec3)=>boolean,pieceRadius:number,reportRejected:boolean,sweep?:(plane:ScoringPlane,previous:Vec3,current:Vec3)=>boolean):ReceiveResult {
  if(this.consumed.has(id))return {kind:'already-scored'};
  let rejected:ReceiveResult={kind:'none'};
  for(const plane of this.planes) {
   const g=plane.element,stored=this.inventory.get(g.id)!;
   const compatible=g.accepts.includes(type)&&plane.surface.accepts.includes(type),full=stored.length>=g.capacity;
   if(!reportRejected&&(!compatible||full))continue;
   const delta=current.map((v,i)=>v-previous[i]),length2=delta.reduce((sum,v)=>sum+v*v,0),t=length2?Math.max(0,Math.min(1,plane.position.reduce((sum,v,i)=>sum+(v-previous[i])*delta[i],0)/length2)):0;
   if(plane.position.reduce((sum,v,i)=>sum+(v-previous[i]-delta[i]*t)**2,0)>(plane.radius+pieceRadius+.002)**2)continue;
   let touching=contact(plane,current);
   if(!touching&&reportRejected)touching=contact(plane,previous);
   if(!touching&&sweep)touching=sweep(plane,previous,current);
   if(!touching) {
    const local=(p:Vec3)=>rotate3(p.map((v,i)=>v-g.position[i]) as Vec3,inverse(plane.rotation));
    const a=local(previous)[plane.axis]-plane.localPlane,b=local(current)[plane.axis]-plane.localPlane;
    if(a*b<0) {const t=a/(a-b);touching=contact(plane,previous.map((v,i)=>v+(current[i]-v)*t) as Vec3);}
   }
   if(touching){
    if(!compatible||full){if(rejected.kind==='none')rejected={kind:compatible?'full':'incompatible',element:g};continue;}
    stored.push({id,type});this.consumed.add(id);return {kind:'accepted',element:g};
   }
  }
  return rejected;
 }
 releases(tick:number,robot:Vec3) {
  return this.configuration.sources.filter(source=>{
   if(!source.enabled||tick<(this.nextRelease.get(source.id) ?? 1))return false;
   if(source.mode==='proximity'&&Math.hypot(robot[0]-source.position[0],robot[1]-source.position[1])>source.proximity)return false;
   this.nextRelease.set(source.id,tick+Math.max(1,Math.ceil(source.cooldown*120)));return true;
  });
 }
 targets():ScoringTarget[]{return this.configuration.scoringElements.map(g=>({id:g.id,position:g.position,valid:g.points>0&&g.surfaces.length>0&&(this.inventory.get(g.id)?.length ?? 0)<g.capacity,accepts:[...new Set(g.surfaces.flatMap(s=>s.accepts).filter(t=>g.accepts.includes(t)))]}));}
 snapshot(){return [...this.inventory].map(([element,pieces])=>({element,pieces:structuredClone(pieces)}));}
}
