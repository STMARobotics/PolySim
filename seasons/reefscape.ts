import type {FieldBox,ScoringElement,SeasonDefinition} from '../contracts/field';
import type {Vec3} from '../contracts/model';
const inch=(value:number)=>value*.0254;
// Reef-center and processor X inferred from opposing tag faces in WPILib's
// v2025.3.2 2025-reefscape-welded.json; the manual's 12 ft locates the near face.
const length=inch(690.875),width=inch(317),reefX=length/2-(3.6576+5.321046)/2;
const geometry:FieldBox[]=[],goals:ScoringElement[]=[],pieces:SeasonDefinition['pieces']=[];
function box(id:string,position:Vec3,size:Vec3,color:number,yaw=0,pitch=0){geometry.push({id,position,size,yaw,pitch,color,solid:true});}
function goal(id:string,name:string,position:Vec3,size:Vec3,yaw:number,points:number,capacity:number,type:string,faces:ScoringElement['surfaces'][number]['faces']=['+Z']){
    goals.push({id,name,position,size,yaw,pitch:0,roll:0,points,capacity,accepts:[type],surfaces:[{id:id+':surface',name:'Scoring surface',faces,accepts:[type]}]});
}
for(const sign of [-1,1]) {
    const team=sign<0?'Blue':'Red',prefix=team.toLowerCase(),x=sign*reefX,color=sign<0?0x286dcc:0xc93648;
    for(let side=0;side<6;side++) {
        const yaw=side*Math.PI/3,c=Math.cos(yaw),s=Math.sin(yaw),cx=x+c*.76,cy=s*.76;
        box(`${prefix}:reef-wall:${side}`,[cx,cy,.225],[.12,.90,.45],color,yaw);
        goal(`${prefix}:reef:l1:${side}`,`${team} reef L1 · ${side+1}`,[x+c*.86,s*.86,inch(16.5)],[.30,.74,inch(3)],yaw,2,12,'coral');
        for(const [branch,tangent] of [-inch(6.5),inch(6.5)].entries()) {
            const bx=x+c*.73-s*tangent,by=s*.73+c*tangent;
            box(`${prefix}:post:${side}:${branch}`,[bx,by,inch(36)],[.04,.04,inch(72)],0x99a8b7,yaw);
            for(const [level,height,points] of [[2,31.875,3],[3,47.625,4],[4,72,5]]) {
                if(level<4)box(`${prefix}:branch:${side}:${branch}:${level}`,[bx+c*.055,by+s*.055,inch(height)-.07],[.20,.035,.035],0xc4cfda,yaw,-35*Math.PI/180);
                goal(`${prefix}:reef:l${level}:${side}:${branch}`,`${team} reef L${level} · ${side*2+branch+1}`,[bx+c*.07,by+s*.07,inch(height)],[.20,.18,.09],yaw,points,1,'coral',['+Z','+X']);
            }
        }
        const z=side%2?inch(47.625)-.08:inch(31.875)+.16;
        const pos:Vec3=[x+c*.93,s*.93,z];
        box(`${prefix}:algae-rest:${side}`,[pos[0],pos[1],z-inch(8.125)-.025],[.24,.24,.05],color,yaw);
        pieces.push({id:`${prefix}:reef-algae:${side}`,type:'algae',position:pos});
    }
    for(const y of [-1.83,0,1.83]){
        pieces.push({id:`${prefix}:mark-coral:${y}`,type:'coral',position:[sign*(length/2-1.25),y,inch(2.25)]});
        pieces.push({id:`${prefix}:mark-algae:${y}`,type:'algae',position:[sign*(length/2-1.25),y,inch(4.5+8.125)]});
    }
    // Opposite sideline processor openings. Receiver boxes extend through the guardrail opening.
    const px=sign*(length/2-5.987542),py=sign*width/2;
    box(`${prefix}:processor:left`,[px-.47,py,inch(17)],[.23,.18,inch(34)],color);
    box(`${prefix}:processor:right`,[px+.47,py,inch(17)],[.23,.18,inch(34)],color);
    goal(`${prefix}:processor`,`${team} processor`,[px,py,inch(17)],[inch(28),.24,inch(20)],0,6,100,'algae',sign<0?['+Y']:['-Y']);
    goal(`${prefix}:net`,`${team} net`,[0,sign*1.85,inch(76)],[inch(48),inch(144),.14],0,4,100,'algae');
    for(const [index,y] of [inch(41.5),inch(84.375),inch(127.375)].entries()) {
        const z=index===0?inch(30.125):inch(3.125);
        for(const dx of [-inch(3.6875),inch(3.6875)])box(`${prefix}:cage:${index}:${dx}`,[dx,sign*y,z+inch(12)],[.035,inch(7.375),inch(24)],color);
    }
}
box('barge:crossbar',[0,0,inch(62)],[inch(44),width+.8,.18],0x8297ac);
box('barge:top',[0,0,inch(101)],[.16,width+.8,.16],0x8297ac);
for(const y of [-width/2-.15,0,width/2+.15])box('barge:leg:'+y,[0,y,inch(50.5)],[.23,.23,inch(101)],0x8297ac);
// Boundary segments leave real processor apertures; corner stations are represented by chamfered panels.
for(const sy of [-1,1]) {
    const opening=sy*(length/2-5.987542),half=inch(14),ends=[-length/2+1.05,opening-half,opening+half,length/2-1.05];
    for(const [a,b] of [[ends[0],ends[1]],[ends[2],ends[3]]])box(`rail:${sy}:${a}`,[(a+b)/2,sy*(width/2+.05),.254],[b-a,.10,.508],0x28496d);
    box('processor:sill:'+sy,[opening,sy*width/2,inch(3.5)],[inch(28),.12,inch(7)],0x28496d);
    box('processor:lintel:'+sy,[opening,sy*width/2,inch(30)],[inch(28),.12,inch(6)],0x28496d);
    for(const sx of [-1,1])box(`coral-station:${sx}:${sy}`,[sx*(length/2-.851154),sy*(width/2-.65532),.68],[inch(76),.14,1.36],sx<0?0x286dcc:0xc93648,-sx*sy*36*Math.PI/180);
}
for(const sx of [-1,1])box('alliance-wall:'+sx,[sx*(length/2+.05),0,.55],[.10,width-2.1,1.10],sx<0?0x286dcc:0xc93648);
export const reefscape:SeasonDefinition={id:'reefscape-2025',title:'2025 · REEFSCAPE',version:'1.1.0',length,width,start:[-6.8,0,0],
    pieceTypes:[{id:'coral',name:'Coral',shape:'tube',size:[inch(11.875),inch(4.5),inch(4.5)],radius:Math.hypot(inch(11.875)/2,inch(2.25)),innerRadius:inch(2),mass:.65,color:0xf4f3e8,bounciness:.35},{id:'algae',name:'Algae',shape:'sphere',size:[inch(16.25),inch(16.25),inch(16.25)],radius:inch(8.125),mass:.4,color:0x46c99a,bounciness:.35}],pieces,geometry,
    defaults:{bounciness:{coral:.35,algae:.35},scoringElements:goals,sources:[-1,1].flatMap(sx=>[-1,1].map(sy=>({id:`station:${sx}:${sy}`,name:`${sx<0?'Blue':'Red'} coral station ${sy<0?1:2}`,position:[sx*(length/2-1.05),sy*(width/2-1.05),inch(41)],velocity:[-sx*.7,-sy*.7,-.6] as Vec3,pieceType:'coral',enabled:true,mode:'proximity' as const,proximity:1.6,cooldown:1.5})))}
};
