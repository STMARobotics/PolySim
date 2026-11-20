import type {RobotDocument,Vec3} from './model';
export const INCH=.0254, HALF_INCH=INCH/2;
// Clamp integer grid coordinates, not metric values, so bounds remain on the grid.
export function snapMetres(value:number,min=-Infinity,max=Infinity) {
    if(!Number.isFinite(value))return value;
    const units=Math.max(Math.ceil(min/HALF_INCH-1e-9),Math.min(Math.floor(max/HALF_INCH+1e-9),Math.round(value/HALF_INCH)));
    return Math.round(units*HALF_INCH*1e10)/1e10;
}
export const snapPosition=(value:Vec3)=>value.map(v=>snapMetres(v,-5,5)) as Vec3;
export const snapSize=(value:Vec3)=>value.map(v=>snapMetres(v,HALF_INCH,3)) as Vec3;
export function snapDocumentInches(d:RobotDocument) {
    for(const key of ['length','width','height','wheelDiameter'] as const)d.basics[key]=snapMetres(d.basics[key],HALF_INCH,3);
    for(const sub of d.subsystems) {
        sub.position=snapPosition(sub.position);sub.size=snapSize(sub.size);
        for(const state of sub.states ?? []) {state.position=snapPosition(state.position);state.size=snapSize(state.size);}
    }
    for(const goal of d.field?.scoringElements ?? []) {goal.position=goal.position.map(v=>snapMetres(v,-50,50)) as Vec3;goal.size=goal.size.map(v=>snapMetres(v,HALF_INCH,12)) as Vec3;}
    for(const source of d.field?.sources ?? []) {source.position=source.position.map(v=>snapMetres(v,-50,50)) as Vec3;source.proximity=snapMetres(source.proximity,0,30);}
    return d;
}
