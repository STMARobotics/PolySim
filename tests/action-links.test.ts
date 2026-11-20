import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import { sampleRobot, practice } from '../seasons/practice';
import { createAction, parseDocument, surfaceForEdge, syncSurfaceLinks, validate } from '../contracts/model';
import { GraphEngine } from '../simulation/graph';
import { RAPIER, Simulation } from '../simulation/runtime';
import { transitionCurve } from '../ui/graph-model';
before(async () => { await RAPIER.init(); });

test('owner links preserve transition binding, trigger, timing and IDs while migrating legacy surface fields', () => {
    const d = sampleRobot(), transfer = structuredClone(d.edges.find(e => e.id === 'store'));
    Object.assign(d.surfaces[0], {key:'Space', trigger:'hold'});
    Object.assign(d.surfaces[1], {key:'Enter', trigger:'press'});
    Object.assign(d.edges[0], {duration: .25, key:'Shift', trigger:'press'});
    d.edges.push({...d.edges[0], id:'duplicate'});
    d.edges = d.edges.filter(e => e.id !== 'shoot');
    const loaded = parseDocument(d), capture = loaded.edges.find(e => e.id === 'capture')!;
    assert.equal(loaded.edges.filter(e=>surfaceForEdge(loaded,e)).length, 2);
    assert.deepEqual([capture.duration,capture.key,capture.trigger],[.25,'Shift','press']);
    const shoot = loaded.edges.find(e=>e.target==='outtake')!;
    assert.deepEqual([shoot.duration,shoot.key,shoot.trigger],[0,'Enter','press']);
    assert.ok(loaded.surfaces.every(s=>!('key' in s) && !('trigger' in s)));
    assert.deepEqual(loaded.edges.find(e=>e.id==='store'),transfer);
    assert.equal(validate(loaded).filter(i=>i.level==='error').length,0);
    assert.deepEqual(parseDocument(loaded),loaded);
});

test('new actions use the owner name and default to an instant transition; missing links are repaired', () => {
    const d = sampleRobot();
    const action = createAction(d.subsystems[1], 'intake', '-Y');
    assert.equal(action.name, `${d.subsystems[1].name} Action`);
    assert.ok(!('key' in action));
    d.surfaces.push(action); syncSurfaceLinks(d);
    const link = d.edges.find(e=>e.source===action.id)!;
    assert.equal(link.target, action.owner); assert.equal(link.duration,0);
    link.duration=.5; link.key='space'; syncSurfaceLinks(d);
    assert.equal(d.edges.find(e=>e.id===link.id)!.duration,.5);
    d.edges = d.edges.filter(e=>!surfaceForEdge(d,e));
    assert.equal(parseDocument(d).edges.filter(e=>surfaceForEdge(d,e)).length,3);
});

test('instant capture enters its owner immediately; delayed capture reserves capacity until delivery', () => {
    const d = sampleRobot(), instant = new GraphEngine(d);
    assert.ok(instant.capture('a','intake',17));
    assert.equal(instant.tokens.get('a')!.node,'collector');
    assert.equal(instant.tokens.get('a')!.flight,undefined);
    d.edges[0].duration=.025;
    const timed = new GraphEngine(d);
    assert.ok(timed.capture('a','intake',17));
    assert.equal(timed.tokens.get('a')!.flight!.end,20);
    assert.equal(timed.available('collector'),false);
    timed.tick(19,new Set(),new Set());
    assert.equal(timed.tokens.get('a')!.node,'intake');
    timed.tick(20,new Set(),new Set());
    assert.equal(timed.tokens.get('a')!.node,'collector');
    assert.equal(timed.metrics.capture.deliveries,1);
    timed.assertInvariants();
});

test('physical intake activation uses only the transition key and honors its delay', () => {
    const d = sampleRobot(); Object.assign(d.edges[0],{key:'space',duration:.025});
    const sim = new Simulation(d), id=practice.pieces[0].id;
    try {
        sim.bodies.get(id)!.setTranslation({x:-3.12,y:0,z:.18},true);
        sim.step({x:0,y:0,turn:0,held:['i']}); assert.equal(sim.pickups,0);
        sim.step({x:0,y:0,turn:0,held:['space']}); assert.equal(sim.pickups,1);
        assert.equal(sim.graph.tokens.get(id)!.flight!.end,5);
        for(let i=0;i<3;i++) sim.step({x:0,y:0,turn:0,held:[]});
        assert.equal(sim.graph.tokens.get(id)!.node,'collector');
        assert.equal(sim.graph.tokens.get(id)!.flight,undefined);
    } finally {sim.free();}
});

test('timed Press outtake launches after delivery even with the key released', () => {
    const d=sampleRobot(); Object.assign(d.edges.find(e=>e.id==='shoot')!,{key:'enter',trigger:'press',duration:.025});
    const sim=new Simulation(d), id=practice.pieces[0].id;
    try {
        sim.world.removeRigidBody(sim.bodies.get(id)!);sim.bodies.delete(id);
        sim.graph.tokens.set(id,{id,node:'launcher',owner:'launcher',arrived:0,captured:0});
        sim.step({x:0,y:0,turn:0,held:['k']});assert.equal(sim.releases,0);
        sim.step({x:0,y:0,turn:0,held:['enter']});assert.equal(sim.releases,0);
        for(let i=0;i<2;i++)sim.step({x:0,y:0,turn:0,held:[]});
        assert.equal(sim.releases,0);
        sim.step({x:0,y:0,turn:0,held:[]});assert.equal(sim.releases,1);
        assert.ok(sim.bodies.has(id));assert.ok(!sim.graph.tokens.has(id));
        assert.equal(sim.graph.metrics.shoot.deliveries,1);
        assert.equal(sim.bodies.size+sim.graph.tokens.size,practice.pieces.length);
    } finally {sim.free();}
});

test('action transition time accepts instant or delayed values and rejects negative or invalid timing', () => {
    for(const time of [0,.25,60]) {const d=sampleRobot();d.edges[0].duration=time;assert.ok(!validate(d).some(i=>i.level==='error'));}
    for(const time of [-1,NaN,61]) {const d=sampleRobot();d.edges[0].duration=time;assert.ok(validate(d).some(i=>i.level==='error'&&i.object==='capture'));}
});

test('transition labels are centered on the curve, with short routes lifted clear of modules', () => {
    const short=transitionCurve([40,80],[240,80],{width:174,portY:48},{portY:72},76);
    assert.deepEqual(short.center,short.point(.5));assert.equal(short.center[0],227);
    assert.ok(short.center[1]+22<80);
    const long=transitionCurve([40,80],[500,140],{width:144,portY:72},{portY:48},76);
    assert.deepEqual(long.center,[342,170]);
});
