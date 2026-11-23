import {Euler, Vector3} from 'three';
import {previewDocument} from '../contracts/states';
import type {RobotDocument, Vec3} from '../contracts/model';

/** A static orthographic projection avoids a WebGL context for every library card. */
export function robotPreview(document: RobotDocument): string {
    const d=previewDocument(document,{}), b=d.basics;
    const boxes=[{position:[0,0,b.height/2] as Vec3,size:[b.length,b.width,b.height] as Vec3,yaw:0,pitch:0,roll:0,color:'#4581a3'},
        ...d.subsystems.map(s=>({...s,color:d.surfaces.some(a=>a.owner===s.id&&a.type==='intake')?'#62ceaa':d.surfaces.some(a=>a.owner===s.id&&a.type==='outtake')?'#ed7c82':'#d4e2ef'}))];
    const faces:{points:Vector3[];depth:number;color:string;shade:number}[]=[];
    const view=new Vector3(1,-1,1);
    for(const box of boxes){
        const rotation=new Euler(box.roll ?? 0,box.pitch ?? 0,box.yaw,'ZYX');
        for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
            const normal=new Vector3().setComponent(axis,sign).applyEuler(rotation);
            if(normal.dot(view)<=0)continue;
            const u=(axis+1)%3,v=(axis+2)%3;
            const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,c])=>new Vector3().setComponent(axis,sign*box.size[axis]/2).setComponent(u,a*box.size[u]/2).setComponent(v,c*box.size[v]/2).applyEuler(rotation).add(new Vector3(...box.position)));
            faces.push({points,depth:points.reduce((sum,p)=>sum+p.dot(view),0)/4,color:box.color,shade:axis===2?.04:axis===0?.18:.32});
        }
    }
    const project=(p:Vector3)=>[(p.x+p.y)*Math.SQRT1_2,(p.y-p.x)/Math.sqrt(6)-p.z*Math.sqrt(2/3)];
    const all=faces.flatMap(f=>f.points.map(project));
    const minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
    const width=Math.max(.1,maxX-minX),height=Math.max(.1,maxY-minY),pad=Math.max(width,height)*.12;
    return `<svg class="robot-preview" viewBox="${minX-pad} ${minY-pad} ${width+2*pad} ${height+2*pad}" aria-hidden="true">${faces.sort((a,b)=>a.depth-b.depth).map(f=>{const points=f.points.map(p=>project(p).join(',')).join(' ');return `<polygon points="${points}" fill="${f.color}" stroke="#152b45" stroke-width="1" vector-effect="non-scaling-stroke"/><polygon points="${points}" fill="#07172c" opacity="${f.shade}"/>`;}).join('')}</svg>`;
}
