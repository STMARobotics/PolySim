import './style.css';
import './workspace.css';
import { clone, createAction, DT, ENGINE_VERSION, syncSurfaceLinks, surfaceForEdge, FACES, freeSpeed, id, nodeName, parseDocument, ticksFor, validConnection, validate, type Face, type RobotDocument, type Surface, type Vec3 } from '../contracts/model';
import { practice, sampleRobot } from '../seasons/practice';
import type { Controls, FromWorker, Snapshot, ToWorker, InputFrame } from '../simulation/protocol';
import { Viewport } from './viewport';
import { esc, GraphView } from './graph-view';
import { download, readDraft, readRobots, readRuns, saveDraft, saveRobot, saveRun, type SavedRun, readCloudRevisions, writeCloudRevision } from './storage';
import { cloudEnabled, cloudLibrary, cloudRobot, saveShared, sharedRevision, signedInUser, trackRevision, signOut, ApiError, type RobotSummary } from './cloud';
import { metricsCSV } from './report';
import { normalizeBinding, bindingLabel } from '../contracts/bindings';
import { nextNodePosition } from './editor-model';
import type { DriverStation } from './camera-model';
import { SimulationClient } from '../simulation/client';
import { displayValue, storedValue, displayIssue } from './units';
import { keyboardDrive } from './drive-controls';
if (cloudEnabled()) for (const [id, revision] of Object.entries(readCloudRevisions())) trackRevision(id, revision);
let saving = false;
let doc = readDraft() ?? sampleRobot(), selected = doc.id, selectedFace: Face = '+X';
let mode: 'edit' | 'running' | 'paused' = 'edit', snapshot: Snapshot | undefined, workerReady = false, pendingPlay = false, isReplay = false;
type WorkspaceView = 'edit' | 'graph' | 'drive';
let activeView: WorkspaceView = 'edit', transformMode: 'translate' | 'scale' = 'translate';
let propertiesVisible = true, driverStation: DriverStation = 2, simulationDirty = true;
let capturingBinding: {
    id: string;
    path: string;
} | undefined;
let undo: RobotDocument[] = [], redo: RobotDocument[] = [], dirty = false, drawing = false, lastUI = 0;
let activeRunId = id(), runDocument: RobotDocument | undefined, runLimit = 14400, toastTimer: ReturnType<typeof setTimeout>, keys = new Set<string>(), virtual = new Set<string>();
const root = document.querySelector<HTMLDivElement>('#app')!;
const button = (action: string, text: string, cls = '', title = '') => `<button data-action="${action}" class="${cls}" ${title ? `title="${esc(title)}"` : ''}>${text}</button>`;
root.innerHTML = `
  <header class="appbar compact-header">
    <button class="brand" data-action="library" title="Robot library"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 30 10 16 18 2 10Z" fill="#f34855"/><path d="M2 10 16 18 16 30 2 22Z" fill="#ffcf32"/><path d="M16 18 30 10 30 22 16 30Z" fill="#368cff"/></svg>PolySim</button>
    <span id="save-status" class="save-status"></span>
    <div class="project-actions">${button('undo', '↶', 'icon-button', 'Undo (Ctrl+Z)')}${button('redo', '↷', 'icon-button', 'Redo (Ctrl+Shift+Z)')}${button('save', 'Save', 'secondary')}${cloudEnabled() ? button('signout', 'Sign out', 'text-button account-signout', signedInUser()!.email) : ''}</div>
  </header>
  <nav class="workspace-nav" aria-label="Workspace views" role="tablist"><h1 id="robot-title"></h1>${([['edit', 'Edit'], ['graph', 'Graph'], ['drive', 'Drive']] as const).map(([v, label]) => `<button role="tab" id="tab-${v}" aria-selected="${v === 'edit'}" aria-controls="workspace" data-action="workspace:${v}">${label}</button>`).join('')}</nav>
  <main class="workspace" id="workspace" data-view="edit" data-properties="visible">
    <section class="stage" aria-label="3D editor"><div class="viewport-toolbar"><div class="edit-tools">${button('transform:translate', 'Move', 'text-button active', 'Drag the X, Y or Z handles')}${button('transform:scale', 'Resize', 'text-button', 'Drag the X, Y or Z handles')}</div><div class="station-tools" role="group" aria-label="Driver station"><span>Station</span>${([1, 2, 3] as const).map(n => `<button data-action="station:${n}" aria-label="Driver station ${n}" aria-pressed="${n === 2}">${n}</button>`).join('')}</div><span id="field-selection" class="selection-name"></span><button id="properties-show" class="secondary hidden" data-action="properties:show" aria-controls="properties-pane" aria-expanded="true">Inspector</button></div><div id="viewport"><div class="viewport-caption"><span class="view-tag" id="mode-tag">Edit</span></div><div class="runtime-hud" id="runtime-hud"><div><small>Pickups</small><strong id="hud-pickups">0</strong></div><div><small>Score</small><strong id="hud-score">0</strong></div></div><div class="viewport-hint" id="viewport-hint"></div></div><div class="drivebar"><div class="drive-keys" title="WASD: translate. Left/right arrows: rotate."><kbd>WASD</kbd><kbd>←/→</kbd></div><div id="action-controls"></div><span class="drive-note" id="drive-note"></span></div></section>
    <aside class="inspector" id="properties-pane" aria-label="Robot inspector"><section class="robot-section"><div class="panel-title"><span>Robot <span id="sub-count" class="count"></span></span><button class="text-button" data-action="properties:hide" aria-controls="properties-pane" aria-expanded="true">Hide</button></div><div class="robot-structure"><button class="robot-row" data-select="robot"><span class="robot-icon">▧</span><strong>Robot basics</strong></button><div id="tree"></div></div><div class="robot-tools">${button('add', '＋ Subsystem', 'secondary')}${button('export', 'Export', 'text-button', 'Export robot JSON')}${button('import', 'Import', 'text-button', 'Import robot JSON')}</div></section><div class="panel-title properties-heading"><span>Properties</span></div><div id="inspector"></div></aside>
    <section class="graph-panel" aria-label="Travel Path view"><div class="graph-toolbar"><span id="graph-selection" class="selection-name"></span><div class="graph-actions">${button('add-graph', '＋ Module', 'text-button')}${button('connect', '＋ Connection', 'text-button')}${button('graph-out', '−', 'icon-button', 'Zoom out')}${button('graph-in', '＋', 'icon-button', 'Zoom in')}${button('graph-fit', 'Fit', 'text-button')}<button class="secondary inspector-show hidden" data-action="properties:show" aria-controls="properties-pane">Inspector</button></div></div><div id="graph"></div></section>
  </main><footer class="statusbar"><button id="validation-summary" data-action="validation"></button><span id="runtime-status"></span></footer><div id="toast" role="status" aria-live="polite"></div><dialog id="modal"><div id="modal-content"></div></dialog><input id="file-input" type="file" accept=".json,application/json" hidden />`;
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const toast = (message: string) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 5000); };
const modal = (content: string) => {
    if (mode === 'running') {
        keys.clear();
        virtual.clear();
        send({ type: 'pause' });
        mode = 'paused';
        renderShell();
    }
    $('#modal-content').innerHTML = content;
    const d = $<HTMLDialogElement>('#modal');
    if (!d.open)
        d.showModal();
};
const close = () => $('#modal').hasAttribute('open') && $<HTMLDialogElement>('#modal').close();
const modalHead = (eyebrow: string, title: string) => `<div class="modal-header"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div>${button('close', '×', 'close-button', 'Close dialog')}</div>`;
const safeSaveDraft = () => {
    try {
        saveDraft(doc);
    }
    catch {
        toast('Browser storage is full or unavailable. Export your robot JSON to keep it.');
    }
};
const commit = (change: (d: RobotDocument) => void) => {
    if (mode !== 'edit') {
        toast('Return to Edit to change the robot.');
        return;
    }
    undo.push(clone(doc));
    if (undo.length > 60)
        undo.shift();
    redo = [];
    change(doc);
    syncSurfaceLinks(doc);
    simulationDirty = true;
    dirty = true;
    safeSaveDraft();
    render();
};
const select = (which: string) => { selected = which; render(); };
let viewport: Viewport | undefined;
try {
    viewport = new Viewport($('#viewport'), (which, face) => {
        selected = which;
        if (face) {
            selectedFace = face;
            toast(`${face} face selected. Assign an action in the inspector.`);
        }
        render();
    }, (position, size) => {
        if (mode !== 'edit')
            return;
        const b = { id: id(), name: 'New subsystem', position, size, yaw: 0, capacity: 1, solid: false };
        commit(d => { d.subsystems.push(b); d.layout[b.id] = nextNodePosition(d); selected = b.id; });
        drawing = false;
        viewport?.setDrawing(false);
        render();
    }, (which, position, size) => commit(d => {
        const block = d.subsystems.find(s => s.id === which);
        if (block) {
            block.position = position;
            block.size = size;
        }
    }));
}
catch (e) {
    $('#viewport').insertAdjacentHTML('beforeend', `<div class="viewport-error"><h3>3D viewport unavailable</h3><p>Enable WebGL in a current desktop browser. The graph and numeric editor remain available.</p><small>${esc(e)}</small></div>`);
}
const graph = new GraphView($('#graph'), select, (which, p) => commit(d => { d.layout[which] = p; }), (a, b) => addConnection(a, b), which => { select(which); setPropertiesVisible(true); });
const worker = new SimulationClient(() => new Worker(new URL('../simulation/worker.ts', import.meta.url), { type: 'module' }), location.protocol === 'file:' || new URLSearchParams(location.search).get('simulation') === 'local');
const send = (message: ToWorker) => worker.postMessage(message);
worker.onmessage = ({ data }: {
    data: FromWorker;
}) => {
    if (data.type === 'ready') {
        workerReady = true;
        if (pendingPlay && activeView === 'drive') {
            pendingPlay = false;
            mode = 'running';
            send({ type: 'play' });
            renderShell();
        }
    }
    if (data.type === 'error') {
        if (pendingPlay) {
            simulationFailed(data.message);
            return;
        }
        pendingPlay = false;
        if (mode !== 'edit')
            mode = 'paused';
        toast(data.message);
        render();
    }
    if (data.type === 'snapshot') {
        snapshot = data.snapshot;
        if (mode !== 'edit') {
            viewport?.update(snapshot);
            if (snapshot.tick === 0)
                renderShell();
            if (!snapshot.running && mode === 'running' && snapshot.tick > 0) {
                mode = 'paused';
                renderShell();
            }
            if (!snapshot.running || performance.now() - lastUI > 100) {
                lastUI = performance.now();
                if (activeView === 'graph') graph.update(snapshot);
                updateRuntime();
            }
        }
    }
};
worker.onerror = e => simulationFailed(e.message);
function simulationFailed(message: string) {
    simulationDirty = true;
    pendingPlay = false;
    workerReady = false;
    mode = 'edit';
    keys.clear();
    virtual.clear();
    setWorkspaceView('edit');
    render();
    toast(`Simulation unavailable: ${message || 'Unable to initialize physics.'}`);
}
function load(next: RobotDocument) {
    if (mode !== 'edit')
        send({ type: 'pause' });
    mode = 'edit';
    doc = syncSurfaceLinks(clone(next));
    simulationDirty = true;
    selected = doc.id;
    undo = [];
    redo = [];
    snapshot = undefined;
    dirty = false;
    isReplay = false;
    safeSaveDraft();
    close();
    render();
    setPropertiesVisible(true);
    setWorkspaceView('edit');
    graph.fit();
}
function start(replay?: InputFrame[], endTick = Number.MAX_SAFE_INTEGER) {
    const errors = validate(doc).filter(i => i.level === 'error');
    if (errors.length) {
        setWorkspaceView('edit');
        showValidation();
        return;
    }
    keys.clear();
    virtual.clear();
    mode = 'paused';
    workerReady = false;
    pendingPlay = true;
    isReplay = !!replay;
    activeRunId = id();
    snapshot = undefined;
    runDocument = clone(doc);
    runLimit = endTick;
    drawing = false;
    viewport?.setDrawing(false);
    simulationDirty = false;
    send({ type: 'init', document: clone(doc), replay, endTick });
    render();
    setWorkspaceView('drive');
}
function render() {
    renderShell();
    renderTree();
    renderInspector();
    viewport?.setDocument(doc, selected);
    if (mode !== 'edit' && snapshot)
        viewport?.update(snapshot);
    if (viewport)
        viewport.setEditing(mode === 'edit' && activeView === 'edit');
    graph.set(doc, selected, mode === 'edit');
    if (snapshot && mode !== 'edit')
        graph.update(snapshot);
    updateRuntime();
}
function renderShell() {
    $('#robot-title').textContent = doc.name;
    $('#save-status').textContent = saving ? 'Saving…' : dirty ? (cloudEnabled() ? 'Unsynced' : 'Draft') : cloudEnabled() ? (sharedRevision(doc.id) ? `Shared · rev ${sharedRevision(doc.id)}` : 'Local draft') : 'Saved';
    $<HTMLButtonElement>('[data-action="save"]').disabled = mode !== 'edit' || saving;
    $<HTMLButtonElement>('[data-action="undo"]').disabled = !undo.length || mode !== 'edit';
    $<HTMLButtonElement>('[data-action="redo"]').disabled = !redo.length || mode !== 'edit';
    for (const action of ['add', 'connect', 'add-graph', 'transform:translate', 'transform:scale'])
        $<HTMLButtonElement>(`[data-action="${action}"]`).disabled = mode !== 'edit';
    $('#mode-tag').textContent = pendingPlay ? 'Loading…' : mode === 'edit' ? 'Edit' : isReplay ? 'Replay' : mode === 'running' ? 'Live' : 'Paused';
    $('#mode-tag').classList.toggle('live', mode === 'running');
    $('#viewport-hint').textContent = activeView === 'edit' && mode === 'edit' && doc.subsystems.some(s => s.id === selected || doc.surfaces.some(a => a.id === selected && a.owner === s.id)) ? (transformMode === 'scale' ? 'Drag handles to resize' : 'Drag handles to move') : '';
    $('#drive-note').textContent = isReplay ? 'Replay' : '';
    $('.drivebar').classList.toggle('hidden', activeView !== 'drive' || mode === 'edit');
    $('.runtime-hud').classList.toggle('hidden', activeView !== 'drive' || mode === 'edit');
    $('.viewport-caption').classList.toggle('hidden', activeView !== 'drive' || mode === 'edit');
    document.querySelectorAll<HTMLElement>('[data-action="properties:show"]').forEach(b => {
        b.classList.toggle('hidden', propertiesVisible);
        b.setAttribute('aria-expanded', String(propertiesVisible));
    });
    document.querySelectorAll<HTMLElement>('[data-action^="station:"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.action === 'station:' + driverStation)));
    $('#field-selection').textContent = activeView === 'drive' || nodeName(doc, selected) === 'Missing node' ? '' : nodeName(doc, selected);
    $('#graph-selection').textContent = [...doc.subsystems, ...doc.surfaces, ...doc.edges].some(n => n.id === selected) ? (doc.edges.some(e => e.id === selected) ? 'Connection' : nodeName(doc, selected)) : '';
    document.querySelectorAll<HTMLElement>('[data-action^="transform:"]').forEach(b => b.classList.toggle('active', b.dataset.action === 'transform:' + transformMode));
    const actions = [...new Set(doc.edges.map(e => normalizeBinding(e.key)!))];
    $('#action-controls').innerHTML = actions.map(k => `<button class="action-control" data-hold="${esc(k)}" ${mode === 'edit' || isReplay ? 'disabled' : ''}><kbd>${esc(bindingLabel(k))}</kbd>${esc(surfaceForEdge(doc, doc.edges.find(e => normalizeBinding(e.key) === k)!)?.type ?? 'Transfer')}</button>`).join('');
    $('#action-controls').querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b => {
        b.addEventListener('pointerdown', e => { virtual.add(b.dataset.hold!); b.setPointerCapture(e.pointerId); b.classList.add('held'); sendControls(); });
        const release = () => { virtual.delete(b.dataset.hold!); b.classList.remove('held'); sendControls(); };
        b.addEventListener('pointerup', release);
        b.addEventListener('pointercancel', release);
    });
    const issues = validate(doc), errors = issues.filter(i => i.level === 'error').length;
    $('#validation-summary').innerHTML = `<span class="${errors ? 'error-text' : 'valid-text'}">${errors ? '⚠ ' + errors + ' errors' : '✓ Valid'}</span>`;
    $('#sub-count').textContent = String(doc.subsystems.length);
}
function renderTree() {
    $('[data-select="robot"]').classList.toggle('selected', selected === doc.id);
    $('#tree').innerHTML = doc.subsystems.map(s => `<div class="tree-group"><button class="tree-row ${selected === s.id ? 'selected' : ''}" data-select="${esc(s.id)}"><span class="cube-icon">◇</span><span>${esc(s.name)}</span><small>${s.capacity}</small></button>${doc.surfaces.filter(a => a.owner === s.id).map(a => `<button class="tree-surface ${selected === a.id ? 'selected' : ''}" data-select="${esc(a.id)}"><i class="swatch ${a.type}"></i><span>${esc(a.name)}</span></button>`).join('')}</div>`).join('');
}
const bindingField = (path: string, value: string) => `<label class="field"><span>Key</span><button type="button" aria-label="Key binding ${esc(bindingLabel(value))}" title="Click, then press a key" class="binding-capture ${capturingBinding?.id === selected && capturingBinding.path === path ? 'recording' : ''}" data-bind="${path}" ${mode !== 'edit' ? 'disabled' : ''}>${capturingBinding?.id === selected && capturingBinding.path === path ? 'Press a key…' : esc(bindingLabel(value))}</button></label>`;
const field = (label: string, key: string, value: string | number, type = 'number', step = '0.01', help = '') => `<label class="field"><span>${label}</span><input data-field="${key}" type="${type}" value="${esc(typeof value === 'number' ? displayValue(key, value) : value)}" step="${step}" ${mode !== 'edit' ? 'disabled' : ''} />${help ? `<small>${help}</small>` : ''}</label>`;
const dropdown = (label: string, key: string, value: string, options: [
    string,
    string
][]) => `<label class="field"><span>${label}</span><select data-field="${key}" ${mode !== 'edit' ? 'disabled' : ''}>${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const section = (name: string, content: string) => `<section class="inspector-section"><h3>${name}</h3>${content}</section>`;
const vectorFields = (label: string, key: string, value: Vec3) => `<div class="vector-label">${label}</div><div class="three-fields">${value.map((n, i) => field(['X', 'Y', 'Z'][i], `${key}.${i}`, n)).join('')}</div>`;
function renderInspector() {
    const sub = doc.subsystems.find(s => s.id === selected), surface = doc.surfaces.find(s => s.id === selected), edge = doc.edges.find(e => e.id === selected);
    let html = '';
    if (mode !== 'edit')
        html += '<div class="read-only-note">Design locked during run. Return to Edit to make changes.</div>';
    if (sub) {
        html += section('Subsystem', field('Name', 'sub.name', sub.name, 'text') + `<div class="object-description">Rectangular functional abstraction. +X forward · +Y left · +Z up.</div>`);
        html += section('Geometry', vectorFields('Position · in', 'sub.position', sub.position) + vectorFields('Dimensions · in', 'sub.size', sub.size) + field('Yaw · degrees', 'sub.yaw', sub.yaw));
        html += section('Storage & collision', field('Total capacity · pieces', 'sub.capacity', sub.capacity, 'number', '1') + `<label class="check-field"><input data-field="sub.solid" type="checkbox" ${sub.solid ? 'checked' : ''} ${mode !== 'edit' ? 'disabled' : ''} /><span>Solid geometry</span></label><p class="help-text">${sub.solid ? 'This box collides with physical pieces and field objects.' : 'Functional envelope: action faces interact, but the box has no solid collider.'} Staging and transit count toward capacity.</p>`);
        const assignments = doc.surfaces.filter(s => s.owner === sub.id);
        html += section('Action surfaces', dropdown('Selected face', 'face', selectedFace, FACES.map(f => [f, f])) + `<div class="face-assignment">${assignments.find(s => s.faces.includes(selectedFace)) ? `Assigned: ${esc(assignments.find(s => s.faces.includes(selectedFace))!.name)}` : 'Unassigned · white'}</div><div class="two-buttons">${button('surface:intake', '＋ Intake', 'secondary')}${button('surface:outtake', '＋ Outtake', 'secondary')}</div>${assignments.length ? `<p class="help-text">Select a surface in the hierarchy to group faces and configure its launch settings.</p>` : ''}`);
        html += section('Subsystem actions', `<div class="two-buttons">${button('duplicate', 'Duplicate', 'secondary')}${button('delete', 'Remove', 'danger')}</div>`);
    }
    else if (surface) {
        html += section('Action surface', field('Name', 'surface.name', surface.name, 'text') + dropdown('Type', 'surface.type', surface.type, [['intake', 'Intake · blue'], ['outtake', 'Outtake · red']]) + `<p class="help-text">Owner: ${esc(nodeName(doc, surface.owner))}</p>`);
        html += section('Face group', `<div class="face-grid">${FACES.map(f => { const taken = doc.surfaces.some(s => s.id !== surface.id && s.owner === surface.owner && s.faces.includes(f)); return `<label class="face-check ${taken ? 'unavailable' : ''}"><input type="checkbox" data-face="${f}" ${surface.faces.includes(f) ? 'checked' : ''} ${taken || mode !== 'edit' ? 'disabled' : ''}/>${f}</label>`; }).join('')}</div><p class="help-text">Faces share one action state. Each face can belong to only one group.</p>`);
        html += section('Action rate', field('Minimum interval · s', 'surface.interval', surface.interval) + button('edit-transition:' + doc.edges.find(e => surfaceForEdge(doc, e)?.id === surface.id)!.id, 'Edit transition', 'secondary wide'));
        if (surface.type === 'outtake')
            html += section('Launch configuration', dropdown('Release face', 'releaseFace', surface.faces[0] ?? '+X', surface.faces.map(f => [f, f])) + field('Exit speed · in/s', 'surface.speed', surface.speed) + `<div class="vector-label">Simultaneous game piece outtake</div><div class="two-buttons">${field('Units X · across', 'surface.unitsX', surface.unitsX ?? 1, 'number', '1')}${field('Units Y · up', 'surface.unitsY', surface.unitsY ?? 1, 'number', '1')}</div>` + field('Local yaw · degrees', 'surface.yaw', surface.yaw) + field('Local pitch · degrees', 'surface.pitch', surface.pitch) + vectorFields('Exit angular velocity · deg/s', 'surface.spin', surface.spin) + `<p class="help-text">Yaw/pitch use the subsystem frame (+X at zero). Robot point velocity and angular velocity are added at release. Ball orientation has no aerodynamic effect.</p>`);
        html += section('Surface actions', button('delete', 'Delete action surface', 'danger wide'));
    }
    else if (edge) {
        const action = surfaceForEdge(doc, edge);
        html += section(action ? 'Action transition' : 'Directed transfer', `<div class="route-card"><span>${esc(nodeName(doc, edge.source))}</span><span class="muted">to</span><span>${esc(nodeName(doc, edge.target))}</span></div>` + field('Travel time · s', 'edge.duration', edge.duration) + `<p class="help-text">${edge.duration === 0 ? 'Instant · no delay.' : `Effective: ${ticksFor(edge.duration)} ticks · ${(ticksFor(edge.duration) * DT).toFixed(4)} s at 120 Hz.`}</p>`);
        html += section('Scheduling', bindingField('edge.key', edge.key) + dropdown('Trigger', 'edge.trigger', edge.trigger, [['hold', 'Hold'], ['press', 'Press']]) + (action ? '' : field('Priority · higher first', 'edge.priority', edge.priority, 'number', '1') + field('Concurrent pieces', 'edge.concurrency', edge.concurrency, 'number', '1')) + `<p class="help-text">Transitions finish after the key is released. Use 0 seconds for instant action transitions. A cross-subsystem transfer reserves its destination slot and keeps source ownership until delivery.</p>`);
        const metric = snapshot?.edgeMetrics[edge.id];
        if (metric)
            html += section('Last run', `<dl class="metric-list"><dt>Completed deliveries</dt><dd>${metric.deliveries}</dd><dt>Capacity blocked</dt><dd>${(metric.capacityTicks * DT).toFixed(2)} s</dd><dt>Waiting for input</dt><dd>${(metric.inputTicks * DT).toFixed(2)} s</dd><dt>Throughput</dt><dd>${(metric.deliveries / Math.max(DT, snapshot!.tick * DT)).toFixed(2)} /s</dd></dl>`);
        if (!action) html += section('Connection actions', button('delete', 'Remove connection', 'danger wide'));
    }
    else if (selected === '@connect') {
        const nodes = doc.subsystems;
        html += section('New connection', `<form id="connection-form"><label class="field"><span>Source</span><select name="source">${nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('')}</select></label><label class="field"><span>Destination</span><select name="target">${nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('')}</select></label><button class="primary wide" type="submit">Create connection</button></form><p class="help-text">Connect subsystems here or drag between their ports. Action links are automatic.</p>`);
    }
    else {
        const b = doc.basics;
        html += section('Robot basics', field('Robot name', 'robot.name', doc.name, 'text') + `<div class="robot-meta"><span>Revision ${doc.revision}</span><span>Practice Lab</span></div>`);
        html += section('Chassis envelope', field('Length · X · in', 'basics.length', b.length) + field('Width · Y · in', 'basics.width', b.width) + field('Height · Z · in', 'basics.height', b.height) + field('Mass · lb', 'basics.mass', b.mass));
        html += section('Planar drivetrain', field('Wheel diameter · in', 'basics.wheelDiameter', b.wheelDiameter) + field('Drive reduction', 'basics.reduction', b.reduction, 'number', '.01', 'Motor revolutions per wheel revolution.') + field('Motor free speed · rpm', 'basics.motorRPM', b.motorRPM, 'number', '1') + `<div class="speed-estimate"><small>Theoretical free speed</small><strong>${displayValue('basics.loadedSpeed', freeSpeed(doc)).toFixed(2)} <span>in/s</span></strong></div>` + field('Loaded speed · in/s', 'basics.loadedSpeed', b.loadedSpeed) + field('Acceleration / deceleration · in/s²', 'basics.acceleration', b.acceleration) + field('Max angular speed · deg/s', 'basics.angularSpeed', b.angularSpeed) + `<p class="help-text">Starting estimates. Module positions use the four chassis corners. Angular acceleration is fixed at 343.77 deg/s². This model does not estimate traction, current, battery sag, or tipping.</p>`);
    }
    $('#inspector').innerHTML = html;
    $('#inspector').querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(el => el.addEventListener('change', () => {
        const path = el.dataset.field!;
        if (path === 'face') {
            selectedFace = el.value as Face;
            renderInspector();
            return;
        }
        let value: unknown = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'number' ? Number(el.value) : el.value;
        if (typeof value === 'number' && !Number.isFinite(value)) {
            toast('Enter a finite number.');
            renderInspector();
            return;
        }
        if (path.endsWith('.key'))
            value = normalizeBinding(String(value)) ?? '';
        if (typeof value === 'number') value = storedValue(path, value);
        commit(d => {
            if (path === 'releaseFace') {
                const s = d.surfaces.find(s => s.id === selected)!;
                s.faces = [value as Face, ...s.faces.filter(f => f !== value)];
                return;
            }
            const [kind, ...parts] = path.split('.');
            let target: any = kind === 'robot' ? d : kind === 'basics' ? d.basics : kind === 'sub' ? d.subsystems.find(s => s.id === selected) : kind === 'surface' ? d.surfaces.find(s => s.id === selected) : d.edges.find(e => e.id === selected);
            for (const p of parts.slice(0, -1))
                target = target[p];
            target[parts.at(-1)!] = value;
        });
    }));
    $('#inspector').querySelectorAll<HTMLInputElement>('[data-face]').forEach(el => el.addEventListener('change', () => commit(d => { const s = d.surfaces.find(s => s.id === selected)!, f = el.dataset.face as Face; s.faces = el.checked ? [...s.faces, f] : s.faces.filter(a => a !== f); })));
    $('#connection-form')?.addEventListener('submit', e => { e.preventDefault(); const form = new FormData(e.target as HTMLFormElement); addConnection(String(form.get('source')), String(form.get('target'))); });
}
function addConnection(source: string, target: string) {
    if (doc.surfaces.some(s => s.id === source || s.id === target)) {
        toast('Action links are permanent. Select the transition to change its binding or time.');
        return;
    }
    if (!validConnection(doc, source, target)) {
        toast('That connection is unsupported. Connect intake → owner, subsystem → subsystem, or owner → outtake.');
        return;
    }
    if (doc.edges.some(e => e.source === source && e.target === target)) {
        toast('That route already exists. Select it to edit.');
        return;
    }
    commit(d => { const e = { id: id(), source, target, duration: .25, key: 'j', trigger: 'hold' as const, priority: 0, concurrency: 1 }; d.edges.push(e); selected = e.id; });
}
function updateRuntime() {
    const s = snapshot;
    $('#hud-pickups').textContent = String(s?.pickups ?? 0);
    $('#hud-score').textContent = String(s?.score ?? 0);
    $('#runtime-status').textContent = mode === 'edit' ? '' : s?.slow ? 'Simulation running slower' : s?.blocked[0] ?? `${mode === 'running' ? 'Running' : 'Paused'} · ${s?.tokens.length ?? 0} internal`;
    $('#runtime-status').classList.toggle('warning-text', !!s?.blocked.length || !!s?.slow);
}
function showValidation() { const issues = validate(doc); modal(modalHead('Design check', 'Validation & model scope') + `<div class="modal-body"><div class="notice">Fix errors before driving. Model notes describe the limits of this offline prototype.</div><div class="issue-list">${issues.map(i => `<button class="issue ${i.level}" data-issue="${esc(i.object)}"><span>${i.level === 'error' ? '⚠' : 'ⓘ'}</span><div><strong>${i.level === 'error' ? 'Fix required' : 'Model note'}</strong><p>${esc(displayIssue(i.message))}</p></div></button>`).join('')}</div></div>`); }
function showLocalLibrary() { const robots = readRobots(); modal(modalHead('Local workspace', 'Your robot library') + `<div class="modal-body"><div class="library-toolbar"><label class="field"><span>Season</span><select aria-label="Season"><option>Practice Lab · spherical ball fixture</option></select></label>${button('new', '＋ New robot', 'primary')}</div><p class="help-text">Saved in this browser on this local address. Offline mode does not use Google sign-in or a shared team library.</p><div class="library-grid"><button class="robot-card sample-card" data-action="sample"><span class="card-overline">Guided sample</span><span class="card-robot">▧</span><h3>Atlas prototype</h3><p>Collector, hopper, launcher.<br>A complete pipeline to explore.</p><span class="card-footer">Open a fresh sample</span></button>${robots.map(r => `<article class="robot-card"><span class="card-overline">Local robot · rev ${r.document.revision}</span><span class="card-robot">▧</span><h3>${esc(r.document.name)}</h3><p>${r.document.subsystems.length} subsystems · ${r.document.edges.length} connections<br>${esc(new Date(r.updated).toLocaleString())}</p><div class="card-footer">${button('open:' + r.document.id, 'Open', 'secondary')}${button('copy:' + r.document.id, 'Duplicate', 'text-button')}</div></article>`).join('')}</div></div>`); }
let cloudRows: RobotSummary[] = [], libraryCursor: string|undefined;
async function showLibrary(more = false) {
    if (!cloudEnabled()) { showLocalLibrary(); return; }
    modal(modalHead('Team workspace', 'Robot library') + '<div class="modal-body">Loading…</div>');
    try {
        const page = await cloudLibrary(more ? libraryCursor : undefined);
        cloudRows = more ? [...cloudRows, ...page.items] : page.items;
        libraryCursor = page.cursor;
        modal(modalHead('Team workspace', 'Robot library') + `<div class="modal-body"><div class="library-toolbar">${button('new', '＋ New robot', 'primary')}${button('sample', 'Guided sample', 'secondary')}</div><div class="library-grid">${cloudRows.map(r => `<article class="robot-card"><span class="card-overline">Shared · rev ${r.revision}</span><h3>${esc(r.name)}</h3><p>${r.subsystems} subsystems · ${r.connections} connections<br>${esc(new Date(r.updated).toLocaleString())}</p><div class="card-footer">${button('open:' + r.id, 'Open', 'secondary')}${button('copy:' + r.id, 'Duplicate', 'text-button')}</div></article>`).join('')}</div>${libraryCursor ? button('library-more', 'Load more', 'secondary') : ''}${!cloudRows.length ? '<p>No shared robots yet. Create a robot and save it.</p>' : ''}</div>`);
    } catch (e) {modal(modalHead('Team workspace', 'Robot library') + `<div class="modal-body"><p>${esc(e instanceof Error ? e.message : 'Unable to load robots.')}</p>${button('library', 'Retry', 'secondary')}</div>`);}
}
function rememberRevision(document: RobotDocument) {
    trackRevision(document.id, document.revision);
    try {writeCloudRevision(document.id, document.revision);} catch {toast('Shared save succeeded. Local recovery storage is unavailable.');}
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
function currentRun(): SavedRun | undefined {
    if (!snapshot || snapshot.tick === 0 || !runDocument)
        return;
    return { id: activeRunId, name: runDocument.name, created: new Date().toISOString(), document: clone(runDocument), snapshot: clone(snapshot), replay: isReplay, engine: ENGINE_VERSION, season: practice.version };
}
function resultCard(run: SavedRun) { const s = run.snapshot, seconds = s.tick * DT; return `<div class="result-card"><div class="eyebrow">${run.replay ? 'RECORDED INPUT RE-SIMULATION' : 'MANUAL · DRIVER-DEPENDENT'}</div><h3>${esc(run.name)}</h3><p class="help-text">Robot rev ${run.document.revision} · ${seconds.toFixed(2)} s</p><div class="result-metrics"><div><span>Practice score</span><strong>${s.score}</strong></div><div><span>Pickups</span><strong>${s.pickups}</strong></div><div><span>Releases</span><strong>${s.releases}</strong></div><div><span>Scored / released</span><strong>${s.scored} / ${s.releases}</strong></div><div><span>Mean intake-to-release</span><strong>${s.cycles.length ? average(s.cycles).toFixed(2) + ' s' : '—'}</strong></div><div><span>Release throughput</span><strong>${(s.releases / Math.max(seconds, DT)).toFixed(2)} /s</strong></div></div><p class="help-text">${s.releases - s.scored} unscored or unresolved releases. Only descending crossings of the target opening score.</p><p class="result-version">Engine ${esc(run.engine)} · Rapier 0.19.3 · Practice ${esc(run.season)} · Experimental fixture</p></div>`; }
function showResults() {
    const current = currentRun(), saved = readRuns();
    const runs = current ? [current, ...saved.filter(r => r.id !== current.id)] : saved;
    modal(modalHead('Engineering outputs', 'Run results') + `<div class="modal-body results-body">${runs.length ? `<div class="results-toolbar">${button('save-run', 'Save current run', 'primary')}${button('csv', 'Export metrics CSV', 'secondary')}${button('run-json', 'Export run JSON', 'secondary')}</div><div class="comparison-selectors"><label class="field"><span>Run A</span><select id="compare-a">${runs.map((r, i) => `<option value="${i}">${i === 0 && current ? 'Current · ' : ''}${esc(r.name)} · rev ${r.document.revision} · ${(r.snapshot.tick * DT).toFixed(1)} s</option>`).join('')}</select></label><label class="field"><span>Run B</span><select id="compare-b"><option value="-1">Select a saved run to compare</option>${runs.map((r, i) => `<option value="${i}">${esc(r.name)} · rev ${r.document.revision} · ${(r.snapshot.tick * DT).toFixed(1)} s</option>`).join('')}</select></label></div><div id="comparison" class="comparison"></div><div id="edge-results"></div><div class="results-toolbar">${button('replay', 'Re-run recorded inputs from A', 'secondary')}</div><div class="notice">All runs use the same fixed practice setup. Manual runs depend on the driver. Re-simulation uses the original robot snapshot and tick-indexed inputs; repeatability is limited to this tested engine/build. Parameters are estimates. No drag, spin lift, flexible pieces, tipping, official FRC rules, or articulated mechanisms are modeled.</div>` : `<div class="empty-state"><div class="empty-icon">◷</div><h3>Make your first run</h3><p>Open Drive, collect balls, and launch toward the target. Your measurements will appear here.</p>${button('close', 'Back to workspace', 'primary')}</div>`}</div>`);
    if (!runs.length)
        return;
    const update = () => {
        const a = Number($<HTMLSelectElement>('#compare-a').value), b = Number($<HTMLSelectElement>('#compare-b').value);
        $('#comparison').innerHTML = resultCard(runs[a]) + (b >= 0 ? resultCard(runs[b]) : '');
        const r = runs[a];
        $('#edge-results').innerHTML = `<h3 class="table-heading">Transfer diagnostics · Run A</h3><div class="table-scroll"><table><thead><tr><th>Connection</th><th>Delivered</th><th>Capacity wait</th><th>Input wait</th><th>Busy</th></tr></thead><tbody>${r.document.edges.map(e => { const m = r.snapshot.edgeMetrics[e.id]; return m ? `<tr><td>${esc(nodeName(r.document, e.source))} → ${esc(nodeName(r.document, e.target))}</td><td>${m.deliveries}</td><td>${(m.capacityTicks * DT).toFixed(2)} s</td><td>${(m.inputTicks * DT).toFixed(2)} s</td><td>${(m.busyTicks / Math.max(1, r.snapshot.tick) * 100).toFixed(1)}%</td></tr>` : ''; }).join('')}</tbody></table></div>`;
        $('#edge-results').insertAdjacentHTML('beforeend', `<p class="help-text">${r.snapshot.escaped?.length ?? 0} pieces retired after leaving the fixture. These remain recorded as unscored, rather than disappearing from the ownership ledger.</p><details class="event-details"><summary>Runtime event log · latest 40 events</summary><div>${r.snapshot.log.map(line => `<p>${esc(line)}</p>`).join('') || '<p>No piece events recorded.</p>'}</div></details>`);
    };
    $('#compare-a').addEventListener('change', update);
    $('#compare-b').addEventListener('change', update);
    update();
    $('[data-action="replay"]').addEventListener('click', () => { const run = runs[Number($<HTMLSelectElement>('#compare-a').value)]; load(run.document); start(run.snapshot.recording, run.snapshot.tick); });
    $('[data-action="csv"]').addEventListener('click', () => exportCSV(runs[Number($<HTMLSelectElement>('#compare-a').value)]));
    $('[data-action="run-json"]').addEventListener('click', () => download('polysim-run.json', JSON.stringify(runs[Number($<HTMLSelectElement>('#compare-a').value)], null, 2)));
}
function exportCSV(run: SavedRun) { download('polysim-metrics.csv', metricsCSV(run), 'text/csv'); }
function help() { modal(modalHead('HELP', 'PolySim') + `<div class="modal-body help-body"><div class="help-steps"><div><h3>Edit</h3><p>Select a box and drag its Move or Resize handles. The right inspector contains dimensions, capacity, faces and bindings. Hide expands the editor; Inspector restores the pane.</p></div><div><h3>Graph</h3><p>Drag from an output port onto a destination. Select any module or connection to edit it in the right inspector.</p></div><div><h3>Drive</h3><p>Choose driver station 1, 2 or 3. The camera stays behind the station and smoothly tracks the robot. WASD moves; left/right arrows rotate. Opening Drive starts play automatically. Leaving Drive pauses play.</p></div></div><p>Click a key binding, then press the desired key. Space, Shift and Enter are supported. Yellow fills each box from the bottom according to owned inventory and capacity.</p><p>Save keeps robots in this browser. Export creates a JSON backup.</p><details class="event-details"><summary>Model limits</summary><p>Estimated practice fixture. No official FRC rules, drag, traction, tipping, articulated mechanisms or cloud sharing. Full assumptions appear in Results and the offline documentation.</p></details>${button('close', 'Close', 'primary')}</div>`); }
function removeSelected() {
    const edge = doc.edges.find(e => e.id === selected);
    if (edge && surfaceForEdge(doc, edge)) { toast('This link belongs to its surface action and cannot be removed.'); return; }
    const sub = doc.subsystems.find(s => s.id === selected), surface = doc.surfaces.find(s => s.id === selected), ids = new Set([selected]);
    if (sub)
        doc.surfaces.filter(s => s.owner === sub.id).forEach(s => ids.add(s.id));
    const affected = doc.edges.filter(e => ids.has(e.source) || ids.has(e.target)).length;
    commit(d => {
        d.subsystems = d.subsystems.filter(s => !ids.has(s.id));
        d.surfaces = d.surfaces.filter(s => !ids.has(s.id));
        d.edges = d.edges.filter(e => !ids.has(e.id) && !ids.has(e.source) && !ids.has(e.target));
        for (const x of ids)
            delete d.layout[x];
        selected = d.id;
    });
    toast(`${sub ? 'Subsystem' : surface ? 'Surface' : 'Connection'} removed${affected ? ' with ' + affected + ' connected edges' : ''}. Undo restores the whole edit.`);
}
function sendControls(gamepad?: {
    x: number;
    y: number;
    turn: number;
    held: string[];
}) {
    if (mode === 'edit' || isReplay || !workerReady)
        return;
    const {x, y, turn} = keyboardDrive(keys);
    const input: Controls = { x: gamepad?.x || x, y: gamepad?.y || y, turn: gamepad?.turn || turn, held: [...new Set([...keys, ...virtual, ...gamepad?.held ?? []])].filter(k => !!normalizeBinding(k)).sort() };
    send({ type: 'controls', controls: input });
}
document.addEventListener('click', async e => {
    const bind = (e.target as Element).closest<HTMLButtonElement>('[data-bind]');
    if (bind && !bind.disabled) {
        capturingBinding = capturingBinding?.id === selected && capturingBinding.path === bind.dataset.bind ? undefined : { id: selected, path: bind.dataset.bind! };
        renderInspector();
        return;
    }
    if (capturingBinding) {
        capturingBinding = undefined;
        renderInspector();
    }
    const issue = (e.target as Element).closest<HTMLElement>('[data-issue]');
    if (issue) {
        close();
        select(issue.dataset.issue!);
        return;
    }
    const selection = (e.target as Element).closest<HTMLElement>('[data-select]');
    if (selection) {
        select(selection.dataset.select === 'robot' ? doc.id : selection.dataset.select!);
        return;
    }
    const target = (e.target as Element).closest<HTMLButtonElement>('[data-action]');
    if (!target || target.disabled)
        return;
    const action = target.dataset.action!;
    if (action === 'close') {
        close();
        return;
    }
    if (action.startsWith('edit-transition:')) { select(action.slice(16)); return; }
    if (action === 'signout') {
        try {await signOut();} catch {toast('Unable to sign out. Check your connection and retry.');}
        return;
    }
    if (action === 'save-copy') {
        close(); doc.id = id(); doc.name += ' copy'; doc.revision = 0; dirty = true; safeSaveDraft(); render();
        toast('Copy created. Save to add it to the shared library.'); return;
    }
    if (action === 'save') {
        if (saving) return;
        if (cloudEnabled()) {
            const captured = clone(doc); saving = true; renderShell();
            try {
                const saved = await saveShared(captured); rememberRevision(saved);
                if (doc.id === captured.id) {
                    doc.revision = saved.revision;
                    dirty = JSON.stringify({...captured, revision:saved.revision}) !== JSON.stringify(doc);
                    safeSaveDraft();
                }
                toast(`Saved shared revision ${saved.revision}.`);
            } catch (error) {
                dirty = true;
                if (error instanceof ApiError && error.status === 409) modal(modalHead('Save conflict', 'Robot changed') + `<div class="modal-body"><p>${esc(error.message)}</p>${button('save-copy','Save as copy','primary')}${button('close','Keep editing','secondary')}${button('library','Open shared library','secondary')}</div>`);
                else toast(error instanceof Error ? error.message : 'Save failed. Your local draft is preserved.');
            } finally {saving = false; renderShell();}
            return;
        }
        try {
            doc.revision++; saveRobot(clone(doc)); dirty = false; safeSaveDraft(); renderShell(); toast('Robot saved to this browser’s library.');
        } catch {doc.revision--;toast('Could not save: browser storage is full or unavailable. Export JSON instead.');}
        return;
    }
    if (action === 'undo' && undo.length) {
        redo.push(clone(doc));
        doc = undo.pop()!;
        simulationDirty = true;
        selected = doc.id;
        dirty = true;
        safeSaveDraft();
        render();
        return;
    }
    if (action === 'redo' && redo.length) {
        undo.push(clone(doc));
        doc = redo.pop()!;
        simulationDirty = true;
        selected = doc.id;
        dirty = true;
        safeSaveDraft();
        render();
        return;
    }
    if (action === 'add' || action === 'add-graph') {
        commit(d => { const s = { id: id(), name: 'New subsystem', position: [0, 0, .5] as Vec3, size: [.35, .35, .35] as Vec3, yaw: 0, capacity: 1, solid: false }; d.subsystems.push(s); d.layout[s.id] = nextNodePosition(d); selected = s.id; });
        requestAnimationFrame(() => graph.fit());
        return;
    }
    if (action.startsWith('surface:')) {
        const sub = doc.subsystems.find(s => s.id === selected);
        if (!sub)
            return;
        if (doc.surfaces.some(s => s.owner === sub.id && s.faces.includes(selectedFace))) {
            toast('That face already belongs to a surface. Edit the existing group first.');
            return;
        }
        commit(d => { const type = action.split(':')[1] as Surface['type']; const s = createAction(sub, type, selectedFace); d.surfaces.push(s); d.layout[s.id] = nextNodePosition(d); selected = s.id; });
        return;
    }
    if (action === 'delete') {
        removeSelected();
        return;
    }
    if (action === 'duplicate') {
        const original = doc.subsystems.find(s => s.id === selected);
        if (!original)
            return;
        commit(d => { const s = clone(original); s.id = id(); s.name += ' copy'; s.position[1] += .4; d.subsystems.push(s); d.layout[s.id] = nextNodePosition(d); selected = s.id; });
        toast('Block duplicated. Assign new action surfaces and connections.');
        return;
    }
    if (action === 'connect') {
        select('@connect');
        setPropertiesVisible(true);
        return;
    }
    if (action.startsWith('workspace:')) {
        setWorkspaceView(action.slice(10) as WorkspaceView);
        return;
    }
    if (action.startsWith('transform:')) {
        transformMode = action.slice(10) as 'translate' | 'scale';
        drawing = false;
        viewport?.setDrawing(false);
        viewport?.setTransformMode(transformMode);
        renderShell();
        return;
    }
    if (action === 'properties:hide') {
        setPropertiesVisible(false);
        return;
    }
    if (action === 'properties:show') {
        setPropertiesVisible(true);
        return;
    }
    if (action.startsWith('station:')) {
        driverStation = Number(action.slice(8)) as DriverStation;
        viewport?.setDriveView(true, driverStation);
        renderShell();
        return;
    }
    if (action === 'graph-fit') {
        graph.fit();
        return;
    }
    if (action === 'graph-in') {
        graph.zoomBy(1.2);
        return;
    }
    if (action === 'graph-out') {
        graph.zoomBy(1 / 1.2);
        return;
    }
    if (action === 'validation') {
        showValidation();
        return;
    }
    if (action === 'library' || action === 'library-more') {
        await showLibrary(action === 'library-more');
        return;
    }
    if (action === 'new') {
        const next = sampleRobot();
        next.name = 'Untitled robot';
        next.subsystems = [];
        next.surfaces = [];
        next.edges = [];
        next.layout = {};
        load(next);
        return;
    }
    if (action === 'sample') {
        load(sampleRobot());
        return;
    }
    if (action.startsWith('open:') || action.startsWith('copy:')) {
        try {
            const next = cloudEnabled() ? await cloudRobot(action.slice(5)) : clone(readRobots().find(r => r.document.id === action.slice(5))!.document);
            if (cloudEnabled()) rememberRevision(next);
            if (action.startsWith('copy:')) {next.id = id();next.name += ' copy';next.revision = 0;}
            load(next);
        } catch (error) {toast(error instanceof Error ? error.message : 'Unable to open robot.');}
        return;
    }
    if (action === 'export') {
        download('polysim-robot.json', JSON.stringify(doc, null, 2));
        return;
    }
    if (action === 'import') {
        $<HTMLInputElement>('#file-input').click();
        return;
    }
    if (action === 'results') {
        if (mode === 'running') {
            send({ type: 'pause' });
            mode = 'paused';
            render();
        }
        showResults();
        return;
    }
    if (action === 'save-run') {
        const run = currentRun();
        if (!run) {
            toast('Open Drive to play first.');
            return;
        }
        try {
            saveRun(run);
            toast('Run saved locally with robot snapshot and recorded inputs.');
            showResults();
        }
        catch {
            toast('Browser storage is full. Export the run JSON instead.');
        }
        return;
    }
    if (action === 'help') {
        help();
        return;
    }
});
$<HTMLInputElement>('#file-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement, file = input.files?.[0];
    if (!file)
        return;
    try {
        if (file.size > 256 * 1024)
            throw Error('Robot JSON must be at most 250 KiB.');
        const next = parseDocument(JSON.parse(await file.text()));
        load(next);
        dirty = true;
        renderShell();
        toast('Robot imported. Check validation before running.');
    }
    catch (e) {
        toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    input.value = '';
});
window.addEventListener('keydown', e => {
    if (capturingBinding) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const key = normalizeBinding(e.key) ?? normalizeBinding(e.code), capture = capturingBinding;
        if (!key)
            return;
        capturingBinding = undefined;
        commit(d => {
            const item = d.edges.find(s => s.id === capture.id);
            if (item)
                item.key = key;
        });
        return;
    }
    const editing = (e.target as Element).matches('input,select,textarea,[contenteditable="true"]') || $<HTMLDialogElement>('#modal').open;
    if (editing)
        return;
    if (activeView === 'edit' && viewport?.navigateKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (mode === 'edit' && (e.ctrlKey || e.metaKey) && ['s', 'z'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        $<HTMLButtonElement>(`[data-action="${e.key.toLowerCase() === 's' ? 'save' : e.shiftKey ? 'redo' : 'undo'}"]`).click();
        return;
    }
    const key = normalizeBinding(e.key) ?? normalizeBinding(e.code);
    if (!key)
        return;
    const bound = doc.edges.some(s => normalizeBinding(s.key) === key);
    if (mode !== 'edit' && (bound || ['w', 'a', 's', 'd', 'arrowleft', 'arrowright'].includes(key))) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!e.repeat) {
        keys.add(key);
        sendControls();
    }
}, true);
window.addEventListener('keyup', e => {
    const key = normalizeBinding(e.key) ?? normalizeBinding(e.code);
    if (key)
        keys.delete(key);
    sendControls();
});
function loseFocus() {
    keys.clear();
    virtual.clear();
    if (workerReady) send({ type: 'controls', controls: { x: 0, y: 0, turn: 0, held: [] } });
    if (mode === 'running') {
        send({ type: 'pause' });
        mode = 'paused';
        render();
    }
}
window.addEventListener('blur', loseFocus);
window.addEventListener('focus', () => { if (activeView === 'drive' && !document.hidden && !$<HTMLDialogElement>('#modal').open) resumeDrive(); });
$<HTMLDialogElement>('#modal').addEventListener('close', () => { if (activeView === 'drive') resumeDrive(); });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) loseFocus();
    else if (activeView === 'drive' && !$<HTMLDialogElement>('#modal').open) resumeDrive();
});
setInterval(() => {
    if (mode !== 'running' || isReplay)
        return;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
    if (!pad)
        return;
    const axis = (i: number) => Math.abs(pad.axes[i] ?? 0) > .15 ? pad.axes[i] : 0;
    sendControls({ x: -axis(1), y: -axis(0), turn: -axis(2), held: ['i', 'j', 'k'].filter((_, i) => pad.buttons[i]?.pressed) });
}, 33);
window.addEventListener('gamepaddisconnected', loseFocus);
render();
requestAnimationFrame(() => graph.fit());
function setPropertiesVisible(visible: boolean) {
    propertiesVisible = visible;
    $('#workspace').dataset.properties = visible ? 'visible' : 'hidden';
    document.querySelectorAll<HTMLElement>('[data-action="properties:show"]').forEach(b => {
        b.classList.toggle('hidden', visible);
        b.setAttribute('aria-expanded', String(visible));
    });
    if (activeView === 'graph') requestAnimationFrame(() => graph.fit());
}
function resumeDrive() {
    if (pendingPlay || mode === 'running') return;
    if (simulationDirty || !snapshot || !workerReady || snapshot.tick >= runLimit) {
        start();
        return;
    }
    mode = 'running';
    send({ type: 'play' });
    render();
}
function setWorkspaceView(view: WorkspaceView) {
    if (!['edit', 'graph', 'drive'].includes(view)) return;
    const previous = activeView;
    activeView = view;
    if (view !== 'drive' && mode !== 'edit') {
        if (workerReady || pendingPlay) send({ type: 'pause' });
        mode = 'edit';
        pendingPlay = false;
        keys.clear();
        virtual.clear();
    }
    $('#workspace').dataset.view = view;
    $('.stage').setAttribute('aria-label', view === 'drive' ? 'Drive view' : '3D editor');
    document.querySelectorAll<HTMLElement>('[data-action^="workspace:"]').forEach(tab => {
        const active = tab.dataset.action === 'workspace:' + view;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    viewport?.setDriveView(view === 'drive', driverStation);
    viewport?.setEditing(view === 'edit' && mode === 'edit');
    render();
    if (view === 'drive' && previous !== 'drive') resumeDrive();
    requestAnimationFrame(() => { if (view === 'graph') graph.fit(); });
}
setWorkspaceView(activeView);
