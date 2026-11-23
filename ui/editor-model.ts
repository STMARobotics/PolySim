import {snapSize,snapMetres,HALF_INCH} from '../contracts/inch-grid';
import type { RobotDocument, Vec3 } from '../contracts/model';
import { nodePosition } from './graph-model';
export const NODE_WIDTH = 192, NODE_HEIGHT = 144;
export function nextNodePosition(document: RobotDocument): [
    number,
    number
] {
    const occupied = [...Object.values(document.layout), ...[...document.subsystems, ...document.surfaces].map(n => nodePosition(document, n.id))];
    for (let i = 0; i < 1000; i++) {
        const x = 48 + (i % 4) * 288, y = 96 + Math.floor(i / 4) * 240;
        if (occupied.every(([ox, oy]) => Math.abs(x - ox) >= NODE_WIDTH + 28 || Math.abs(y - oy) >= NODE_HEIGHT + 28))
            return [x, y];
    }
    return [48, Math.ceil(Math.max(0, ...occupied.map(p => p[1]))/24)*24 + 240];
}
export function inventoryFraction(owned: number, capacity: number): number {
    return capacity > 0 ? Math.max(0, Math.min(1, owned / capacity)) : 0;
}
export function fillBounds(height: number, owned: number, capacity: number): [
    number,
    number
] {
    return [-height / 2, -height / 2 + height * inventoryFraction(owned, capacity)];
}
export function resizedDimensions(size: Vec3, scale: Vec3,max=3): Vec3 {
    return size.map((n,i)=>snapMetres(n*scale[i],HALF_INCH,max)) as Vec3;
}
