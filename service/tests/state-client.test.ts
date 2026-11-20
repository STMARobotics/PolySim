import test from 'node:test';
import assert from 'node:assert/strict';
import {configureCloud,saveShared} from '../../ui/cloud';
import {ensureStates} from '../../contracts/states';
import {addState} from '../../contracts/states';
import {sampleRobot} from '../../seasons/practice';
import {TARGETING_MODES} from '../../contracts/targeting';
test('state saves refuse an older server instead of silently losing state definitions',async context=>{
    configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
    const calls:string[]=[];
    context.mock.method(globalThis,'fetch',async(path:string)=>{calls.push(path);return new Response(JSON.stringify({capabilities:['boxes']}),{status:200});});
    await assert.rejects(()=>saveShared(ensureStates(sampleRobot())),/server needs the states update/);assert.equal(calls.length,1);assert.ok(calls[0].includes('/seasons/'));
});
test('state saves proceed when the server advertises state support',async context=>{
    configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
    const doc=ensureStates(sampleRobot()),calls:string[]=[];
    context.mock.method(globalThis,'fetch',async(path:string)=>{calls.push(path);return new Response(JSON.stringify(path.includes('/seasons/')?{capabilities:['subsystem-states']}:{document:doc}),{status:200});});
    const saved=await saveShared(doc);assert.deepEqual(saved.subsystems[0].states,doc.subsystems[0].states);assert.equal(calls.length,2);assert.equal(calls[1],'/api/robots');
});

test('Not Pressed saves in either graph refuse a server without trigger support before writing',async context=>{
    const calls:string[]=[];
    context.mock.method(globalThis,'fetch',async(path:string)=>{calls.push(path);return new Response(JSON.stringify({capabilities:['subsystem-states']}),{status:200});});
    for(const graph of ['travel','states']) {
        configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
        const doc=ensureStates(sampleRobot());
        if(graph==='travel')doc.edges[1].trigger='not-pressed';
        else {const sub=doc.subsystems[0],to=addState(doc,sub,sub.states![0]);sub.stateTransitions!.push({id:'return',source:sub.states![0].id,target:to.id,key:'space',trigger:'not-pressed',duration:0});}
        await assert.rejects(()=>saveShared(doc),/server needs the Not Pressed update/);
    }
    assert.equal(calls.length,2);assert.ok(calls.every(path=>path.includes('/seasons/')));
});

test('Not Pressed saves preserve the trigger when advertised by the server',async context=>{
    configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
    const doc=ensureStates(sampleRobot());doc.edges[1].trigger='not-pressed';
    context.mock.method(globalThis,'fetch',async(path:string,options?:RequestInit)=>{
        if(path.includes('/seasons/'))return new Response(JSON.stringify({capabilities:['subsystem-states','not-pressed-trigger']}),{status:200});
        assert.equal(JSON.parse(options!.body as string).document.edges[1].trigger,'not-pressed');
        return new Response(JSON.stringify({document:doc}),{status:200});
    });
    const saved=await saveShared(doc);assert.equal(saved.edges[1].trigger,'not-pressed');
});

test('targeting saves refuse a server that would strip automatic mode or a stored manual range',async context=>{
    const calls:string[]=[];
    context.mock.method(globalThis,'fetch',async(path:string)=>{calls.push(path);return new Response(JSON.stringify({capabilities:['subsystem-states']}),{status:200});});
    for(const mode of TARGETING_MODES) {
        configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
        const doc=ensureStates(sampleRobot());doc.subsystems[2].targetingMode=mode;doc.subsystems[2].targetingFreedom=Math.PI;
        await assert.rejects(()=>saveShared(doc),/server needs the targeting update/);
    }
    assert.equal(calls.length,4);assert.ok(calls.every(path=>path.includes('/seasons/')));
});

test('targeting saves preserve the mode and range when the server advertises support',async context=>{
    configureCloud({user:{sub:'test',email:'test@stmarobotics.org',name:'Test',role:'member'},csrfToken:'test',expiresAt:'2099-01-01'});
    const doc=ensureStates(sampleRobot());doc.subsystems[2].targetingMode='sotm-turret';doc.subsystems[2].targetingFreedom=Math.PI;
    context.mock.method(globalThis,'fetch',async(path:string,options?:RequestInit)=>{
        if(path.includes('/seasons/'))return new Response(JSON.stringify({capabilities:['subsystem-states','subsystem-targeting']}),{status:200});
        const posted=JSON.parse(options!.body as string).document;
        assert.equal(posted.subsystems[2].targetingMode,'sotm-turret');assert.equal(posted.subsystems[2].targetingFreedom,Math.PI);
        return new Response(JSON.stringify({document:doc}),{status:200});
    });
    const saved=await saveShared(doc);assert.equal(saved.subsystems[2].targetingMode,'sotm-turret');assert.equal(saved.subsystems[2].targetingFreedom,Math.PI);
});
