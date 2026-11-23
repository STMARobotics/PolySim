import {ensureField} from '../contracts/field-validation';
import {seasons,seasonFor,pieceTypesFor,acceptedTypes,createSeasonRobot} from '../seasons/registry';
import {fieldTree,fieldInspector} from './field-editor';
import {snapDocumentInches} from '../contracts/inch-grid';
import {TRIGGER_OPTIONS} from '../contracts/triggers';
import {TARGETING_OPTIONS,isTurretMode,DEFAULT_TARGETING_FREEDOM} from '../contracts/targeting';
import {ActionBeam} from './action-beam';
import {subsystemTree} from './tree-model';
import {ensureStates,syncDefaults,previewDocument,addState,duplicateSubsystem} from '../contracts/states';
import './style.css';
import './workspace.css';
import { clone, createAction, DT, ENGINE_VERSION, syncSurfaceLinks, surfaceForEdge, FACES, freeSpeed, id, nodeName, parseDocument, ticksFor, validConnection, validate, type Face, type RobotDocument, type Surface, type Vec3 } from '../contracts/model';
import { practice, sampleRobot } from '../seasons/practice';
import type { Controls, FromWorker, Snapshot, ToWorker, InputFrame } from '../simulation/protocol';
import {robotPreview} from './robot-preview';
import { Viewport } from './viewport';
import { esc, GraphView } from './graph-view';
import { download, readDraft, readRobots, readRuns, saveDraft, saveRobot, saveRun, type SavedRun, readCloudRevisions, writeCloudRevision } from './storage';
import { cloudEnabled, cloudLibrary, cloudRobot, saveShared, sharedRevision, signedInUser, trackRevision, signOut, ApiError, robotMetadata, type RobotSummary } from './cloud';
import { metricsCSV } from './report';
import { normalizeBinding, bindingLabel } from '../contracts/bindings';
import { nextNodePosition } from './editor-model';
import type { DriverStation } from './camera-model';
import { SimulationClient } from '../simulation/client';
import { displayValue, storedValue, displayIssue, propertyStep, inchProperty, inchInputLimits } from './units';
import { keyboardDrive, gamepadControls, gamepadHeldBindings, driveBindings } from './drive-controls';
if (cloudEnabled()) for (const [id, revision] of Object.entries(readCloudRevisions())) trackRevision(id, revision);
let saving = false;
let doc = snapDocumentInches(ensureStates(readDraft() ?? createSeasonRobot('reefscape-2025'))), selected = doc.id, selectedFace: Face = '+X';
let mode: 'edit' | 'running' | 'paused' = 'edit', snapshot: Snapshot | undefined, workerReady = false, pendingPlay = false, isReplay = false;
let robotEditable=!cloudEnabled() || !sharedRevision(doc.id);
let librarySeason=doc.seasonId;
let inspectorScope:'robot'|'field'='robot';
let graphMode: 'travel'|'states'='travel', stateOwner='', stateEdgeSelection='';
const openStates:Record<string,string|undefined>={};
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
  <nav class="workspace-nav" aria-label="Workspace views" role="tablist"><h1 id="robot-title"></h1>${([['edit', 'Edit'], ['graph', 'Graph'], ['drive', 'Drive']] as const).map(([v, label]) => `<button role="tab" id="tab-${v}" aria-selected="${v === 'edit'}" aria-controls="workspace" data-action="workspace:${v}">${label}</button>`).join('')}<button role="tab" id="tab-library" aria-selected="false" aria-controls="modal" data-action="library">Library</button></nav>
  <main class="workspace" id="workspace" data-view="edit" data-properties="visible">
    <section class="stage" aria-label="3D editor"><div class="viewport-toolbar"><div class="edit-tools">${button('transform:translate', 'Move', 'text-button active', 'Drag the X, Y or Z handles')}${button('transform:scale', 'Resize', 'text-button', 'Drag the X, Y or Z handles')}</div><div class="station-tools" role="group" aria-label="Driver station"><span>Station</span>${([1, 2, 3] as const).map(n => `<button data-action="station:${n}" aria-label="Driver station ${n}" aria-pressed="${n === 2}">${n}</button>`).join('')}</div>${button('restart-drive','Restart','text-button restart-drive')}<span id="field-selection" class="selection-name"></span><button id="properties-show" class="secondary hidden" data-action="properties:show" aria-controls="properties-pane" aria-expanded="true">Inspector</button></div><div id="viewport"><div class="viewport-caption"><span class="view-tag" id="mode-tag">Edit</span></div><div class="runtime-hud" id="runtime-hud"><div><small>Pickups</small><strong id="hud-pickups">0</strong></div><div><small>Score</small><strong id="hud-score">0</strong></div></div><div class="viewport-hint" id="viewport-hint"></div></div><div class="drivebar"><div class="drive-keys" title="WASD: translate. Left/right arrows: rotate."><kbd>WASD</kbd><kbd>←/→</kbd></div><div id="action-controls"></div><span class="drive-note" id="drive-note"></span></div></section>
    <aside class="inspector" id="properties-pane" aria-label="Robot inspector"><section class="robot-section"><div class="panel-title"><div class="inspector-scopes">${button('scope:robot','Robot','scope-tab active')}${button('scope:field','Field','scope-tab')}<span id="sub-count" class="count"></span></div><button class="text-button" data-action="properties:hide" aria-controls="properties-pane" aria-expanded="true">Hide</button></div><div class="robot-structure"><button class="robot-row" data-select="robot"><span class="robot-icon">▧</span><strong>Robot basics</strong></button><div id="tree"></div></div><div class="robot-tools">${button('add', '＋ Subsystem', 'secondary')}${button('export', 'Export', 'text-button', 'Export robot JSON')}${button('import', 'Import', 'text-button', 'Import robot JSON')}</div></section><div class="panel-title properties-heading"><span>Robot</span></div><div id="inspector"></div></aside>
    <section class="graph-panel" aria-label="Travel Path view"><div class="graph-toolbar"><div class="graph-mode-tabs">${button('graph-mode:travel','Travel Path','text-button active')}${button('graph-mode:states','States','text-button')}</div><span id="graph-selection" class="selection-name"></span><div class="graph-actions">${button('add-graph', '＋ Module', 'text-button')}${button('connect', '＋ Connection', 'text-button')}${button('graph-out', '−', 'icon-button', 'Zoom out')}${button('graph-in', '＋', 'icon-button', 'Zoom in')}${button('graph-fit', 'Fit', 'text-button')}<button class="secondary inspector-show hidden" data-action="properties:show" aria-controls="properties-pane">Inspector</button></div></div><div id="graph"></div></section>
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
    const isLibrary=content.includes('library-header');
    $('#modal').classList.toggle('library-dialog',isLibrary);
    $('#tab-library').setAttribute('aria-selected',String(isLibrary));
    document.querySelectorAll<HTMLElement>('[data-action^="workspace:"]').forEach(tab=>tab.setAttribute('aria-selected',String(!isLibrary && tab.dataset.action==='workspace:'+activeView)));
    $('#modal-content').innerHTML = content;
    const d = $<HTMLDialogElement>('#modal');
    if (!d.open)
        d.showModal();
};
const close = () => $('#modal').hasAttribute('open') && $<HTMLDialogElement>('#modal').close();
const modalHead = (eyebrow: string, title: string) => `<div class="modal-header"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div>${button('close', '×', 'close-button', 'Close dialog')}</div>`;
const safeSaveDraft = () => {
    if(!robotEditable)return;
    try {
        saveDraft(doc);
    }
    catch {
        toast('Browser storage is full or unavailable. Export your robot JSON to keep it.');
    }
};
const commit = (change: (d: RobotDocument) => void) => {
    if (!robotEditable || mode !== 'edit') {
        toast('Duplicate this robot to make changes, or return to Edit.');
        return;
    }
    undo.push(clone(doc));
    if (undo.length > 60)
        undo.shift();
    redo = [];
    change(doc);
    snapDocumentInches(doc);
    syncDefaults(doc);
    syncSurfaceLinks(doc);
    for(const action of doc.surfaces)if(!doc.layout[action.id])doc.layout[action.id]=nextNodePosition(doc);
    simulationDirty = true;
    dirty = true;
    safeSaveDraft();
    render();
};
const select = (which: string) => {
    selected=which;stateEdgeSelection='';
    const stateSub=doc.subsystems.find(s=>s.states!.some(t=>t.id===which)),edgeSub=doc.subsystems.find(s=>s.stateTransitions!.some(e=>e.id===which));
    if(stateSub){selected=stateSub.id;stateOwner=stateSub.id;openStates[stateSub.id]=which;render();return;}
    if(edgeSub){selected=edgeSub.id;stateOwner=edgeSub.id;stateEdgeSelection=which;render();return;}
    const sub=doc.subsystems.find(s=>s.id===which),surface=doc.surfaces.find(s=>s.id===which);
    if(sub){stateOwner=sub.id;if(!(sub.id in openStates))openStates[sub.id]=sub.states!.find(s=>s.isDefault)!.id;}
    if(surface){stateOwner=surface.owner;openStates[surface.owner]=surface.stateId;}
    render();
};
const currentState=(sub:typeof doc.subsystems[number])=>sub.states!.find(s=>s.id===openStates[sub.id]) ?? sub.states!.find(s=>s.isDefault)!;
function stateGraphDocument():RobotDocument {
    const sub=doc.subsystems.find(s=>s.id===stateOwner);
    return {...doc,subsystems:(sub?.states ?? []).map(state=>({id:state.id,name:state.name,position:state.position,size:state.size,yaw:state.yaw,capacity:state.capacity,solid:!state.ignoreCollision})),surfaces:[],edges:(sub?.stateTransitions ?? []).map(e=>({...e,priority:0,concurrency:1})),layout:sub?.stateLayout ?? {}};
}
function selectGraph(which:string) {
    if(graphMode==='travel'){select(which);return;}
    const sub=doc.subsystems.find(s=>s.id===stateOwner);if(!sub)return;
    selected=sub.id;
    if(sub.states!.some(s=>s.id===which)){openStates[sub.id]=which;stateEdgeSelection='';}else stateEdgeSelection=which;
    render();
}
function assignFace(owner:string,face:Face,type:Surface['type']|'score') {
    if(type==='score'){const goal=doc.field!.scoringElements.find(g=>g.id===owner);if(!goal)return;if(goal.surfaces.some(s=>s.faces.includes(face))){toast('That face already has a scoring surface.');return;}commit(d=>{const g=d.field!.scoringElements.find(g=>g.id===owner)!;const surface={id:id(),name:g.name+' Surface',faces:[face],accepts:[...g.accepts]};g.surfaces.push(surface);selected=surface.id;});return;}

    const sub=doc.subsystems.find(s=>s.id===owner);if(!sub)return;
    const state=currentState(sub);
    if(doc.surfaces.some(s=>s.owner===owner&&s.stateId===state.id&&s.faces.includes(face))){toast('That face already has an action in this state.');return;}
    commit(d=>{const action={...createAction(sub,type,face),stateId:state.id};d.surfaces.push(action);d.layout[action.id]=nextNodePosition(d);selected=action.id;stateOwner=owner;openStates[owner]=state.id;});
}

let viewport: Viewport | undefined;
try {
    viewport = new Viewport($('#viewport'), (which, face) => {
        if (face) {
            selectedFace = face;
            toast(`${face} face selected. Assign an action in the inspector.`);
        }
        select(which);
    }, (position, size) => {
        if (mode !== 'edit')
            return;
        const b = { id: id(), name: 'New subsystem', position, size, yaw: 0, capacity: 1, solid: true };
        commit(d => { d.subsystems.push(b); d.layout[b.id] = nextNodePosition(d); selected = b.id; });
        drawing = false;
        viewport?.setDrawing(false);
        render();
    }, (which, position, size) => commit(d => {
        const goal=d.field?.scoringElements.find(g=>g.id===which),source=d.field?.sources.find(g=>g.id===which);if(goal){goal.position=position;goal.size=size;return;}if(source){source.position=position;return;}
        const block = d.subsystems.find(s => s.id === which);
        if (block) {
            const state=currentState(block);state.position=position;state.size=size;
        }
    }));
}
catch (e) {
    $('#viewport').insertAdjacentHTML('beforeend', `<div class="viewport-error"><h3>3D viewport unavailable</h3><p>Enable WebGL in a current desktop browser. The graph and numeric editor remain available.</p><small>${esc(e)}</small></div>`);
}
const graph = new GraphView($('#graph'), selectGraph, (which,p)=>commit(d=>{if(graphMode==='travel')d.layout[which]=p;else d.subsystems.find(s=>s.id===stateOwner)!.stateLayout![which]=p;}), (a,b,type)=>{
    if(graphMode==='travel'){addConnection(a,b,type);return;}
    const sub=doc.subsystems.find(s=>s.id===stateOwner);if(!sub||a===b||!sub.states!.some(s=>s.id===a)||!sub.states!.some(s=>s.id===b))return;
    if(sub.stateTransitions!.some(e=>e.source===a&&e.target===b)){toast('That state transition already exists.');return;}
    commit(d=>{const edge={id:id(),source:a,target:b,duration:.5,key:'u',trigger:'press' as const};d.subsystems.find(s=>s.id===stateOwner)!.stateTransitions!.push(edge);stateEdgeSelection=edge.id;selected=stateOwner;});
}, which=>{selectGraph(which);setPropertiesVisible(true);},(which,route)=>commit(d=>{const edges=graphMode==='travel'?d.edges:d.subsystems.find(s=>s.id===stateOwner)!.stateTransitions!;const edge=edges.find(e=>e.id===which);if(edge){if(route)edge.route=route;else delete edge.route;if(graphMode==='travel')selected=which;else stateEdgeSelection=which;}}));

new ActionBeam(root,()=>mode==='edit'&&activeView==='edit',(x,y)=>viewport?.actionTarget(x,y,(owner,face)=>{
    if(inspectorScope==='field'){const goal=doc.field!.scoringElements.find(g=>g.id===owner);return !!goal&&!goal.surfaces.some(s=>s.faces.includes(face));}
    const sub=doc.subsystems.find(s=>s.id===owner);return !!sub && !doc.surfaces.some(a=>a.owner===owner&&a.stateId===currentState(sub).id&&a.faces.includes(face));
}),target=>viewport?.highlightActionFace(target),on=>viewport?.setActionDragging(on),(target,type)=>assignFace(target.owner,target.face,type));
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
function load(next: RobotDocument, editable = !cloudEnabled() || (!sharedRevision(next.id) && !robotMetadata.has(next.id)) || robotMetadata.get(next.id)?.createdBy===signedInUser()?.sub, view: WorkspaceView = editable ? 'edit' : 'drive') {
    robotEditable=editable;
    if (mode !== 'edit')
        send({ type: 'pause' });
    mode = 'edit';
    doc = syncSurfaceLinks(ensureStates(snapDocumentInches(ensureField(clone(next)))));librarySeason=doc.seasonId;
    pendingPlay = false;
    stateEdgeSelection='';stateOwner='';
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
    setWorkspaceView(view);
    if(view==='drive')resumeDrive();
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
    viewport?.setFieldEditing(inspectorScope==='field'&&activeView==='edit');
    viewport?.setDocument(activeView==='drive'?doc:previewDocument(doc,openStates), selected);
    if (mode !== 'edit' && snapshot)
        viewport?.update(snapshot);
    if (viewport)
        viewport.setEditing(robotEditable && mode === 'edit' && activeView === 'edit');
    $('.graph-panel').setAttribute('aria-label',graphMode==='states'?'Subsystem states view':'Travel Path view');
    graph.nodeTypeLabel=graphMode==='states'?'State':'Subsystem';
    graph.defaultStateId=graphMode==='states'?(doc.subsystems.find(s=>s.id===stateOwner)?.states?.find(t=>t.isDefault)?.id ?? ''):'';
    graph.set(graphMode==='states'?stateGraphDocument():doc,graphMode==='states'?(stateEdgeSelection||openStates[stateOwner]||''):selected,mode==='edit');
    document.querySelectorAll<HTMLElement>('[data-action^="graph-mode:"]').forEach(el=>el.classList.toggle('active',el.dataset.action==='graph-mode:'+graphMode));
    if (snapshot && mode !== 'edit')
        graph.update(snapshot);
    updateRuntime();
}
function renderShell() {
    $('#tab-edit').classList.toggle('hidden',!robotEditable);
    $('#tab-graph').classList.toggle('hidden',!robotEditable);
    $('.project-actions').querySelectorAll<HTMLElement>('[data-action=save],[data-action=undo],[data-action=redo]').forEach(b=>b.classList.toggle('hidden',!robotEditable));
    const sourceSelected=inspectorScope==='field'&&doc.field!.sources.some(s=>s.id===selected);if(sourceSelected&&transformMode==='scale'){transformMode='translate';viewport?.setTransformMode('translate');}
    $('#robot-title').textContent = doc.name;
    $('#save-status').textContent = saving ? 'Saving…' : dirty ? (cloudEnabled() ? 'Unsynced' : 'Draft') : cloudEnabled() ? (sharedRevision(doc.id) ? `Saved · rev ${sharedRevision(doc.id)}` : 'Local draft') : 'Saved';
    $<HTMLButtonElement>('[data-action="save"]').disabled = !robotEditable || mode !== 'edit' || saving;
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
    const actions = driveBindings(doc);
    $('#action-controls').innerHTML = actions.map(({key,label}) => `<button class="action-control" data-hold="${esc(key)}" ${mode === 'edit' || isReplay ? 'disabled' : ''}><kbd>${esc(bindingLabel(key))}</kbd>${esc(label)}</button>`).join('');
    $('#action-controls').querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b => {
        b.addEventListener('pointerdown', e => { virtual.add(b.dataset.hold!); b.setPointerCapture(e.pointerId); b.classList.add('held'); sendControls(); });
        const release = () => { virtual.delete(b.dataset.hold!); b.classList.remove('held'); sendControls(); };
        b.addEventListener('pointerup', release);
        b.addEventListener('pointercancel', release);
    });
    const issues = validate(doc), errors = issues.filter(i => i.level === 'error').length;
    $('#validation-summary').innerHTML = `<span class="${errors ? 'error-text' : 'valid-text'}">${errors ? '⚠ ' + errors + ' errors' : '✓ Valid'}</span>`;
    if(sourceSelected)$<HTMLButtonElement>('[data-action="transform:scale"]').disabled=true;
    $('#sub-count').textContent=String(inspectorScope==='field'?doc.field!.scoringElements.length:doc.subsystems.length);
    document.querySelectorAll<HTMLElement>('[data-action^="scope:"]').forEach(el=>el.classList.toggle('active',el.dataset.action==='scope:'+inspectorScope));
    $('[data-select="robot"] strong').textContent=inspectorScope==='field'?'Field overview':'Robot basics';
    $('[data-action="add"]').textContent=inspectorScope==='field'?'＋ Scoring element':'＋ Subsystem';
}
function renderTree() {
    if(inspectorScope==='field'){$('#tree').innerHTML=fieldTree(doc,selected);return;}
    $('[data-select="robot"]').classList.toggle('selected', selected === doc.id);
    $('#tree').innerHTML = subsystemTree(doc).map(({subsystem:sub,states})=>`<div class="tree-group"><button class="tree-row ${selected===sub.id?'selected':''}" data-select="${esc(sub.id)}"><span class="cube-icon">◇</span><span>${esc(sub.name)}</span><small>${sub.capacity}</small></button>${states.map(({state,actions})=>`<div class="tree-state-group"><button class="tree-state ${selected===sub.id&&openStates[sub.id]===state.id?'selected':''}" data-select="${esc(state.id)}" aria-label="${esc(sub.name+' / '+state.name)}"><span class="state-marker">${state.isDefault?'●':'◇'}</span><span>${esc(state.name)}</span></button>${actions.map(action=>`<button class="tree-surface tree-action ${selected===action.id?'selected':''}" data-select="${esc(action.id)}" aria-label="${esc(sub.name+' / '+state.name+' / '+action.name)}"><i class="swatch ${action.type}"></i><span>${esc(action.name)}</span></button>`).join('')}</div>`).join('')}</div>`).join('');
}
const bindingField = (path: string, value: string) => `<label class="field"><span>Key</span><button type="button" aria-label="Key binding ${esc(bindingLabel(value))}" title="Click, then press a keyboard key or gamepad control" class="binding-capture ${capturingBinding?.id === selected && capturingBinding.path === path ? 'recording' : ''}" data-bind="${path}" ${mode !== 'edit' ? 'disabled' : ''}>${capturingBinding?.id === selected && capturingBinding.path === path ? 'Press a key or gamepad control…' : esc(bindingLabel(value))}</button></label>`;
const field = (label: string, key: string, value: string | number, type = 'number', step = '0.01', help = '') => `<label class="field"><span>${label}</span><input data-field="${key}" type="${type}" value="${esc(typeof value === 'number' ? displayValue(key, value) : value)}" step="${propertyStep(key,step)}" ${key==='sub.targetingFreedom'?'min="0" max="360"':inchProperty(key)?inchInputLimits(key):''} ${mode !== 'edit' ? 'disabled' : ''} />${help ? `<small>${help}</small>` : ''}</label>`;
const dropdown = (label: string, key: string, value: string, options: [
    string,
    string
][]) => `<label class="field"><span>${label}</span><select data-field="${key}" ${mode !== 'edit' ? 'disabled' : ''}>${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const typeField=(path:string,types:string[])=>{const all=pieceTypesFor(doc),options:[string,string][]=all.map(p=>[p.id,p.name]);if(all.length>1)options.unshift([all.map(p=>p.id).join(','),all.map(p=>p.name).join(' + ')]);return dropdown('Accepted game pieces',path,types.join(','),options);};
const section = (name: string, content: string) => `<section class="inspector-section"><h3>${name}</h3>${content}</section>`;
const vectorFields = (label: string, key: string, value: Vec3) => `<div class="vector-label">${label}</div><div class="three-fields">${value.map((n, i) => field(['X', 'Y', 'Z'][i], `${key}.${i}`, n).replace('class="field"','class="field axis-field"')).join('')}</div>`;
function renderInspector() {
    const sub = doc.subsystems.find(s => s.id === selected), surface = doc.surfaces.find(s => s.id === selected), edge = doc.edges.find(e => e.id === selected);
    if(sub){stateOwner=sub.id;if(!(sub.id in openStates))openStates[sub.id]=sub.states!.find(s=>s.isDefault)!.id;}
    const contextSub=sub ?? (surface?doc.subsystems.find(s=>s.id===surface.owner):edge?doc.subsystems.find(s=>s.id===surfaceForEdge(doc,edge)?.owner):undefined);
    const heading=$('.properties-heading');
    heading.innerHTML=contextSub?`<input id="inspector-name" aria-label="Subsystem name" type="text" maxlength="100" value="${esc(contextSub.name)}" ${mode!=='edit'?'disabled':''}/>`:`<span>${edge?'Transition':'Robot'}</span>`;
    const nameInput=heading.querySelector<HTMLInputElement>('#inspector-name');
    nameInput?.addEventListener('change',()=>{
        const name=nameInput.value.trim();if(!name){toast('Subsystem name is required.');nameInput.value=contextSub!.name;return;}
        if(name!==contextSub!.name)commit(d=>{d.subsystems.find(s=>s.id===contextSub!.id)!.name=name;});
    });
    nameInput?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();nameInput.blur();}if(event.key==='Escape'){nameInput.value=contextSub!.name;nameInput.blur();}});
    let html = '';
    if (mode !== 'edit')
        html += '<div class="read-only-note">Design locked during run. Return to Edit to make changes.</div>';
    if(inspectorScope==='field') {
        html+=fieldInspector(doc,selected,{field,vector:vectorFields,section,dropdown,types:typeField,button});
        const goal=doc.field!.scoringElements.find(g=>g.id===selected||g.surfaces.some(s=>s.id===selected)),source=doc.field!.sources.find(g=>g.id===selected),context=goal ?? source;
        heading.innerHTML=context?`<input id="inspector-name" aria-label="Field element name" value="${esc(context.name)}" maxlength="100" ${mode!=='edit'?'disabled':''}/>`:'<span>Field</span>';
        const fieldName=heading.querySelector<HTMLInputElement>('input');fieldName?.addEventListener('change',()=>{const name=fieldName.value.trim();if(!name){toast('A field element name is required.');fieldName.value=context!.name;return;}commit(d=>{(d.field!.scoringElements.find(g=>g.id===context!.id) ?? d.field!.sources.find(g=>g.id===context!.id))!.name=name;});});fieldName?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();fieldName.blur();}if(event.key==='Escape'){fieldName.value=context!.name;fieldName.blur();}});
    }
    else if (sub && stateEdgeSelection) {
        const edge=sub.stateTransitions!.find(e=>e.id===stateEdgeSelection);
        if(edge)html+=section('State transition',`<div class="route-card">${esc(sub.states!.find(s=>s.id===edge.source)?.name)} → ${esc(sub.states!.find(s=>s.id===edge.target)?.name)}</div>`+bindingField('stateEdge.key',edge.key)+dropdown('Trigger','stateEdge.trigger',edge.trigger,TRIGGER_OPTIONS)+field('Transition time · s','stateEdge.duration',edge.duration)+button('delete-state-edge','Remove transition','danger wide'));
    }
    else if (sub) {
        html+=section('Targeting',dropdown('Targeting Mode','sub.targetingMode',sub.targetingMode ?? 'manual',TARGETING_OPTIONS)+(isTurretMode(sub.targetingMode)?field('Degrees of freedom · degrees','sub.targetingFreedom',sub.targetingFreedom ?? DEFAULT_TARGETING_FREEDOM,'number','1','Total rotation range, split equally around startup yaw.'):''));
        html+=`<div class="states-list">${sub.states!.map(state=>{
            const open=openStates[sub.id]===state.id;
            return `<section class="state-section"><button class="state-toggle" data-action="toggle-state:${esc(state.id)}" aria-expanded="${open}"><span>${open?'▾':'▸'} ${esc(state.name)}</span>${state.isDefault?'<small>Default</small>':''}</button>${open?`<div class="state-properties"><label class="check-field"><input type="checkbox" data-default-state="${esc(state.id)}" ${state.isDefault?'checked':''} ${mode!=='edit'?'disabled':''}/><span>Is default state</span></label>${field('State name','state.name',state.name,'text')}${vectorFields('Position · in','state.position',state.position)}${vectorFields('Dimensions · in','state.size',state.size)}${field('Yaw · degrees','state.yaw',state.yaw)}${field('Pitch · degrees','state.pitch',state.pitch)}${field('Roll · degrees','state.roll',state.roll)}${field('Total capacity · pieces','state.capacity',state.capacity,'number','1')}<label class="check-field"><input data-field="state.ignoreCollision" type="checkbox" ${state.ignoreCollision?'checked':''} ${mode!=='edit'?'disabled':''}/><span>Ignore collision</span></label><h3>Action surfaces</h3><p class="help-text">Drag and drop to target surface</p><div class="two-buttons"><button class="secondary" type="button" data-drag-action="intake" ${activeView!=='edit'||mode!=='edit'?'disabled':''}>＋ Intake</button><button class="secondary" type="button" data-drag-action="outtake" ${activeView!=='edit'||mode!=='edit'?'disabled':''}>＋ Outtake</button></div>${doc.surfaces.filter(a=>a.owner===sub.id&&a.stateId===state.id).map(a=>`<button class="state-action-row" data-select="${esc(a.id)}">${esc(a.name)} · ${a.type}</button>`).join('')}${button('remove-state:'+state.id,'Remove state','danger wide')}</div>`:''}</section>`;
        }).join('')}</div>${button('add-state','＋ Add state','secondary wide add-state')}`;
        html+=section('Subsystem actions',`<div class="two-buttons">${button('duplicate','Duplicate','secondary')}${button('delete','Remove','danger')}</div>`);
    }
    else if (surface) {
        html += section('Action surface', field('Name', 'surface.name', surface.name, 'text') + typeField('surface.accepts',acceptedTypes(doc,surface)) + dropdown('Type', 'surface.type', surface.type, [['intake', 'Intake · blue'], ['outtake', 'Outtake · red']]) + `<p class="help-text">Owner: ${esc(nodeName(doc, surface.owner))}</p>`);
        html += section('Face group', `<div class="face-grid">${FACES.map(f => { const taken = doc.surfaces.some(s => s.id !== surface.id && s.owner === surface.owner && s.stateId===surface.stateId && s.faces.includes(f)); return `<label class="face-check ${taken ? 'unavailable' : ''}"><input type="checkbox" data-face="${f}" ${surface.faces.includes(f) ? 'checked' : ''} ${taken || mode !== 'edit' ? 'disabled' : ''}/>${f}</label>`; }).join('')}</div><p class="help-text">Faces share one action state. Each face can belong to only one group.</p>`);
        html += section('Action rate', field('Minimum interval · s', 'surface.interval', surface.interval) + doc.edges.filter(e=>surfaceForEdge(doc,e)?.id===surface.id).map(e=>button('edit-transition:'+e.id,(pieceTypesFor(doc).find(p=>p.id===e.pieceType)?.name ?? '')+' transition','secondary wide')).join(''));
        if (surface.type === 'outtake')
            html += section('Launch configuration', dropdown('Release face', 'releaseFace', surface.faces[0] ?? '+X', surface.faces.map(f => [f, f])) + field('Exit speed · m/s', 'surface.speed', surface.speed) + `<div class="vector-label">Simultaneous game piece outtake</div><div class="two-buttons">${field('Units X · across', 'surface.unitsX', surface.unitsX ?? 1, 'number', '1')}${field('Units Y · up', 'surface.unitsY', surface.unitsY ?? 1, 'number', '1')}</div>` + field('Local yaw · degrees', 'surface.yaw', surface.yaw) + field('Local pitch · degrees', 'surface.pitch', surface.pitch) + vectorFields('Exit angular velocity · deg/s', 'surface.spin', surface.spin) + `<p class="help-text">Yaw/pitch use the subsystem frame (+X at zero). Robot point velocity and angular velocity are added at release. Ball orientation has no aerodynamic effect.</p>`);
        html += section('Surface actions', button('delete', 'Delete action surface', 'danger wide'));
    }
    else if (edge) {
        const action = surfaceForEdge(doc, edge);
        html += section(action ? 'Action transition' : 'Directed transfer', `<div class="route-card"><span>${esc(nodeName(doc, edge.source))}</span><span class="muted">to</span><span>${esc(nodeName(doc, edge.target))}</span></div>` + field('Travel time · s', 'edge.duration', edge.duration) + `<p class="help-text">${edge.duration === 0 ? 'Instant · no delay.' : `Effective: ${ticksFor(edge.duration)} ticks · ${(ticksFor(edge.duration) * DT).toFixed(4)} s at 120 Hz.`}</p>`);
        html += section('Scheduling', (action?'<p class="help-text">'+esc(pieceTypesFor(doc).find(p=>p.id===edge.pieceType)?.name ?? pieceTypesFor(doc)[0].name)+'</p>':dropdown('Game piece','edge.pieceType',edge.pieceType ?? pieceTypesFor(doc)[0].id,pieceTypesFor(doc).map(p=>[p.id,p.name]))) + bindingField('edge.key', edge.key) + dropdown('Trigger', 'edge.trigger', edge.trigger, TRIGGER_OPTIONS) + (action ? '' : field('Priority · higher first', 'edge.priority', edge.priority, 'number', '1') + field('Concurrent pieces', 'edge.concurrency', edge.concurrency, 'number', '1')) + `<p class="help-text">Transitions finish after the key is released. Use 0 seconds for instant action transitions. A cross-subsystem transfer reserves its destination slot and keeps source ownership until delivery.</p>`);
        const metric = snapshot?.edgeMetrics[edge.id];
        if (metric)
            html += section('Last run', `<dl class="metric-list"><dt>Completed deliveries</dt><dd>${metric.deliveries}</dd><dt>Capacity blocked</dt><dd>${(metric.capacityTicks * DT).toFixed(2)} s</dd><dt>Waiting for input</dt><dd>${(metric.inputTicks * DT).toFixed(2)} s</dd><dt>Throughput</dt><dd>${(metric.deliveries / Math.max(DT, snapshot!.tick * DT)).toFixed(2)} /s</dd></dl>`);
        if (!action) html += section('Connection actions', button('delete', 'Remove connection', 'danger wide'));
    }
    else if (selected === '@connect') {
        const nodes = doc.subsystems;
        html += section('New connection', `<form id="connection-form">${dropdown('Game piece','new.pieceType',pieceTypesFor(doc)[0].id,pieceTypesFor(doc).map(p=>[p.id,p.name])).replace('data-field="new.pieceType"','name="pieceType"')}<label class="field"><span>Source</span><select name="source">${nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('')}</select></label><label class="field"><span>Destination</span><select name="target">${nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('')}</select></label><button class="primary wide" type="submit">Create connection</button></form><p class="help-text">Connect subsystems here or drag between their ports. Action links are automatic.</p>`);
    }
    else {
        const b = doc.basics;
        html += section('Robot basics', field('Robot name', 'robot.name', doc.name, 'text') + `<div class="robot-meta"><span>Revision ${doc.revision}</span><span>${esc(seasonFor(doc.seasonId).title)}</span></div>`);
        html += section('Chassis envelope', field('Length · X · in', 'basics.length', b.length) + field('Width · Y · in', 'basics.width', b.width) + field('Height · Z · in', 'basics.height', b.height) + field('Mass · lb', 'basics.mass', b.mass));
        html += section('Planar drivetrain', field('Wheel diameter · in', 'basics.wheelDiameter', b.wheelDiameter) + field('Drive reduction', 'basics.reduction', b.reduction, 'number', '.01', 'Motor revolutions per wheel revolution.') + field('Motor free speed · rpm', 'basics.motorRPM', b.motorRPM, 'number', '1') + `<div class="speed-estimate"><small>Theoretical free speed</small><strong>${displayValue('basics.loadedSpeed', freeSpeed(doc)).toFixed(2)} <span>m/s</span></strong></div>` + field('Loaded speed · m/s', 'basics.loadedSpeed', b.loadedSpeed) + field('Acceleration / deceleration · m/s²', 'basics.acceleration', b.acceleration) + field('Max angular speed · deg/s', 'basics.angularSpeed', b.angularSpeed) + `<p class="help-text">Starting estimates. Module positions use the four chassis corners. Angular acceleration is fixed at 343.77 deg/s². This model does not estimate traction, current, battery sag, or tipping.</p>`);
    }
    $('#inspector').innerHTML = html;
    $('#inspector').querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(el => el.addEventListener('change', () => {
        const path = el.dataset.field!;
        if(path==='scoreSurface.name'&&!el.value.trim()){toast('A scoring surface name is required.');renderInspector();return;}
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
        if(path.endsWith('.accepts'))value=String(value).split(',');
        if(path==='source.enabled')value=value==='true';
        if (path.endsWith('.key'))
            value = normalizeBinding(String(value)) ?? '';
        if (typeof value === 'number') {
            const typed=value;value=storedValue(path,value);
            if(path.startsWith('bounce.'))value=Math.max(0,Math.min(1,value as number));
            if(path==='goal.points')value=Math.round(Math.max(0,Math.min(1000,value as number)));
            if(path==='goal.capacity')value=Math.round(Math.max(1,Math.min(1000,value as number)));
            if(path==='source.cooldown')value=Math.max(.1,Math.min(300,value as number));
            if(path.startsWith('source.velocity.'))value=Math.max(-20,Math.min(20,value as number));
            if(path==='sub.targetingFreedom')value=Math.max(0,Math.min(2*Math.PI,value as number));
            if(inchProperty(path)&&Math.abs(displayValue(path,value as number)-typed)>1e-7)toast(`Rounded to ${displayValue(path,value as number)} in · 0.5-inch grid.`);
        }
        commit(d => {
            if (path === 'releaseFace') {
                const s = d.surfaces.find(s => s.id === selected)!;
                s.faces = [value as Face, ...s.faces.filter(f => f !== value)];
                return;
            }
            const [kind, ...parts] = path.split('.');
            let target: any = kind==='bounce'?d.field!.bounciness:kind==='goal'?d.field!.scoringElements.find(g=>g.id===selected):kind==='source'?d.field!.sources.find(g=>g.id===selected):kind==='scoreSurface'?d.field!.scoringElements.flatMap(g=>g.surfaces).find(s=>s.id===selected):kind === 'robot' ? d : kind === 'basics' ? d.basics : kind === 'sub' ? d.subsystems.find(s => s.id === selected) : kind === 'surface' ? d.surfaces.find(s => s.id === selected) : kind === 'state' ? currentState(d.subsystems.find(s=>s.id===selected)!) : kind === 'stateEdge' ? d.subsystems.find(s=>s.id===selected)!.stateTransitions!.find(e=>e.id===stateEdgeSelection) : d.edges.find(e => e.id === selected);
            for (const p of parts.slice(0, -1))
                target = target[p];
            target[parts.at(-1)!] = value;
            if(kind==='goal'&&parts[0]==='accepts')for(const surface of target.surfaces){surface.accepts=surface.accepts.filter((t:string)=>target.accepts.includes(t));if(!surface.accepts.length)surface.accepts=[target.accepts[0]];}
        });
    }));
    $('#inspector').querySelectorAll<HTMLInputElement>('[data-face]').forEach(el => el.addEventListener('change', () => commit(d => { const s = d.surfaces.find(s => s.id === selected)!, f = el.dataset.face as Face; s.faces = el.checked ? [...s.faces, f] : s.faces.filter(a => a !== f); })));
    $('#inspector').querySelectorAll<HTMLInputElement>('[data-score-face]').forEach(el=>el.addEventListener('change',()=>commit(d=>{const goal=d.field!.scoringElements.find(g=>g.surfaces.some(s=>s.id===selected))!,surface=goal.surfaces.find(s=>s.id===selected)!,face=el.dataset.scoreFace as Face;if(!el.checked&&surface.faces.length===1){toast('A scoring surface must have at least one face.');return;}if(el.checked&&goal.surfaces.some(s=>s.id!==selected&&s.faces.includes(face))){toast('That face already has a scoring surface.');return;}surface.faces=el.checked?[...surface.faces,face]:surface.faces.filter(f=>f!==face);})));
    $('#inspector').querySelectorAll<HTMLInputElement>('[data-default-state]').forEach(el=>el.addEventListener('change',()=>{
        const sub=doc.subsystems.find(s=>s.id===selected)!;
        if(!el.checked){toast('A subsystem must have a default state. Choose another default before removing this one.');renderInspector();return;}
        const before=sub.states!.find(s=>s.isDefault)!;
        commit(d=>{for(const state of d.subsystems.find(s=>s.id===selected)!.states!)state.isDefault=state.id===el.dataset.defaultState;});
        toast(`Default changed from ${before.name}. This replaces the previous default; it does not add another.`);
    }));
    $('#connection-form')?.addEventListener('submit', e => { e.preventDefault(); const form = new FormData(e.target as HTMLFormElement); addConnection(String(form.get('source')),String(form.get('target')),String(form.get('pieceType'))); });
}
function addConnection(source:string,target:string,pieceType=pieceTypesFor(doc)[0].id) {
    if (doc.surfaces.some(s => s.id === source || s.id === target)) {
        toast('Action links are permanent. Select the transition to change its binding or time.');
        return;
    }
    if (!validConnection(doc, source, target)) {
        toast('That connection is unsupported. Connect intake → owner, subsystem → subsystem, or owner → outtake.');
        return;
    }
    if (doc.edges.some(e => e.source===source&&e.target===target&&(e.pieceType ?? pieceTypesFor(doc)[0].id)===pieceType)) {
        toast('That route already exists. Select it to edit.');
        return;
    }
    commit(d => { const e = { id: id(), source, target,pieceType,duration: .25, key: 'j', trigger: 'hold' as const, priority: 0, concurrency: 1 }; d.edges.push(e); selected = e.id; });
}
function updateRuntime() {
    const s = snapshot;
    $('#hud-pickups').textContent = String(s?.pickups ?? 0);
    $('#hud-score').textContent = String(s?.score ?? 0);
    $('#runtime-status').textContent = mode === 'edit' ? '' : s?.slow ? 'Simulation running slower' : s?.blocked[0] ?? `${mode === 'running' ? 'Running' : 'Paused'} · ${s?.tokens.length ?? 0} internal`;
    $('#runtime-status').classList.toggle('warning-text', !!s?.blocked.length || !!s?.slow);
}
function showValidation() { const issues = validate(doc); modal(modalHead('Design check', 'Validation & model scope') + `<div class="modal-body"><div class="notice">Fix errors before driving. Model notes describe the limits of this offline prototype.</div><div class="issue-list">${issues.map(i => `<button class="issue ${i.level}" data-issue="${esc(i.object)}"><span>${i.level === 'error' ? '⚠' : 'ⓘ'}</span><div><strong>${i.level === 'error' ? 'Fix required' : 'Model note'}</strong><p>${esc(displayIssue(i.message))}</p></div></button>`).join('')}</div></div>`); }
const libraryHeader=()=>`<div class="modal-header library-header"><h2>Robot library</h2><div class="library-header-actions">${button('new','＋ New robot','primary')}${button('close','×','close-button','Close library')}</div></div>`;
const libraryToolbar=()=>`<div class="library-toolbar"><label class="field"><span>Season</span><select id="new-season" aria-label="Season">${seasons.map(s=>`<option value="${s.id}" ${s.id===librarySeason?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label></div>`;
const updatedLabel=(date:string)=>esc(new Date(date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));
function libraryCard(r:{id:string;name:string;updated:string},creator:string,editable:boolean,preview:string) {
    return `<article class="robot-card"><div class="card-preview" data-preview="${esc(r.id)}">${preview}</div><h3>${esc(r.name)}</h3><p class="card-creator">By ${esc(creator)}</p><p class="card-updated">Updated ${updatedLabel(r.updated)}</p><div class="card-footer">${editable?button('edit:'+r.id,'Edit','secondary'):''}${button('open:'+r.id,'Drive','primary')}${button('copy:'+r.id,'Duplicate','text-button')}</div></article>`;
}
function showLocalLibrary() {
    const robots=readRobots().filter(r=>r.document.seasonId===librarySeason);
    modal(libraryHeader()+`<div class="modal-body">${libraryToolbar()}<div class="library-grid">${robots.map(r=>libraryCard({id:r.document.id,name:r.document.name,updated:r.updated},'You',true,robotPreview(r.document))).join('')}</div>${!robots.length?'<p class="library-empty">Create your first robot to get started.</p>':''}</div>`);
}
let cloudRows: RobotSummary[] = [], libraryCursor: string|undefined, libraryRequest=0;
$<HTMLDialogElement>('#modal').addEventListener('close',()=>{libraryRequest++;$('#tab-library').setAttribute('aria-selected','false');document.querySelectorAll<HTMLElement>('[data-action^="workspace:"]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.action==='workspace:'+activeView)));});
const previewCache=new Map<string,{revision:number;svg:string}>();
async function showLibrary(more = false) {
    const request=++libraryRequest;
    if (!cloudEnabled()) { showLocalLibrary(); return; }
    modal(libraryHeader() + '<div class="modal-body">Loading…</div>');
    try {
        const page = await cloudLibrary(more ? libraryCursor : undefined,librarySeason);
        if(request!==libraryRequest)return;
        cloudRows = more ? [...cloudRows, ...page.items] : page.items;
        libraryCursor = page.cursor;
        cloudRows.forEach(r=>robotMetadata.set(r.id,r));
        modal(libraryHeader() + `<div class="modal-body">${libraryToolbar()}<div class="library-grid">${cloudRows.map(r => libraryCard(r,r.creatorName || (r.createdBy===signedInUser()?.sub?signedInUser()!.name:'Unknown creator'),r.createdBy===signedInUser()?.sub,previewCache.get(r.id)?.revision===r.revision?previewCache.get(r.id)!.svg:'<span>Loading preview…</span>')).join('')}</div>${libraryCursor ? button('library-more', 'Load more', 'secondary') : ''}${!cloudRows.length ? '<p class="library-empty">Create your first robot to get started.</p>' : ''}</div>`);
        await Promise.allSettled(cloudRows.map(async r=>{
            if(previewCache.get(r.id)?.revision===r.revision)return;
            let svg:string;
            try{const robot=await cloudRobot(r.id);svg=robotPreview(robot);previewCache.set(r.id,{revision:robot.revision,svg});}
            catch{svg='<span>Preview unavailable</span>';}
            if(request!==libraryRequest)return;
            const target=Array.from(document.querySelectorAll<HTMLElement>('[data-preview]')).find(el=>el.dataset.preview===r.id);
            if(target)target.innerHTML=svg;
        }));
    } catch (e) {if(request===libraryRequest)modal(libraryHeader() + `<div class="modal-body"><p>${esc(e instanceof Error ? e.message : 'Unable to load robots.')}</p>${button('library', 'Retry', 'secondary')}</div>`);}
}
function rememberRevision(document: RobotDocument) {
    trackRevision(document.id, document.revision);
    try {writeCloudRevision(document.id, document.revision);} catch {toast('Shared save succeeded. Local recovery storage is unavailable.');}
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
function currentRun(): SavedRun | undefined {
    if (!snapshot || snapshot.tick === 0 || !runDocument)
        return;
    return { id: activeRunId, name: runDocument.name, created: new Date().toISOString(), document: clone(runDocument), snapshot: clone(snapshot), replay: isReplay, engine: ENGINE_VERSION, season: seasonFor(runDocument.seasonId).version };
}
function resultCard(run: SavedRun) { const s = run.snapshot, seconds = s.tick * DT; return `<div class="result-card"><div class="eyebrow">${run.replay ? 'RECORDED INPUT RE-SIMULATION' : 'MANUAL · DRIVER-DEPENDENT'}</div><h3>${esc(run.name)}</h3><p class="help-text">Robot rev ${run.document.revision} · ${seconds.toFixed(2)} s</p><div class="result-metrics"><div><span>Score</span><strong>${s.score}</strong></div><div><span>Pickups</span><strong>${s.pickups}</strong></div><div><span>Releases</span><strong>${s.releases}</strong></div><div><span>Scored / released</span><strong>${s.scored} / ${s.releases}</strong></div><div><span>Mean intake-to-release</span><strong>${s.cycles.length ? average(s.cycles).toFixed(2) + ' s' : '—'}</strong></div><div><span>Release throughput</span><strong>${(s.releases / Math.max(seconds, DT)).toFixed(2)} /s</strong></div></div><p class="help-text">${s.scored} pieces stored in scoring elements. Each accepted piece scores once on contact.</p><p class="result-version">Engine ${esc(run.engine)} · Rapier 0.21.0 · Practice ${esc(run.season)} · Experimental fixture</p></div>`; }
function showResults() {
    const current = currentRun(), saved = readRuns();
    const runs = current ? [current, ...saved.filter(r => r.id !== current.id)] : saved;
    modal(modalHead('Engineering outputs', 'Run results') + `<div class="modal-body results-body">${runs.length ? `<div class="results-toolbar">${button('save-run', 'Save current run', 'primary')}${button('csv', 'Export metrics CSV', 'secondary')}${button('run-json', 'Export run JSON', 'secondary')}</div><div class="comparison-selectors"><label class="field"><span>Run A</span><select id="compare-a">${runs.map((r, i) => `<option value="${i}">${i === 0 && current ? 'Current · ' : ''}${esc(r.name)} · rev ${r.document.revision} · ${(r.snapshot.tick * DT).toFixed(1)} s</option>`).join('')}</select></label><label class="field"><span>Run B</span><select id="compare-b"><option value="-1">Select a saved run to compare</option>${runs.map((r, i) => `<option value="${i}">${esc(r.name)} · rev ${r.document.revision} · ${(r.snapshot.tick * DT).toFixed(1)} s</option>`).join('')}</select></label></div><div id="comparison" class="comparison"></div><div id="edge-results"></div><div class="results-toolbar">${button('replay', 'Re-run recorded inputs from A', 'secondary')}</div><div class="notice">Runs use their saved season and field settings. Manual runs depend on the driver. Re-simulation uses the original robot snapshot and tick-indexed inputs; repeatability is limited to this tested engine/build. Parameters are estimates. No drag, spin lift, flexible pieces, tipping, official FRC rules, or articulated mechanisms are modeled.</div>` : `<div class="empty-state"><div class="empty-icon">◷</div><h3>Make your first run</h3><p>Open Drive, collect balls, and launch toward the target. Your measurements will appear here.</p>${button('close', 'Back to workspace', 'primary')}</div>`}</div>`);
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
function help() { modal(modalHead('HELP', 'PolySim') + `<div class="modal-body help-body"><div class="help-steps"><div><h3>Edit</h3><p>Select a box and drag its Move or Resize handles. The right inspector contains dimensions, capacity, faces and bindings. Hide expands the editor; Inspector restores the pane.</p></div><div><h3>Graph</h3><p>Nodes snap to the dot grid. Drag from an output port onto a destination. Select a connection and drag its highlighted segments to organize the route; Reset route restores automatic routing. Select any module or connection to edit it in the inspector.</p></div><div><h3>Drive</h3><p>Choose driver station 1, 2 or 3. The camera stays behind the station and smoothly tracks the robot. WASD moves; left/right arrows rotate. Opening Drive starts play automatically. Leaving Drive pauses play.</p></div></div><p>Click a key binding, then press a keyboard key, gamepad button, trigger, or stick direction. Gamepad labels use the standard controller layout. Yellow fills each box from the bottom according to owned inventory and capacity.</p><p>Save keeps robots in this browser. Export creates a JSON backup.</p><details class="event-details"><summary>Model limits</summary><p>Estimated practice fixture. No official FRC rules, drag, traction, tipping, articulated mechanisms or cloud sharing. Full assumptions appear in Results and the offline documentation.</p></details>${button('close', 'Close', 'primary')}</div>`); }
function removeSelected() {
    if(inspectorScope==='field'){$('#inspector').querySelector<HTMLButtonElement>('[data-action="field:delete"]')?.click();return;}
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
let padControls=gamepadControls();
function captureKey(key:string){
    const capture=capturingBinding;if(!capture)return;capturingBinding=undefined;
    commit(d=>{const item=capture.path==='stateEdge.key'?d.subsystems.find(s=>s.id===capture.id)?.stateTransitions?.find(e=>e.id===stateEdgeSelection):d.edges.find(e=>e.id===capture.id);if(item)item.key=key;});
}
function sendControls() {
    if (mode === 'edit' || isReplay || !workerReady)
        return;
    const {x, y, turn} = keyboardDrive(keys);
    const input: Controls = { x: padControls.x || x, y: padControls.y || y, turn: padControls.turn || turn, held: [...new Set([...keys, ...virtual, ...gamepadHeldBindings(doc,padControls.held)])].filter(k => !!normalizeBinding(k)).sort() };
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
    if(action.startsWith('scope:')){inspectorScope=action==='scope:field'?'field':'robot';selected=doc.id;if(activeView!=='edit')setWorkspaceView('edit');render();return;}
    if(action.startsWith('field:') || action==='add'&&inspectorScope==='field'){
        if(mode!=='edit'){toast('Return to Edit to change the field.');return;}
        if(action==='field:add-goal'||action==='add'){commit(d=>{const goal={id:id(),name:'Scoring element',position:[seasonFor(d.seasonId).start[0],1.5,.5] as Vec3,size:[.3048,.3048,.3048] as Vec3,yaw:0,pitch:0,roll:0,points:1,capacity:1,accepts:pieceTypesFor(d).map(p=>p.id),surfaces:[]};d.field!.scoringElements.push(goal);selected=goal.id;});return;}
        if(action==='field:add-source'){commit(d=>{const source={id:id(),name:'Human-player release',position:[seasonFor(d.seasonId).start[0],1.5,1] as Vec3,velocity:[0,0,-1] as Vec3,pieceType:pieceTypesFor(d)[0].id,enabled:true,mode:'proximity' as const,proximity:1.5,cooldown:1.5};d.field!.sources.push(source);selected=source.id;});return;}
        if(action==='field:delete'){commit(d=>{const parent=d.field!.scoringElements.find(g=>g.surfaces.some(s=>s.id===selected));if(parent){parent.surfaces=parent.surfaces.filter(s=>s.id!==selected);selected=parent.id;}else{d.field!.scoringElements=d.field!.scoringElements.filter(g=>g.id!==selected);d.field!.sources=d.field!.sources.filter(g=>g.id!==selected);selected=d.id;}});return;}
    }

    if (action === 'close') {
        close();
        return;
    }
    if(action==='restart-drive'){if(activeView==='drive'){keys.clear();virtual.clear();start();}return;}
    if(action.startsWith('graph-mode:')){graphMode=action.slice(11) as 'travel'|'states';stateEdgeSelection='';if(!stateOwner)stateOwner=doc.subsystems[0]?.id??'';render();graph.fit();return;}
    if(action.startsWith('toggle-state:')){const sid=action.slice(13),sub=doc.subsystems.find(s=>s.states!.some(t=>t.id===sid))!;openStates[sub.id]=openStates[sub.id]===sid?undefined:sid;selected=sub.id;stateOwner=sub.id;stateEdgeSelection='';render();return;}
    if(action==='add-state'){
        const sub=doc.subsystems.find(s=>s.id===selected)||doc.subsystems.find(s=>s.id===stateOwner);if(!sub)return;
        if(sub.states!.length>=20){toast('A subsystem can have at most 20 states.');return;}
        commit(d=>{const owner=d.subsystems.find(s=>s.id===sub.id)!;const state=addState(d,owner,currentState(owner));openStates[owner.id]=state.id;selected=owner.id;stateOwner=owner.id;stateEdgeSelection='';});graph.fit();return;
    }
    if(action.startsWith('remove-state:')){
        const sub=doc.subsystems.find(s=>s.id===selected)!,sid=action.slice(13),state=sub.states!.find(t=>t.id===sid)!;
        if(state.isDefault){toast('A subsystem must have a default state. Set another state as default before removing this one.');return;}
        commit(d=>{const owner=d.subsystems.find(s=>s.id===selected)!;owner.states=owner.states!.filter(t=>t.id!==sid);owner.stateTransitions=owner.stateTransitions!.filter(e=>e.source!==sid&&e.target!==sid);delete owner.stateLayout![sid];const ids=new Set(d.surfaces.filter(a=>a.owner===owner.id&&a.stateId===sid).map(a=>a.id));d.surfaces=d.surfaces.filter(a=>!ids.has(a.id));d.edges=d.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target));for(const id of ids)delete d.layout[id];openStates[owner.id]=owner.states!.find(t=>t.isDefault)!.id;});return;
    }
    if(action==='delete-state-edge'){commit(d=>{const sub=d.subsystems.find(s=>s.id===selected)!;sub.stateTransitions=sub.stateTransitions!.filter(e=>e.id!==stateEdgeSelection);stateEdgeSelection='';});return;}
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
        if (!robotEditable || saving) return;
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
    if (action === 'undo' && robotEditable && undo.length) {
        redo.push(clone(doc));
        doc = undo.pop()!;
        simulationDirty = true;
        selected = doc.id;
        dirty = true;
        safeSaveDraft();
        render();
        return;
    }
    if (action === 'redo' && robotEditable && redo.length) {
        undo.push(clone(doc));
        doc = redo.pop()!;
        simulationDirty = true;
        selected = doc.id;
        dirty = true;
        safeSaveDraft();
        render();
        return;
    }
    if(action==='add-graph'&&graphMode==='states'){
        const sub=doc.subsystems.find(s=>s.id===stateOwner);if(!sub)return;
        if(sub.states!.length>=20){toast('A subsystem can have at most 20 states.');return;}
        commit(d=>{const owner=d.subsystems.find(s=>s.id===sub.id)!;const state=addState(d,owner,currentState(owner));openStates[owner.id]=state.id;selected=owner.id;stateEdgeSelection='';});graph.fit();return;
    }
    if (action === 'add' || action === 'add-graph') {
        commit(d => { const s = { id: id(), name: 'New subsystem', position: [0, 0, .5] as Vec3, size: [.35, .35, .35] as Vec3, yaw: 0, capacity: 1, solid: true }; d.subsystems.push(s); d.layout[s.id] = nextNodePosition(d); selected = s.id; });
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
        commit(d => { const type = action.split(':')[1] as Surface['type']; const s = {...createAction(sub, type, selectedFace),stateId:currentState(sub).id}; d.surfaces.push(s); d.layout[s.id] = nextNodePosition(d); selected = s.id; });
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
        commit(d=>{const sub=duplicateSubsystem(d,original);d.layout[sub.id]=nextNodePosition(d);selected=sub.id;openStates[sub.id]=sub.states!.find(s=>s.isDefault)!.id;});
        toast('Subsystem and states duplicated.');
        return;
    }
    if(action==='connect'&&graphMode==='states'){toast('Drag a state output port onto another state to create a transition.');return;}
    if (action === 'connect') {
        select('@connect');
        setPropertiesVisible(true);
        return;
    }
    if (action.startsWith('workspace:')) {
        if(action!=='workspace:edit')inspectorScope='robot';
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
        const next=createSeasonRobot($<HTMLSelectElement>('#new-season')?.value ?? librarySeason);
        next.name = 'Untitled robot';
        next.revision = 0;
        next.subsystems = [];
        next.surfaces = [];
        next.edges = [];
        next.layout = {};
        load(next);
        return;
    }
    if (action === 'sample') {
        load(createSeasonRobot(librarySeason));
        return;
    }
    if (action.startsWith('open:') || action.startsWith('copy:') || action.startsWith('edit:')) {
        try {
            const next = cloudEnabled() ? await cloudRobot(action.slice(5)) : clone(readRobots().find(r => r.document.id === action.slice(5))!.document);
            if (cloudEnabled()) rememberRevision(next);
            if (action.startsWith('copy:')) {next.id = id();next.name += ' copy';next.revision = 0;}
            const editable=!cloudEnabled() || action.startsWith('copy:') || robotMetadata.get(next.id)?.createdBy===signedInUser()?.sub;
            load(next,editable,action.startsWith('open:')?'drive':editable?'edit':'drive');
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
        const key=normalizeBinding(e.key)??normalizeBinding(e.code);
        if(key)captureKey(key);
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
    const bound = [...doc.edges,...doc.subsystems.flatMap(s=>s.stateTransitions ?? [])].some(s => normalizeBinding(s.key) === key);
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
    padControls=gamepadControls();
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
let previousPadHeld=new Set<string>();
setInterval(()=>{
    const pad=Array.from(navigator.getGamepads?.()??[]).find(p=>p?.connected);
    const previous=padControls;padControls=gamepadControls(document.hidden||!document.hasFocus()?undefined:pad);
    const rising=padControls.held.find(key=>!previousPadHeld.has(key));
    previousPadHeld=new Set(padControls.held);
    if(capturingBinding && rising)captureKey(rising);
    if(mode==='running' && !isReplay && (pad||previous.held.length||previous.x||previous.y||previous.turn))sendControls();
},33);
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
    if(!robotEditable && view!=='drive')return;
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
    viewport?.setEditing(robotEditable && view === 'edit' && mode === 'edit');
    render();
    if (view === 'drive' && previous !== 'drive') resumeDrive();
    requestAnimationFrame(() => { if (view === 'graph') graph.fit(); });
}
setWorkspaceView(robotEditable?activeView:'drive');
if(cloudEnabled() && !robotEditable){
    const draftId=doc.id;
    void cloudRobot(draftId).then(()=>{if(doc.id!==draftId)return;robotEditable=robotMetadata.get(draftId)?.createdBy===signedInUser()?.sub;renderShell();}).catch(()=>{});
}

document.addEventListener('change',e=>{const input=e.target as HTMLSelectElement;if(input.id==='new-season'){librarySeason=input.value;void showLibrary();}});
