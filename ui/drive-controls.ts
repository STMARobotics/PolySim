import {normalizeBinding} from '../contracts/bindings';
import {nodeName,surfaceForEdge,type RobotDocument} from '../contracts/model';

export function keyboardDrive(keys: ReadonlySet<string>) {
    const x = Number(keys.has('w')) - Number(keys.has('s'));
    const y = Number(keys.has('a')) - Number(keys.has('d'));
    const norm = Math.max(1, Math.hypot(x, y));
    return {x: x / norm, y: y / norm, turn: Number(keys.has('arrowleft')) - Number(keys.has('arrowright'))};
}
export function gamepadControls(pad?:Pick<Gamepad,'axes'|'buttons'>|null){
    const axis=(i:number)=>Math.abs(pad?.axes[i]??0)>.15?pad!.axes[i]:0;
    const held:string[]=[];
    pad?.buttons.slice(0,32).forEach((button,i)=>{if(button.pressed||button.value>.5)held.push(`gamepad:button:${i}`);});
    pad?.axes.slice(0,16).forEach((value,i)=>{if(Math.abs(value)>.65)held.push(`gamepad:axis:${i}:${value>0?'+':'-'}`);});
    return {x:-axis(1),y:-axis(0),turn:-axis(2),held};
}
export function gamepadHeldBindings(d:RobotDocument,held:readonly string[]){
    const bindings=new Set([...d.edges,...d.subsystems.flatMap(s=>s.stateTransitions??[])].map(e=>normalizeBinding(e.key)));
    // Preserve the original three action buttons until the user assigns a button explicitly.
    return [...held,...['i','j','k'].filter((key,i)=>held.includes(`gamepad:button:${i}`)&&!bindings.has(`gamepad:button:${i}`)&&bindings.has(key))];
}
export function driveBindings(d:RobotDocument){
    const groups=new Map<string,Set<string>>();
    const add=(key:string,label:string)=>{const normalized=normalizeBinding(key);if(!normalized)return;if(!groups.has(normalized))groups.set(normalized,new Set());groups.get(normalized)!.add(label);};
    for(const edge of d.edges){const action=surfaceForEdge(d,edge);add(edge.key,action?.name??`${nodeName(d,edge.source)} → ${nodeName(d,edge.target)}`);}
    for(const sub of d.subsystems)for(const edge of sub.stateTransitions??[])add(edge.key,`${sub.name}: ${sub.states?.find(s=>s.id===edge.target)?.name??'Unknown state'}`);
    return [...groups].map(([key,labels])=>({key,label:[...labels].join(' / ')}));
}
