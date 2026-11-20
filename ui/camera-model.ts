import type { Vec3 } from '../contracts/model';
import { MOUSE } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export function configureEditOrbit(controls: OrbitControls) {
    controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    controls.zoomToCursor = true;
    controls.maxPolarAngle = Math.PI - .01;
}
export type DriverStation = 1 | 2 | 3;
export function stationCameraPosition(station: DriverStation, fieldLength = 12, fieldWidth = 8): Vec3 {
    return [-fieldLength / 2 - 1.2, (2 - station) * fieldWidth / 3, 1.65];
}
export function trackingFactor(dt: number, response = 12): number {
    return 1 - Math.exp(-response * Math.max(0, Math.min(.1, dt)));
}
