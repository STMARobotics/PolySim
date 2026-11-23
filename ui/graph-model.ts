import {GRAPH_GRID,snapGraphPoint,orthogonalRoute,roundedRoute,routePoint,routeGrid,occupyRoute,type GraphRect,type Point} from './graph-routing';
import {bindingLabel} from '../contracts/bindings';
import type { RobotDocument } from '../contracts/model';
import {pieceTypesFor,acceptedTypes} from '../seasons/registry';
export function nodePorts(document:RobotDocument,id:string,states=false) {
 const node=graphNode(document,id),action=document.surfaces.find(s=>s.id===id),types=states?[{id:'',name:'State'}]:pieceTypesFor(document).filter(p=>!action||acceptedTypes(document,action).includes(p.id));
 const ports=types.map((type,i)=>({type:type.id,label:type.name,y:types.length===1?node.portY:(action?48:72)+i*GRAPH_GRID,color:pieceTypesFor(document).findIndex(p=>p.id===type.id)<=0?'#ffe044':'#4b9cff'}));
 return {inputs:action?.type==='intake'?[]:ports,outputs:ports};
}

export function graphNode(document: RobotDocument, id: string) {
    const subsystem = document.subsystems.find(s => s.id === id);
    const action = document.surfaces.find(s => s.id === id);
    const owner = document.subsystems.find(s => s.id === action?.owner);
    const width = subsystem ? 144 : 192, height = subsystem ? 144 : 96;
    return {
        width, height, portY: height / 2,
        type: subsystem ? 'Subsystem' : 'Action',
        capacity: subsystem?.capacity ?? (action?.type === 'intake' ? 1 : owner?.capacity ?? 0),
    };
}

export function nodePosition(document: RobotDocument, id: string): [number, number] {
    const index = [...document.subsystems, ...document.surfaces].findIndex(n => n.id === id);
    return snapGraphPoint(document.layout[id] ?? [48 + index % 4 * 288, 96 + Math.floor(index / 4) * 240]);
}

export function transitionLabel(points:Point[],labelWidth:number,obstacles:GraphRect[],lane=0,labels:GraphRect[]=[]) {
    const labelRects=[...obstacles,...labels];
    const candidates=points.slice(1,-1).flatMap((p,i)=>[.25,.75,.5].map(t=>({p:snapGraphPoint([p[0]+(points[i+2][0]-p[0])*t,p[1]+(points[i+2][1]-p[1])*t]),length:Math.hypot(p[0]-points[i+2][0],p[1]-points[i+2][1]),horizontal:p[1]===points[i+2][1]})));
    const collides=(p:Point)=>labelRects.some(r=>p[0]+labelWidth/2+8>r.x&&p[0]-labelWidth/2-8<r.x+r.width&&p[1]+28>r.y&&p[1]-28<r.y+r.height);
    let center=candidates.sort((a,b)=>Number(b.horizontal)-Number(a.horizontal)||b.length-a.length).find(({p})=>!collides(p))?.p;
    let leader='';
    if(!center){center=snapGraphPoint([(points[0][0]+points.at(-1)![0])/2,Math.min(...obstacles.map(r=>r.y))-48-lane*72]);for(let i=0;i<100&&collides(center);i++)center[1]-=72;leader=roundedRoute(routeGrid(snapGraphPoint(routePoint(points,.5)),center,obstacles));}
    return {center,leader};
}
export function transitionCurve(a:Point,b:Point,ga:{width:number;portY:number},gb:{portY:number},labelWidth:number,lane=0,options:{obstacles?:GraphRect[];occupied?:Map<string,number>;manual?:Point[];labels?:GraphRect[];labelPosition?:number}={}) {
    const start=snapGraphPoint([a[0]+ga.width,a[1]+ga.portY]),end=snapGraphPoint([b[0],b[1]+gb.portY]);
    const obstacles=options.obstacles ?? [{x:a[0],y:a[1],width:ga.width,height:ga.portY*2},{x:b[0],y:b[1],width:144,height:gb.portY*2}];
    const route=orthogonalRoute(start,end,obstacles,options.occupied,options.manual,lane,labelWidth);
    const label=options.labelPosition===undefined?transitionLabel(route.points,labelWidth,obstacles,lane,options.labels):{center:routePoint(route.points,options.labelPosition),leader:''};
    return {...route,path:roundedRoute(route.points),point:(f:number)=>routePoint(route.points,f),...label};
}

/** Automatic routes depend on graph topology, never on another edge's manual edits. */
export class GraphRoutes {
    private topology='';
    private automatic=new Map<string,ReturnType<typeof transitionCurve>>();
    private edited=new Map<string,{key:string;curve:ReturnType<typeof transitionCurve>}>();
    layout(d:RobotDocument,states=false){
        const topology=JSON.stringify([states,d.seasonId,d.layout,d.subsystems.map(n=>n.id),d.surfaces.map(n=>[n.id,n.type,n.accepts]),d.edges.map(e=>[e.id,e.source,e.target,e.pieceType])]);
        const obstacles=[...d.subsystems,...d.surfaces].map(n=>{const p=nodePosition(d,n.id),g=graphNode(d,n.id);return {x:p[0],y:p[1],width:g.width,height:g.height};});
        const geometry=(e:RobotDocument['edges'][number])=>{
            const ga=graphNode(d,e.source),gb=graphNode(d,e.target),type=e.pieceType??nodePorts(d,e.source,states).outputs[0]?.type;
            return {a:nodePosition(d,e.source),b:nodePosition(d,e.target),ga:{...ga,portY:nodePorts(d,e.source,states).outputs.find(p=>p.type===type)?.y??ga.portY},gb:{...gb,portY:nodePorts(d,e.target,states).inputs.find(p=>p.type===type)?.y??gb.portY},lane:states?0:Math.max(0,pieceTypesFor(d).findIndex(p=>p.id===type))};
        };
        if(topology!==this.topology){
            this.topology=topology;this.automatic.clear();this.edited.clear();
            const occupied=new Map<string,number>(),labels:GraphRect[]=[];
            for(const e of d.edges){const g=geometry(e),curve=transitionCurve(g.a,g.b,g.ga,g.gb,96,g.lane,{obstacles,occupied,labels});this.automatic.set(e.id,curve);occupyRoute(curve.points,occupied);labels.push({x:curve.center[0]-48,y:curve.center[1]-24,width:96,height:48});}
        }
        const result=new Map<string,ReturnType<typeof transitionCurve>>();
        for(const e of d.edges){
            const key=JSON.stringify([e.route,e.labelPosition,e.key]),cached=this.edited.get(e.id);
            if(cached?.key===key){result.set(e.id,cached.curve);continue;}
            const width=Math.ceil(Math.max(96,bindingLabel(e.key).length*7+24)/GRAPH_GRID)*GRAPH_GRID,g=geometry(e);
            const base=e.route?.length?transitionCurve(g.a,g.b,g.ga,g.gb,width,g.lane,{obstacles,manual:e.route}):this.automatic.get(e.id)!;
            const label=e.labelPosition===undefined?(width===96?{center:base.center,leader:base.leader}:transitionLabel(base.points,width,obstacles,g.lane)):{center:routePoint(base.points,e.labelPosition),leader:''};
            const curve={...base,...label};this.edited.set(e.id,{key,curve});result.set(e.id,curve);
        }
        return result;
    }
}
