import { parseDocument, type RobotDocument } from '../contracts/model';
import type { Snapshot } from '../simulation/protocol';
export interface SavedRobot {
    document: RobotDocument;
    updated: string;
}
export interface SavedRun {
    id: string;
    name: string;
    created: string;
    document: RobotDocument;
    snapshot: Snapshot;
    replay: boolean;
    engine: string;
    season: string;
}
let ROBOTS = 'polysim.robots.v2', DRAFT = 'polysim.draft.v2', RUNS = 'polysim.runs.v2';
let BASE = 'polysim';
export function scopeStorage(subject?: string) {
    BASE=subject?`polysim.user.${subject}`:'polysim.signed-out';
    ROBOTS=BASE+'.robots.v2';DRAFT=BASE+'.draft.v2';RUNS=BASE+'.runs.v2';
    try {
        const previous=localStorage.getItem('polysim.active-user');
        if(previous && previous!==subject)for(const key of ['robots','draft','runs','cloud-revisions'])localStorage.removeItem(`polysim.user.${previous}.${key}.v2`);
        if(subject)localStorage.setItem('polysim.active-user',subject);else localStorage.removeItem('polysim.active-user');
    } catch {/* Shared saves still work when browser recovery storage is unavailable. */}
}
export function clearScopedStorage() {try {for(const key of [ROBOTS,DRAFT,RUNS,BASE+'.cloud-revisions.v2'])localStorage.removeItem(key);localStorage.removeItem('polysim.active-user');}catch {/* No recovery data can be read while storage is blocked. */}}
export function readCloudRevisions():Record<string,number> {try {return JSON.parse(localStorage.getItem(BASE+'.cloud-revisions.v2') ?? '{}');}catch{return {};}}
export function writeCloudRevision(id:string,revision:number) {localStorage.setItem(BASE+'.cloud-revisions.v2',JSON.stringify({...readCloudRevisions(),[id]:revision}));}
export function readRobots(): SavedRobot[] {
    try {
        return JSON.parse(localStorage.getItem(ROBOTS) ?? '[]').map((r: SavedRobot) => ({ ...r, document: parseDocument(r.document) }));
    }
    catch {
        return [];
    }
}
export function saveRobot(document: RobotDocument) {
    const robots = readRobots();
    const i = robots.findIndex(r => r.document.id === document.id);
    const r = { document, updated: new Date().toISOString() };
    if (i < 0)
        robots.push(r);
    else
        robots[i] = r;
    localStorage.setItem(ROBOTS, JSON.stringify(robots));
}
export function saveDraft(document: RobotDocument) { localStorage.setItem(DRAFT, JSON.stringify(document)); }
export function readDraft(): RobotDocument | undefined {
    try {
        const raw = localStorage.getItem(DRAFT);
        return raw ? parseDocument(JSON.parse(raw)) : undefined;
    }
    catch {
        return undefined;
    }
}
export function readRuns(): SavedRun[] {
    try {
        return JSON.parse(localStorage.getItem(RUNS) ?? '[]');
    }
    catch {
        return [];
    }
}
export function saveRun(run: SavedRun) { const runs = readRuns().filter(r => r.id !== run.id); runs.unshift(run); localStorage.setItem(RUNS, JSON.stringify(runs.slice(0, 12))); }
export function download(name: string, content: string, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
