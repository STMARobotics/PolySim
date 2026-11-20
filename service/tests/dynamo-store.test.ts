import test from 'node:test';
import assert from 'node:assert/strict';
import {DynamoStore,Conflict} from '../store';
test('Dynamo adapter uses strong reads, conditional one-use OAuth deletes, atomic revision transactions and bounded queries',async()=>{
    const calls:any[]=[];
    const client={async send(command:any) {calls.push(command);return command.constructor.name==='DeleteCommand'?{Attributes:{pk:'state',sk:'STATE',ttl:10}}:{Items:[],Item:{pk:'x',sk:'y'}};}};
    const store=new DynamoStore(client as any);
    await store.get('table','robot','METADATA');assert.equal(calls[0].input.ConsistentRead,true);
    await store.consume('sessions','state','STATE',5);assert.equal(calls[1].input.ConditionExpression,'#ttl > :now');assert.equal(calls[1].input.ReturnValues,'ALL_OLD');
    await store.transaction([{table:'table',item:{pk:'robot',sk:'REV#2'},condition:{absent:true}},{table:'table',item:{pk:'robot',sk:'METADATA'},condition:{equals:{revision:1,archived:false}}}]);
    assert.equal(calls[2].constructor.name,'TransactWriteCommand');assert.equal(calls[2].input.TransactItems.length,2);assert.equal(calls[2].input.TransactItems[1].Put.ExpressionAttributeValues[':v0'],1);
    await store.list('table','TEAM',20);assert.equal(calls[3].constructor.name,'QueryCommand');assert.equal(calls[3].input.IndexName,'GSI1');assert.equal(calls[3].input.Limit,20);
    await store.list('table','ROBOT',10,undefined,false);assert.equal(calls[4].input.ConsistentRead,true);assert.equal(calls[4].input.IndexName,undefined);
});
test('Dynamo adapter distinguishes conditional conflicts from throttles/service faults',async()=>{
    let reason='ConditionalCheckFailed';
    const store=new DynamoStore({async send() {throw Object.assign(Error('hidden'),{name:'TransactionCanceledException',CancellationReasons:[{Code:reason}]});}} as any);
    await assert.rejects(()=>store.transaction([]),Conflict);
    reason='ProvisionedThroughputExceeded';await assert.rejects(()=>store.transaction([]),e=>!(e instanceof Conflict));
});
