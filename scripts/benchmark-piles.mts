import {writeFile} from 'node:fs/promises';
import {RAPIER} from '../simulation/runtime';
import {ENGINE_VERSION,DT} from '../contracts/model';
import {createPile,drivePile,type PileType} from '../tests/fixtures/pile';
await RAPIER.init();
const cases:{type:PileType;count:number}[]=[{type:'empty',count:0},{type:'coral',count:18},{type:'coral',count:36},{type:'mixed',count:36},{type:'algae',count:36}];
const results=[];
for(const {type,count} of cases){
 const sim=createPile(type,count),durations:number[]=[];
 try{
  for(let tick=0;tick<240;tick++){const start=performance.now();drivePile(sim,tick);durations.push(performance.now()-start);}
  durations.sort((a,b)=>a-b);
  const result={type,count,ticks:durations.length,meanMs:durations.reduce((a,b)=>a+b,0)/durations.length,p95Ms:durations[Math.floor(durations.length*.95)],p99Ms:durations[Math.floor(durations.length*.99)],maxMs:durations.at(-1),remainingBodies:sim.bodies.size,escapedPieces:sim.escaped.length,storedPieces:sim.field.snapshot().reduce((n,row)=>n+row.pieces.length,0)};
  results.push(result);console.log(JSON.stringify(result));
 }finally{sim.free();}
}
const report={engine:ENGINE_VERSION,physicsTickBudgetMs:DT*1000,scope:'Local CPU simulation timings including initial pile separation; no browser rendering or FPS measurement. All cases preserve 120 Hz physics and CCD.',cases:results};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
