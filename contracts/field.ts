import type {Face,Vec3} from './model';
export interface ScoringSurface {id:string;name:string;faces:Face[];accepts:string[]}
export interface ScoringElement {id:string;name:string;position:Vec3;size:Vec3;yaw:number;pitch:number;roll:number;points:number;capacity:number;accepts:string[];surfaces:ScoringSurface[]}
export interface PieceSource {id:string;name:string;position:Vec3;velocity:Vec3;pieceType:string;enabled:boolean;mode:'proximity'|'continuous';proximity:number;cooldown:number}
export interface FieldConfiguration {scoringElements:ScoringElement[];sources:PieceSource[];bounciness?:Record<string,number>}
export interface FieldBox {id:string;position:Vec3;size:Vec3;yaw?:number;pitch?:number;roll?:number;color:number;solid:boolean}
export interface PieceDefinition {id:string;name:string;shape:'sphere'|'box'|'tube';size:Vec3;radius:number;innerRadius?:number;mass:number;color:number;bounciness?:number}
export interface SeasonDefinition {id:string;title:string;version:string;length:number;width:number;start:Vec3;pieceTypes:PieceDefinition[];pieces:{id:string;type:string;position:Vec3}[];geometry:FieldBox[];defaults:FieldConfiguration}
