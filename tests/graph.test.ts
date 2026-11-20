import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRobot } from '../seasons/practice';
import { GraphEngine } from '../simulation/graph';
import { parseDocument, ticksFor, validate } from '../contracts/model';
const held = new Set(['i', 'j', 'k']), none = new Set<string>();
test('capture is atomic, immediately owned, and counts against owner capacity', () => {
    const g = new GraphEngine(sampleRobot());
    assert.equal(g.capture('a', 'intake', 0), true);
    assert.equal(g.capture('a', 'intake', 0), false);
    assert.equal(g.capture('b', 'intake', 0), false);
    assert.equal(g.owned('collector'), 1);
    g.assertInvariants();
});
test('tick-quantized transfer finishes at deadline even after action release', () => {
    const d = sampleRobot();
    d.edges.find(e => e.id === 'store')!.duration = .101;
    const g = new GraphEngine(d);
    g.capture('a', 'intake', 0);
    g.tick(1, held, none);
    assert.equal(g.tokens.get('a')?.flight?.end, 14);
    for (let t = 2; t < 14; t++)
        g.tick(t, none, none);
    assert.equal(g.tokens.get('a')?.node, 'collector');
    g.tick(14, none, none);
    assert.equal(g.tokens.get('a')?.node, 'hopper');
    assert.equal(g.metrics.store.deliveries, 1);
    assert.equal(g.metrics.store.busyTicks, 13);
    assert.equal(ticksFor(.1), 12);
});
test('cross-owner reservation blocks competing admission until delivery', () => {
    const d = sampleRobot();
    d.subsystems.find(s => s.id === 'hopper')!.capacity = 1;
    const g = new GraphEngine(d);
    g.tokens.set('a', { id: 'a', node: 'collector', owner: 'collector', arrived: 0, captured: 0 });
    g.tick(1, held, none);
    assert.equal(g.owned('collector'), 1);
    assert.equal(g.reserved('hopper'), 1);
    assert.equal(g.available('hopper'), false);
    assert.equal(g.available('collector'), false);
    for (let t = 2; t <= 31; t++)
        g.tick(t, new Set(['i']), none);
    assert.equal(g.tokens.get('a')?.owner, 'hopper');
    assert.equal(g.reserved('hopper'), 0);
    g.assertInvariants();
});
test('a token cannot start two competing edges in one tick; stable priority wins', () => {
    const d = sampleRobot();
    d.edges.push({ ...d.edges[1], id: 'priority', target: 'launcher', priority: 5 });
    const g = new GraphEngine(d);
    g.tokens.set('a', { id: 'a', node: 'collector', owner: 'collector', arrived: 0, captured: 0 });
    g.tick(1, held, none);
    assert.equal(g.tokens.get('a')?.flight?.edge, 'priority');
    assert.equal(g.reserved('launcher'), 1);
    assert.equal(g.reserved('hopper'), 0);
});
test('Press actions only start on a rising input edge', () => {
    const d = sampleRobot();
    d.edges[1].trigger = 'press';
    const g = new GraphEngine(d);
    g.tokens.set('a', { id: 'a', node: 'collector', owner: 'collector', arrived: 0, captured: 0 });
    g.tick(1, held, none);
    assert.equal(g.tokens.get('a')?.flight, undefined);
    g.tick(2, held, new Set(['i']));
    assert.equal(g.tokens.get('a')?.flight?.edge, 'store');
});
test('full destination leaves token in place and reports capacity blocking', () => {
    const d = sampleRobot();
    const g = new GraphEngine(d);
    g.tokens.set('a', { id: 'a', node: 'hopper', owner: 'hopper', arrived: 0, captured: 0 });
    g.tokens.set('b', { id: 'b', node: 'launcher', owner: 'launcher', arrived: 0, captured: 0 });
    g.tick(1, new Set(['j']), none);
    assert.equal(g.tokens.get('a')?.flight, undefined);
    assert.equal(g.metrics.feed.capacityTicks, 1);
    g.assertInvariants();
});
test('validation catches ambiguous faces, invalid ports, nonfinite inputs and timings', () => {
    const d = sampleRobot();
    assert.equal(validate(d).filter(i => i.level === 'error').length, 0);
    d.surfaces.push({ ...d.surfaces[0], id: 'duplicate-face' });
    d.edges[1].duration = 0;
    d.edges[2].target = 'outtake';
    d.basics.mass = NaN;
    const issues = validate(d).filter(i => i.level === 'error');
    assert.ok(issues.length >= 4);
    assert.throws(() => parseDocument({ schemaVersion: 1 }));
    assert.deepEqual(parseDocument(JSON.parse(JSON.stringify(sampleRobot()))).schemaVersion, 1);
});
