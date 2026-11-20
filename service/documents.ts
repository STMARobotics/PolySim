import {snapDocumentInches} from '../contracts/inch-grid';
import {TRIGGERS} from '../contracts/triggers';
import {TARGETING_MODES} from '../contracts/targeting';
import { z } from 'zod';
import { parseDocument, validate, type RobotDocument } from '../contracts/model';
import { HttpError } from './http';
const identifier=z.string().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const number=z.number().min(-1e6).max(1e6), vector=z.tuple([number,number,number]);
const name=z.string().trim().min(1).max(100);
const stateSchema=z.object({id:identifier,name,isDefault:z.boolean(),position:vector,size:vector,yaw:number,pitch:number,roll:number,capacity:number,ignoreCollision:z.boolean()});
const stateEdgeSchema=z.object({id:identifier,source:identifier,target:identifier,key:z.string().max(30),trigger:z.enum(TRIGGERS),duration:number});
const types=z.array(z.string().min(1).max(32)).min(1).max(2);
const scoringSurface=z.object({id:identifier,name,faces:z.array(z.enum(['+X','-X','+Y','-Y','+Z','-Z'])).min(1).max(6),accepts:types});
const fieldSchema=z.object({bounciness:z.record(z.string().min(1).max(32),z.number().min(0).max(1)).optional(),scoringElements:z.array(z.object({id:identifier,name,position:vector,size:vector,yaw:number,pitch:number,roll:number,points:z.int().min(0).max(1000),capacity:z.int().min(1).max(1000),accepts:types,surfaces:z.array(scoringSurface).max(6)})).max(128),sources:z.array(z.object({id:identifier,name,position:vector,velocity:vector,pieceType:z.string().min(1).max(32),enabled:z.boolean(),mode:z.enum(['proximity','continuous']),proximity:z.number().min(0).max(30),cooldown:z.number().min(.1).max(300)})).max(16)}).strict();
const docSchema=z.object({
    schemaVersion:z.literal(1),id:z.uuid(),name,seasonId:z.enum(['practice-balls','reefscape-2025']),field:fieldSchema.optional(),revision:z.int().min(0).max(999999999),
    basics:z.object({length:number,width:number,height:number,mass:number,wheelDiameter:number,reduction:number,motorRPM:number,loadedSpeed:number,acceleration:number,angularSpeed:number}),
    subsystems:z.array(z.object({id:identifier,name,position:vector,size:vector,yaw:number,capacity:number,solid:z.boolean(),pitch:number.optional(),roll:number.optional(),targetingMode:z.enum(TARGETING_MODES).optional(),targetingFreedom:z.number().min(0).max(2*Math.PI).optional(),states:z.array(stateSchema).min(1).max(20).refine(s=>s.filter(t=>t.isDefault).length===1).optional(),stateTransitions:z.array(stateEdgeSchema).max(100).optional(),stateLayout:z.record(identifier,z.tuple([z.number().min(-9999).max(9999),z.number().min(-9999).max(9999)])).refine(v=>Object.keys(v).length<=20).optional()})).max(50),
    surfaces:z.array(z.object({id:identifier,name,owner:identifier,stateId:identifier.optional(),accepts:types.optional(),faces:z.array(z.enum(['+X','-X','+Y','-Y','+Z','-Z'])).max(6),type:z.enum(['intake','outtake']),interval:number,speed:number,yaw:number,pitch:number,spin:vector,unitsX:number.optional(),unitsY:number.optional(),key:z.string().max(30).optional(),trigger:z.enum(TRIGGERS).optional()})).max(100),
    edges:z.array(z.object({id:identifier,source:identifier,target:identifier,pieceType:z.string().min(1).max(32).optional(),duration:number,key:z.string().max(30),trigger:z.enum(TRIGGERS),priority:number,concurrency:number})).max(200),
    layout:z.record(identifier,z.tuple([z.number().min(-9999).max(9999),z.number().min(-9999).max(9999)])).refine(v=>Object.keys(v).length<=350),
});
export function documentInput(raw: unknown) {
    const parsed=docSchema.safeParse(raw);
    if(!parsed.success)throw new HttpError(422,'INVALID_DOCUMENT','Robot structure is invalid.',parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message})).slice(0,20));
    if(Buffer.byteLength(JSON.stringify(parsed.data))>250*1024)throw new HttpError(413,'DOCUMENT_TOO_LARGE','Robot document exceeds 250 KiB.');
    let document: RobotDocument;
    try {document=snapDocumentInches(parseDocument(parsed.data));} catch {throw new HttpError(422,'INVALID_DOCUMENT','Robot structure is invalid.');}
    return {document,issues:validate(document),runnable:!validate(document).some(i=>i.level==='error')};
}
export const uuid=(s: string) => {if(!z.uuid().safeParse(s).success)throw new HttpError(400,'INVALID_ID','Invalid robot ID.');return s;};
export function object(raw: unknown) {if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new HttpError(400,'INVALID_BODY','Expected a JSON object.');return raw as Record<string,unknown>;}
