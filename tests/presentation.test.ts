import test from 'node:test';
import assert from 'node:assert/strict';
import { displayValue, storedValue, displayIssue } from '../ui/units';
import { graphNode, nodePosition } from '../ui/graph-model';
import { nextNodePosition } from '../ui/editor-model';
import { sampleRobot } from '../seasons/practice';

test('inch inputs convert to physical geometry, wheel diameter, speed and acceleration', () => {
    for (const path of ['sub.position.0', 'sub.size.2', 'basics.length', 'basics.width', 'basics.height', 'basics.wheelDiameter', 'basics.loadedSpeed', 'basics.acceleration', 'surface.speed']) {
        assert.equal(displayValue(path, .0254), 1);
        assert.ok(Math.abs(storedValue(path, 12.5) - .3175) < 1e-10);
    }
    assert.equal(displayValue('basics.wheelDiameter', sampleRobot().basics.wheelDiameter), 4);
    assert.equal(displayValue('edge.duration', .25), .25);
    assert.equal(storedValue('sub.capacity', 3), 3);
    assert.ok(Math.abs(storedValue('surface.pitch', 90) - Math.PI / 2) < 1e-10);
    assert.equal(displayValue('basics.mass', .45359237), 1);
});

test('graph shapes and ports distinguish actions from subsystems with accurate capacities', () => {
    const d = sampleRobot(), sub = graphNode(d, 'hopper'), intake = graphNode(d, 'intake'), outtake = graphNode(d, 'outtake');
    assert.equal(sub.width, sub.height);
    assert.equal(sub.type, 'Subsystem');
    assert.equal(sub.capacity, 4);
    assert.ok(intake.width > intake.height);
    assert.equal(intake.type, 'Action');
    assert.equal(intake.capacity, 1);
    d.subsystems.find(s => s.id === 'launcher')!.capacity = 7;
    assert.equal(graphNode(d, 'outtake').capacity, 7);
    for (const node of [sub, intake, outtake]) assert.equal(node.portY, node.height / 2);
});

test('new graph modules leave room for square cards across successive additions', () => {
    const d = sampleRobot();
    for (let i = 0; i < 30; i++) {
        const p = nextNodePosition(d);
        for (const node of [...d.subsystems, ...d.surfaces]) {
            const q = nodePosition(d, node.id), g = graphNode(d, node.id);
            assert.ok(p[0] >= q[0] + g.width + 28 || q[0] >= p[0] + 144 + 28 || p[1] >= q[1] + g.height + 28 || q[1] >= p[1] + 144 + 28);
        }
        const id = 'new-' + i;
        d.subsystems.push({ ...d.subsystems[0], id });
        d.layout[id] = p;
    }
});

test('measurement validation bounds use the same display units as inspector inputs', () => {
    assert.equal(displayIssue('Chassis dimensions must be at most 3 m.'), 'Chassis dimensions must be at most 118.11 in.');
    assert.equal(displayIssue('Dimension must be between 0 and 3.'), 'Dimension must be between 0 and 118.11 in.');
    assert.equal(displayIssue('Exit speed must be between 0 and 50.'), 'Exit speed must be between 0 and 1968.50 in/s.');
    assert.equal(displayIssue('Capacity must be an integer from 1 to 100.'), 'Capacity must be an integer from 1 to 100.');
});
