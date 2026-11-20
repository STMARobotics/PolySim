import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { RAPIER, Simulation } from '../simulation/runtime';
import { outtakeOffsets } from '../simulation/outtake-grid';
import { parseDocument, validate } from '../contracts/model';
import { sampleRobot, practice } from '../seasons/practice';
import { keyboardDrive } from '../ui/drive-controls';
import type { Controls } from '../simulation/protocol';

before(async () => { await RAPIER.init(); });
const input = (held = ['k']): Controls => ({ x: 0, y: 0, turn: 0, held });
function staged(x: number, y: number, count: number, press = false) {
    const d = sampleRobot(), surface = d.surfaces.find(s => s.id === 'outtake')!;
    surface.unitsX = x;
    surface.unitsY = y;
    if (press) { d.edges.find(e => e.id === 'shoot')!.trigger = 'press'; surface.interval = .02; }
    d.subsystems.find(s => s.id === 'launcher')!.capacity = Math.max(count, 1);
    const sim = new Simulation(d);
    for (let i = 0; i < count; i++) {
        const id = practice.pieces[i].id;
        sim.world.removeRigidBody(sim.bodies.get(id)!);
        sim.bodies.delete(id);
        sim.graph.tokens.set(id, { id, node: 'launcher', owner: 'launcher', arrived: 0, captured: 0 });
    }
    return sim;
}
function conserved(sim: Simulation) {
    assert.equal(sim.bodies.size + sim.graph.tokens.size + sim.scored + sim.escaped.length, practice.pieces.length);
    assert.equal(new Set([...sim.bodies.keys(), ...sim.graph.tokens.keys()]).size, sim.bodies.size + sim.graph.tokens.size);
}
function releasedPositions(sim: Simulation, count: number) {
    return Array.from({ length: count }, (_, i) => sim.bodies.get(practice.pieces[i].id)!.translation());
}

test('4×1 outtake releases four ready pieces in one tick, across the face, with one shared cooldown', () => {
    const sim = staged(4, 1, 6);
    try {
        sim.step(input());
        assert.equal(sim.releases, 4);
        assert.equal(sim.graph.tokens.size, 2);
        const positions = releasedPositions(sim, 4);
        for (let i = 1; i < positions.length; i++) {
            assert.ok(Math.abs(positions[i].y - positions[i - 1].y - .2) < .0001);
            assert.ok(Math.abs(positions[i].z - positions[0].z) < .0001);
        }
        sim.step(input());
        assert.equal(sim.releases, 4, 'cooldown applies to the whole batch');
        conserved(sim);
    } finally { sim.free(); }
});

test('2×2 outtake creates two columns and two rows without overlapping pieces', () => {
    const sim = staged(2, 2, 4);
    try {
        sim.step(input());
        assert.equal(sim.releases, 4);
        const p = releasedPositions(sim, 4);
        assert.ok(Math.abs(p[1].y - p[0].y - .2) < .0001);
        assert.ok(Math.abs(p[2].z - p[0].z - .2) < .0001);
        for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++)
            assert.ok(Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y, p[i].z - p[j].z) > 2 * practice.radius);
        conserved(sim);
    } finally { sim.free(); }
});

test('a partial batch launches only available pieces and centers them', () => {
    const sim = staged(4, 1, 2);
    try {
        sim.step(input());
        assert.equal(sim.releases, 2);
        assert.equal(sim.graph.tokens.size, 0);
        const p = releasedPositions(sim, 2);
        assert.ok(Math.abs(p[0].y + p[1].y) < .0001);
        conserved(sim);
    } finally { sim.free(); }
});

test('a blocked batch slot retains its piece while clear slots still release', () => {
    const sim = staged(4, 1, 4);
    try {
        sim.world.createCollider(RAPIER.ColliderDesc.cuboid(.04, .04, .04).setTranslation(-3.255, -.3, .8));
        sim.world.step();
        sim.step(input());
        assert.equal(sim.releases, 3);
        assert.ok(sim.graph.tokens.has(practice.pieces[0].id));
        assert.ok(!sim.bodies.has(practice.pieces[0].id));
        assert.ok(sim.blocked.some(s => s.includes('Blocked outtake')));
        conserved(sim);
    } finally { sim.free(); }
});

test('Press outtake releases one batch per activation, even when more pieces remain', () => {
    const sim = staged(4, 1, 6, true);
    try {
        sim.step(input());
        for (let i = 0; i < 10; i++) sim.step(input());
        assert.equal(sim.releases, 4);
        sim.step(input([]));
        sim.step(input());
        assert.equal(sim.releases, 6);
        conserved(sim);
    } finally { sim.free(); }
});

test('batch offsets lie in the selected face plane for every release axis', () => {
    for (const axis of [0, 1, 2]) {
        const offsets = outtakeOffsets(2, 2, 4, axis, .2);
        assert.ok(offsets.every(p => p[axis] === 0));
        assert.equal(new Set(offsets.map(p => p.join(','))).size, 4);
    }
});

test('old documents default to 1×1 and malformed or excessive outtake grids are rejected', () => {
    const old = sampleRobot();
    assert.doesNotThrow(() => parseDocument(old));
    assert.equal(validate(old).filter(i => i.level === 'error').length, 0);
    for (const [x, y] of [[0, 1], [1.5, 2], [NaN, 1], [20, 20]]) {
        const d = sampleRobot();
        Object.assign(d.surfaces[1], { unitsX: x, unitsY: y });
        assert.ok(validate(d).some(i => i.level === 'error' && i.message.includes('Simultaneous')));
    }
    const bad = sampleRobot();
    (bad.surfaces[1] as any).unitsX = '4';
    assert.throws(() => parseDocument(bad), /simultaneous/);
});

test('left/right arrows rotate the robot while Q/E remain available for actions', () => {
    assert.equal(keyboardDrive(new Set(['arrowleft'])).turn, 1);
    assert.equal(keyboardDrive(new Set(['arrowright'])).turn, -1);
    assert.equal(keyboardDrive(new Set(['q', 'e'])).turn, 0);
    assert.equal(keyboardDrive(new Set(['arrowleft', 'arrowright'])).turn, 0);
    const diagonal = keyboardDrive(new Set(['w', 'a', 'arrowleft']));
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
    assert.equal(diagonal.turn, 1);
});
