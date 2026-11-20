import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderFrames, blendYaw } from '../ui/render-frames';
import type { Snapshot } from '../simulation/protocol';
const frame = (tick: number, running = true): Snapshot => ({tick, running, pose:{x:tick,y:0,yaw:0},pieces:[{id:'ball',position:[tick,0,1],rotation:[0,0,0,1]}],tokens:[],edgeMetrics:{},score:0,pickups:0,releases:0,scored:0,escaped:[],cycles:[],log:[],blocked:[],recording:[],slow:false});

test('render frames interpolate continuously between 30 Hz poses on intermediate display frames', () => {
    const frames = new RenderFrames();
    frames.push(frame(0), 0);
    frames.push(frame(4), 100);
    assert.equal(frames.alpha(100),0);
    assert.ok(Math.abs(frames.alpha(100 + 1000/60) - .5) < 1e-10);
    const x = frames.previous!.pose.x + (frames.current!.pose.x - frames.previous!.pose.x) * frames.alpha(100 + 1000/60);
    assert.ok(Math.abs(x-2)<1e-10);
    assert.equal(frames.alpha(200),1);
    assert.equal(frames.alpha(90),0);
    assert.equal(frames.previousPieces.get('ball')!.position[0],0);
});

test('pause/reset snapshots snap to their exact pose and clear interpolation history', () => {
    const frames = new RenderFrames();
    frames.push(frame(0),0); frames.push(frame(4),100); frames.push(frame(8,false),110);
    assert.equal(frames.alpha(110),1); assert.equal(frames.previous!.pose.x,8);
    frames.push(frame(0),120);
    assert.equal(frames.alpha(120),1); assert.equal(frames.previous!.pose.x,0);
    assert.deepEqual(Object.keys(frames.current!).sort(),['pieces','pose','tick']);
    frames.clear(); assert.equal(frames.current,undefined); assert.equal(frames.previousPieces.size,0);
});

test('rotation interpolation takes the short route across the ±180 degree boundary', () => {
    const d=Math.PI/180, middle=blendYaw(179*d,-179*d,.5);
    assert.ok(Math.abs(middle-Math.PI)<1e-10);
    assert.ok(Math.abs(blendYaw(0,Math.PI/2,.5)-Math.PI/4)<1e-10);
});
