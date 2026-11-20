import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {createSeasonRobot} from '../../seasons/registry';
import type {FromWorker,ToWorker} from '../../simulation/protocol';

test('the published production worker initializes REEFSCAPE and drives through its actual bundled WASM engine',async()=>{
 const filename=readdirSync('dist/assets').find(file=>/^worker-.*\.js$/.test(file));assert.ok(filename);
 const bootstrap=`
 import {parentPort,workerData} from 'node:worker_threads';
 globalThis.self=globalThis;
 globalThis.onmessage=null;
 globalThis.postMessage=data=>parentPort.postMessage(data);
 await import(workerData.url);
 parentPort.on('message',data=>globalThis.onmessage({data}));
 `;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)),{workerData:{url:pathToFileURL(resolve('dist/assets',filename)).href}});
 const document=createSeasonRobot('reefscape-2025');document.field!.sources=[];document.field!.bounciness={coral:.2,algae:.8};
 const waitFor=(accept:(message:FromWorker)=>boolean)=>new Promise<FromWorker>((resolve,reject)=>{
  const timeout=setTimeout(()=>{cleanup();reject(Error('Published worker response timed out'));},10000);
  const cleanup=()=>{clearTimeout(timeout);worker.off('message',receive);worker.off('error',fail);};
  const fail=(error:Error)=>{cleanup();reject(error);};
  const receive=(message:FromWorker)=>{
   if(message.type==='error'){fail(Error(message.message));return;}
   if(accept(message)){cleanup();resolve(message);}
  };
  worker.on('message',receive);worker.on('error',fail);
 });
 const send=(message:ToWorker)=>worker.postMessage(message);
 try{
  const initialized=waitFor(m=>m.type==='snapshot'&&m.snapshot.tick===0);send({type:'init',document});
  const initial=await initialized;assert.equal(initial.type,'snapshot');if(initial.type!=='snapshot')return;
  assert.equal(initial.snapshot.pieces.length,24);assert.ok(initial.snapshot.pieces.some(p=>p.type==='coral'));assert.ok(initial.snapshot.pieces.some(p=>p.type==='algae'));
  const advanced=waitFor(m=>m.type==='snapshot'&&m.snapshot.tick===60);
  send({type:'controls',controls:{x:1,y:0,turn:0,held:[]}});for(let tick=0;tick<60;tick++)send({type:'step'});
  const final=await advanced;assert.equal(final.type,'snapshot');if(final.type!=='snapshot')return;
  assert.ok(final.snapshot.pose.x>initial.snapshot.pose.x+.1);assert.ok(final.snapshot.pieces.every(p=>p.position.every(Number.isFinite)));
  assert.equal(final.snapshot.fieldInventory?.length,88);assert.equal(final.snapshot.running,false);
 }finally{await worker.terminate();}
});
