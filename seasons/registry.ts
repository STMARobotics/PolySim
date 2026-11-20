import type {SeasonDefinition,FieldBox} from '../contracts/field';
import {syncSurfaceLinks,type RobotDocument,type Vec3} from '../contracts/model';
import {practice} from './practice-field';
import {sampleRobot} from './practice';
import {reefscape} from './reefscape';
const box=(id:string,position:Vec3,size:Vec3,color=0x28496d):FieldBox=>({id,position,size,color,solid:true});
const t=practice.target,o=practice.obstacle;
const practiceSeason:SeasonDefinition={id:practice.id,title:practice.title,version:practice.version,length:practice.length,width:practice.width,start:practice.start,
 pieceTypes:[{id:'ball',name:'Ball',shape:'sphere',size:[.18,.18,.18],radius:practice.radius,mass:practice.mass,color:0xf5b14e}],pieces:practice.pieces.map(p=>({...p,type:'ball'})),
 geometry:[box('west',[-6.1,0,.3],[.2,8.4,.6]),box('east',[6.1,0,.3],[.2,8.4,.6]),box('south',[0,-4.1,.3],[12.4,.2,.6]),box('north',[0,4.1,.3],[12.4,.2,.6]),box('obstacle',[o.x,o.y,o.height/2],[o.length,o.width,o.height],0xdc3545),box('basket:floor',[t.x,t.y,t.height-.4],[t.depth,t.width,.12]),...[-1,1].flatMap(s=>[box('basket:x:'+s,[t.x+s*t.depth/2,t.y,t.height-.25],[.08,t.width,.3],0x3d8eff),box('basket:y:'+s,[t.x,t.y+s*t.width/2,t.height-.25],[t.depth,.08,.3],0x3d8eff)])],
 defaults:{scoringElements:[{id:'practice:basket',name:'Practice basket',position:[t.x,t.y,t.height],size:[t.depth,t.width,.08],yaw:0,pitch:0,roll:0,points:1,capacity:100,accepts:['ball'],surfaces:[{id:'practice:basket:surface',name:'Opening',faces:['+Z'],accepts:['ball']}]}],sources:[]}
};
export const seasons=[reefscape,practiceSeason] as const;
export function seasonFor(id:string):SeasonDefinition {const season=seasons.find(s=>s.id===id);if(!season)throw Error('Unsupported season.');return season;}
export const pieceTypesFor=(d:Pick<RobotDocument,'seasonId'>)=>seasonFor(d.seasonId).pieceTypes;
export const acceptedTypes=(d:Pick<RobotDocument,'seasonId'>,s:{accepts?:string[]})=>s.accepts ?? pieceTypesFor(d).map(p=>p.id);
export function createSeasonRobot(seasonId:string):RobotDocument {
 const d=sampleRobot(),season=seasonFor(seasonId);d.seasonId=season.id;d.name=season.id==='reefscape-2025'?'REEFSCAPE prototype':d.name;d.field=structuredClone(season.defaults);
 for(const surface of d.surfaces)surface.accepts=season.pieceTypes.map(p=>p.id);
 for(const edge of d.edges)edge.pieceType=season.pieceTypes[0].id;
 for(const type of season.pieceTypes.slice(1))for(const edge of [...d.edges].filter(e=>!d.surfaces.some(s=>s.id===e.source||s.id===e.target)))d.edges.push({...edge,id:edge.id+':'+type.id,pieceType:type.id});
 return syncSurfaceLinks(d);
}
