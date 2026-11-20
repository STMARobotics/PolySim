import {FACES,type RobotDocument,type Vec3} from './model';
import {seasonFor} from '../seasons/registry';
const vector=(v:unknown,bound:number,positive=false):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=bound&&(!positive||n>0));
const identifier=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=100&&/^[A-Za-z0-9:_-]+$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const name=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0&&s.length<=100;
export function ensureField(d:RobotDocument){
 d.field ??=structuredClone(seasonFor(d.seasonId).defaults);
 if(d.seasonId==='reefscape-2025'&&d.field.bounciness===undefined)for(const g of d.field.scoringElements){
  // Move untouched pre-physics-update net defaults onto the barge centerline once.
  if(['blue:net','red:net'].includes(g.id)&&[.31,.3048].some(x=>Math.abs(Math.abs(g.position[0])-x)<1e-8))g.position[0]=0;
 }
 d.field.bounciness ??={};for(const type of seasonFor(d.seasonId).pieceTypes)d.field.bounciness[type.id] ??=type.bounciness ?? .35;return d;
}
export function validateField(d:RobotDocument):string[] {
 if(!d.field)return [];
 const f=d.field;if(!Array.isArray(f.scoringElements)||f.scoringElements.length>128||!Array.isArray(f.sources)||f.sources.length>16)return ['Field configuration exceeds its limits.'];
 const types=seasonFor(d.seasonId).pieceTypes.map(p=>p.id),ids=new Set<string>([d.id,...d.subsystems.map(s=>s.id),...d.surfaces.map(s=>s.id),...d.edges.map(e=>e.id),...d.subsystems.flatMap(s=>[...(s.states ?? []).map(t=>t.id),...(s.stateTransitions ?? []).map(t=>t.id)])]);
 if(f.bounciness!==undefined && (!f.bounciness||typeof f.bounciness!=='object'||Array.isArray(f.bounciness)||Object.entries(f.bounciness).some(([type,value])=>!types.includes(type)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)))return ['Game piece bounciness must be from 0 to 1 for a valid season piece type.'];
 const unique=(s:string)=>{if(!identifier(s)||ids.has(s))return false;ids.add(s);return true;};
 const accepts=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.length<=types.length&&new Set(v).size===v.length&&v.every(t=>types.includes(t));
 for(const g of f.scoringElements) {
  if(!g||!unique(g.id)||!name(g.name)||!vector(g.position,50)||!vector(g.size,12,true)||![g.yaw,g.pitch,g.roll].every(Number.isFinite)||!Number.isInteger(g.points)||g.points<0||g.points>1000||!Number.isInteger(g.capacity)||g.capacity<1||g.capacity>1000||!accepts(g.accepts)||!Array.isArray(g.surfaces)||g.surfaces.length>6)return ['Invalid scoring element.'];
  const faces=new Set<string>();
  for(const s of g.surfaces) {
   if(!s||!unique(s.id)||!name(s.name)||!accepts(s.accepts)||s.accepts.some(t=>!g.accepts.includes(t))||!Array.isArray(s.faces)||!s.faces.length||new Set(s.faces).size!==s.faces.length||s.faces.some(face=>!FACES.includes(face)||faces.has(face)))return ['Invalid scoring surface.'];
   for(const face of s.faces)faces.add(face);
  }
 }
 for(const s of f.sources)if(!s||!unique(s.id)||!name(s.name)||!vector(s.position,50)||!vector(s.velocity,20)||!types.includes(s.pieceType)||typeof s.enabled!=='boolean'||!['proximity','continuous'].includes(s.mode)||!Number.isFinite(s.proximity)||s.proximity<0||s.proximity>30||!Number.isFinite(s.cooldown)||s.cooldown<.1||s.cooldown>300)return ['Invalid human-player release settings.'];
 return [];
}
