import { RAPIER, Simulation } from './runtime';
import { DT, type RobotDocument } from '../contracts/model';
import type { Controls, InputFrame, ToWorker, FromWorker } from './protocol';
export function createSimulationHost(send: (message: FromWorker) => void) {
    let disposed = false;
    let sentRecording = 0;
    let sim: Simulation | undefined, document: RobotDocument, replay: InputFrame[] | undefined;
    let running = false, endTick = 14400, controls: Controls = { x: 0, y: 0, turn: 0, held: [] }, last = performance.now(), accumulator = 0, lastPublish = 0;
    const publish = () => {
        if (sim) {
            const snapshot = sim.snapshot(running, accumulator > .15, !running);
            snapshot.recordingOffset = running ? sentRecording : 0;
            if (running) snapshot.recording = structuredClone(sim.recording.slice(sentRecording));
            sentRecording = sim.recording.length;
            send({type: 'snapshot', snapshot});
        }
    };
    let ready: Promise<void> | undefined;
    const handle = async (data: ToWorker) => {
        try {
            if (disposed) return;
            await (ready ??= RAPIER.init());
            if (disposed) return;
            if (data.type === 'init') {
                running = false;
                document = data.document;
                replay = data.replay;
                endTick = data.endTick ?? 14400;
                sim?.free();
                sim = new Simulation(document, replay);
                sentRecording = 0;
                accumulator = 0;
                controls = { x: 0, y: 0, turn: 0, held: [] };
                send({ type: 'ready' });
                publish();
            }
            if (data.type === 'reset' && document) {
                running = false;
                sim?.free();
                sim = new Simulation(document, replay);
                sentRecording = 0;
                accumulator = 0;
                publish();
            }
            if (data.type === 'play' && sim) {
                running = sim.tick < endTick;
                last = performance.now();
                accumulator = 0;
                publish();
            }
            if (data.type === 'pause') {
                running = false;
                controls = { x: 0, y: 0, turn: 0, held: [] };
                publish();
            }
            if (data.type === 'step' && sim && !running && sim.tick < endTick) {
                sim.step(controls);
                publish();
            }
            if (data.type === 'controls')
                controls = data.controls;
        }
        catch (e) {
            running = false;
            send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
    };
    const timer = setInterval(() => {
        const now = performance.now();
        if (running && sim) {
            accumulator += (now - last) / 1000;
            if (accumulator > 2) {
                running = false;
                accumulator = 0;
                send({ type: 'error', message: 'Simulation paused: worker fell over 2 seconds behind. No physics ticks were skipped.' });
            }
            try {
                let n = 0;
                while (running && accumulator >= DT && n++ < 12) {
                    sim.step(controls);
                    accumulator -= DT;
                    if (sim.tick >= endTick)
                        running = false;
                }
            }
            catch (e) {
                running = false;
                send({ type: 'error', message: String(e) });
            }
            if (now - lastPublish > 33 || !running) {
                publish();
                lastPublish = now;
            }
        }
        last = now;
    }, 8);
    
    return { handle, dispose() { disposed = true; clearInterval(timer); running = false; sim?.free(); sim = undefined; } };
}
