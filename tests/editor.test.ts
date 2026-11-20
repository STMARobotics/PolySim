import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBinding, bindingLabel } from '../contracts/bindings';
import { nextNodePosition, fillBounds, inventoryFraction, resizedDimensions } from '../ui/editor-model';
import { sampleRobot } from '../seasons/practice';
import { validate } from '../contracts/model';
import { GraphEngine } from '../simulation/graph';
test('special keys normalize for imported bindings, event keys, labels and physical codes', () => {
    for (const [input, expected] of [[' ', 'space'], ['Space', 'space'], ['Spacebar', 'space'], ['Shift', 'shift'], ['ShiftLeft', 'shift'], ['Enter', 'enter'], ['NumpadEnter', 'enter'], ['Control', 'control'], ['Ctrl', 'control'], ['ArrowUp', 'arrowup'], ['KeyW', 'w'], ['Digit2', '2'], [';', ';'], ['F12', 'f12']])
        assert.equal(normalizeBinding(input), expected);
    assert.equal(normalizeBinding('Shift+Enter'), undefined);
    assert.equal(bindingLabel(' '), 'Space');
    assert.equal(bindingLabel('ShiftLeft'), 'Shift');
});
test('space, shift and enter bindings validate and drive timed Hold/Press transfers', () => {
    for (const [key, eventKey] of [['Space', 'space'], ['Shift', 'shift'], ['Enter', 'enter']]) {
        const d = sampleRobot();
        d.edges[0].key = key;
        d.edges[1].key = key;
        assert.equal(validate(d).filter(i => i.level === 'error').length, 0);
        const graph = new GraphEngine(d);
        graph.capture('piece', 'intake', 0);
        graph.tick(1, new Set([eventKey]), new Set([eventKey]));
        assert.equal(graph.tokens.get('piece')?.flight?.edge, 'store');
    }
    const d = sampleRobot();
    d.edges[1].key = 'Enter';
    d.edges[1].trigger = 'press';
    const graph = new GraphEngine(d);
    graph.capture('piece', 'intake', 0);
    graph.tick(1, new Set(['enter']), new Set());
    assert.equal(graph.tokens.get('piece')?.flight, undefined);
    graph.tick(2, new Set(['enter']), new Set(['enter']));
    assert.equal(graph.tokens.get('piece')?.flight?.edge, 'store');
});
test('new graph modules never overlap existing nodes, including prior staggered additions', () => {
    const d = sampleRobot();
    for (let i = 0; i < 45; i++) {
        const p = nextNodePosition(d);
        for (const existing of Object.values(d.layout))
            assert.ok(Math.abs(p[0] - existing[0]) >= 202 || Math.abs(p[1] - existing[1]) >= 104);
        d.layout['new-' + i] = p;
    }
});
test('inventory shading fills upward by occupancy including empty, full and clamped bounds', () => {
    assert.equal(inventoryFraction(1, 3), 1 / 3);
    assert.deepEqual(fillBounds(.9, 1, 3), [-.45, -.15000000000000002]);
    assert.deepEqual(fillBounds(.6, 0, 3), [-.3, -.3]);
    assert.deepEqual(fillBounds(.6, 3, 3), [-.3, .3]);
    assert.equal(inventoryFraction(10, 3), 1);
    assert.equal(inventoryFraction(-1, 3), 0);
});
test('3D scale converts to editable dimensions while respecting valid size bounds', () => {
    assert.deepEqual(resizedDimensions([.3, .4, .5], [2, 1, .5]), [.6, .4, .25]);
    assert.deepEqual(resizedDimensions([.3, .4, .5], [-1, 100, 0]), [.05, 3, .05]);
});
