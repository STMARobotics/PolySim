import type { RobotDocument } from '../contracts/model';
import {pieceTypesFor,acceptedTypes} from '../seasons/registry';
export function nodePorts(document:RobotDocument,id:string,states=false) {
 const node=graphNode(document,id),action=document.surfaces.find(s=>s.id===id),types=states?[{id:'',name:'State'}]:pieceTypesFor(document).filter(p=>!action||acceptedTypes(document,action).includes(p.id));
 const ports=types.map((type,i)=>({type:type.id,label:type.name,y:types.length===1?node.portY:(action?42:92)+i*22,color:pieceTypesFor(document).findIndex(p=>p.id===type.id)<=0?'#ffe044':'#4b9cff'}));
 return {inputs:action?.type==='intake'?[]:ports,outputs:ports};
}

export function graphNode(document: RobotDocument, id: string) {
    const subsystem = document.subsystems.find(s => s.id === id);
    const action = document.surfaces.find(s => s.id === id);
    const owner = document.subsystems.find(s => s.id === action?.owner);
    const width = subsystem ? 144 : 174, height = subsystem ? 144 : 96;
    return {
        width, height, portY: height / 2,
        type: subsystem ? 'Subsystem' : 'Action',
        capacity: subsystem?.capacity ?? (action?.type === 'intake' ? 1 : owner?.capacity ?? 0),
    };
}

export function nodePosition(document: RobotDocument, id: string): [number, number] {
    const index = [...document.subsystems, ...document.surfaces].findIndex(n => n.id === id);
    return document.layout[id] ?? [40 + index % 4 * 240, 80 + Math.floor(index / 4) * 230];
}

// Lift short routes so their centered labels remain clear of both modules.
export function transitionCurve(a: [number, number], b: [number, number], ga: {width: number; portY: number}, gb: {portY: number}, labelWidth: number,lane=0) {
    const sx = a[0] + ga.width, sy = a[1] + ga.portY, tx = b[0], ty = b[1] + gb.portY;
    const dx = Math.max(65, Math.abs(tx - sx) * .5);
    const lift = tx - sx < labelWidth + 16 ? Math.max(0, ((sy + ty) / 2 - (Math.min(a[1], b[1]) - 30)) / .75) : 0;
    const c1y = sy - lift-lane*96, c2y = ty - lift-lane*96;
    const point = (f: number) => [
        (1-f)**3*sx + 3*(1-f)**2*f*(sx+dx) + 3*(1-f)*f*f*(tx-dx) + f**3*tx,
        (1-f)**3*sy + 3*(1-f)**2*f*c1y + 3*(1-f)*f*f*c2y + f**3*ty,
    ] as [number, number];
    return {path: `M ${sx} ${sy} C ${sx+dx} ${c1y},${tx-dx} ${c2y},${tx} ${ty}`, point, center: point(.5)};
}
