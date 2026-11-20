import test from 'node:test';
import assert from 'node:assert/strict';
import { stationCameraPosition, trackingFactor, configureEditOrbit } from '../ui/camera-model';
import * as THREE from 'three';
import { Viewport } from '../ui/viewport';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
test('driver stations are fixed close behind the alliance wall at raised driver eye height', () => {
    for (const station of [1, 2, 3] as const) {
        const p = stationCameraPosition(station);
        assert.ok(p[0] < -6);
        assert.equal(p[2], 1.9);assert.ok(Math.abs(p[0]+6+.3)<1e-10);
    }
    assert.equal(stationCameraPosition(2)[1], 0);
    assert.ok(stationCameraPosition(1)[1] > 0);
    assert.ok(stationCameraPosition(3)[1] < 0);
    assert.equal(stationCameraPosition(1)[0], stationCameraPosition(3)[0]);
    assert.equal(stationCameraPosition(1)[1], -stationCameraPosition(3)[1]);
});
test('camera target damping is frame-rate independent and cannot overshoot', () => {
    let sixty = 0, oneTwenty = 0;
    for (let i = 0; i < 60; i++)
        sixty += (10 - sixty) * trackingFactor(1 / 60);
    for (let i = 0; i < 120; i++)
        oneTwenty += (10 - oneTwenty) * trackingFactor(1 / 120);
    assert.ok(Math.abs(sixty - oneTwenty) < 1e-10);
    assert.ok(sixty < 10 && sixty > 9.99);
    assert.equal(trackingFactor(-1), 0);
    assert.ok(trackingFactor(5) < 1);
});

test('Edit camera keyboard navigation rotates 15/90/5 degrees and preserves orbit distance', () => {
    for (const [modifiers, degrees] of [[{}, 15], [{shiftKey: true}, 90], [{ctrlKey: true}, 5]] as const) {
        const camera = new THREE.PerspectiveCamera();
        camera.up.set(0, 0, 1);
        camera.position.set(5, 0, 3);
        const state = { camera, editing: true, driver: false, controls: { target: new THREE.Vector3(), update() {}, minDistance: 1, maxDistance: 30 } };
        const distance = camera.position.length();
        assert.equal(Viewport.prototype.navigateKey.call(state as any, { key: 'ArrowLeft', ...modifiers } as KeyboardEvent), true);
        assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.atan2(camera.position.y, camera.position.x)) - degrees) < 1e-9);
        assert.ok(Math.abs(camera.position.length() - distance) < 1e-9);
    }
});

test('Edit camera supports keyboard zoom and pan while Drive camera ignores navigation', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(5, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const state = { camera, editing: true, driver: false, controls: { target: new THREE.Vector3(), update() {}, minDistance: 1, maxDistance: 30 } };
    const distance = camera.position.length();
    const key = (event: object) => Viewport.prototype.navigateKey.call(state as any, event as KeyboardEvent);
    key({ key: 'z' });
    assert.ok(Math.abs(camera.position.length() - distance * 1.2) < 1e-9);
    key({ key: 'Z', shiftKey: true });
    assert.ok(Math.abs(camera.position.length() - distance) < 1e-9);
    key({ key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    assert.ok(state.controls.target.length() > 0);
    assert.ok(Math.abs(camera.position.distanceTo(state.controls.target) - distance) < 1e-9);
    state.driver = true;
    const p = camera.position.clone();
    assert.equal(key({ key: 'ArrowLeft' }), false);
    assert.ok(camera.position.equals(p));
});

test('Edit mouse inputs orbit on right drag, pan on middle/Ctrl-right, reserve left drag, and wheel zoom', () => {
    class Surface extends EventTarget {
        style = { touchAction: '' };
        clientWidth = 1000;
        clientHeight = 600;
        getRootNode() { return this; }
        setPointerCapture() {}
        releasePointerCapture() {}
        getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 }; }
    }
    for (const [button, ctrlKey, kind] of [[0, false, 'select'], [1, false, 'pan'], [2, true, 'pan'], [2, false, 'orbit']] as const) {
        const surface = new Surface(), camera = new THREE.PerspectiveCamera(43, 1000 / 600);
        camera.up.set(0, 0, 1);
        camera.position.set(5, -5, 4);
        const controls = new OrbitControls(camera, surface as unknown as HTMLElement);
        configureEditOrbit(controls);
        const start = camera.position.clone(), target = controls.target.clone();
        const emit = (type: string, x: number, y: number) => surface.dispatchEvent(Object.assign(new Event(type, {cancelable: true}), {button, ctrlKey, metaKey: false, shiftKey: false, pointerType: 'mouse', pointerId: 1, pageX: x, pageY: y, clientX: x, clientY: y}));
        try {
            emit('pointerdown', 500, 300); emit('pointermove', 560, 325); emit('pointerup', 560, 325);
            if (kind === 'select') { assert.ok(camera.position.equals(start)); assert.ok(controls.target.equals(target)); }
            if (kind === 'pan') { assert.ok(!controls.target.equals(target)); assert.ok(camera.position.clone().sub(controls.target).distanceTo(start.clone().sub(target)) < 1e-9); }
            if (kind === 'orbit') { assert.ok(!camera.position.equals(start)); assert.ok(controls.target.equals(target)); }
            const distance = camera.position.distanceTo(controls.target);
            surface.dispatchEvent(Object.assign(new Event('wheel', {cancelable: true}), {deltaY: -120, deltaMode: 0, clientX: 500, clientY: 300, ctrlKey: false}));
            assert.ok(camera.position.distanceTo(controls.target) < distance);
        } finally { controls.dispose(); }
    }
});
