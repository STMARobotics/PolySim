import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {triggerActive,type Trigger} from '../contracts/triggers';
import {sampleRobot,practice} from '../seasons/practice';
import {ensureStates,addState} from '../contracts/states';
import {parseDocument,validate} from '../contracts/model';
import {documentInput} from '../service/documents';
import {GraphEngine} from '../simulation/graph';
import {RAPIER,Simulation} from '../simulation/runtime';

before(async()=>{await RAPIER.init();});
const empty=new Set<string>(),held=new Set(['space']);
const input=(keys:string[]=[])=>({x:0,y:0,turn:0,held:keys});

test('Not Pressed is continuously active while released, including startup, with normalized and valid bindings',()=>{
    assert.equal(triggerActive('not-pressed','Space',empty,empty),true);
    assert.equal(triggerActive('not-pressed','Space',held,held),false);
    assert.equal(triggerActive('not-pressed','Space',empty,held),true);
    assert.equal(triggerActive('not-pressed','invalid key',empty,empty),false);
    assert.equal(triggerActive('unknown' as Trigger,'space',empty,empty),false);
    assert.equal(triggerActive('hold','Space',held,empty),true);
    assert.equal(triggerActive('press','Space',held,empty),false);
    assert.equal(triggerActive('press','Space',held,held),true);
});

test('Not Pressed travel transfers start while released, repeat without a release edge, and finish after a new press',()=>{
    const d=sampleRobot();Object.assign(d.edges.find(e=>e.id==='store')!,{key:'space',trigger:'not-pressed',duration:.025});
    const graph=new GraphEngine(d);graph.capture('first','intake',0);
    graph.tick(1,held,held);assert.equal(graph.tokens.get('first')!.flight,undefined);
    graph.tick(2,empty,empty);assert.equal(graph.tokens.get('first')!.flight!.end,5);
    for(let tick=3;tick<=5;tick++)graph.tick(tick,held,empty);
    assert.equal(graph.tokens.get('first')!.node,'hopper');
    graph.capture('second','intake',5);graph.tick(6,empty,empty);
    assert.equal(graph.tokens.get('second')!.flight!.edge,'store');graph.assertInvariants();
    const startup=new GraphEngine(d);startup.capture('startup','intake',0);startup.tick(1,empty,empty);
    assert.ok(startup.tokens.get('startup')!.flight);
});

test('Not Pressed state transitions respect timing, finish after a press, and work at startup',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2],from=sub.states![0],to=addState(d,sub,from);
    to.position[2]+=.5;
    sub.stateTransitions!.push({id:'release-state',source:from.id,target:to.id,key:'space',trigger:'not-pressed',duration:.025});
    const sim=new Simulation(d);
    try {
        sim.step(input(['space']));assert.equal(sim.states.flights.size,0);
        sim.step(input());assert.ok(sim.states.flights.has(sub.id));
        for(let i=0;i<3;i++)sim.step(input(['space']));
        assert.equal(sim.states.current.get(sub.id),to.id);assert.equal(sim.states.flights.size,0);
        assert.deepEqual(sim.snapshot().subsystems![2].position,to.position);
    }finally{sim.free();}
    const startup=new Simulation(d);
    try{startup.step(input());assert.ok(startup.states.flights.has(sub.id));}finally{startup.free();}
});

test('Not Pressed gates physical intake capture, suppressing capture while the key is held',()=>{
    const d=sampleRobot();Object.assign(d.edges.find(e=>e.id==='capture')!,{key:'space',trigger:'not-pressed'});
    const sim=new Simulation(d),id=practice.pieces[0].id;
    try {
        sim.bodies.get(id)!.setTranslation({x:-3.12,y:0,z:.18},true);
        sim.step(input(['space']));assert.equal(sim.pickups,0);
        sim.step(input());assert.equal(sim.pickups,1);assert.equal(sim.graph.tokens.get(id)!.node,'collector');
        sim.graph.assertInvariants();
    }finally{sim.free();}
});

test('Not Pressed outtake honors timing and batch cooldown, and does not start new work while held',()=>{
    const d=sampleRobot();d.subsystems[2].capacity=2;d.surfaces[1].interval=.025;
    Object.assign(d.edges.find(e=>e.id==='shoot')!,{key:'space',trigger:'not-pressed',duration:.025});
    const sim=new Simulation(d);
    try {
        for(const id of ['one','two'])sim.graph.tokens.set(id,{id,node:'launcher',owner:'launcher',arrived:0,captured:0});
        sim.step(input(['space']));assert.equal(sim.releases,0);assert.equal(sim.graph.tokens.get('one')!.flight,undefined);
        sim.step(input());assert.ok(sim.graph.tokens.get('one')!.flight);
        for(let i=0;i<3;i++)sim.step(input(['space']));
        assert.equal(sim.releases,1);assert.equal(sim.graph.tokens.get('two')!.flight,undefined);
        sim.step(input());assert.ok(sim.graph.tokens.get('two')!.flight);
        for(let i=0;i<3;i++)sim.step(input());
        assert.equal(sim.releases,2);assert.equal(sim.graph.tokens.size,0);sim.graph.assertInvariants();
    }finally{sim.free();}
});

test('imports and backend saves preserve Not Pressed for both graphs and reject unknown modes',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[0],to=addState(d,sub,sub.states![0]);
    sub.stateTransitions!.push({id:'release-state',source:sub.states![0].id,target:to.id,key:'space',trigger:'not-pressed',duration:0});
    d.edges[1].trigger='not-pressed';
    const loaded=parseDocument(JSON.parse(JSON.stringify(d))),saved=documentInput(loaded);
    assert.equal(saved.runnable,true);assert.equal(saved.document.edges[1].trigger,'not-pressed');
    assert.equal(saved.document.subsystems[0].stateTransitions![0].trigger,'not-pressed');
    const bad=structuredClone(d);bad.edges[1].trigger='unknown' as Trigger;bad.subsystems[0].stateTransitions![0].trigger='unknown' as Trigger;
    assert.ok(validate(bad).filter(i=>i.level==='error').length>=2);assert.throws(()=>documentInput(bad));
});
