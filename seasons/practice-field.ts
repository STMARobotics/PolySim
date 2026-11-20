import type {Vec3} from '../contracts/model';
import type {ScoringTarget} from '../contracts/targeting';
const basket={ x:4.75,y:0,width:2,height:1.8,depth:.7 };
export const practice = {
    id: 'practice-balls', title: 'Practice Lab', version: '1.0.0',
    length: 12, width: 8, radius: 0.09, mass: 0.27,
    start: [-3.8, 0, 0] as Vec3,
    target: basket,
    scoringTargets: [{id:'practice-basket',position:[basket.x,basket.y,basket.height],valid:true}] as ScoringTarget[],
    obstacle: { x: 0.3, y: 2.5, length: 1.3, width: 0.5, height: 0.5 },
    // Deliberately fixed fixture. No random hidden variation in this first build.
    pieces: Array.from({ length: 18 }, (_, i) => ({ id: `ball-${i + 1}`, position: [-2.3 + (i % 6) * 0.8, (Math.floor(i / 6) - 1) * 0.65, 0.11] as Vec3 })),
};
