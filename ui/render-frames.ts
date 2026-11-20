import { DT,type Subsystem } from '../contracts/model';
import {DEFAULT_TARGETING_FREEDOM,isTurretMode} from '../contracts/targeting';
import type { Snapshot } from '../simulation/protocol';
type Frame = Pick<Snapshot, 'tick' | 'pose' | 'pieces' | 'subsystems'>;
export class RenderFrames {
    previous?: Frame;
    current?: Frame;
    previousPieces = new Map<string, Snapshot['pieces'][number]>();
    private received = 0;
    private interval = 0;
    clear() { this.previous = this.current = undefined; this.previousPieces.clear(); }
    push(s: Snapshot, now: number) {
        const frame: Frame = {tick: s.tick, pose: s.pose, pieces: s.pieces,subsystems:s.subsystems};
        const interpolate = !!this.current && s.running && s.tick > this.current.tick;
        this.previous = interpolate ? this.current : frame;
        this.interval = interpolate ? Math.max(1000 * DT, Math.min(100, (s.tick - this.current!.tick) * DT * 1000)) : 0;
        this.current = frame;
        this.received = now;
        this.previousPieces = new Map(this.previous!.pieces.map(p => [p.id, p]));
    }
    alpha(now: number) { return this.interval ? Math.max(0, Math.min(1, (now - this.received) / this.interval)) : 1; }
}
export function blendYaw(a: number, b: number, alpha: number) {
    return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
}

export function blendSubsystemYaw(a:number,b:number,alpha:number,sub?:Subsystem) {
    // A bounded turret must travel inside its allowed interval, even across ±180°.
    return isTurretMode(sub?.targetingMode) && (sub?.targetingFreedom ?? DEFAULT_TARGETING_FREEDOM)<2*Math.PI ? a+(b-a)*alpha : blendYaw(a,b,alpha);
}
