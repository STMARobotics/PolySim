import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { inventoryFraction, resizedDimensions } from './editor-model';
import { stationCameraPosition, trackingFactor, configureEditOrbit, type DriverStation } from './camera-model';
import { FACES, type RobotDocument, type Face, type Vec3 } from '../contracts/model';
import { practice } from '../seasons/practice';
import type { Snapshot } from '../simulation/protocol';
import { RenderProfile } from './render-profile';
import { RenderFrames, blendYaw } from './render-frames';
const colors = { intake: 0x398dff, outtake: 0xf44854, white: 0xe7edf0 };
export class Viewport {
    scene = new THREE.Scene();
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    controls: OrbitControls;
    transform: TransformControls;
    robot = new THREE.Group();
    blocks = new THREE.Group();
    balls = new THREE.Group();
    private ray = new THREE.Raycaster();
    private pointer = new THREE.Vector2();
    private meshes = new Map<string, THREE.Mesh>();
    private frames = new RenderFrames();
    private pieceMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(practice.radius, 12, 8), new THREE.MeshStandardMaterial({color: 0xf5b14e, roughness: .7}), Math.max(32, practice.pieces.length));
    private instanceTransform = new THREE.Object3D();
    private fromRotation = new THREE.Quaternion();
    private toRotation = new THREE.Quaternion();
    private aim = new THREE.Vector3();
    private robotAimHeight = .5;
    private selection?: THREE.LineSegments;
    private arc?: THREE.Line;
    private document?: RobotDocument;
    private selected = '';
    private resizeObserver: ResizeObserver;
    private drawStart?: THREE.Vector3;
    private ghost?: THREE.Mesh;
    private down = [0, 0];
    private transformGesture = false;
    private transformStart?: {
        position: Vec3;
        size: Vec3;
    };
    private fillUniforms = new Map<string, {
        value: number;
    }>();
    private fillCaps = new Map<string, THREE.Mesh>();
    private station: DriverStation = 2;
    private driverAim = new THREE.Vector3();
    private driverEye = new THREE.Vector3();
    private lastFrame = performance.now();
    private editCamera?: {
        position: THREE.Vector3;
        target: THREE.Vector3;
        fov: number;
    };
    private textLabels: {
        canvas: HTMLCanvasElement;
        texture: THREE.CanvasTexture;
        text: string;
        color: string;
    }[] = [];
    drawing = false;
    driver = false;
    editing = true;
    private profile = new RenderProfile();
    constructor(private host: HTMLElement, private onSelect: (id: string, face?: Face) => void, private onDraw: (position: Vec3, size: Vec3) => void, private onGeometry: (id: string, position: Vec3, size: Vec3) => void) {
        THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
        this.scene.background = new THREE.Color(0x0a172b);
        this.scene.fog = new THREE.Fog(0x0a172b, 20, 45);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        host.append(this.renderer.domElement);
        this.camera = new THREE.PerspectiveCamera(43, 1, 0.05, 100);
        this.camera.position.set(-6.5, -5.5, 4.8);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        configureEditOrbit(this.controls);
        this.controls.target.set(-1.4, 0, 0.25);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI - .01;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 30;
        this.transform = new TransformControls(this.camera, this.renderer.domElement);
        this.transform.setSpace('local');
        this.transform.setSize(.85);
        this.transform.setColors(0xf34855,0xffd135,0x368cff,0xffffff);
        this.transform.setTranslationSnap(.01);
        this.transform.setScaleSnap(.01);
        this.scene.add(this.transform.getHelper());
        this.transform.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value && !this.drawing && !this.driver; });
        this.transform.addEventListener('mouseDown', () => {
            this.transformGesture = true;
            const block = this.document?.subsystems.find(s => s.id === this.transform.object?.userData.id);
            if (block)
                this.transformStart = { position: [...block.position], size: [...block.size] };
        });
        this.transform.addEventListener('mouseUp', () => {
            const object = this.transform.object, start = this.transformStart;
            this.transformStart = undefined;
            if (!object || !start)
                return;
            const position = object.position.toArray().map(n => Math.max(-5, Math.min(5, Math.round(n * 1000) / 1000))) as Vec3;
            const size = resizedDimensions(start.size, object.scale.toArray() as Vec3);
            if (position.some((n, i) => n !== start.position[i]) || size.some((n, i) => n !== start.size[i]))
                this.onGeometry(object.userData.id, position, size);
        });
        this.scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x344035, 2.5));
        const light = new THREE.DirectionalLight(0xfff0d6, 3);
        light.position.set(-3, -5, 12);
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.camera.left = -10;
        light.shadow.camera.right = 10;
        light.shadow.camera.top = 8;
        light.shadow.camera.bottom = -8;
        light.shadow.normalBias = 0.025;
        this.scene.add(light);
        this.makeField();
        document.fonts.load('40px "Mona Sans"').then(() => { for (const label of this.textLabels)
            this.paintLabel(label); }).catch(() => { });
        this.robot.add(this.blocks);
        this.pieceMesh.castShadow = true;
        this.pieceMesh.frustumCulled = false;
        this.pieceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.balls.add(this.pieceMesh);
        this.scene.add(this.robot, this.balls);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
        const canvas = this.renderer.domElement;
        canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
        });
        canvas.addEventListener('pointerdown', e => {
            this.down = [e.clientX, e.clientY];
            if (this.drawing && e.button === 0) {
                this.drawStart = this.ground(e);
                canvas.setPointerCapture(e.pointerId);
            }
        });
        canvas.addEventListener('pointermove', e => {
            if (!this.drawStart)
                return;
            const end = this.ground(e);
            if (!end)
                return;
            this.updateGhost(end);
        });
        canvas.addEventListener('pointerup', e => {
            if (this.driver)
                return;
            if (this.transformGesture) {
                this.transformGesture = false;
                return;
            }
            if (this.drawStart) {
                const end = this.ground(e), start = this.drawStart;
                this.drawStart = undefined;
                if (this.ghost) {
                    this.scene.remove(this.ghost);
                    this.ghost.geometry.dispose();
                    (this.ghost.material as THREE.Material).dispose();
                    this.ghost = undefined;
                }
                if (end && end.distanceTo(start) > 0.08) {
                    const size: Vec3 = [Math.max(.1, Math.abs(end.x - start.x)), Math.max(.1, Math.abs(end.y - start.y)), .35];
                    const pose = this.robot.position;
                    this.onDraw([Math.round(((start.x + end.x) / 2 - pose.x) * 20) / 20, Math.round(((start.y + end.y) / 2 - pose.y) * 20) / 20, .45], size.map(n => Math.round(n * 20) / 20) as Vec3);
                }
                return;
            }
            if (e.button === 0 && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 5)
                this.hit(e, false);
            if (this.editing && e.button === 2 && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 5)
                this.hit(e, true);
        });
        this.renderer.setAnimationLoop(() => {
            const now = performance.now(), dt = (now - this.lastFrame) / 1000;
            this.lastFrame = now;
            if (!host.clientWidth || !host.clientHeight)
                return;
            this.animateSnapshot(now);
            if (this.driver) {
                const alpha = trackingFactor(dt);
                this.camera.position.lerp(this.driverEye, alpha);
                this.driverAim.lerp(this.robotTarget(), alpha);
                this.camera.lookAt(this.driverAim);
            }
            else {
                this.controls.update();
            }
            const renderStart = performance.now();
            this.renderer.render(this.scene, this.camera);
            this.profile.frame(dt, performance.now() - renderStart, this.renderer.getPixelRatio(), host.clientWidth, host.clientHeight);
        });
    }
    private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, parent: THREE.Object3D = this.scene, opacity = 1) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: .83, transparent: opacity < 1, opacity }));
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
    }
    private label(text: string, x: number, y: number, z: number, size = .45, color = '#c8d8e3') {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 96;
        const texture = new THREE.CanvasTexture(canvas);
        const label = { canvas, texture, text, color };
        this.textLabels.push(label);
        this.paintLabel(label);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
        sprite.position.set(x, y, z);
        sprite.scale.set(size * 5.3, size, 1);
        this.scene.add(sprite);
    }
    private paintLabel(label: {
        canvas: HTMLCanvasElement;
        texture: THREE.CanvasTexture;
        text: string;
        color: string;
    }) {
        const c = label.canvas.getContext('2d')!;
        c.clearRect(0, 0, 512, 96);
        c.font = '500 36px "Mona Sans"';
        c.fillStyle = label.color;
        c.textAlign = 'center';
        c.fillText(label.text, 256, 60);
        label.texture.needsUpdate = true;
    }
    private makeField() {
        this.box(0, 0, -.08, 12, 8, .16, 0x203750);
        const grid = new THREE.GridHelper(12, 24, 0x4b6c92, 0x2b455f);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = .006;
        grid.scale.z = 8 / 12;
        this.scene.add(grid);
        this.box(-6.08, 0, .23, .16, 8.3, .46, 0x224b7b);
        this.box(6.08, 0, .23, .16, 8.3, .46, 0x224b7b);
        this.box(0, -4.08, .23, 12.3, .16, .46, 0x224b7b);
        this.box(0, 4.08, .23, 12.3, .16, .46, 0x224b7b);
        this.box(-4.7, 0, .012, 2.5, 7.8, .012, 0x1d64d3, this.scene, .45);
        this.box(4.7, 0, .013, 2.5, 7.8, .012, 0xd62d42, this.scene, .35);
        this.box(0, 0, .015, .035, 8, .015, 0xffdf35);
        const o = practice.obstacle;
        this.box(o.x, o.y, o.height / 2, o.length, o.width, o.height, 0xdc3545);
        const t = practice.target;
        this.box(t.x, t.y, (t.height - .4) / 2, .16, .16, t.height - .4, 0x91a8b3);
        this.box(t.x, t.y, t.height - .4, t.depth, t.width, .1, 0x1456c4);
        this.box(t.x + t.depth / 2, t.y, t.height - .25, .08, t.width, .3, 0x3d8eff, this.scene, .65);
        this.box(t.x - t.depth / 2, t.y, t.height - .25, .08, t.width, .3, 0x3d8eff, this.scene, .35);
        for (const s of [-1, 1])
            this.box(t.x, t.y + s * t.width / 2, t.height - .25, t.depth, .08, .3, 0x3d8eff, this.scene, .65);
        this.label('Practice lab', 0, 3.7, .7, .3);
        this.label('Target · 1 pt', 4.75, 0, 2.3, .22, '#95d7e6');
        this.label('Start', -4.8, 2.8, .3, .25, '#94b9d5');
        const axes = new THREE.AxesHelper(.65);
        axes.position.set(-5.6, -3.5, .04);
        this.scene.add(axes);
    }
    private disposeGroup(group: THREE.Group) {
        group.traverse(o => {
            if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
                o.geometry.dispose();
                for (const m of Array.isArray(o.material) ? o.material : [o.material])
                    m.dispose();
            }
        });
        group.clear();
    }
    setDocument(d: RobotDocument, selected: string) {
        this.transform.detach();
        this.document = d;
        this.selected = selected;
        this.robotAimHeight = Math.max(.25, Math.max(d.basics.height, ...d.subsystems.map(s => s.position[2] + s.size[2] / 2)) / 2);
        this.disposeGroup(this.blocks);
        this.meshes.clear();
        this.fillUniforms.clear();
        this.fillCaps.clear();
        this.selection = undefined;
        const b = d.basics;
        this.box(0, 0, b.height / 2, b.length, b.width, b.height, 0x263b50, this.blocks);
        for (const y of [-1, 1])
            this.box(0, y * (b.width / 2 + .035), .15, b.length + .08, .09, .18, 0x4581a3, this.blocks);
        for (const x of [-1, 1])
            this.box(x * (b.length / 2 + .035), 0, .15, .09, b.width + .08, .18, 0x4581a3, this.blocks);
        for (const x of [-1, 1])
            for (const y of [-1, 1]) {
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .065, 16), new THREE.MeshStandardMaterial({ color: 0x101820, roughness: .9 }));
                wheel.position.set(x * b.length * .35, y * b.width * .4, .075);
                wheel.castShadow = true;
                this.blocks.add(wheel);
            }
        for (const s of d.subsystems) {
            const fill = { value: 0 };
            this.fillUniforms.set(s.id, fill);
            const materials = FACES.map(f => {
                const action = d.surfaces.find(a => a.owner === s.id && a.faces.includes(f));
                const material = new THREE.MeshStandardMaterial({ color: action ? colors[action.type] : colors.white, roughness: .55, metalness: .08, transparent: !s.solid, opacity: !s.solid ? .8 : 1 });
                material.onBeforeCompile = shader => {
                    shader.uniforms.inventoryFill = fill;
                    shader.uniforms.boxHeight = { value: s.size[2] };
                    shader.vertexShader = 'varying float inventoryZ;\n' + shader.vertexShader;
                    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ninventoryZ=position.z;');
                    shader.fragmentShader = 'varying float inventoryZ; uniform float inventoryFill; uniform float boxHeight;\n' + shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif(inventoryFill>0.0 && inventoryZ<=-boxHeight*0.5+boxHeight*inventoryFill){diffuseColor.rgb=vec3(1.0,0.78,0.02);diffuseColor.a=1.0;}');
                };
                material.customProgramCacheKey = () => 'polysim-inventory-v1';
                return material;
            });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...s.size), materials);
            mesh.position.set(...s.position);
            mesh.rotation.z = s.yaw;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.id = s.id;
            this.blocks.add(mesh);
            this.meshes.set(s.id, mesh);
            const cap = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[1]), new THREE.MeshStandardMaterial({ color: 0xffc705, roughness: .55, side: THREE.DoubleSide }));
            cap.visible = false;
            mesh.add(cap);
            this.fillCaps.set(s.id, cap);
            const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x7a919f, transparent: true, opacity: .5 }));
            mesh.add(edge);
            const surface = d.surfaces.find(a => a.id === selected);
            if (s.id === selected || surface?.owner === s.id) {
                const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xf7c56a, depthTest: false }));
                line.scale.setScalar(1.025);
                line.renderOrder = 5;
                mesh.add(line);
                this.selection = line;
                this.transform.attach(mesh);
            }
        }
        this.resetPose();
        this.previewArc();
        this.refreshTransform();
    }
    private previewArc() {
        if (this.arc) {
            this.robot.remove(this.arc);
            this.arc.geometry.dispose();
            (this.arc.material as THREE.Material).dispose();
            this.arc = undefined;
        }
        const d = this.document!, surface = d.surfaces.find(s => s.type === 'outtake');
        if (!surface)
            return;
        const b = d.subsystems.find(s => s.id === surface.owner);
        if (!b)
            return;
        // Visual reference for the sample +X release face; other faces are handled by the worker.
        if (surface.faces[0] !== '+X')
            return;
        const points: THREE.Vector3[] = [], angle = surface.yaw + b.yaw;
        const origin = new THREE.Vector3(b.position[0] + (b.size[0] / 2 + .135) * Math.cos(b.yaw), b.position[1] + (b.size[0] / 2 + .135) * Math.sin(b.yaw), b.position[2]);
        for (let t = 0; t < 2.5; t += .025) {
            const p = origin.clone().add(new THREE.Vector3(Math.cos(angle) * Math.cos(surface.pitch) * surface.speed * t, Math.sin(angle) * Math.cos(surface.pitch) * surface.speed * t, Math.sin(surface.pitch) * surface.speed * t - 4.905 * t * t));
            if (p.z < 0)
                break;
            points.push(p);
        }
        this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xf1bc66, dashSize: .08, gapSize: .07, transparent: true, opacity: .55 }));
        this.arc.computeLineDistances();
        this.robot.add(this.arc);
    }
    resetPose() {
        this.frames.clear();
        this.robot.position.set(practice.start[0], practice.start[1], 0);
        this.robot.rotation.z = 0;
        this.updatePieces(practice.pieces.map(p => ({ id: p.id, position: p.position, rotation: [0, 0, 0, 1] })));
        if (this.arc)
            this.arc.visible = !this.driver;
    }
    update(s: Snapshot) {
        this.frames.push(s, performance.now());
        const counts = new Map<string, number>();
        for (const token of s.tokens) counts.set(token.owner, (counts.get(token.owner) ?? 0) + 1);
        for (const block of this.document?.subsystems ?? []) {
            const uniform = this.fillUniforms.get(block.id), fraction = inventoryFraction((counts.get(block.id) ?? 0), block.capacity);
            if (uniform)
                uniform.value = fraction;
            const cap = this.fillCaps.get(block.id);
            if (cap) {
                cap.visible = fraction > 0 && fraction < 1;
                cap.position.z = -block.size[2] / 2 + block.size[2] * fraction;
            }
        }
        if (this.arc)
            this.arc.visible = false;
    }
    setTransformMode(mode: 'translate' | 'scale') { this.transform.setMode(mode); this.refreshTransform(); }
    navigateKey(event: KeyboardEvent): boolean {
        if (!this.editing || this.driver) return false;
        const key = event.key.toLowerCase(), offset = this.camera.position.clone().sub(this.controls.target);
        if (key === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            offset.multiplyScalar(event.shiftKey ? 1 / 1.2 : 1.2).clampLength(this.controls.minDistance, this.controls.maxDistance);
        } else if (key.startsWith('arrow') && ['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
                const horizontal = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
                const vertical = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
                const delta = (key === 'arrowleft' || key === 'arrowright' ? horizontal : vertical).multiplyScalar(offset.length() * .08 * (key === 'arrowleft' || key === 'arrowdown' ? -1 : 1));
                this.controls.target.add(delta);
            } else {
                const q = new THREE.Quaternion().setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
                const spherical = new THREE.Spherical().setFromVector3(offset.applyQuaternion(q));
                const angle = THREE.MathUtils.degToRad(event.ctrlKey || event.metaKey ? 5 : event.shiftKey ? 90 : 15);
                if (key === 'arrowleft' || key === 'arrowright') spherical.theta += key === 'arrowleft' ? angle : -angle;
                else spherical.phi = Math.max(.01, Math.min(Math.PI - .01, spherical.phi + (key === 'arrowup' ? -angle : angle)));
                offset.setFromSpherical(spherical).applyQuaternion(q.invert());
            }
        } else return false;
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
        return true;
    }
    setEditing(on: boolean) { this.editing = on; this.refreshTransform(); }
    private refreshTransform() { this.transform.enabled = this.editing && !this.drawing && !this.driver; this.transform.getHelper().visible = this.transform.enabled && !!this.transform.object; }
    private robotTarget() {
        this.aim.copy(this.robot.position); this.aim.z += this.robotAimHeight; return this.aim;
    }
    setDriveView(on: boolean, station: DriverStation = 2) {
        const entering = on && !this.driver;
        if (entering) {
            this.editCamera = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera instanceof THREE.PerspectiveCamera ? this.camera.fov : 43 };
        }
        if (!on && this.driver && this.editCamera) {
            this.camera.position.copy(this.editCamera.position);
            this.controls.target.copy(this.editCamera.target);
            if (this.camera instanceof THREE.PerspectiveCamera) {
                this.camera.fov = this.editCamera.fov;
                this.camera.updateProjectionMatrix();
            }
            this.camera.lookAt(this.controls.target);
        }
        this.station = station;
        this.driver = on;
        if (this.arc) this.arc.visible = !on && this.editing;
        this.driverEye.set(...stationCameraPosition(station, practice.length, practice.width));
        if (entering) {
            this.camera.position.copy(this.driverEye);
            this.driverAim.copy(this.robotTarget());
            this.camera.lookAt(this.driverAim);
        }
        if (on && this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.fov = 65;
            this.camera.updateProjectionMatrix();
        }
        this.controls.enabled = !on && !this.drawing;
        this.refreshTransform();
        this.lastFrame = performance.now();
    }
    private animateSnapshot(now: number) {
        const frame = this.frames.current, previous = this.frames.previous;
        if (!frame || !previous) return;
        const alpha = this.frames.alpha(now);
        this.robot.position.set(previous.pose.x + (frame.pose.x - previous.pose.x) * alpha, previous.pose.y + (frame.pose.y - previous.pose.y) * alpha, 0);
        this.robot.rotation.z = blendYaw(previous.pose.yaw, frame.pose.yaw, alpha);
        this.updatePieces(frame.pieces, alpha);
    }
    private updatePieces(pieces: Snapshot['pieces'], alpha = 1) {
        if (pieces.length > this.pieceMesh.instanceMatrix.count) {
            const old = this.pieceMesh;
            this.pieceMesh = new THREE.InstancedMesh(old.geometry, old.material, pieces.length * 2);
            this.pieceMesh.castShadow = true; this.pieceMesh.frustumCulled = false;
            this.pieceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.balls.remove(old); old.dispose(); this.balls.add(this.pieceMesh);
        }
        this.pieceMesh.count = pieces.length;
        pieces.forEach((p, index) => {
            const from = this.frames.previousPieces.get(p.id) ?? p;
            this.instanceTransform.position.set(from.position[0] + (p.position[0] - from.position[0]) * alpha, from.position[1] + (p.position[1] - from.position[1]) * alpha, from.position[2] + (p.position[2] - from.position[2]) * alpha);
            this.fromRotation.set(...from.rotation); this.toRotation.set(...p.rotation);
            this.instanceTransform.quaternion.slerpQuaternions(this.fromRotation, this.toRotation, alpha);
            this.instanceTransform.updateMatrix();
            this.pieceMesh.setMatrixAt(index, this.instanceTransform.matrix);
        });
        this.pieceMesh.instanceMatrix.needsUpdate = true;
    }
    private resize() {
        const w = this.host.clientWidth, h = this.host.clientHeight;
        if (!w || !h)
            return;
        this.renderer.setSize(w, h);
        if (this.camera instanceof THREE.PerspectiveCamera)
            this.camera.aspect = w / h;
        else {
            const scale = 7;
            this.camera.left = -scale * w / h;
            this.camera.right = scale * w / h;
            this.camera.top = scale;
            this.camera.bottom = -scale;
        }
        this.camera.updateProjectionMatrix();
    }
    view(type: string) {
        this.driver = type === 'driver';
        const target = this.robot.position.clone().add(new THREE.Vector3(.8, 0, .2));
        const old = this.controls;
        old.dispose();
        if (type === 'top' || type === 'front' || type === 'side') {
            this.camera = new THREE.OrthographicCamera(-8, 8, 6, -6, .05, 100);
            this.camera.position.copy(target).add(type === 'top' ? new THREE.Vector3(0, -.001, 14) : type === 'front' ? new THREE.Vector3(12, 0, .001) : new THREE.Vector3(0, -12, .001));
        }
        else {
            this.camera = new THREE.PerspectiveCamera(43, 1, .05, 100);
            this.camera.position.copy(target).add(new THREE.Vector3(-4.5, -5.5, 4.8));
        }
        this.camera.up.set(0, 0, 1);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.transform.camera = this.camera;
        this.controls.target.copy(target);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2 - .01;
        this.controls.enabled = !this.drawing && !this.driver;
        this.camera.lookAt(target);
        this.resize();
    }
    frame() {
        const mesh = this.meshes.get(this.selected);
        const center = mesh ? mesh.getWorldPosition(new THREE.Vector3()) : this.robot.position.clone();
        this.controls.target.copy(center);
        this.camera.position.copy(center).add(new THREE.Vector3(-2, -2, 2));
        if (this.camera instanceof THREE.OrthographicCamera) {
            this.camera.zoom = 3;
            this.camera.updateProjectionMatrix();
        }
    }
    setDrawing(on: boolean) {
        this.drawing = on;
        this.controls.enabled = !on && !this.driver;
        this.refreshTransform();
        this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
        if (on)
            this.view('top');
    }
    private coords(e: PointerEvent | MouseEvent) { const r = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); this.ray.setFromCamera(this.pointer, this.camera); }
    private ground(e: PointerEvent) { this.coords(e); const point = new THREE.Vector3(); return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -.275), point) ?? undefined; }
    private hit(e: PointerEvent | MouseEvent, face: boolean) {
        this.coords(e);
        const hit = this.ray.intersectObjects([...this.meshes.values()], false)[0];
        if (hit) {
            const f = FACES[Math.floor((hit.faceIndex ?? 0) / 2)];
            this.onSelect(hit.object.userData.id, face ? f : undefined);
        }
    }
    private updateGhost(end: THREE.Vector3) {
        const start = this.drawStart!;
        if (!this.ghost)
            this.ghost = this.box(0, 0, .45, .1, .1, .35, 0xf1bb64, this.scene, .4);
        this.ghost.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, .45);
        this.ghost.scale.set(Math.max(.1, Math.abs(end.x - start.x)) / .1, Math.max(.1, Math.abs(end.y - start.y)) / .1, 1);
    }
}
