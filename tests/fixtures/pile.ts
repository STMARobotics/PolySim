import {Simulation} from '../../simulation/runtime';
import {createSeasonRobot} from '../../seasons/registry';
import {orientation} from '../../contracts/geometry';
export type PileType='coral'|'algae'|'mixed'|'empty';
export function createPile(type:PileType,count:number){
 const document=createSeasonRobot('reefscape-2025');document.field!.sources=[];
 const sim=new Simulation(document);
 for(const body of sim.bodies.values())sim.world.removeRigidBody(body);sim.bodies.clear();
 sim.robot.setTranslation({x:-4,y:2,z:0},true);
 if(type!=='empty')for(let i=0;i<count;i++){
  const piece=type==='mixed'?(i%3?'coral':'algae'):type,radius=piece==='coral'?.058:.207;
  // Deliberately crowded, partially overlapping initial placements stress both
  // pile separation and repeated robot contact rather than empty-field driving.
  (sim as any).spawn('pile:'+i,[-2.8+(i%6)*.17,1.7+(Math.floor(i/6)%3)*.22,radius+Math.floor(i/18)*.15],[0,0,0],[0,0,0],piece,orientation((i%3)*Math.PI/3));
 }
 return sim;
}
export function drivePile(sim:Simulation,tick:number){
 if(tick>0&&tick%180===0){sim.robot.setTranslation({x:-4,y:2,z:0},true);sim.robot.setLinvel({x:0,y:0,z:0},true);}
 sim.step({x:1,y:0,turn:0,held:[]});
}
