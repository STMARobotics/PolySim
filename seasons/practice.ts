import {syncSurfaceLinks,type RobotDocument} from '../contracts/model';
import {practice} from './practice-field';
export {practice} from './practice-field';
export function sampleRobot(): RobotDocument {
    return syncSurfaceLinks({
        schemaVersion: 1, id: crypto.randomUUID(), name: 'Atlas · collector prototype', seasonId: practice.id, revision: 1,
        basics: { length: 0.85, width: 0.78, height: 0.22, mass: 52, wheelDiameter: 0.1016, reduction: 6.75, motorRPM: 6380, loadedSpeed: 3.5, acceleration: 3, angularSpeed: 3 },
        subsystems: [
            { id: 'collector', name: 'Collector', position: [0.51, 0, 0.18], size: [0.32, 0.7, 0.32], yaw: 0, capacity: 1, solid: true },
            { id: 'hopper', name: 'Hopper', position: [0, 0, 0.45], size: [0.52, 0.58, 0.4], yaw: 0, capacity: 4, solid: true },
            { id: 'launcher', name: 'Launcher', position: [0.24, 0, 0.8], size: [0.34, 0.4, 0.3], yaw: 0, capacity: 1, solid: true },
        ],
        surfaces: [
            { id: 'intake', name: 'Front intake', owner: 'collector', faces: ['+X'], type: 'intake', interval: 0.2, speed: 8, yaw: 0, pitch: 0.48, spin: [0, 0, 0] },
            { id: 'outtake', name: 'Ball launch', owner: 'launcher', faces: ['+X'], type: 'outtake', interval: 0.25, speed: 10, yaw: 0, pitch: 0.62, spin: [0, 0, 0] },
        ],
        edges: [
            { id: 'capture', source: 'intake', target: 'collector', duration: 0, key: 'i', trigger: 'hold', priority: 0, concurrency: 1 },
            { id: 'store', source: 'collector', target: 'hopper', duration: 0.25, key: 'i', trigger: 'hold', priority: 0, concurrency: 1 },
            { id: 'feed', source: 'hopper', target: 'launcher', duration: 0.35, key: 'j', trigger: 'hold', priority: 0, concurrency: 1 },
            { id: 'shoot', source: 'launcher', target: 'outtake', duration: 0, key: 'k', trigger: 'hold', priority: 0, concurrency: 1 },
        ],
        layout: { intake: [35, 90], collector: [255, 90], hopper: [475, 90], launcher: [695, 90], outtake: [915, 90] },
    });
}
