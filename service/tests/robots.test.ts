import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleRobot} from '../../seasons/practice';
import {fixture,request} from './support';
const key=()=>({'idempotency-key':randomUUID()});
test('create persists immutable revision and metadata atomically, and same request retries do not create revisions',async()=>{
    const f=fixture(),session=await f.login(),document=sampleRobot(),headers={...session,...key()},req=request('/api/robots','POST',{document},headers);
    const first=await f.app.handle(req), retry=await f.app.handle(req);assert.equal(first.statusCode,201);assert.equal(retry.body,first.body);
    const saved=JSON.parse(first.body);assert.equal(saved.revision,1);assert.equal(saved.document.revision,1);assert.equal(saved.author,'member-sub');
    assert.equal([...f.store.rows.values()].filter(r=>r.sk.startsWith('REV#')).length,1);
    assert.equal((await f.app.handle(request('/api/robots','POST',{document:{...document,name:'Other'}},headers))).statusCode,409);
    const loaded=await f.app.handle(request('/api/robots/'+document.id,'GET',undefined,session));assert.equal(loaded.statusCode,200);assert.equal(JSON.parse(loaded.body).metadata.revision,1);
});
test('two simultaneous saves against the same revision produce one winner, and preserve immutable history',async()=>{
    const f=fixture(),session=await f.login(),document=sampleRobot();await f.app.handle(request('/api/robots','POST',{document},{...session,...key()}));
    const results=await Promise.all(['A','B'].map(name=>f.app.handle(request(`/api/robots/${document.id}/revisions`,'POST',{document:{...document,name},expectedRevision:1},{...session,...key()}))));
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
    const previous=await f.app.handle(request(`/api/robots/${document.id}/revisions/1`,'GET',undefined,session));assert.equal(JSON.parse(previous.body).document.name,document.name);
    const revisions=await f.app.handle(request(`/api/robots/${document.id}/revisions`,'GET',undefined,session));assert.equal(JSON.parse(revisions.body).items.length,2);
});
test('idempotent retries still return the original result after newer revisions exist',async()=>{
    const f=fixture(),session=await f.login(),document=sampleRobot(),create=request('/api/robots','POST',{document},{...session,...key()});
    await f.app.handle(create);
    await f.app.handle(request(`/api/robots/${document.id}/revisions`,'POST',{document:{...document,name:'Updated'},expectedRevision:1},{...session,...key()}));
    const original=await f.app.handle(create);assert.equal(original.statusCode,201);assert.equal(JSON.parse(original.body).document.name,document.name);
});
test('schema and byte budgets reject malformed, unsafe, nonfinite or excessive data without storing it',async()=>{
    const f=fixture(),session=await f.login();
    const docs=[{}, {...sampleRobot(),id:'bad'}, {...sampleRobot(),name:'x'.repeat(101)}, {...sampleRobot(),layout:{constructor:[0,0]}}, {...sampleRobot(),subsystems:Array.from({length:51},()=>sampleRobot().subsystems[0])}, {...sampleRobot(),basics:{...sampleRobot().basics,mass:null}}];
    for(const document of docs)assert.equal((await f.app.handle(request('/api/robots','POST',{document},{...session,...key()}))).statusCode,422);
    const oversized=request('/api/robots','POST',{}, {...session,...key()});oversized.body=' '.repeat(271*1024);assert.equal((await f.app.handle(oversized)).statusCode,413);
    assert.equal([...f.store.rows.values()].filter(r=>r.sk==='METADATA').length,0);
});
test('well-formed non-runnable drafts are saved with validation status; old surface bindings are stripped',async()=>{
    const f=fixture(),session=await f.login(),document=sampleRobot();document.subsystems[0].capacity=0;
    Object.assign(document.surfaces[0],{key:'Space',trigger:'hold'});
    const r=await f.app.handle(request('/api/robots','POST',{document},{...session,...key()}));assert.equal(r.statusCode,201);
    const saved=JSON.parse(r.body);assert.equal(saved.runnable,false);assert.ok(saved.issues.some((i:any)=>i.level==='error'));assert.ok(!('key' in saved.document.surfaces[0]));
});
test('list endpoints paginate, restrict cursors to this team and bound request limits',async()=>{
    const f=fixture(),session=await f.login();
    for(let i=0;i<3;i++)await f.app.handle(request('/api/robots','POST',{document:sampleRobot()},{...session,...key()}));
    const first=JSON.parse((await f.app.handle(request('/api/robots?limit=2','GET',undefined,session))).body);assert.equal(first.items.length,2);assert.ok(first.cursor);
    const second=JSON.parse((await f.app.handle(request('/api/robots?limit=2&cursor='+first.cursor,'GET',undefined,session))).body);assert.equal(second.items.length,1);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,3);
    const forged=Buffer.from(JSON.stringify({pk:'TEAM#other#ROBOT#x',sk:'METADATA',gsi1pk:'OTHER',gsi1sk:'x'})).toString('base64url');
    for(const q of ['limit=1000','limit=0','limit=NaN','cursor='+forged,'cursor=bad','seasonId=unknown'])assert.equal((await f.app.handle(request('/api/robots?'+q,'GET',undefined,session))).statusCode,400);
});
test('archive and restore require configured admin subjects, preserve history and prevent edits while archived',async()=>{
    const f=fixture(),member=await f.login(),admin=await f.login('admin-sub'),document=sampleRobot();await f.app.handle(request('/api/robots','POST',{document},{...member,...key()}));
    const path=`/api/robots/${document.id}/archive`,body={archived:true,expectedRevision:1};
    assert.equal((await f.app.handle(request(path,'PATCH',body,member))).statusCode,403);
    assert.equal((await f.app.handle(request(path,'PATCH',body,admin))).statusCode,200);
    assert.equal((await f.app.handle(request(`/api/robots/${document.id}/revisions`,'POST',{document,expectedRevision:1},{...member,...key()}))).statusCode,409);
    assert.equal(JSON.parse((await f.app.handle(request('/api/robots','GET',undefined,member))).body).items.length,0);
    assert.equal((await f.app.handle(request('/api/robots?archived=true','GET',undefined,member))).statusCode,403);
    assert.equal((await f.app.handle(request(path,'PATCH',{archived:false,expectedRevision:1},admin))).statusCode,200);
    assert.equal((await f.app.handle(request(`/api/robots/${document.id}/revisions/1`,'GET',undefined,member))).statusCode,200);
});
test('unexpected storage failures return a redacted 503 and never downgrade authorization',async()=>{
    const f=fixture(),session=await f.login();f.store.get=async()=>{throw Error('SECRET_DATABASE_DETAILS');};
    const result=await f.app.handle(request('/api/robots','GET',undefined,session));assert.equal(result.statusCode,503);assert.ok(!result.body.includes('SECRET_DATABASE_DETAILS'));assert.match(result.headers['cache-control'],/no-store/);
});
