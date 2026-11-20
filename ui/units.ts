// Documents and physics retain SI units so existing robots keep their geometry.
// Conversion happens only at the inspector boundary.
export function displayScale(path: string): number {
    if (/^sub\.(position|size)\.\d$/.test(path) || /^basics\.(length|width|height|wheelDiameter|loadedSpeed|acceleration)$/.test(path) || path === 'surface.speed') return 1 / .0254;
    if (path === 'basics.mass') return 1 / .45359237;
    if (/\.(yaw|pitch)$/.test(path) || path === 'basics.angularSpeed' || /^surface\.spin\.\d$/.test(path)) return 180 / Math.PI;
    return 1;
}
export function displayValue(path: string, value: number): number {
    return Math.round(value * displayScale(path) * 10000) / 10000;
}
export function storedValue(path: string, value: number): number {
    return value / displayScale(path);
}

export function displayIssue(message: string): string {
    if (message === 'Chassis dimensions must be at most 3 m.') return 'Chassis dimensions must be at most 118.11 in.';
    const match = message.match(/^(.+) must be between 0 and (\d+)\.$/);
    if (!match) return message;
    const names: Record<string, [string, string]> = {
        length: ['basics.length', 'in'], width: ['basics.width', 'in'], height: ['basics.height', 'in'],
        wheelDiameter: ['basics.wheelDiameter', 'in'], loadedSpeed: ['basics.loadedSpeed', 'in/s'],
        acceleration: ['basics.acceleration', 'in/s²'], angularSpeed: ['basics.angularSpeed', 'deg/s'],
        mass: ['basics.mass', 'lb'], Dimension: ['sub.size.0', 'in'], 'Exit speed': ['surface.speed', 'in/s'],
    };
    const unit = names[match[1]];
    return unit ? `${match[1]} must be between 0 and ${displayValue(unit[0], Number(match[2])).toFixed(2)} ${unit[1]}.` : message;
}
