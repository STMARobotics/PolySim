import * as THREE from 'three';
import {FACES,type Face,type Vec3} from '../contracts/model';
export interface FaceTarget {owner:string;face:Face;screen:[number,number]}
export interface ViewRect {left:number;top:number;width:number;height:number}
export function nearestActionFace(camera:THREE.Camera,meshes:THREE.Mesh[],rect:ViewRect,x:number,y:number,valid:(owner:string,face:Face)=>boolean,radius=36):FaceTarget|undefined {
    if(rect.width<=0||rect.height<=0||x<rect.left||y<rect.top||x>rect.left+rect.width||y>rect.top+rect.height)return;
    camera.updateMatrixWorld();for(const mesh of meshes)mesh.updateWorldMatrix(true,false);
    const ray=new THREE.Raycaster(),pointer=new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);
    const center=(mesh:THREE.Mesh,index:number)=>{
        const face=FACES[index],axis=Math.floor(index/2),base=mesh.userData.baseSize as Vec3,local=new THREE.Vector3();
        local.setComponent(axis,base[axis]/2*(face[0]==='+'?1:-1));const world=mesh.localToWorld(local);
        const projected=world.clone().project(camera);
        return {world,projected,screen:[rect.left+(projected.x+1)*rect.width/2,rect.top+(1-projected.y)*rect.height/2] as [number,number]};
    };
    ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(meshes,false)[0];
    if(hit) {
        const mesh=hit.object as THREE.Mesh,index=Math.floor((hit.faceIndex??0)/2),face=FACES[index],owner=mesh.userData.id;
        if(valid(owner,face))return {owner,face,screen:center(mesh,index).screen};
    }
    const candidates:{target:FaceTarget;distance:number;projected:THREE.Vector3;mesh:THREE.Mesh;index:number}[]=[];
    for(const mesh of meshes)for(const [index,face] of FACES.entries()) {
        if(!valid(mesh.userData.id,face))continue;
        const c=center(mesh,index);if(c.projected.z<-1||c.projected.z>1)continue;
        const normal=new THREE.Vector3().setComponent(Math.floor(index/2),face[0]==='+'?1:-1).transformDirection(mesh.matrixWorld);
        if(normal.dot(camera.getWorldPosition(new THREE.Vector3()).sub(c.world))<=0)continue;
        const distance=Math.hypot(c.screen[0]-x,c.screen[1]-y);if(distance>radius)continue;
        candidates.push({target:{owner:mesh.userData.id,face,screen:c.screen},distance,projected:c.projected,mesh,index});
    }
    for(const candidate of candidates.sort((a,b)=>a.distance-b.distance)) {
        ray.setFromCamera(new THREE.Vector2(candidate.projected.x,candidate.projected.y),camera);
        const first=ray.intersectObjects(meshes,false)[0];
        if(first?.object===candidate.mesh && Math.floor((first.faceIndex??0)/2)===candidate.index)return candidate.target;
    }
}
