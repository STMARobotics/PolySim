import type { Vec3 } from '../contracts/model';

// Grid X runs across the release face, and Y runs up it. On horizontal faces
// both axes lie in the horizontal plane. Old documents default to one piece.
export function outtakeOffsets(unitsX: number, unitsY: number, available: number, axis: number, spacing: number): Vec3[] {
    const count = Math.min(unitsX * unitsY, available);
    if (!count) return [];
    const columns = Math.min(unitsX, count), rows = Math.ceil(count / columns);
    return Array.from({length: count}, (_, i) => {
        const row = Math.floor(i / columns), rowCount = Math.min(columns, count - row * columns);
        const p: Vec3 = [0, 0, 0];
        p[axis === 0 ? 1 : 0] = (i % columns - (rowCount - 1) / 2) * spacing;
        p[axis === 2 ? 1 : 2] = (row - (rows - 1) / 2) * spacing;
        return p;
    });
}
