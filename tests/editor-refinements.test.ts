import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HALF_INCH,snapDocumentInches,snapMetres,snapSize} from '../contracts/inch-grid';
import {ensureStates,addState,stateName} from '../contracts/states';
import {sampleRobot} from '../seasons/practice';
import {storedValue,displayValue} from '../ui/units';
import {resizedDimensions} from '../ui/editor-model';
import {subsystemTree} from '../ui/tree-model';
import {beamGeometry} from '../ui/action-beam-model';
import {nearestActionFace} from '../ui/face-target';
test('typed and imported inch measurements use only half-inch values with grid-aligned bounds',()=>{
    for(const value of [-17.13,-1.2,0,.24,.26,1.2,1.25,10.01,100000]) {
        const stored=storedValue('state.position.0',value),display=displayValue('state.position.0',stored);
        assert.ok(Number.isInteger(display*2));assert.ok(Math.abs(stored/HALF_INCH-Math.round(stored/HALF_INCH))<1e-8);
    }
    assert.equal(displayValue('state.size.0',storedValue('state.size.0',1.2)),1);
    assert.equal(displayValue('basics.length',storedValue('basics.length',0)),.5);
    assert.equal(displayValue('basics.length',storedValue('basics.length',1000)),118);
    const d=snapDocumentInches(ensureStates(sampleRobot()));
    for(const sub of d.subsystems)for(const state of sub.states!)for(const n of [...state.position,...state.size])assert.ok(Math.abs(n/HALF_INCH-Math.round(n/HALF_INCH))<1e-8);
    assert.deepEqual(snapDocumentInches(structuredClone(d)),d);
});
test('resizing rounds absolute dimensions instead of percentage scale and clamps to legal half-inch sizes',()=>{
    const base=snapSize([.3,.4,.5]);
    for(const scale of [[1.001,1.24,.333],[2,1,.5],[-1,100,0]] as [number,number,number][])for(const n of resizedDimensions(base,scale)) {
        assert.ok(Math.abs(n/HALF_INCH-Math.round(n/HALF_INCH))<1e-8);assert.ok(n>=HALF_INCH&&n<=3);
    }
    assert.equal(snapMetres(.0127),.0127);
});
test('all state names have a single canonical suffix on migration, creation and rename',()=>{
    for(const name of ['Extended','Extended State','Extended state','Extended State State'])assert.equal(stateName(name),'Extended State');
    assert.equal(stateName(''),'Untitled State');assert.ok(stateName('x'.repeat(200)).length<=100);
    const d=ensureStates(sampleRobot()),state=addState(d,d.subsystems[2],d.subsystems[2].states![0]);
    assert.ok(d.subsystems.every(s=>s.states!.every(t=>t.name.endsWith(' State'))));assert.ok(state.name.endsWith(' State'));
});
test('three-level hierarchy includes every identically named action under its own state ID',()=>{
    const d=ensureStates(sampleRobot()),sub=d.subsystems[2];addState(d,sub,sub.states![0]);
    const tree=subsystemTree(d).find(t=>t.subsystem.id===sub.id)!;
    assert.equal(tree.states.length,2);assert.equal(tree.states[0].actions[0].name,tree.states[1].actions[0].name);
    assert.notEqual(tree.states[0].actions[0].id,tree.states[1].actions[0].id);
    assert.ok(tree.states.every(t=>t.actions.every(a=>a.stateId===t.state.id)));
});
test('action beam rises above its endpoints and has a depth ribbon without invalid coordinates',()=>{
    const beam=beamGeometry([100,300],[700,400]);assert.ok(beam.midpoint[1]<300);assert.match(beam.path,/^M 100,300 C/);assert.ok(beam.ribbon.endsWith(' Z'));assert.ok(!beam.ribbon.includes('NaN'));
    assert.ok(!beamGeometry([100,300],[100,300]).ribbon.includes('NaN'));
});
function fixture() {
    const camera=new THREE.PerspectiveCamera(50,800/600,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshBasicMaterial());mesh.userData={id:'owner',baseSize:[.2,.2,.2]};
    return {camera,mesh,rect:{left:0,top:0,width:800,height:600}};
}
test('beam targets hit faces and snaps near visible free faces while rejecting blocked/back faces and out-of-viewport drops',()=>{
    const {camera,mesh,rect}=fixture();
    assert.equal(nearestActionFace(camera,[mesh],rect,400,300,()=>true)?.face,'+Z');
    assert.equal(nearestActionFace(camera,[mesh],rect,423,300,()=>true)?.face,'+Z');
    assert.equal(nearestActionFace(camera,[mesh],rect,400,300,(_,face)=>face==='-Z'),undefined);
    assert.equal(nearestActionFace(camera,[mesh],rect,400,300,()=>false),undefined);
    assert.equal(nearestActionFace(camera,[mesh],rect,850,300,()=>true),undefined);
    const blocker=mesh.clone();blocker.position.z=1;blocker.userData={id:'blocker',baseSize:[.2,.2,.2]};
    assert.equal(nearestActionFace(camera,[mesh,blocker],rect,400,300,owner=>owner==='owner'),undefined);
});
