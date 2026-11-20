import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, metricsCSV } from '../ui/report';
import { sampleRobot } from '../seasons/practice';
import type { SavedRun } from '../ui/storage';
test('CSV quotes names and neutralizes spreadsheet formula strings without changing numbers', () => {
    assert.equal(csvCell('robot, "A"'), '"robot, ""A"""');
    assert.equal(csvCell('=1+1'), '"\'=1+1"');
    assert.equal(csvCell(-1.5), '"-1.5"');
});
test('report exports completed deliveries, waits in seconds, unresolved attempts and assumptions', () => {
    const document = sampleRobot();
    const run: SavedRun = { id: 'test', name: 'test robot', created: '2026-11-19', document, replay: false, engine: '0.1.0', season: '1.0.0', snapshot: { tick: 120, running: false, pose: { x: 0, y: 0, yaw: 0 }, pieces: [], tokens: [], edgeMetrics: { capture: { deliveries: 2, busyTicks: 60, capacityTicks: 30, inputTicks: 12, emptyTicks: 18 } }, score: 1, pickups: 3, releases: 2, scored: 1, escaped: ['ball-2'], cycles: [1, 2], log: [], blocked: [], recording: [], slow: false } };
    const report = metricsCSV(run);
    assert.ok(report.includes('"capture","Front intake","Collector","2","0.25","0.1","0.15","0.5"'));
    assert.ok(report.includes('"manual driver dependent","1","1","3","2","1","1","1.5"'));
    assert.ok(report.includes('"assumptions"'));
    assert.ok(report.includes('\r\n'));
});
