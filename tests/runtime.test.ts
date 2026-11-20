import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { RAPIER, Simulation } from '../simulation/runtime';
import { practice, sampleRobot } from '../seasons/practice';
import type { Controls } from '../simulation/protocol';
const controls = (x = 0, held: string[] = []): Controls => ({ x, y: 0, turn: 0, held });
before(async () => { await RAPIER.init(); });
test('physical capture and logical release conserve stable piece IDs', () => {
    const sim = new Simulation(sampleRobot());
    try {
        for (let t = 0; t < 180; t++)
            sim.step(controls(1, ['i']));
        assert.ok(sim.pickups > 0, 'driving intake must capture an accessible ball');
        assert.equal(sim.bodies.size + sim.graph.tokens.size, practice.pieces.length);
        assert.ok([...sim.graph.tokens.keys()].every(id => !sim.bodies.has(id)));
        for (let t = 0; t < 300; t++)
            sim.step(controls(0, ['i', 'j', 'k']));
        assert.ok(sim.releases > 0, 'held feed and shoot must physically release a token');
        assert.equal(sim.bodies.size + sim.graph.tokens.size + sim.scored + sim.escaped.length, practice.pieces.length);
    }
    finally {
        sim.free();
    }
});
test('recorded controls reproduce pose, graph metrics and pickups in the same build', () => {
    const d = sampleRobot(), a = new Simulation(d);
    try {
        for (let t = 0; t < 250; t++)
            a.step(controls(t < 150 ? 1 : 0, t < 200 ? ['i'] : ['j', 'k']));
        const original = a.snapshot();
        const b = new Simulation(d, original.recording);
        try {
            for (let t = 0; t < 250; t++)
                b.step();
            const replay = b.snapshot();
            assert.deepEqual(replay.pose, original.pose);
            assert.deepEqual(replay.edgeMetrics, original.edgeMetrics);
            assert.equal(replay.pickups, original.pickups);
            assert.deepEqual(replay.pieces, original.pieces);
        }
        finally {
            b.free();
        }
    }
    finally {
        a.free();
    }
});
test('chassis stays inside colliding field walls at loaded speed', () => {
    const sim = new Simulation(sampleRobot());
    try {
        for (let t = 0; t < 700; t++)
            sim.step(controls(-1));
        assert.ok(sim.pose().x > -5.65, `wall contact x=${sim.pose().x}`);
    }
    finally {
        sim.free();
    }
});
test('blocked outtake retains its token without creating a duplicate body', () => {
    const d = sampleRobot();
    d.subsystems.find(s => s.id === 'launcher')!.position = [0, 0, .04];
    const sim = new Simulation(d);
    try {
        sim.graph.tokens.set('preload', { id: 'preload', owner: 'launcher', node: 'outtake', arrived: 0, captured: 0 });
        sim.step(controls(0, ['k']));
        assert.ok(sim.graph.tokens.has('preload'));
        assert.equal(sim.releases, 0);
        assert.ok(sim.blocked.some(s => s.includes('Blocked outtake')));
        assert.equal(sim.bodies.has('preload'), false);
    }
    finally {
        sim.free();
    }
});
test('sample launch from initial pose scores a descending target crossing', () => {
    const sim = new Simulation(sampleRobot());
    try {
        sim.graph.tokens.set('shot', { id: 'shot', owner: 'launcher', node: 'outtake', arrived: 0, captured: 0 });
        for (let t = 0; t < 180; t++)
            sim.step(controls(0, ['k']));
        assert.equal(sim.releases, 1);
        assert.equal(sim.scored, 1);
    }
    finally {
        sim.free();
    }
});
test('release includes robot point velocity and angular velocity', () => {
    const d = sampleRobot();
    d.surfaces.find(s => s.id === 'outtake')!.spin = [0, 0, 3];
    const sim = new Simulation(d);
    try {
        sim.robot.setLinvel({ x: 1, y: 2, z: 0 }, true);
        sim.robot.setAngvel({ x: 0, y: 0, z: 1 }, true);
        sim.graph.tokens.set('shot', { id: 'shot', owner: 'launcher', node: 'outtake', arrived: 0, captured: 0 });
        sim.step(controls(0, ['k']));
        const shot = sim.bodies.get('shot')!, v = shot.linvel();
        assert.ok(Math.abs(v.x - (1 + 10 * Math.cos(.62))) < .001);
        // Subsystem X offset + face half extent + radius/tolerance = .24 + .17 + .135.
        assert.ok(Math.abs(v.y - (2 + .545)) < .001);
        assert.ok(Math.abs(shot.angvel().z - 4) < .001);
    }
    finally {
        sim.free();
    }
});
test('multi-face intake cannot capture one piece twice', () => {
    const d = sampleRobot();
    d.surfaces[0].faces = ['+X', '+Y'];
    const sim = new Simulation(d);
    try {
        for (let t = 0; t < 130; t++)
            sim.step(controls(1, ['i']));
        assert.ok(sim.pickups > 0);
        assert.equal(sim.bodies.size + sim.graph.tokens.size, practice.pieces.length);
        assert.equal(new Set([...sim.bodies.keys(), ...sim.graph.tokens.keys()]).size, practice.pieces.length);
    }
    finally {
        sim.free();
    }
});
