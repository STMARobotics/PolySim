import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewport } from '../ui/viewport';
import { RAPIER, Simulation } from '../simulation/runtime';
import { sampleRobot } from '../seasons/practice';
before(async () => { await RAPIER.init(); });

test('live snapshots omit the growing recording while full snapshots preserve replay inputs', () => {
    const sim = new Simulation(sampleRobot());
    try {
        sim.recording = Array.from({length:10000},(_,tick)=>({tick,controls:{x:1,y:0,turn:0,held:['i']}}));
        const lean = sim.snapshot(true,false,false), full = sim.snapshot();
        assert.equal(lean.recording.length,0);
        assert.equal(full.recording.length,10000);
        assert.ok(JSON.stringify(full).length > JSON.stringify(lean).length * 50);
    } finally {sim.free();}
});

test('instanced piece rendering interpolates by ID, removes captured pieces and grows without duplicating geometry', () => {
    const piece = (id:string,x:number) => ({id,position:[x,0,1],rotation:[0,0,0,1]});
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.09,12,8),new THREE.MeshStandardMaterial(),2);
    const state:any = {pieceMeshes:new Map([['ball',mesh]]),frames:{previousPieces:new Map([['a',piece('a',0)],['b',piece('b',2)]])},instanceTransform:new THREE.Object3D(),fromRotation:new THREE.Quaternion(),toRotation:new THREE.Quaternion(),balls:new THREE.Group()};
    state.balls.add(mesh);
    const update = (pieces:unknown[],alpha:number) => (Viewport.prototype as any).updatePieces.call(state,pieces,alpha);
    const position = (index:number) => { const m=new THREE.Matrix4();state.pieceMeshes.get('ball').getMatrixAt(index,m);return new THREE.Vector3().setFromMatrixPosition(m); };
    try {
        update([piece('a',2),piece('b',4)],.5);
        assert.equal(state.pieceMeshes.get('ball').count,2);
        assert.equal(position(0).x,1);assert.equal(position(1).x,3);
        update([piece('b',4)],.5);
        assert.equal(state.pieceMeshes.get('ball').count,1);assert.equal(position(0).x,3);
        update([piece('a',2),piece('b',4),piece('c',6)],1);
        assert.equal(state.pieceMeshes.get('ball').count,3);
        assert.equal(state.pieceMeshes.get('ball').geometry,mesh.geometry);
        assert.equal(position(2).x,6);
        assert.equal(state.balls.children.length,1);
    } finally {state.pieceMeshes.get('ball').dispose();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
});
