import {snapMetres,HALF_INCH} from '../contracts/inch-grid';
// Documents and physics use SI units; editable inch values use a half-inch grid.
export function displayScale(path: string): number {
    if (inchProperty(path)) return 1 / .0254;
    if (path === 'basics.mass') return 1 / .45359237;
    if (/\.(yaw|pitch|roll)$/.test(path) || path === 'sub.targetingFreedom' || path === 'basics.angularSpeed' || /^surface\.spin\.\d$/.test(path)) return 180 / Math.PI;
    return 1;
}
export function displayValue(path: string, value: number): number {
    return inchProperty(path)?Math.round(value/.0254*2)/2:Math.round(value * displayScale(path) * 10000) / 10000;
}
export function storedValue(path: string, value: number): number {
    const metric=value/displayScale(path);
    const [min,max]=inchMetricBounds(path);
    return inchProperty(path)?snapMetres(metric,min,max):metric;
}

export function displayIssue(message: string): string {
    if (message === 'Chassis dimensions must be at most 3 m.') return 'Chassis dimensions must be at most 118 in.';
    const match = message.match(/^(.+) must be between 0 and (\d+)\.$/);
    if (!match) return message;
    const names: Record<string, [string, string]> = {
        length: ['basics.length', 'in'], width: ['basics.width', 'in'], height: ['basics.height', 'in'],
        wheelDiameter: ['basics.wheelDiameter', 'in'], loadedSpeed: ['basics.loadedSpeed', 'm/s'],
        acceleration: ['basics.acceleration', 'm/s²'], angularSpeed: ['basics.angularSpeed', 'deg/s'],
        mass: ['basics.mass', 'lb'], Dimension: ['sub.size.0', 'in'], 'Exit speed': ['surface.speed', 'm/s'],
    };
    const unit = names[match[1]];
    return unit ? `${match[1]} must be between 0 and ${displayValue(unit[0], Number(match[2])).toFixed(2)} ${unit[1]}.` : message;
}

export function inchProperty(path:string) {return /^(sub|state|goal|source)\.(position|size)\.\d$/.test(path) || path==='source.proximity' || /^basics\.(length|width|height|wheelDiameter)$/.test(path);}
function inchMetricBounds(path:string):[number,number] {if(path==='source.proximity')return [0,30];if(/^(goal|source)\./.test(path))return path.includes('.position.')?[-50,50]:[HALF_INCH,12];return path.includes('.position.')?[-5,5]:[HALF_INCH,3];}
export function inchInputLimits(path:string){const [min,max]=inchMetricBounds(path);return `min="${Math.ceil(min/HALF_INCH-1e-8)/2}" max="${Math.floor(max/HALF_INCH+1e-8)/2}"`;}
export const propertyStep=(path:string,fallback='.01')=>inchProperty(path)?'.5':fallback;
