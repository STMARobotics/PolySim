export function keyboardDrive(keys: ReadonlySet<string>) {
    const x = Number(keys.has('w')) - Number(keys.has('s'));
    const y = Number(keys.has('a')) - Number(keys.has('d'));
    const norm = Math.max(1, Math.hypot(x, y));
    return {x: x / norm, y: y / norm, turn: Number(keys.has('arrowleft')) - Number(keys.has('arrowright'))};
}
