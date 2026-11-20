import type { RobotDocument, Vec3 } from '../contracts/model';
import type { Token, EdgeMetric } from './graph';
export interface Controls {
    x: number;
    y: number;
    turn: number;
    held: string[];
}
export interface InputFrame {
    tick: number;
    controls: Controls;
}
export interface Snapshot {
    fieldInventory?: {element:string;pieces:{id:string;type:string}[]}[];
    subsystems?: import('./states').ActiveGeometry[];
    tick: number;
    running: boolean;
    pose: {
        x: number;
        y: number;
        yaw: number;
    };
    pieces: {
        type?: string;
        id: string;
        position: Vec3;
        rotation: [
            number,
            number,
            number,
            number
        ];
    }[];
    tokens: Token[];
    edgeMetrics: Record<string, EdgeMetric>;
    score: number;
    pickups: number;
    releases: number;
    scored: number;
    escaped: string[];
    cycles: number[];
    log: string[];
    blocked: string[];
    recording: InputFrame[];
    recordingOffset?: number;
    slow: boolean;
}
export type ToWorker = {
    type: 'init';
    document: RobotDocument;
    replay?: InputFrame[];
    endTick?: number;
} | {
    type: 'play' | 'pause' | 'step' | 'reset';
} | {
    type: 'controls';
    controls: Controls;
};
export type FromWorker = {
    type: 'snapshot';
    snapshot: Snapshot;
} | {
    type: 'ready';
} | {
    type: 'error';
    message: string;
};
