import type { RobotDocument } from '../contracts/model';
import { parseDocument } from '../contracts/model';
export interface Identity {user:{sub:string;email:string;name:string;role:'member'|'admin'};csrfToken:string;expiresAt:string}
export interface RobotSummary {id:string;name:string;revision:number;seasonId:string;updated:string;subsystems:number;connections:number;runnable:boolean}
export class ApiError extends Error {constructor(public status:number,public code:string,message:string) {super(message);}}
let identity: Identity|undefined;
export const cloudEnabled=()=>!!identity;
export const signedInUser=()=>identity?.user;
export function configureCloud(session: Identity) {identity=session;}
export async function api<T>(path: string, options: RequestInit={}):Promise<T> {
    if(!identity)throw Error('Sign in required');
    const result=await fetch('/api'+path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'content-type':'application/json','x-csrf-token':identity.csrfToken}:{}),...options.headers}});
    if(result.status===401) {window.dispatchEvent(new Event('polysim:session-expired'));throw new ApiError(401,'UNAUTHENTICATED','Your session expired. Sign in again.');}
    if(!result.ok) {const data=await result.json().catch(()=>({}));throw new ApiError(result.status,data.error?.code ?? 'UNAVAILABLE',data.error?.message ?? 'Service unavailable. Your local draft is preserved.');}
    return result.status===204?undefined as T:result.json();
}
export const cloudLibrary=(cursor?:string)=>api<{items:RobotSummary[];cursor?:string}>('/robots?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
export async function cloudRobot(id:string) {const row=await api<{document:RobotDocument}>('/robots/'+encodeURIComponent(id));return parseDocument(row.document);}
const savedRevisions=new Map<string,number>();
export function trackRevision(id:string, revision:number) {savedRevisions.set(id,revision);}
export const sharedRevision=(id:string)=>savedRevisions.get(id);
export async function saveShared(document:RobotDocument) {
    const expectedRevision=savedRevisions.get(document.id), body=JSON.stringify({document,...(expectedRevision?{expectedRevision}:{})});
    // Deterministic request keys survive an ambiguous network result and a browser reload.
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    const key=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const row=await api<{document:RobotDocument}>(expectedRevision?`/robots/${document.id}/revisions`:'/robots',{method:'POST',headers:{'idempotency-key':key},body});
    const saved=parseDocument(row.document);savedRevisions.set(saved.id,saved.revision);return saved;
}
export async function signOut() {await api('/auth/logout',{method:'POST',body:'{}'});window.dispatchEvent(new Event('polysim:session-expired'));}
