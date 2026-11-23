import {GRAPH_GRID,snapGraph,snapGraphPoint,roundedRoute,routePoint,routeSegments,nearestRoutePosition,type Point,type GraphRect} from './graph-routing';
import { nodeName, validConnection, surfaceForEdge, type RobotDocument } from '../contracts/model';
import { bindingLabel } from '../contracts/bindings';
import {pieceTypesFor} from '../seasons/registry';
import { graphNode, nodePosition, transitionCurve, GraphRoutes, nodePorts } from './graph-model';
import type { Snapshot } from '../simulation/protocol';
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const directionArrows=(points:Point[])=>routeSegments(points).map(({center,angle},i)=>`<path class="segment-arrow" data-segment-arrow="${i}" transform="translate(${center.join(',')}) rotate(${angle})" d="M -5 -4 L 5 0 L -5 4 Z"/>`).join('');
export class GraphView {
    private document?: RobotDocument;
    private selected = '';
    private routeBounds:Point[]=[];
    private routes=new GraphRoutes();
    private snapshot?: Snapshot;
    private dragging = false;
    private offset: [
        number,
        number
    ] = [0, 0];
    private zoom = 1;
    private pending?: string;
    private pendingType='';
    private editing = true;
    nodeTypeLabel='Subsystem';
    defaultStateId='';
    constructor(private host: HTMLElement, private select: (id: string) => void, private move: (id: string, p: [
        number,
        number
    ]) => void, private connect: (a: string, b: string,type?:string) => void, private inspect: (id: string) => void = select, private reroute:(id:string,points?:Point[])=>void=()=>{},private moveLabel:(id:string,position:number)=>void=()=>{}) {
        new ResizeObserver(() => { if (!this.dragging) this.fit(); }).observe(host);
        host.addEventListener('wheel', e => {
            e.preventDefault();
            if (this.dragging)
                return;
            this.zoom = Math.max(.2, Math.min(2, this.zoom * (e.deltaY > 0 ? .9 : 1.1)));
            this.render();
        }, { passive: false });
    }
    set(d: RobotDocument, selected: string, editing: boolean) {
        this.document = d;
        this.selected = selected;
        this.editing = editing;
        if (editing)
            this.snapshot = undefined;
        this.render();
    }
    update(s: Snapshot) {
        this.snapshot = s;
        if (!this.dragging)
            this.render();
    }
    fit() {
        if (!this.document || this.host.clientWidth < 80 || this.host.clientHeight < 80) return;
        const ids = [...this.document.subsystems, ...this.document.surfaces].map(n => n.id);
        if (!ids.length) { this.zoom = 1; this.offset = [0, 0]; this.render(); return; }
        const nodes = ids.map(id => ({p: this.position(id), ...graphNode(this.document!, id)}));
        const minX = Math.min(...nodes.map(n => n.p[0]),...this.routeBounds.map(p=>p[0])) - 48, maxX = Math.max(...nodes.map(n => n.p[0] + n.width),...this.routeBounds.map(p=>p[0])) + 48;
        const minY = Math.min(...nodes.map(n => n.p[1]),...this.routeBounds.map(p=>p[1])) - 48, maxY = Math.max(...nodes.map(n => n.p[1] + n.height),...this.routeBounds.map(p=>p[1])) + 48;
        this.zoom = Math.min(1.2, (this.host.clientWidth - 48) / (maxX - minX), (this.host.clientHeight - 48) / (maxY - minY));
        this.offset = [(this.host.clientWidth - (maxX - minX) * this.zoom) / 2 - minX * this.zoom, (this.host.clientHeight - (maxY - minY) * this.zoom) / 2 - minY * this.zoom];
        this.render();
    }
    zoomBy(f: number) { this.zoom = Math.max(.2, Math.min(2, this.zoom * f)); this.render(); }
    focus(id: string) {
        if (!this.document || this.host.clientWidth < 80 || this.host.clientHeight < 80)
            return;
        const edge = this.document.edges.find(e => e.id === id);
        const nodes = [...this.document.subsystems, ...this.document.surfaces];
        let center: [
            number,
            number
        ];
        if (edge) {
            const a = this.position(edge.source), b = this.position(edge.target), ga = graphNode(this.document, edge.source), gb = graphNode(this.document, edge.target);
            center = [(a[0] + ga.width + b[0]) / 2, (a[1] + ga.portY + b[1] + gb.portY) / 2];
        }
        else if (nodes.some(n => n.id === id)) {
            const p = this.position(id);
            const g = graphNode(this.document, id);
            center = [p[0] + g.width / 2, p[1] + g.height / 2];
        }
        else {
            const positions = nodes.map(n => this.position(n.id));
            center = positions.length ? [(Math.min(...positions.map(p => p[0])) + Math.max(...positions.map(p => p[0]))) / 2 + 87, (Math.min(...positions.map(p => p[1])) + Math.max(...positions.map(p => p[1]))) / 2 + 38] : [87, 38];
        }
        this.zoom = .9;
        this.offset = [this.host.clientWidth / 2 - center[0] * this.zoom, this.host.clientHeight / 2 - center[1] * this.zoom];
        this.render();
    }
    private position(id: string): [number, number] { return nodePosition(this.document!, id); }
    private point(event: PointerEvent): [
        number,
        number
    ] { const r = this.host.getBoundingClientRect(); return [(event.clientX - r.left - this.offset[0]) / this.zoom, (event.clientY - r.top - this.offset[1]) / this.zoom]; }
    private editableConnection(source: string, target: string,type?:string) {
        return !!this.document?.subsystems.some(s => s.id === source) && this.document.subsystems.some(s => s.id === target) && validConnection(this.document, source, target);
    }
    private connectionDrag(event: PointerEvent, source: string, svg: SVGSVGElement,pieceType?:string) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.editing || !this.document?.subsystems.some(s => s.id === source))
            return;
        this.dragging = true;
        const start = this.position(source), geometry = graphNode(this.document!, source), sx = start[0] + geometry.width, sy = start[1]+(nodePorts(this.document!,source,this.nodeTypeLabel==='State').outputs.find(p=>p.type===pieceType)?.y ?? geometry.portY);
        const group = svg.querySelector<SVGGElement>('.graph-content')!;
        const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        preview.setAttribute('class', 'connection-preview');
        preview.setAttribute('marker-end', 'url(#arrow)');
        group.append(preview);
        svg.querySelectorAll<SVGGElement>('[data-node]').forEach(el => el.classList.toggle('can-connect', this.editableConnection(source, el.dataset.node!)));
        svg.setPointerCapture(event.pointerId);
        let distance = 0;
        const drag = (e: PointerEvent) => {
            const [x, y] = snapGraphPoint(this.point(e)),mx=snapGraph((sx+x)/2);
            preview.setAttribute('d', roundedRoute([[sx,sy],[mx,sy],[mx,y],[x,y]]));
            distance = Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY);
            const under=document.elementFromPoint(e.clientX,e.clientY),port=under?.closest<SVGElement>('[data-in]');const target=port&&port.dataset.piece!==pieceType?undefined:under?.closest<SVGElement>('[data-node]')?.dataset.node;
            svg.querySelectorAll<SVGElement>('[data-node]').forEach(el => el.classList.toggle('drop-target', el.dataset.node === target && !!target && this.editableConnection(source, target)));
        };
        const finish = (e: PointerEvent, cancelled = false) => {
            const under=document.elementFromPoint(e.clientX,e.clientY),port=under?.closest<SVGElement>('[data-in]');const target=port&&port.dataset.piece!==pieceType?undefined:under?.closest<SVGElement>('[data-node]')?.dataset.node;
            svg.removeEventListener('pointermove', drag);
            svg.removeEventListener('pointerup', up);
            svg.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', escape);
            if (svg.hasPointerCapture(event.pointerId))
                svg.releasePointerCapture(event.pointerId);
            this.dragging = false;
            this.pending = undefined;
            if (!cancelled && distance < 4 && (!target || target === source))
                {this.pending = source;this.pendingType=pieceType ?? '';}
            else if (!cancelled && target && target !== source)
                this.connect(source,target,pieceType);
            this.render();
        };
        const up = (e: PointerEvent) => finish(e), cancel = (e: PointerEvent) => finish(e, true);
        const escape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish(event, true);
            }
        };
        svg.addEventListener('pointermove', drag);
        svg.addEventListener('pointerup', up);
        svg.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', escape);
        drag(event);
    }
    private render() {
        const d = this.document;
        if (!d)
            return;
        const tokens = this.snapshot?.tokens ?? [], tick = this.snapshot?.tick ?? 0;
        const curves=this.routes.layout(d,this.nodeTypeLabel==='State');
        this.routeBounds=[];
        const edges = d.edges.map(e => {
            const width = Math.ceil(Math.max(96,bindingLabel(e.key).length*7+24)/GRAPH_GRID)*GRAPH_GRID;
            const curve=curves.get(e.id)!;
            this.routeBounds.push(...curve.points,[curve.center[0]-width/2,curve.center[1]-24],[curve.center[0]+width/2,curve.center[1]+24]);
            const [cx, cy] = curve.center, path = curve.path;
            const flight = tokens.find(t => t.flight?.edge === e.id)?.flight, f = flight ? Math.min(1, (tick - flight.start) / (flight.end - flight.start)) : 0;
            const [x, y] = curve.point(f);
            const gripSegment=curve.points.slice(1,-2).map((p,i)=>({i:i+1,length:Math.hypot(p[0]-curve.points[i+2][0],p[1]-curve.points[i+2][1])})).sort((a,b)=>b.length-a.length)[0]?.i??1;
            return `<g class="graph-edge ${surfaceForEdge(d, e) ? 'automatic' : ''} ${e.id === this.selected ? 'selected' : ''} ${curve.blocked?'route-blocked':''} ${flight ? 'flowing' : ''}" data-edge="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(nodeName(d, e.source))} to ${esc(nodeName(d, e.target))}">${curve.leader?`<path class="edge-label-leader" d="${curve.leader}"/>`:""}<path class="edge-hit" d="${path}"/><path class="edge-line" d="${path}" marker-end="url(#arrow)"/>${this.editing&&e.id===this.selected?curve.points.slice(1,-2).map((p,i)=>`<circle class="route-handle" data-route-segment="${i+1}" cx="${(p[0]+curve.points[i+2][0])/2}" cy="${(p[1]+curve.points[i+2][1])/2}" r="5"/><path class="route-segment" data-route-segment="${i+1}" d="M ${p.join(' ')} L ${curve.points[i+2].join(' ')}"><title>Drag to move this segment along the grid</title></path>`).join('')+`<text class="route-reset" tabindex="0" role="button" aria-label="Reset connection route" data-reset-route="${esc(e.id)}" x="${cx}" y="${cy+62}" text-anchor="middle">Reset route</text>`:''}<g class="edge-label" data-edge-label="${esc(e.id)}" transform="translate(${cx},${cy})" role="slider" tabindex="0" aria-label="${esc(nodeName(d,e.source)+' to '+nodeName(d,e.target)+' label position')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((e.labelPosition??nearestRoutePosition(curve.points,curve.center))*100)}"><title>Drag to slide the label along this transition. Arrow keys move it; Home and End jump to the ends.</title><rect x="${-width/2}" y="-24" width="${width}" height="48" rx="5"/><text x="0" y="-10" text-anchor="middle">${esc(bindingLabel(e.key))}</text><text x="0" y="20" text-anchor="middle">${e.duration === 0 ? 'Instant' : e.duration.toFixed(2) + ' s'}</text></g>${this.editing&&e.id===this.selected?`<g class="route-grip" data-route-grip="${gripSegment}" transform="translate(${cx},${cy+36})"><title>Drag to move the line. Drag the key/time label to slide the label.</title><rect x="-7" y="-7" width="14" height="14" rx="2"/><path d="M -4 -2 H 4 M -4 2 H 4"/></g>`:""}<g class="segment-arrows" aria-hidden="true">${directionArrows(curve.points)}</g>${flight ? `<circle class="token-dot" cx="${x}" cy="${y}" r="5"/>` : ''}</g>`;
        }).join('');
        const nodes = [...d.subsystems.map(n => ({ ...n, kind: 'subsystem' })), ...d.surfaces.map(n => ({ ...n, kind: n.type }))];
        this.host.innerHTML = `<svg class="graph-svg" aria-label="${this.nodeTypeLabel==='State'?'Subsystem States Graph':'Travel Path Graph'}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#91a7b5"/></marker><pattern id="dots" width="${GRAPH_GRID}" height="${GRAPH_GRID}" patternUnits="userSpaceOnUse" patternTransform="translate(${this.offset[0]},${this.offset[1]}) scale(${this.zoom})"><circle cx="0" cy="0" r=".8" fill="#2e5b9b"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)"/><g class="graph-content" transform="translate(${this.offset[0]},${this.offset[1]}) scale(${this.zoom})">${nodes.map(n => {
            const p = this.position(n.id), g = graphNode(d, n.id);
            const words = n.name.match(/.{1,14}(?:\s|$)|.{1,14}/g) ?? [n.name];
            const lines = words.slice(0, 2).map((line, i) => `<tspan x="14" dy="${i ? 16 : 0}">${esc(line.trim())}${i === 1 && words.length > 2 ? '…' : ''}</tspan>`).join('');
            const nameY=n.kind==='subsystem'?48:43,capacityY=n.kind==='subsystem'?136:86;const ports=nodePorts(d,n.id,this.nodeTypeLabel==='State');
            return `<g class="graph-node ${n.kind} ${n.id === this.selected ? 'selected' : ''} ${this.pending === n.id ? 'pending' : ''}" transform="translate(${p[0]},${p[1]})" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.name)}"><title>${esc(n.name)} · ${g.type} · Capacity ${g.capacity}</title><rect width="${g.width}" height="${g.height}" rx="4"/><rect class="node-stripe" width="4" height="${g.height - 18}" y="9" rx="2"/><text class="node-kind" x="14" y="23">${n.kind === 'subsystem' ? this.nodeTypeLabel : g.type}${n.id===this.defaultStateId?' · Default':''}</text><text class="node-name" x="14" y="${nameY}">${lines}</text><text class="node-info" x="14" y="${capacityY}">Capacity ${g.capacity}</text>${ports.inputs.map(port=>`<circle class="port input-port" cx="0" cy="${port.y}" r="7" data-in="${esc(n.id)}" data-piece="${esc(port.type)}" style="fill:${port.color}"><title>${esc(port.label)} entry</title></circle>${ports.inputs.length>1&&n.kind==='subsystem'?`<text class="port-label" x="12" y="${port.y+4}">${esc(port.label)}</text>`:''}`).join('')}${ports.outputs.map(port=>`<circle class="port output-port" cx="${g.width}" cy="${port.y}" r="7" data-out="${esc(n.id)}" data-piece="${esc(port.type)}" style="fill:${port.color}"><title>${esc(port.label)} exit</title></circle>${ports.outputs.length>1&&n.kind==='subsystem'?`<text class="port-label" text-anchor="end" x="${g.width-12}" y="${port.y+4}">${esc(port.label)}</text>`:''}`).join('')}</g>`;
        }).join('')}${edges}</g></svg>${this.pending ? '<div class="graph-instruction">Choose a destination</div>' : ''}`;
        const svg = this.host.querySelector('svg')!;
        svg.querySelectorAll<SVGGElement>('[data-edge]').forEach(el => {
            el.addEventListener('pointerdown', event=>{
                if(event.button!==0)return;
                event.stopPropagation();event.preventDefault();
                const id=el.dataset.edge!;
                if((event.target as Element).hasAttribute('data-reset-route')){this.reroute(id);return;}
                if(!this.editing){this.select(id);return;}
                const curve=curves.get(id)!;
                if((event.target as Element).closest('[data-edge-label]')){
                    const pointer=this.point(event),label=el.querySelector<SVGGElement>('[data-edge-label]')!;
                    let position=d.edges.find(e=>e.id===id)?.labelPosition??nearestRoutePosition(curve.points,curve.center),changed=false;
                    this.dragging=true;svg.setPointerCapture(event.pointerId);
                    const drag=(e:PointerEvent)=>{const p=this.point(e);changed=Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)>3;
                        if(!changed)return;
                        position=nearestRoutePosition(curve.points,[curve.center[0]+p[0]-pointer[0],curve.center[1]+p[1]-pointer[1]],position);
                        const center=routePoint(curve.points,position);label.setAttribute('transform',`translate(${center.join(',')})`);label.setAttribute('aria-valuenow',String(Math.round(position*100)));
                        el.querySelector('.edge-label-leader')?.setAttribute('d','');const reset=el.querySelector('.route-reset');reset?.setAttribute('x',String(center[0]));reset?.setAttribute('y',String(center[1]+62));el.querySelector('.route-grip')?.setAttribute('transform',`translate(${center[0]},${center[1]+36})`);
                    };
                    const finish=(cancel=false)=>{svg.removeEventListener('pointermove',drag);svg.removeEventListener('pointerup',up);svg.removeEventListener('pointercancel',abort);window.removeEventListener('keydown',escape);if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);this.dragging=false;if(cancel)this.render();else if(changed)this.moveLabel(id,position);else this.select(id);};
                    const up=()=>finish(),abort=()=>finish(true),escape=(e:KeyboardEvent)=>{if(e.key==='Escape')finish(true);};
                    svg.addEventListener('pointermove',drag);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',abort);window.addEventListener('keydown',escape);return;
                }
                let points=curve.points.map(p=>[...p] as Point);
                const pointer=this.point(event),target=(event.target as Element).closest<SVGElement>('[data-route-segment],[data-route-grip]'),hit=target?.dataset.routeSegment??target?.dataset.routeGrip;
                const segments=points.slice(1,-2).map((p,i)=>({i:i+1,d:Math.hypot(pointer[0]-(p[0]+points[i+2][0])/2,pointer[1]-(p[1]+points[i+2][1])/2)})).sort((a,b)=>a.d-b.d);
                const index=hit?Number(hit):segments[0]?.i ?? 1;
                const horizontal=points[index][1]===points[index+1][1];let changed=false;
                this.dragging=true;svg.setPointerCapture(event.pointerId);
                const drag=(e:PointerEvent)=>{const p=this.point(e),delta=snapGraph(p[horizontal?1:0]-pointer[horizontal?1:0]);changed=delta!==0;points=curve.points.map(p=>[...p] as Point);points[index][horizontal?1:0]=snapGraph(points[index][horizontal?1:0]+delta);points[index+1][horizontal?1:0]=snapGraph(points[index+1][horizontal?1:0]+delta);
                    const start=points[0],end=points.at(-1)!,preview=[start,[points[1][0],start[1]] as Point,...points.slice(1,-1),[points.at(-2)![0],end[1]] as Point,end];
                    el.querySelector('.segment-arrows')!.innerHTML=directionArrows(preview);
                    el.querySelectorAll<SVGPathElement>('.edge-line,.edge-hit').forEach(path=>path.setAttribute('d',roundedRoute(preview)));
                    el.querySelectorAll<SVGElement>('[data-route-segment]').forEach(handle=>{const i=Number(handle.dataset.routeSegment);if(handle.tagName==='circle'){handle.setAttribute('cx',String((points[i][0]+points[i+1][0])/2));handle.setAttribute('cy',String((points[i][1]+points[i+1][1])/2));}else handle.setAttribute('d',`M ${points[i].join(' ')} L ${points[i+1].join(' ')}`);});
                };
                const finish=(cancel=false)=>{svg.removeEventListener('pointermove',drag);svg.removeEventListener('pointerup',up);svg.removeEventListener('pointercancel',abort);window.removeEventListener('keydown',escape);if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);this.dragging=false;if(cancel)this.render();else if(changed)this.reroute(id,points.slice(1,-1).slice(0,64));else this.select(id);};
                const up=()=>finish(),abort=()=>finish(true),escape=(e:KeyboardEvent)=>{if(e.key==='Escape')finish(true);};
                svg.addEventListener('pointermove',drag);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',abort);window.addEventListener('keydown',escape);
            });
            el.addEventListener('dblclick', () => this.inspect(el.dataset.edge!));
            el.addEventListener('keydown', e => {
                if((e.target as Element).closest('[data-edge-label]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){
                    e.preventDefault();e.stopPropagation();if(!this.editing)return;
                    const id=el.dataset.edge!,edge=d.edges.find(edge=>edge.id===id)!,curve=curves.get(id)!,previous=edge.labelPosition??nearestRoutePosition(curve.points,curve.center);
                    const position=e.key==='Home'?0:e.key==='End'?1:Math.max(0,Math.min(1,previous+(['ArrowLeft','ArrowUp'].includes(e.key)?-.025:.025)));
                    this.moveLabel(id,position);this.host.querySelector<SVGElement>(`[data-edge-label="${CSS.escape(id)}"]`)?.focus();return;
                }
                if (e.key === 'Enter'){e.preventDefault();if((e.target as Element).hasAttribute('data-reset-route'))this.reroute(el.dataset.edge!);else this.inspect(el.dataset.edge!);}
            });
        });
        svg.querySelectorAll<SVGGElement>('[data-node]').forEach(el => {
            const node = el.dataset.node!;
            el.addEventListener('dblclick', () => this.inspect(node));
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter')
                    this.inspect(node);
            });
            el.addEventListener('pointerdown', e => {
                if (e.button !== 0)
                    return;
                if ((e.target as Element).hasAttribute('data-out')) {
                    this.connectionDrag(e,node,svg,(e.target as SVGElement).dataset.piece);
                    return;
                }
                e.stopPropagation();
                if (this.pending && this.editing) {
                    const source = this.pending;
                    this.pending = undefined;
                    this.connect(source,node,this.pendingType);
                    return;
                }
                if (!this.editing) {
                    this.select(node);
                    return;
                }
                const start = this.position(node), px = e.clientX, py = e.clientY;
                let end = start;
                this.dragging = true;
                el.setPointerCapture(e.pointerId);
                const drag = (event: PointerEvent) => { end = snapGraphPoint([start[0] + (event.clientX - px) / this.zoom, start[1] + (event.clientY - py) / this.zoom]); el.setAttribute('transform', `translate(${end[0]},${end[1]})`); };
                const finish = (cancel = false) => {
                    el.removeEventListener('pointermove', drag);
                    el.removeEventListener('pointerup', up);
                    el.removeEventListener('pointercancel', cancelDrag);
                    this.dragging = false;
                    if (cancel)
                        this.render();
                    else if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 2)
                        this.move(node, end);
                    else
                        this.select(node);
                };
                const up = () => finish(), cancelDrag = () => finish(true);
                el.addEventListener('pointermove', drag);
                el.addEventListener('pointerup', up);
                el.addEventListener('pointercancel', cancelDrag);
            });
        });
        svg.addEventListener('pointerdown', e => {
            if (e.button !== 0 || (e.target as Element).closest('[data-node],[data-edge]'))
                return;
            this.pending = undefined;
            const px = e.clientX, py = e.clientY, start = [...this.offset];
            this.dragging = true;
            svg.setPointerCapture(e.pointerId);
            const drag = (ev: PointerEvent) => { this.offset = [start[0] + ev.clientX - px, start[1] + ev.clientY - py]; svg.querySelector('.graph-content')?.setAttribute('transform', `translate(${this.offset[0]},${this.offset[1]}) scale(${this.zoom})`);svg.querySelector('#dots')?.setAttribute('patternTransform',`translate(${this.offset[0]},${this.offset[1]}) scale(${this.zoom})`); };
            const up = () => { this.dragging = false; svg.removeEventListener('pointermove', drag); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); this.render(); };
            svg.addEventListener('pointermove', drag);
            svg.addEventListener('pointerup', up);
            svg.addEventListener('pointercancel', up);
        });
    }
}
