import test from 'node:test';
import assert from 'node:assert/strict';
import {orthogonalRoute,roundedRoute,occupyRoute,routeSegments,nearestRoutePosition,routePoint,type Point} from '../ui/graph-routing';
import {graphNode,nodePosition,nodePorts,transitionCurve,GraphRoutes} from '../ui/graph-model';
import {sampleRobot} from '../seasons/practice';
import {ensureStates,addState} from '../contracts/states';
import {parseDocument,syncSurfaceLinks} from '../contracts/model';
import {gamepadControls,gamepadHeldBindings,driveBindings} from '../ui/drive-controls';
import {normalizeBinding,bindingLabel} from '../contracts/bindings';
import {triggerActive} from '../contracts/triggers';

const source={x:0,y:0,width:144,height:144},target={x:576,y:0,width:144,height:144},blocker={x:288,y:0,width:144,height:192};

test('editing a route or label cannot rearrange other connections, including after reload',()=>{
    const d=ensureStates(sampleRobot()),router=new GraphRoutes(),initial=router.layout(d),edge=d.edges.find(e=>e.id==='store')!;
    edge.route=[[432,168],[432,336],[456,336],[456,168]];
    const edited=router.layout(d);assert.notEqual(edited.get(edge.id)!.path,initial.get(edge.id)!.path);
    const unchanged=(routes:ReturnType<GraphRoutes['layout']>)=>{for(const e of d.edges.filter(e=>e.id!==edge.id)){assert.deepEqual(routes.get(e.id)!.points,initial.get(e.id)!.points);assert.deepEqual(routes.get(e.id)!.center,initial.get(e.id)!.center);}};
    unchanged(edited);unchanged(new GraphRoutes().layout(d));
    const path=edited.get(edge.id)!.path;edge.labelPosition=.73;edge.key='gamepad:button:0';edge.duration=2;
    const labeled=router.layout(d);unchanged(labeled);unchanged(new GraphRoutes().layout(d));assert.equal(labeled.get(edge.id)!.path,path);assert.deepEqual(labeled.get(edge.id)!.center,routePoint(labeled.get(edge.id)!.points,.73));
});
test('label projection slides through bends without changing route geometry',()=>{
    const points:Point[]=[[0,0],[0,0],[120,0],[120,120],[0,120]],before=structuredClone(points);
    assert.equal(nearestRoutePosition(points,[60,-50]),1/6);assert.equal(nearestRoutePosition(points,[180,60]),.5);assert.equal(nearestRoutePosition(points,[60,180]),5/6);
    assert.deepEqual(routePoint(points,.5),[120,60]);assert.deepEqual(points,before);
    assert.equal(nearestRoutePosition([[0,0],[0,0]],[4,4]),0);
});
test('segment arrows use actual segment midpoints and source-to-destination direction',()=>{
    const segments=routeSegments([[0,0],[24,0],[120,0],[120,120],[120,120],[0,120],[0,0]]);
    assert.deepEqual(segments.map(s=>s.center),[[60,0],[120,60],[60,120],[0,60]]);
    assert.deepEqual(segments.map(s=>s.angle),[0,90,180,-90]);
});
test('travel and state label positions persist through import and automatic action link rebuilding',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[0],state=addState(d,sub,sub.states![0]);
    d.edges[0].labelPosition=0;sub.stateTransitions!.push({id:'raise',source:sub.states![0].id,target:state.id,duration:0,key:'u',trigger:'press',labelPosition:1});
    const saved=parseDocument(JSON.parse(JSON.stringify(d)));assert.equal(saved.edges[0].labelPosition,0);assert.equal(saved.subsystems[0].stateTransitions![0].labelPosition,1);
    for(const value of [-.1,1.1,NaN]){const bad=structuredClone(d);bad.edges[0].labelPosition=value;assert.throws(()=>parseDocument(bad),/Malformed graph label position/);}
});
function check(points:Point[]){for(const p of points)assert.ok(p.every(n=>n%24===0));for(let i=1;i<points.length;i++)assert.ok(points[i][0]===points[i-1][0]||points[i][1]===points[i-1][1]);}
test('orthogonal routes stay on the grid and avoid intermediate cards',()=>{
    const route=orthogonalRoute([144,72],[576,72],[source,target,blocker]);assert.equal(route.blocked,false);check(route.points);
    for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i];for(let t=0;t<=1;t+=.05){const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;assert.ok(!(x>blocker.x&&x<blocker.x+blocker.width&&y>blocker.y&&y<blocker.y+blocker.height));}}
    const path=roundedRoute(route.points);assert.ok(!path.includes(' C '));assert.ok(path.includes(' Q '));
});
test('saved route waypoints persist and route around cards after nodes move',()=>{
    const manual:Point[]=[[192,-96],[528,-96]],d=ensureStates(sampleRobot());d.edges[0].route=manual;
    const sub=d.subsystems[0],state=addState(d,sub,sub.states![0]);sub.stateTransitions!.push({id:'go',source:sub.states![0].id,target:state.id,duration:0,key:'gamepad:button:0',trigger:'press',route:manual});
    const saved=parseDocument(JSON.parse(JSON.stringify(d)));assert.deepEqual(saved.edges[0].route,manual);assert.deepEqual(saved.subsystems[0].stateTransitions![0].route,manual);
    assert.deepEqual(syncSurfaceLinks(saved).edges[0].route,manual);
    const route=orthogonalRoute([144,72],[576,72],[source,target,blocker],undefined,manual);assert.equal(route.blocked,false);check(route.points);assert.ok(route.points.some(p=>p[1]===-96));
    assert.throws(()=>parseDocument({...d,edges:d.edges.map(e=>({...e,route:[[Infinity,0]]}))}),/Malformed graph route/);
});
test('occupied routes take separate lanes and graph geometry aligns with the grid',()=>{
    const occupied=new Map<string,number>(),first=orthogonalRoute([144,72],[576,72],[source,target]);occupyRoute(first.points,occupied);
    const second=orthogonalRoute([144,72],[576,72],[source,target],occupied);assert.notDeepEqual(second.points,first.points);check(second.points);
    const d=sampleRobot();for(const node of [...d.subsystems,...d.surfaces]){assert.ok(nodePosition(d,node.id).every(n=>n%24===0));const g=graphNode(d,node.id);assert.equal(g.width%24,0);assert.equal(g.height%24,0);for(const p of nodePorts(d,node.id).outputs)assert.equal(p.y%24,0);}
});
test('gamepad buttons, triggers and stick directions normalize and obey transition trigger semantics',()=>{
    const pad=gamepadControls({axes:[.8,-.9,0,0],buttons:[{pressed:true,value:1,touched:true},{pressed:false,value:.8,touched:true}]});
    assert.ok(pad.held.includes('gamepad:button:0'));assert.ok(pad.held.includes('gamepad:button:1'));assert.ok(pad.held.includes('gamepad:axis:0:+'));assert.equal(pad.x,.9);
    assert.equal(normalizeBinding('GAMEPAD:BUTTON:0'),'gamepad:button:0');assert.equal(normalizeBinding('gamepad:button:32'),undefined);assert.equal(normalizeBinding('gamepad:axis:16:+'),undefined);assert.match(bindingLabel('gamepad:button:0'),/A \/ Cross/);
    const held=new Set(pad.held);assert.ok(triggerActive('press','gamepad:button:0',held,held));assert.equal(triggerActive('press','gamepad:button:0',held,new Set()),false);assert.ok(triggerActive('hold','gamepad:button:0',held,new Set()));assert.ok(triggerActive('not-pressed','gamepad:button:0',new Set(),new Set()));
});
test('drive binding labels retain every action and destination state name on shared keys',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[0],state=addState(d,sub,sub.states![0]);state.name='Raised State';d.surfaces[0].name='Coral Collector';
    const key=d.edges.find(e=>e.source===d.surfaces[0].id||e.target===d.surfaces[0].id)!.key;
    sub.stateTransitions!.push({id:'raise',source:sub.states![0].id,target:state.id,duration:0,key,trigger:'press'});
    const label=driveBindings(d).find(b=>b.key===normalizeBinding(key))!.label;assert.match(label,/Coral Collector/);assert.match(label,/Raised State/);
});
test('legacy gamepad action buttons stop aliasing keyboard keys when explicitly rebound',()=>{
    const d=ensureStates(sampleRobot());assert.ok(gamepadHeldBindings(d,['gamepad:button:0']).includes('i'));
    d.edges[0].key='gamepad:button:0';assert.deepEqual(gamepadHeldBindings(d,['gamepad:button:0']),['gamepad:button:0']);
});
