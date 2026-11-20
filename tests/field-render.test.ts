import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Viewport} from '../ui/viewport';
import {createSeasonRobot} from '../seasons/registry';
import {RenderFrames} from '../ui/render-frames';

test('fixed field geometry stays outside the editable maps while scoring and sources use world coordinates',()=>{
 const d=createSeasonRobot('reefscape-2025'),goal=d.field!.scoringElements[0];
 const prototype=Viewport.prototype as any;
 let attached:THREE.Mesh|undefined;
 const state:any={document:d,scene:new THREE.Scene(),fieldVisual:new THREE.Group(),scoringVisual:new THREE.Group(),fieldMeshes:new Map(),fieldFills:new Map(),pieceMeshes:new Map(),balls:new THREE.Group(),driverEye:new THREE.Vector3(),station:2,fieldSeason:'',fieldEditing:true,selected:goal.id,transform:{attach:(mesh:THREE.Mesh)=>{attached=mesh;}},disposeGroup:prototype.disposeGroup,box:prototype.box};
 prototype.makeField.call(state);prototype.renderScoring.call(state);
 try {
  assert.equal(state.pieceMeshes.size,2);assert.equal(state.fieldMeshes.size,88);assert.equal(state.fieldVisual.parent,state.scene);assert.equal(state.scoringVisual.parent,state.scene);
  assert.equal(attached!.userData.id,goal.id);assert.deepEqual(attached!.position.toArray(),goal.position);assert.deepEqual(attached!.userData.baseSize,goal.size);
  assert.ok([...state.fieldMeshes.keys()].every((id:any)=>d.field!.scoringElements.some(g=>g.id===id)||d.field!.sources.some(s=>s.id===id)));
  assert.ok(!state.fieldMeshes.has('barge:crossbar'));
  const coral=state.pieceMeshes.get('coral'),algae=state.pieceMeshes.get('algae');assert.ok(coral.geometry instanceof THREE.LatheGeometry);assert.ok(algae.geometry instanceof THREE.SphereGeometry);
  state.frames=new RenderFrames();state.fillUniforms=new Map();state.fillCaps=new Map();state.previewArc=()=>{};
  prototype.update.call(state,{tick:1,running:false,pose:{x:0,y:0,yaw:0},pieces:[],tokens:[],fieldInventory:[{element:goal.id,pieces:[{id:'one',type:'coral'}]}]});
  const fill=state.fieldFills.get(goal.id);assert.equal(fill.visible,true);assert.equal(fill.scale.z,1/goal.capacity);assert.ok(Math.abs(fill.position.z-(-goal.size[2]/2+goal.size[2]/goal.capacity/2))<1e-10);
 } finally {
  prototype.disposeGroup.call(state,state.fieldVisual);prototype.disposeGroup.call(state,state.scoringVisual);
  for(const mesh of state.pieceMeshes.values()){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();}
 }
});
