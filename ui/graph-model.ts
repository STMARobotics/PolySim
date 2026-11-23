import {GRAPH_GRID,snapGraphPoint,orthogonalRoute,roundedRoute,routePoint,routeGrid,type GraphRect,type Point} from './graph-routing';
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

export function transitionCurve(a:Point,b:Point,ga:{width:number;portY:number},gb:{portY:number},labelWidth:number,lane=0,options:{obstacles?:GraphRect[];occupied?:Map<string,number>;manual?:Point[];labels?:GraphRect[]}={}) {
    const start=snapGraphPoint([a[0]+ga.width,a[1]+ga.portY]),end=snapGraphPoint([b[0],b[1]+gb.portY]);
    const obstacles=options.obstacles ?? [{x:a[0],y:a[1],width:ga.width,height:ga.portY*2},{x:b[0],y:b[1],width:144,height:gb.portY*2}];
    let route=orthogonalRoute(start,end,obstacles,options.occupied,options.manual,lane,labelWidth);
    const labelRects=[...obstacles,...options.labels??[]];
    const labelCenter=(points:Point[])=>points.slice(1,-1).map((p,i)=>({p:snapGraphPoint([(p[0]+points[i+2][0])/2,(p[1]+points[i+2][1])/2]),length:Math.hypot(p[0]-points[i+2][0],p[1]-points[i+2][1]),horizontal:p[1]===points[i+2][1]})).sort((a,b)=>Number(b.horizontal)-Number(a.horizontal)||b.length-a.length).find(({p})=>!labelRects.some(r=>p[0]+labelWidth/2+8>r.x&&p[0]-labelWidth/2-8<r.x+r.width&&p[1]+28>r.y&&p[1]-28<r.y+r.height))?.p;
    let center=labelCenter(route.points);
    if(!center&&!options.manual?.length&&Math.abs(end[0]-start[0]-48)>=labelWidth+48){const top=Math.min(...obstacles.map(r=>r.y))-72-lane*72;route=orthogonalRoute(start,end,obstacles,options.occupied,[[start[0]+24,top],[end[0]-24,top]],lane,labelWidth);center=labelCenter(route.points);}
    let leader='';
    if(!center){center=snapGraphPoint([(start[0]+end[0])/2,Math.min(...obstacles.map(r=>r.y))-48-lane*72]);for(let i=0;i<100&&labelRects.some(r=>center![0]+labelWidth/2+8>r.x&&center![0]-labelWidth/2-8<r.x+r.width&&center![1]+28>r.y&&center![1]-28<r.y+r.height);i++)center[1]-=72;leader=roundedRoute(routeGrid(snapGraphPoint(routePoint(route.points,.5)),center,obstacles));}
    return {...route,path:roundedRoute(route.points),point:(f:number)=>routePoint(route.points,f),center,leader};
}
