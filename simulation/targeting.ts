import type {RobotDocument,Subsystem,Surface,Vec3} from '../contracts/model';
import {faceFrame,launchDirection,orientation,rotate3} from '../contracts/geometry';
import {DEFAULT_TARGETING_FREEDOM,isTurretMode,type ScoringTarget} from '../contracts/targeting';
import {triggerActive} from '../contracts/triggers';
import type {StateEngine} from './states';
import type {GraphEngine} from './graph';
import {pieceTypesFor} from '../seasons/registry';

export interface AimPose {x:number;y:number;yaw:number}
export interface AimMotion {x:number;y:number;omega:number}
export interface AimSolution {yaw:number;heading:number;target:ScoringTarget;timeOfFlight:number;limited:boolean}
export const angleDelta=(angle:number,reference:number)=>Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const worldPoint=(point:Vec3,pose:AimPose):Vec3=>{const v=rotate3(point,orientation(pose.yaw));return [pose.x+v[0],pose.y+v[1],v[2]];};

export function nearestTarget(origin:Vec3,targets:readonly ScoringTarget[]):ScoringTarget|undefined {
    let nearest:ScoringTarget|undefined,best=Infinity;
    for(const target of targets) {
        if(!target.valid || !target.position.every(Number.isFinite) || Math.hypot(target.position[0]-origin[0],target.position[1]-origin[1])<1e-6)continue;
        const distance=target.position.reduce((sum,value,i)=>sum+(value-origin[i])**2,0);
        if(!Number.isFinite(distance))continue;
        if(distance<best || (distance===best && target.id.localeCompare(nearest!.id)<0)){nearest=target;best=distance;}
    }
    return nearest;
}

// Yaw pre-multiplies pitch/roll: the world vertical axis stays through the box center.
// Only azimuth is controlled. Launch elevation and speed remain the user's settings.
export function solveTurretAim(sub:Subsystem,startYaw:number,pose:AimPose,motion:AimMotion,targets:readonly ScoringTarget[],surface?:Surface,sotm=false,releaseClearance=.135):AimSolution|undefined {
    const center=worldPoint(sub.position,pose),target=nearestTarget(center,targets);if(!target)return;
    const q=orientation(startYaw,sub.pitch,sub.roll);
    const bore=surface?launchDirection(surface,q):rotate3([1,0,0],q);
    const horizontal=Math.hypot(bore[0],bore[1]);
    const boreAngle=horizontal>1e-8?Math.atan2(bore[1],bore[0]):startYaw;
    const half=clamp(sub.targetingFreedom ?? DEFAULT_TARGETING_FREEDOM,0,2*Math.PI)/2;
    const desired=(bearing:number)=>startYaw+angleDelta(bearing,pose.yaw+boreAngle);
    let yaw=desired(Math.atan2(target.position[1]-center[1],target.position[0]-center[0]));
    const speed=surface?surface.speed*horizontal:0;
    let time=sotm&&speed>.05?clamp(Math.hypot(target.position[0]-center[0],target.position[1]-center[1])/speed,0,10):0;
    for(let iteration=0;iteration<10;iteration++) {
        const aimed={...sub,yaw:startYaw+clamp(yaw-startYaw,-half,half)};
        const frame=surface?faceFrame(aimed,surface):undefined;
        const local=frame?frame.center.map((value,i)=>value+frame.normal[i]*releaseClearance) as Vec3:sub.position;
        const origin=worldPoint(local,pose),offset=[origin[0]-pose.x,origin[1]-pose.y];
        const vx=motion.x-motion.omega*offset[1],vy=motion.y+motion.omega*offset[0];
        const dx=target.position[0]-origin[0]-(sotm?vx*time:0),dy=target.position[1]-origin[1]-(sotm?vy*time:0);
        yaw=desired(Math.atan2(dy,dx));
        if(sotm && speed>.05)time=clamp(Math.hypot(dx,dy)/speed,0,10);
    }
    const offset=clamp(yaw-startYaw,-half,half),result=startYaw+offset;
    return {yaw:result,heading:pose.yaw+boreAngle+(result-startYaw),target,timeOfFlight:time,limited:Math.abs(offset-(yaw-startYaw))>1e-8};
}

export function aimingTurn(error:number,maxSpeed:number):number {
    // Brake within the same 6 rad/s² acceleration limit used by the drivetrain.
    return Math.sign(error)*Math.min(maxSpeed,4*Math.abs(error),Math.sqrt(12*Math.abs(error)));
}

export class TargetingEngine {
    private startupYaw=new Map<string,number>();
    constructor(private document:RobotDocument,private states:StateEngine,private graph:GraphEngine,private targets:readonly ScoringTarget[],private clearance:number) {
        for(const sub of document.subsystems)this.startupYaw.set(sub.id,sub.yaw);
    }
    setTargets(targets:readonly ScoringTarget[]){this.targets=targets;}
    update(pose:AimPose,motion:AimMotion,held:Set<string>,pressed:Set<string>):number|undefined {
        const driveRequests:{heading:number;distance:number;id:string}[]=[];
        for(const sub of this.document.subsystems) {
            const mode=sub.targetingMode ?? 'manual';if(mode==='manual')continue;
            const actions=this.document.surfaces.filter(s=>s.owner===sub.id && this.states.active(s)).sort((a,b)=>a.id.localeCompare(b.id));
            const active=actions.filter(surface=>{
                return this.graph.transitions(surface.id).some(edge=>{
                // Press requests one operation, but its held key keeps driver aiming engaged.
                return triggerActive(edge.trigger==='press'?'hold':edge.trigger,edge.key,held,pressed) || [...this.graph.tokens.values()].some(t=>t.node===surface.id || t.flight?.edge===edge.id);
                });
            });
            const reference=active.find(s=>s.type==='outtake') ?? actions.find(s=>s.type==='outtake');
            const channelSurface=(reference&&active.includes(reference)?reference:active[0]) ?? reference;
            const channels=channelSurface?this.graph.transitions(channelSurface.id).filter(e=>triggerActive(e.trigger==='press'?'hold':e.trigger,e.key,held,pressed)||[...this.graph.tokens.values()].some(t=>t.node===channelSurface.id||t.flight?.edge===e.id)).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)):[];
            const channel=channels.find(e=>[...this.graph.tokens.values()].some(t=>(t.pieceType ?? pieceTypesFor(this.document)[0].id)===(e.pieceType ?? pieceTypesFor(this.document)[0].id)&&!t.flight&&t.node===e.source)) ?? channels[0];
            const types=channel?[channel.pieceType ?? pieceTypesFor(this.document)[0].id]:reference?.accepts;
            const targets=this.targets.filter(t=>!t.accepts||!types||t.accepts.some(type=>types.includes(type)));
            if(isTurretMode(mode)) {
                const solution=solveTurretAim(sub,this.startupYaw.get(sub.id)!,pose,motion,targets,reference,mode==='sotm-turret',this.clearance);
                if(solution)sub.yaw=solution.yaw;
            } else if(mode==='aim-with-drivetrain' && active.length) {
                const center=worldPoint(sub.position,pose),target=nearestTarget(center,targets);if(!target)continue;
                // Treat the chassis as the rotating assembly: subsystem position and bore both rotate about its origin.
                const muzzle=reference?faceFrame(sub,reference):undefined;
                const local=muzzle?muzzle.center.map((v,i)=>v+muzzle.normal[i]*this.clearance) as Vec3:sub.position;
                const direction=reference?launchDirection(reference,orientation(sub.yaw,sub.pitch,sub.roll)):rotate3([1,0,0],orientation(sub.yaw,sub.pitch,sub.roll));
                if(Math.hypot(direction[0],direction[1])<1e-8)continue;
                let heading=pose.yaw;
                for(let i=0;i<8;i++) {
                    const offset=rotate3(local,orientation(heading));
                    heading=Math.atan2(target.position[1]-pose.y-offset[1],target.position[0]-pose.x-offset[0])-Math.atan2(direction[1],direction[0]);
                }
                driveRequests.push({heading,distance:Math.hypot(target.position[0]-center[0],target.position[1]-center[1]),id:sub.id});
            }
        }
        return driveRequests.sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id))[0]?.heading;
    }
}
