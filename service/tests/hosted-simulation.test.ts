import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './support';
import {createSeasonRobot} from '../../seasons/registry';
import {ensureStates,addState,stateName} from '../../contracts/states';
import {parseDocument} from '../../contracts/model';
import {configureCloud,saveShared,cloudRobot,cloudLibrary} from '../../ui/cloud';
import {RAPIER,Simulation} from '../../simulation/runtime';

test('hosted saves round-trip the complete season/state design and the reopened robot runs the current engine',async context=>{
 await RAPIER.init();
 const f=fixture(),session=await f.login(),identity=JSON.parse((await f.app.handle(request('/api/auth/session','GET',undefined,session))).body);
 configureCloud(identity);
 // Exercise the actual client and HTTP handlers together. Only storage and the
 // session fixture are local; this does not claim AWS or live Google validation.
 context.mock.method(globalThis,'fetch',async(path:string|URL|Request,options:RequestInit={})=>{
  const headers:Record<string,string>={};new Headers(options.headers).forEach((value,key)=>{headers[key]=value;});
  const response=await f.app.handle(request(String(path),options.method ?? 'GET',options.body?JSON.parse(String(options.body)):undefined,{...headers,cookie:session.cookie}));
  return new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:response.headers});
 });
 const draft=ensureStates(createSeasonRobot('reefscape-2025')),launcher=draft.subsystems.find(s=>s.id==='launcher')!;
 const action=draft.surfaces.find(s=>s.id==='outtake')!;action.unitsX=4;action.unitsY=1;
 const state=addState(draft,launcher,launcher.states![0]);state.name=stateName('Extended');state.position=[.254,0,.762];state.size=[.3048,.2032,.1016];state.pitch=Math.PI/6;state.roll=-Math.PI/9;
 launcher.stateTransitions!.push({id:'hosted-state-transition',source:launcher.states![0].id,target:state.id,key:'space',trigger:'not-pressed',duration:.1});
 launcher.targetingMode='sotm-turret';launcher.targetingFreedom=Math.PI;
 for(const edge of draft.edges.filter(e=>e.target==='outtake'))Object.assign(edge,{key:'enter',trigger:'not-pressed',duration:.025});
 draft.field!.bounciness={coral:.2,algae:.8};draft.field!.scoringElements[0].points=9;draft.field!.scoringElements[0].capacity=7;
 draft.field!.sources[0].mode='continuous';draft.field!.sources[0].cooldown=1;
 const canonical=parseDocument(draft),created=await saveShared(canonical);assert.equal(created.revision,1);
 const revised=await saveShared({...created,name:'Hosted round trip'});assert.equal(revised.revision,2);
 assert.ok((await cloudLibrary(undefined,'reefscape-2025')).items.some(row=>row.id===created.id));
 const reopened=await cloudRobot(created.id);assert.deepEqual(reopened,revised);
 assert.deepEqual(reopened.field!.bounciness,{coral:.2,algae:.8});assert.equal(reopened.field!.scoringElements[0].points,9);assert.equal(reopened.field!.scoringElements[0].capacity,7);
 const reopenedLauncher=reopened.subsystems.find(s=>s.id==='launcher')!;
 assert.equal(reopenedLauncher.targetingMode,'sotm-turret');assert.equal(reopenedLauncher.targetingFreedom,Math.PI);
 assert.equal(reopenedLauncher.stateTransitions![0].trigger,'not-pressed');assert.equal(reopened.surfaces.find(s=>s.id==='outtake')!.unitsX,4);
 assert.ok(reopened.edges.some(e=>e.pieceType==='algae'));assert.ok(reopened.edges.some(e=>e.pieceType==='coral'));
 const sim=new Simulation(reopened);
 try{
  for(let i=0;i<20;i++)sim.step({x:.1,y:0,turn:0,held:[]});
  const actual=sim.document.subsystems.find(s=>s.id==='launcher')!;
  assert.deepEqual(actual.size,state.size);assert.deepEqual(actual.position,state.position);assert.equal(actual.pitch,state.pitch);assert.equal(actual.roll,state.roll);
  assert.ok(Number.isFinite(sim.pose().x));sim.graph.assertInvariants();
 }finally{sim.free();}
 const other=await f.login('second-approved-member');
 const shared=await f.app.handle(request('/api/robots/'+created.id,'GET',undefined,other));assert.equal(shared.statusCode,200);assert.deepEqual(parseDocument(JSON.parse(shared.body).document),revised);
 assert.equal((await f.app.handle(request('/api/auth/logout','POST',{},session))).statusCode,204);
 assert.equal((await f.app.handle(request('/api/robots/'+created.id,'GET',undefined,session))).statusCode,401);
});
