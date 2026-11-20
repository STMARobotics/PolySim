import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeStorage,clearScopedStorage,saveDraft,readDraft,writeCloudRevision,readCloudRevisions} from '../../ui/storage';
import {sampleRobot} from '../../seasons/practice';
test('recovery storage is scoped to the Google subject, cleared on account changes/logout, and leaves offline backups alone',()=>{
    const data=new Map<string,string>();
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>data.get(k) ?? null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)}});
    const doc=sampleRobot();data.set('polysim.draft.v1',JSON.stringify(doc));
    scopeStorage('alice');saveDraft(doc);writeCloudRevision(doc.id,3);assert.equal(readDraft()!.id,doc.id);assert.equal(readCloudRevisions()[doc.id],3);
    scopeStorage('bob');assert.equal(readDraft(),undefined);assert.deepEqual(readCloudRevisions(),{});assert.ok(!data.has('polysim.user.alice.draft.v1'));
    saveDraft(doc);clearScopedStorage();assert.equal(readDraft(),undefined);assert.equal(data.get('polysim.active-user'),undefined);assert.ok(data.has('polysim.draft.v1'));
});
test('blocked browser storage cannot prevent authenticated app initialization or logout cleanup',()=>{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>{throw Error('Blocked');},setItem:()=>{throw Error('Blocked');},removeItem:()=>{throw Error('Blocked');}}});
    assert.doesNotThrow(()=>scopeStorage('alice'));assert.equal(readDraft(),undefined);assert.deepEqual(readCloudRevisions(),{});assert.doesNotThrow(clearScopedStorage);
});
