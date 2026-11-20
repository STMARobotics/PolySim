import { z } from 'zod';
import { parseDocument, validate, type RobotDocument } from '../contracts/model';
import { HttpError } from './http';
const identifier=z.string().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const number=z.number().min(-1e6).max(1e6), vector=z.tuple([number,number,number]);
const name=z.string().trim().min(1).max(100);
const docSchema=z.object({
    schemaVersion:z.literal(1),id:z.uuid(),name,seasonId:z.literal('practice-balls'),revision:z.int().min(0).max(999999999),
    basics:z.object({length:number,width:number,height:number,mass:number,wheelDiameter:number,reduction:number,motorRPM:number,loadedSpeed:number,acceleration:number,angularSpeed:number}),
    subsystems:z.array(z.object({id:identifier,name,position:vector,size:vector,yaw:number,capacity:number,solid:z.boolean()})).max(50),
    surfaces:z.array(z.object({id:identifier,name,owner:identifier,faces:z.array(z.enum(['+X','-X','+Y','-Y','+Z','-Z'])).max(6),type:z.enum(['intake','outtake']),interval:number,speed:number,yaw:number,pitch:number,spin:vector,unitsX:number.optional(),unitsY:number.optional(),key:z.string().max(30).optional(),trigger:z.enum(['hold','press']).optional()})).max(100),
    edges:z.array(z.object({id:identifier,source:identifier,target:identifier,duration:number,key:z.string().max(30),trigger:z.enum(['hold','press']),priority:number,concurrency:number})).max(200),
    layout:z.record(identifier,z.tuple([z.number().min(-9999).max(9999),z.number().min(-9999).max(9999)])).refine(v=>Object.keys(v).length<=350),
});
export function documentInput(raw: unknown) {
    const parsed=docSchema.safeParse(raw);
    if(!parsed.success)throw new HttpError(422,'INVALID_DOCUMENT','Robot structure is invalid.',parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message})).slice(0,20));
    if(Buffer.byteLength(JSON.stringify(parsed.data))>250*1024)throw new HttpError(413,'DOCUMENT_TOO_LARGE','Robot document exceeds 250 KiB.');
    let document: RobotDocument;
    try {document=parseDocument(parsed.data);} catch {throw new HttpError(422,'INVALID_DOCUMENT','Robot structure is invalid.');}
    return {document,issues:validate(document),runnable:!validate(document).some(i=>i.level==='error')};
}
export const uuid=(s: string) => {if(!z.uuid().safeParse(s).success)throw new HttpError(400,'INVALID_ID','Invalid robot ID.');return s;};
export function object(raw: unknown) {if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new HttpError(400,'INVALID_BODY','Expected a JSON object.');return raw as Record<string,unknown>;}
