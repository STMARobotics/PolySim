export type Point=[number,number];
const point=(start:Point,a:Point,b:Point,end:Point,t:number):Point=>[(1-t)**3*start[0]+3*(1-t)**2*t*a[0]+3*(1-t)*t*t*b[0]+t**3*end[0],(1-t)**3*start[1]+3*(1-t)**2*t*a[1]+3*(1-t)*t*t*b[1]+t**3*end[1]];
export function beamGeometry(start:Point,end:Point) {
    const dx=end[0]-start[0],distance=Math.hypot(dx,end[1]-start[1]),lift=Math.max(65,Math.min(230,distance*.38));
    const a:Point=[start[0]+dx*.2,start[1]-lift],b:Point=[end[0]-dx*.2,end[1]-lift];
    const left:Point[]=[],right:Point[]=[];
    for(let i=0;i<=40;i++) {
        const t=i/40,p=point(start,a,b,end,t),before=point(start,a,b,end,Math.max(0,t-.005)),after=point(start,a,b,end,Math.min(1,t+.005));
        const vx=after[0]-before[0],vy=after[1]-before[1],length=Math.hypot(vx,vy)||1,width=.75+5*Math.sin(Math.PI*t);
        left.push([p[0]-vy/length*width,p[1]+vx/length*width]);right.push([p[0]+vy/length*width,p[1]-vx/length*width]);
    }
    return {path:`M ${start} C ${a} ${b} ${end}`,ribbon:`M ${left.map(p=>p.join(',')).join(' L ')} L ${right.reverse().map(p=>p.join(',')).join(' L ')} Z`,midpoint:point(start,a,b,end,.5)};
}
