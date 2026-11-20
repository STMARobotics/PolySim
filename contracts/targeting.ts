import type {Vec3} from './model';

export const TARGETING_MODES = ['turret','sotm-turret','aim-with-drivetrain','manual'] as const;
export type TargetingMode = typeof TARGETING_MODES[number];
export const TARGETING_OPTIONS: [TargetingMode,string][] = [['turret','Turret'],['sotm-turret','SOTM Turret'],['aim-with-drivetrain','Aim with Drivetrain'],['manual','Manual']];
export const DEFAULT_TARGETING_FREEDOM = Math.PI*2;
export const isTurretMode = (mode:TargetingMode|undefined) => mode==='turret'||mode==='sotm-turret';
export interface ScoringTarget {id:string;position:Vec3;valid:boolean;accepts?:string[]}
