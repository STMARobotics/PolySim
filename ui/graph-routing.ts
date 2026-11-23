export type Point = [number,number];
export interface GraphRect {x:number;y:number;width:number;height:number}
export const GRAPH_GRID=24;
export const snapGraph=(n:number)=>Math.max(-9984,Math.min(9984,Math.round(n/GRAPH_GRID)*GRAPH_GRID));
export const snapGraphPoint=(p:Point):Point=>[snapGraph(p[0]),snapGraph(p[1])];
const key=(p:Point)=>p.join(',');
export const inside=(p:Point,r:GraphRect,pad=0)=>p[0]>r.x-pad&&p[0]<r.x+r.width+pad&&p[1]>r.y-pad&&p[1]<r.y+r.height+pad;

function simplify(points:Point[]):Point[]{
    const out:Point[]=[];
    for(const p of points){if(out.length&&key(out.at(-1)!)===key(p))continue;
        while(out.length>1){const a=out.at(-2)!,b=out.at(-1)!;if((a[0]===b[0]&&b[0]===p[0]&&(b[1]-a[1])*(p[1]-b[1])>=0)||(a[1]===b[1]&&b[1]===p[1]&&(b[0]-a[0])*(p[0]-b[0])>=0))out.pop();else break;}out.push(p);}
    return out;
}
interface Step {p:Point;dir:number;g:number;f:number;parent?:Step}
export function routeGrid(start:Point,end:Point,obstacles:GraphRect[],occupied=new Map<string,number>()):Point[]{
    const blocked=(p:Point)=>obstacles.some(r=>inside(p,r,12));
    if(blocked(start)||blocked(end))return [];
    const xs=[start[0],end[0],...obstacles.flatMap(r=>[r.x,r.x+r.width])],ys=[start[1],end[1],...obstacles.flatMap(r=>[r.y,r.y+r.height])];
    const minX=Math.min(...xs)-96,maxX=Math.max(...xs)+96,minY=Math.min(...ys)-96,maxY=Math.max(...ys)+96;
    const heap:Step[]=[],costs=new Map<string,number>();
    const push=(s:Step)=>{heap.push(s);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(heap[parent].f<=s.f)break;heap[i]=heap[parent];i=parent;}heap[i]=s;};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
    const heuristic=(p:Point)=>Math.abs(p[0]-end[0])+Math.abs(p[1]-end[1]);
    push({p:start,dir:0,g:0,f:heuristic(start)});
    const dirs:Point[]=[[24,0],[0,24],[-24,0],[0,-24]];
    for(let visited=0;heap.length&&visited<30000;visited++){
        const s=pop(),state=key(s.p)+','+s.dir;if((costs.get(state)??Infinity)<s.g)continue;
        if(key(s.p)===key(end)){const path:Point[]=[];for(let n:Step|undefined=s;n;n=n.parent)path.push(n.p);return simplify(path.reverse());}
        dirs.forEach(([dx,dy],dir)=>{const p:Point=[s.p[0]+dx,s.p[1]+dy];if(p[0]<minX||p[0]>maxX||p[1]<minY||p[1]>maxY||blocked(p))return;
            const g=s.g+24+(dir===s.dir?0:10)+(occupied.get(key(p))??0)*30,k=key(p)+','+dir;if(g>=(costs.get(k)??Infinity))return;costs.set(k,g);push({p,dir,g,f:g+heuristic(p),parent:s});});
    }
    return [];
}

export function orthogonalRoute(start:Point,end:Point,obstacles:GraphRect[],occupied=new Map<string,number>(),manual:Point[]=[],lane=0,labelWidth=96){
    const a:Point=[start[0]+24,start[1]],b:Point=[end[0]-24,end[1]];
    // Move saved waypoints out of nodes if a node has since been moved over them.
    const clear=(p:Point)=>!obstacles.some(r=>inside(p,r,12));
    const waypoints=manual.map(snapGraphPoint).filter(clear);
    if(!waypoints.length&&end[0]<=start[0]){const top=snapGraph(Math.min(start[1],end[1],...obstacles.map(r=>r.y))-48-lane*72);waypoints.push([a[0],top],[b[0],top]);}
    const stops=[a,...waypoints,b],points:Point[]=[start,a];
    for(let i=1;i<stops.length;i++){
        const path=routeGrid(stops[i-1],stops[i],obstacles,occupied);
        if(!path.length)return {points:[start,a,[a[0],Math.min(start[1],end[1])-72],[b[0],Math.min(start[1],end[1])-72],b,end] as Point[],blocked:true};
        points.push(...path.slice(1));
    }
    points.push(end);
    // Keep terminal stubs as editable segments even on an otherwise straight route.
    const middle=simplify(points.slice(1,-1));
    if(middle.length===1)middle.push([...middle[0]]);
    return {points:[start,...middle,end],blocked:false};
}

export function roundedRoute(points:Point[],radius=6):string{
    if(!points.length)return '';
    let path=`M ${points[0].join(' ')}`;
    for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
        if(!ab||!bc||(a[0]===c[0])||(a[1]===c[1])){path+=` L ${b.join(' ')}`;continue;}
        const r=Math.min(radius,ab/2,bc/2),p:Point=[b[0]+(a[0]-b[0])*r/ab,b[1]+(a[1]-b[1])*r/ab],q:Point=[b[0]+(c[0]-b[0])*r/bc,b[1]+(c[1]-b[1])*r/bc];
        path+=` L ${p.join(' ')} Q ${b.join(' ')} ${q.join(' ')}`;
    }
    return path+` L ${points.at(-1)!.join(' ')}`;
}
export function routePoint(points:Point[],f:number):Point{
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,f));
    for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]){const t=lengths[i]?distance/lengths[i]:0;return [points[i][0]+(points[i+1][0]-points[i][0])*t,points[i][1]+(points[i+1][1]-points[i][1])*t];}distance-=lengths[i];}return points.at(-1)!;
}
export function occupyRoute(points:Point[],occupied:Map<string,number>){for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],steps=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/24;for(let t=0;t<=steps;t++){const k=key([a[0]+Math.sign(b[0]-a[0])*24*t,a[1]+Math.sign(b[1]-a[1])*24*t]);occupied.set(k,(occupied.get(k)??0)+1);}}}

export function routeSegments(points:Point[]){
    const corners=simplify(points);
    return corners.slice(1).map((to,i)=>{const from=corners[i];return {from,to,center:[(from[0]+to[0])/2,(from[1]+to[1])/2] as Point,angle:Math.atan2(to[1]-from[1],to[0]-from[0])*180/Math.PI};});
}

/** Project a dragged label onto its connection without changing the connection. */
export function nearestRoutePosition(points:Point[],point:Point,previous=.5){
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),total=lengths.reduce((a,b)=>a+b,0);
    if(!total)return 0;
    let walked=0,best=Infinity,position=0;
    for(let i=0;i<lengths.length;i++){
        const a=points[i],b=points[i+1],length=lengths[i];if(!length)continue;
        const t=Math.max(0,Math.min(1,((point[0]-a[0])*(b[0]-a[0])+(point[1]-a[1])*(b[1]-a[1]))/(length*length)));
        const distance=(point[0]-a[0]-(b[0]-a[0])*t)**2+(point[1]-a[1]-(b[1]-a[1])*t)**2,fraction=(walked+length*t)/total;
        if(distance<best-1e-8||(Math.abs(distance-best)<1e-8&&Math.abs(fraction-previous)<Math.abs(position-previous))){best=distance;position=fraction;}
        walked+=length;
    }
    return position;
}
