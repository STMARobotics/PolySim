import type { RobotDocument } from '../contracts/model';
import { parseDocument } from '../contracts/model';
import {DEFAULT_TARGETING_FREEDOM} from '../contracts/targeting';
import {pieceTypesFor} from '../seasons/registry';
export interface Identity {user:{sub:string;email:string;name:string;role:'member'|'admin'};csrfToken:string;expiresAt:string}
export interface RobotSummary {id:string;name:string;revision:number;seasonId:string;updated:string;createdBy:string;creatorName?:string;subsystems:number;connections:number;runnable:boolean}
export class ApiError extends Error {constructor(public status:number,public code:string,message:string) {super(message);}}
let identity: Identity|undefined;
let supportsPiecePhysics=false;
let supportsSeasonField=false;
let supportsTypedPieces=false;
let supportsStates=false;
let supportsNotPressed=false;
let supportsTargeting=false;
let supportsGraphRoutes=false;
let supportsGraphLabels=false;
let supportsGamepad=false;
export const cloudEnabled=()=>!!identity;
export const signedInUser=()=>identity?.user;
export function configureCloud(session: Identity) {identity=session;supportsPiecePhysics=false;supportsSeasonField=false;supportsTypedPieces=false;supportsStates=false;supportsNotPressed=false;supportsTargeting=false;supportsGraphRoutes=false;supportsGraphLabels=false;supportsGamepad=false;}
export async function api<T>(path: string, options: RequestInit={}):Promise<T> {
    if(!identity)throw Error('Sign in required');
    const result=await fetch('/api'+path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'content-type':'application/json','x-csrf-token':identity.csrfToken}:{}),...options.headers}});
    if(result.status===401) {window.dispatchEvent(new Event('polysim:session-expired'));throw new ApiError(401,'UNAUTHENTICATED','Your session expired. Sign in again.');}
    if(!result.ok) {const data=await result.json().catch(()=>({}));throw new ApiError(result.status,data.error?.code ?? 'UNAVAILABLE',data.error?.message ?? 'Service unavailable. Your local draft is preserved.');}
    return result.status===204?undefined as T:result.json();
}
export const cloudLibrary=(cursor?:string,seasonId='practice-balls')=>api<{items:RobotSummary[];cursor?:string}>('/robots?limit=20&seasonId='+encodeURIComponent(seasonId)+(cursor?'&cursor='+encodeURIComponent(cursor):''));
export const robotMetadata = new Map<string, RobotSummary>();
export async function cloudRobot(id:string) {const row=await api<{document:RobotDocument;metadata:RobotSummary}>('/robots/'+encodeURIComponent(id));robotMetadata.set(id,row.metadata);return parseDocument(row.document);}
const savedRevisions=new Map<string,number>();
export function trackRevision(id:string, revision:number) {savedRevisions.set(id,revision);}
export const sharedRevision=(id:string)=>savedRevisions.get(id);
export async function saveShared(document:RobotDocument) {
    const edges=[...document.edges,...document.subsystems.flatMap(s=>s.stateTransitions??[])];
    const needsGraphLabels=edges.some(e=>e.labelPosition!==undefined);
    const needsGraphRoutes=edges.some(e=>e.route?.length);
    const needsGamepad=edges.some(e=>e.key.startsWith('gamepad:'));
    const needsPiecePhysics=!!document.field?.bounciness;
    const needsSeasonField=document.seasonId!=='practice-balls'||!!document.field;
    const needsTypedPieces=pieceTypesFor(document).length>1;
    const needsStates=document.subsystems.some(s=>s.states?.length);
    const needsNotPressed=document.edges.some(e=>e.trigger==='not-pressed') || document.subsystems.some(s=>s.stateTransitions?.some(e=>e.trigger==='not-pressed'));
    const needsTargeting=document.subsystems.some(s=>(s.targetingMode ?? 'manual')!=='manual'||(s.targetingFreedom ?? DEFAULT_TARGETING_FREEDOM)!==DEFAULT_TARGETING_FREEDOM);
    if((needsGraphLabels&&!supportsGraphLabels)||(needsGraphRoutes&&!supportsGraphRoutes)||(needsGamepad&&!supportsGamepad)||(needsPiecePhysics&&!supportsPiecePhysics)||(needsTypedPieces&&!supportsTypedPieces)||(needsSeasonField&&!supportsSeasonField)||(needsStates && !supportsStates) || (needsNotPressed && !supportsNotPressed) || (needsTargeting && !supportsTargeting)) {
        const manifest=await api<{capabilities:string[]}>('/seasons/'+encodeURIComponent(document.seasonId));
        if(needsGraphLabels&&!manifest.capabilities?.includes('graph-label-position'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the graph label update before saving label positions. Your local draft is preserved.');
        if(needsGraphRoutes&&!manifest.capabilities?.includes('graph-routes'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the graph routing update before saving custom routes. Your local draft is preserved.');
        if(needsGamepad&&!manifest.capabilities?.includes('gamepad-bindings'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the gamepad update before saving gamepad bindings. Your local draft is preserved.');
        if(needsStates && !manifest.capabilities?.includes('subsystem-states'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the states update before saving this robot. Your local draft is preserved.');
        if(needsNotPressed && !manifest.capabilities?.includes('not-pressed-trigger'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the Not Pressed update before saving this robot. Your local draft is preserved.');
        if(needsTargeting && !manifest.capabilities?.includes('subsystem-targeting'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the targeting update before saving this robot. Your local draft is preserved.');
        if(needsSeasonField&&!manifest.capabilities?.includes('season-field-v1'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs the season field update before saving this robot. Your local draft is preserved.');
        if(needsTypedPieces&&!manifest.capabilities?.includes('typed-pieces'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs typed game piece support before saving this robot. Your local draft is preserved.');
        if(needsPiecePhysics&&!manifest.capabilities?.includes('piece-physics-v2'))throw new ApiError(503,'SERVER_UPDATE_REQUIRED','The server needs game piece physics support before saving bounciness settings. Your local draft is preserved.');
        supportsGraphLabels=!!manifest.capabilities?.includes('graph-label-position');
        supportsGraphRoutes=!!manifest.capabilities?.includes('graph-routes');
        supportsGamepad=!!manifest.capabilities?.includes('gamepad-bindings');
        supportsPiecePhysics=!!manifest.capabilities?.includes('piece-physics-v2');
        supportsTypedPieces=!!manifest.capabilities?.includes('typed-pieces');
        supportsSeasonField=!!manifest.capabilities?.includes('season-field-v1');
        supportsStates=!!manifest.capabilities?.includes('subsystem-states');
        supportsNotPressed=!!manifest.capabilities?.includes('not-pressed-trigger');
        supportsTargeting=!!manifest.capabilities?.includes('subsystem-targeting');
    }
    const expectedRevision=savedRevisions.get(document.id), body=JSON.stringify({document,...(expectedRevision?{expectedRevision}:{})});
    // Deterministic request keys survive an ambiguous network result and a browser reload.
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    const key=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const row=await api<{document:RobotDocument}>(expectedRevision?`/robots/${document.id}/revisions`:'/robots',{method:'POST',headers:{'idempotency-key':key},body});
    const saved=parseDocument(row.document);savedRevisions.set(saved.id,saved.revision);return saved;
}
export async function signOut() {await api('/auth/logout',{method:'POST',body:'{}'});window.dispatchEvent(new Event('polysim:session-expired'));}
