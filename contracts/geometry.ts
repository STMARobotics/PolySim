import type {Vec3,Subsystem,Surface} from './model';
export type Quat={x:number;y:number;z:number;w:number};
// Intrinsic roll(X), pitch(Y), yaw(Z), equivalent to Three's ZYX Euler order.
export function orientation(yaw:number,pitch=0,roll=0):Quat {
    const cy=Math.cos(yaw/2),sy=Math.sin(yaw/2),cp=Math.cos(pitch/2),sp=Math.sin(pitch/2),cr=Math.cos(roll/2),sr=Math.sin(roll/2);
    return {x:sr*cp*cy-cr*sp*sy,y:cr*sp*cy+sr*cp*sy,z:cr*cp*sy-sr*sp*cy,w:cr*cp*cy+sr*sp*sy};
}
export function rotate3(v:Vec3,q:Quat):Vec3 {
    const [x,y,z]=v,tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
    return [x+q.w*tx+q.y*tz-q.z*ty,y+q.w*ty+q.z*tx-q.x*tz,z+q.w*tz+q.x*ty-q.y*tx];
}
export const inverse=(q:Quat):Quat=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
export const multiply=(a:Quat,b:Quat):Quat=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
export function faceFrame(b:Subsystem,s:Surface) {
    const face=s.faces[0],axis=face.endsWith('X')?0:face.endsWith('Y')?1:2,sign=face[0]==='+'?1:-1;
    const q=orientation(b.yaw,b.pitch,b.roll),offset:Vec3=[0,0,0],n:Vec3=[0,0,0];offset[axis]=b.size[axis]/2*sign;n[axis]=sign;
    const rotated=rotate3(offset,q);
    return {axis,sign,q,center:b.position.map((p,i)=>p+rotated[i]) as Vec3,normal:rotate3(n,q)};
}
export function launchDirection(s:Surface,q:Quat):Vec3 {return rotate3([Math.cos(s.pitch)*Math.cos(s.yaw),Math.cos(s.pitch)*Math.sin(s.yaw),Math.sin(s.pitch)],q);}
