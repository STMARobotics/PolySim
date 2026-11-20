import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './support';
import {createSeasonRobot} from '../../seasons/registry';
import {configureCloud,saveShared} from '../../ui/cloud';

test('season manifests require login and supply trusted field geometry and game piece definitions',async()=>{
 const f=fixture();assert.equal((await f.app.handle(request('/api/seasons'))).statusCode,401);
 const session=await f.login(),list=JSON.parse((await f.app.handle(request('/api/seasons','GET',undefined,session))).body);
 assert.deepEqual(list.items.map((s:any)=>s.id),['reefscape-2025','practice-balls']);
 const season=JSON.parse((await f.app.handle(request('/api/seasons/reefscape-2025','GET',undefined,session))).body);
 assert.equal(season.units,'m');assert.equal(season.displayUnits,'in');
 assert.ok(season.geometry.length>100);assert.equal(season.defaults.scoringElements.length,88);assert.deepEqual(season.pieceTypes.map((p:any)=>p.id),['coral','algae']);assert.ok(season.capabilities.includes('typed-pieces'));
});

test('reefscape robots persist field settings and typed routes, list by season, and cannot change season',async()=>{
 const f=fixture(),session=await f.login(),doc=createSeasonRobot('reefscape-2025');doc.field!.scoringElements[0].points=8;
 const created=await f.app.handle(request('/api/robots','POST',{document:doc},{...session,'idempotency-key':randomUUID()}));assert.equal(created.statusCode,201);assert.equal(JSON.parse(created.body).runnable,true);
 const saved=JSON.parse((await f.app.handle(request('/api/robots/'+doc.id,'GET',undefined,session))).body).document;
 assert.equal(saved.seasonId,'reefscape-2025');assert.equal(saved.field.scoringElements[0].points,8);assert.deepEqual(saved.surfaces[0].accepts,['coral','algae']);assert.ok(saved.edges.some((e:any)=>e.pieceType==='algae'));
 const reef=JSON.parse((await f.app.handle(request('/api/robots?seasonId=reefscape-2025','GET',undefined,session))).body);assert.equal(reef.items.length,1);
 const practice=JSON.parse((await f.app.handle(request('/api/robots?seasonId=practice-balls','GET',undefined,session))).body);assert.equal(practice.items.length,0);
 const other=createSeasonRobot('practice-balls');other.id=doc.id;
 const changed=await f.app.handle(request('/api/robots/'+doc.id+'/revisions','POST',{document:other,expectedRevision:1},{...session,'idempotency-key':randomUUID()}));assert.equal(changed.statusCode,422);assert.equal(JSON.parse(changed.body).error.code,'SEASON_IMMUTABLE');
});

test('field writes reject geometry injection, invalid piece types, duplicate faces and unsafe collections',async()=>{
 const f=fixture(),session=await f.login(),doc=createSeasonRobot('reefscape-2025');
 const wrongType=structuredClone(doc),wrongFaces=structuredClone(doc),wrongCooldown=structuredClone(doc);
 wrongType.field!.sources[0].pieceType='ball';wrongFaces.field!.scoringElements[0].surfaces[0].faces=['+Z','+Z'];wrongCooldown.field!.sources[0].cooldown=0;
 const cases=[{...doc,field:{...doc.field,geometry:[]}},wrongType,wrongFaces,wrongCooldown];
 for(const document of cases)assert.equal((await f.app.handle(request('/api/robots','POST',{document},{...session,'idempotency-key':randomUUID()}))).statusCode,422);
 assert.equal([...f.store.rows.values()].filter(r=>r.sk==='METADATA').length,0);
});

test('client refuses season or typed saves against older servers and preserves a supported season save',async context=>{
 const doc=createSeasonRobot('reefscape-2025'),session={user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member' as const},csrfToken:'test',expiresAt:'2099-01-01'};
 let capabilities=['subsystem-states'],writes=0;
 context.mock.method(globalThis,'fetch',async(path:string,options?:RequestInit)=>{
  if(path.includes('/seasons/'))return new Response(JSON.stringify({capabilities}),{status:200});writes++;
  assert.equal(JSON.parse(options!.body as string).document.seasonId,'reefscape-2025');return new Response(JSON.stringify({document:doc}),{status:200});
 });
 configureCloud(session);await assert.rejects(()=>saveShared(doc),/season field update/);assert.equal(writes,0);
 capabilities.push('season-field-v1');configureCloud(session);await assert.rejects(()=>saveShared(doc),/typed game piece support/);assert.equal(writes,0);
 capabilities.push('typed-pieces');configureCloud(session);await assert.rejects(()=>saveShared(doc),/game piece physics support/);assert.equal(writes,0);
 capabilities.push('piece-physics-v2');configureCloud(session);const saved=await saveShared(doc);assert.equal(saved.seasonId,'reefscape-2025');assert.equal(saved.field!.scoringElements.length,88);assert.equal(writes,1);
});

test('authenticated saves preserve per-type bounciness and reject coefficients outside 0–1',async()=>{
 const f=fixture(),session=await f.login(),document=createSeasonRobot('reefscape-2025');document.field!.bounciness={coral:.2,algae:.75};
 const manifest=JSON.parse((await f.app.handle(request('/api/seasons/reefscape-2025','GET',undefined,session))).body);assert.ok(manifest.capabilities.includes('piece-physics-v2'));
 const created=await f.app.handle(request('/api/robots','POST',{document},{...session,'idempotency-key':randomUUID()}));assert.equal(created.statusCode,201);
 const saved=JSON.parse((await f.app.handle(request('/api/robots/'+document.id,'GET',undefined,session))).body).document;assert.deepEqual(saved.field.bounciness,{coral:.2,algae:.75});
 const bad=structuredClone(document);bad.id=randomUUID();bad.field!.bounciness!.algae=1.1;
 assert.equal((await f.app.handle(request('/api/robots','POST',{document:bad},{...session,'idempotency-key':randomUUID()}))).statusCode,422);
});
