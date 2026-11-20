import { DT, nodeName } from '../contracts/model';
import type { SavedRun } from './storage';
export function csvCell(value: string | number): string {
    let text = String(value);
    // Names are user-editable display strings. Do not let spreadsheet apps treat them as formulas.
    if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(text))
        text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
}
export function metricsCSV(run: SavedRun): string {
    const s = run.snapshot, mean = s.cycles.length ? s.cycles.reduce((a, b) => a + b, 0) / s.cycles.length : 0;
    const rows: (string | number)[][] = [
        ['robot', 'revision', 'engine', 'season', 'mode', 'duration_s', 'score', 'pickups', 'releases', 'unscored_or_unresolved', 'escaped_pieces', 'mean_cycle_s'],
        [run.name, run.document.revision, run.engine, run.season, run.replay ? 'recorded inputs' : 'manual driver dependent', s.tick * DT, s.score, s.pickups, s.releases, s.releases - s.scored, s.escaped?.length ?? 0, mean],
        [], ['edge', 'source', 'target', 'completed_deliveries', 'capacity_wait_s', 'input_wait_s', 'empty_s', 'busy_s'],
    ];
    for (const e of run.document.edges) {
        const m = s.edgeMetrics[e.id];
        if (m)
            rows.push([e.id, nodeName(run.document, e.source), nodeName(run.document, e.target), m.deliveries, m.capacityTicks * DT, m.inputTicks * DT, m.emptyTicks * DT, m.busyTicks * DT]);
    }
    rows.push([], ['assumptions', 'Estimated coefficients; fixed spherical-ball fixture; no official rules, drag, traction, tipping or articulation.']);
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
