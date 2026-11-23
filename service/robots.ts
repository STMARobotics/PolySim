import {seasons} from '../seasons/registry';
import type { Auth, User } from './auth';
import { canonical, hash, headers, HttpError, json, response, type Request } from './http';
import { documentInput, object, uuid } from './documents';
import { Conflict, type Store, type Item, type Write } from './store';
import type { Config } from './config';
const revKey=(n: number)=>'REV#'+String(n).padStart(10,'0');
export class Robots {
    constructor(private config: Config, private store: Store, private auth: Auth) {}
    private pk(id: string) {return `TEAM#${this.config.allowedDomain}#ROBOT#${uuid(id)}`;}
    private listPK(season='practice-balls',archived=false) {return `TEAM#${this.config.allowedDomain}#ROBOTS#${season}#${archived?'ARCHIVED':'ACTIVE'}`;}
    private async metadata(id: string) {const row=await this.store.get(this.config.dataTable,this.pk(id),'METADATA');if(!row)throw new HttpError(404,'NOT_FOUND','Robot not found.');return row;}
    private publicMeta(row: Item) {const {pk,sk,gsi1pk,gsi1sk,...meta}=row;return meta;}
    private async version(id: string, revision: number) {const row=await this.store.get(this.config.dataTable,this.pk(id),revKey(revision));if(!row)throw new HttpError(404,'NOT_FOUND','Revision not found.');const {pk,sk,...result}=row;return result;}
    private page(req: Request, partition: string, index=true) {
        const limit=Number(req.queryStringParameters?.limit ?? 20), raw=req.queryStringParameters?.cursor;
        if(!Number.isInteger(limit)||limit<1||limit>50)throw new HttpError(400,'PAGINATION','Limit must be 1–50.');
        let after: Record<string,unknown>|undefined;
        if(raw) {
            try {
                if(raw.length>2048)throw Error();
                after=JSON.parse(Buffer.from(raw,'base64url').toString());
                const a=after as Record<string,unknown>, keys=Object.keys(a);
                if(!a || typeof a!=='object' || keys.length!==(index?4:2) || keys.some(k=>!['pk','sk',...(index?['gsi1pk','gsi1sk']:[])].includes(k)) || keys.some(k=>typeof a[k]!=='string') || (index ? a.gsi1pk!==partition || !String(a.pk).startsWith(`TEAM#${this.config.allowedDomain}#ROBOT#`) || a.sk!=='METADATA' : a.pk!==partition))throw Error();
            } catch {throw new HttpError(400,'PAGINATION','Invalid cursor.');}
        }
        return {limit,after};
    }
    async handle(req: Request) {
        const method=req.requestContext.http.method, parts=req.rawPath.split('/').filter(Boolean).slice(2), id=parts[0];
        const session=['GET','HEAD'].includes(method)?await this.auth.session(req):await this.auth.mutation(req);
        if(method==='GET' && !id) {
            const season=req.queryStringParameters?.seasonId ?? 'practice-balls';
            if(!seasons.some(s=>s.id===season))throw new HttpError(400,'SEASON','Unknown season.');
            const archived=req.queryStringParameters?.archived==='true';
            if(archived && session.user.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','Administrator access required.');
            const partition=this.listPK(season,archived), {limit,after}=this.page(req,partition);
            const page=await this.store.list(this.config.dataTable,partition,limit,after);
            return response(200,{items:page.items.map(r=>this.publicMeta(r)),...(page.cursor?{cursor:Buffer.from(JSON.stringify(page.cursor)).toString('base64url')}:{})});
        }
        if(method==='GET' && id && parts.length===1) {const meta=await this.metadata(id);return response(200,{metadata:this.publicMeta(meta),...await this.version(id,meta.revision)});}
        if(method==='GET' && id && parts[1]==='revisions') {
            await this.metadata(id);
            if(parts.length===3) {const revision=Number(parts[2]);if(!Number.isSafeInteger(revision)||revision<1)throw new HttpError(400,'REVISION','Invalid revision.');return response(200,await this.version(id,revision));}
            if(parts.length===2) {
                const partition=this.pk(id),{limit,after}=this.page(req,partition,false), page=await this.store.list(this.config.dataTable,partition,limit,after,false);
                return response(200,{items:page.items.filter(r=>r.sk.startsWith('REV#')).map(({pk,sk,document,...r})=>r),...(page.cursor?{cursor:Buffer.from(JSON.stringify(page.cursor)).toString('base64url')}:{})});
            }
        }
        if(method==='PATCH' && id && parts[1]==='archive' && parts.length===2) {
            if(session.user.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','Administrator access required.');
            const body=object(json(req,1024)), meta=await this.metadata(id);
            if(typeof body.archived!=='boolean' || body.expectedRevision!==meta.revision)throw new HttpError(409,'REVISION_CONFLICT','Reload the current robot before archiving.');
            if(body.archived===meta.archived)return response(200,this.publicMeta(meta));
            const row={...meta,archived:body.archived,updated:new Date().toISOString(),updatedBy:session.user.sub,gsi1pk:this.listPK(meta.seasonId,body.archived)};
            try {await this.store.transaction([{table:this.config.dataTable,item:row,condition:{equals:{revision:meta.revision,archived:meta.archived}}}]);}
            catch(e) {if(e instanceof Conflict)throw new HttpError(409,'REVISION_CONFLICT','Robot changed. Reload before archiving.');throw e;}
            return response(200,this.publicMeta(row));
        }
        if(method==='POST' && (!id || (parts.length===2 && parts[1]==='revisions')))return this.save(req,session.user,id);
        throw new HttpError(404,'NOT_FOUND','Route not found.');
    }
    private async save(req: Request, user: User, existingId?: string) {
        const body=object(json(req)), input=documentInput(body.document), id=existingId ?? input.document.id, pk=this.pk(id);
        if(id!==input.document.id)throw new HttpError(422,'ID_MISMATCH','Document ID must match the robot.');
        const expected=existingId?body.expectedRevision:0;
        if(!Number.isSafeInteger(expected) || Number(expected)<0 || (existingId && Number(expected)<1))throw new HttpError(400,'EXPECTED_REVISION','Supply expectedRevision.');
        const key=headers(req)['idempotency-key'];
        if(!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))throw new HttpError(400,'IDEMPOTENCY_KEY','Supply an Idempotency-Key of 16–128 letters, digits, underscores or dashes.');
        const requestHash=hash(canonical({document:input.document,expected})), idemPK='IDEMP#'+hash(user.sub+'|'+req.rawPath+'|'+key);
        const previous=async()=>{
            const row=await this.store.get(this.config.dataTable,idemPK,'REQUEST');
            if(!row)return undefined;
            if(row.requestHash!==requestHash)throw new HttpError(409,'IDEMPOTENCY_REUSE','Request key was already used for different content.');
            return response(row.status,await this.version(row.robotId,row.revision));
        };
        const prior=await previous();if(prior)return prior;
        const meta=existingId?await this.metadata(id):undefined;
        if(meta && meta.createdBy!==user.sub)throw new HttpError(403,'OWNER_REQUIRED','Only the creator can edit this robot. Duplicate it to make your own copy.');
        if(meta && (meta.revision!==expected || meta.archived))throw new HttpError(409,'REVISION_CONFLICT','Robot changed or was archived. Your local draft is preserved.',{currentRevision:meta.revision,archived:meta.archived});
        const revision=Number(expected)+1, now=new Date().toISOString(), document={...input.document,revision};
        if(meta && meta.seasonId!==document.seasonId)throw new HttpError(422,'SEASON_IMMUTABLE','Duplicate a robot to change its season.');
        const record: Item={pk,sk:revKey(revision),document,revision,author:user.sub,created:now,issues:input.issues,runnable:input.runnable};
        const metadata: Item={pk,sk:'METADATA',id,name:document.name,seasonId:document.seasonId,revision,archived:false,created:meta?.created ?? now,createdBy:meta?.createdBy ?? user.sub,creatorName:meta?.creatorName ?? user.name,updated:now,updatedBy:user.sub,subsystems:document.subsystems.length,connections:document.edges.length,runnable:input.runnable,gsi1pk:this.listPK(document.seasonId),gsi1sk:now+'#'+id};
        const writes: Write[]=[
            {table:this.config.dataTable,item:record,condition:{absent:true}},
            {table:this.config.dataTable,item:metadata,condition:meta?{equals:{revision:expected,archived:false}}:{absent:true}},
            {table:this.config.dataTable,item:{pk:idemPK,sk:'REQUEST',requestHash,robotId:id,revision,status:meta?200:201,ttl:Math.floor(Date.now()/1000)+86400},condition:{absent:true}},
        ];
        // Document is capped separately; account for attribute names, validation and metadata overhead too.
        if(Buffer.byteLength(JSON.stringify(record))>300*1024)throw new HttpError(413,'DOCUMENT_TOO_LARGE','Revision exceeds storage budget.');
        try {await this.store.transaction(writes);} catch(e) {
            if(!(e instanceof Conflict))throw e;
            const retry=await previous();if(retry)return retry;
            throw new HttpError(409,'REVISION_CONFLICT','Robot changed. Your local draft is preserved. Reload or save a copy.');
        }
        const {pk:_,sk:__,...result}=record;
        return response(meta?200:201,result);
    }
}
