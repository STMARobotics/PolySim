import type {RobotDocument} from '../contracts/model';
export function subsystemTree(document:RobotDocument) {
    return document.subsystems.map(subsystem=>({subsystem,states:(subsystem.states??[]).map(state=>({state,actions:document.surfaces.filter(a=>a.owner===subsystem.id&&a.stateId===state.id)}))}));
}
