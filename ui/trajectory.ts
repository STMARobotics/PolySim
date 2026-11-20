import {faceFrame,launchDirection,rotate3} from '../contracts/geometry';
import type {Subsystem,Surface,Vec3} from '../contracts/model';
import {outtakeOffsets} from '../simulation/outtake-grid';
import {practice} from '../seasons/practice';
export function outputTrajectories(sub:Subsystem,surface:Surface,radii:number[]=[practice.radius]):Vec3[][] {
    const x=surface.unitsX??1,y=surface.unitsY??1;
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||y<1||x>20||y>20||x*y>100)return [];
    const frame=faceFrame(sub,surface),direction=launchDirection(surface,frame.q),count=(surface.unitsX??1)*(surface.unitsY??1),radius=Math.max(...radii);
    return outtakeOffsets(surface.unitsX??1,surface.unitsY??1,count,frame.axis,radius*2+.02).map(offset=>{
        const tangent=rotate3(offset,frame.q),origin=frame.center.map((p,i)=>p+frame.normal[i]*(radius+.045)+tangent[i]) as Vec3;
        const points:Vec3[]=[];
        for(let i=0;i<=100;i++) {const t=i*.04,p=origin.map((v,j)=>v+surface.speed*direction[j]*t-(j===2?4.905*t*t:0)) as Vec3;if(p[2]<0 && i>0)break;points.push(p);}
        return points;
    });
}
