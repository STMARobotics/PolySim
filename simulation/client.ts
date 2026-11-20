import { createSimulationHost } from './host';
import type { FromWorker, ToWorker, InputFrame } from './protocol';

type WorkerEndpoint = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

// File-based browsers can reject blob workers without an ErrorEvent message.
// The same host also runs in-page, preserving physics and the message protocol.
export class SimulationClient {
    onmessage?: (event: { data: FromWorker }) => void;
    onerror?: (error: Error) => void;
    private worker?: WorkerEndpoint;
    private local?: ReturnType<typeof createSimulationHost>;
    private init?: Extract<ToWorker, { type: 'init' }>;
    private ready = false;
    private timer?: ReturnType<typeof setTimeout>;
    private recording: InputFrame[] = [];
    private frozenRecording = false;

    constructor(private factory: () => WorkerEndpoint, private preferLocal = false) {}

    postMessage(message: ToWorker) {
        if (message.type === 'init') {
            this.init = structuredClone(message);
            this.ready = false;
        }
        if (this.local) {
            void this.local.handle(structuredClone(message));
            return;
        }
        try {
            if (!this.worker) {
                if (this.preferLocal) {
                    this.useLocal();
                    return;
                }
                this.worker = this.factory();
                this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.receive(data);
                this.worker.onerror = () => this.workerFailed();
                this.worker.onmessageerror = () => this.workerFailed();
            }
            this.worker.postMessage(message);
            if (message.type === 'init') {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.workerFailed(), 10000);
            }
        } catch {
            this.workerFailed();
        }
    }

    private receive(data: FromWorker) {
        if (data.type === 'snapshot' && data.snapshot.recordingOffset !== undefined) {
            const s = data.snapshot;
            if (s.recordingOffset === 0) { this.recording = s.recording; this.frozenRecording = !s.running; }
            else if (s.recording.length) {
                if (this.frozenRecording) this.recording = this.recording.slice();
                this.recording.push(...s.recording);
                this.frozenRecording = false;
            }
            s.recording = this.recording;
        }
        if (data.type === 'ready' || data.type === 'error') clearTimeout(this.timer);
        if (data.type === 'ready') this.ready = true;
        this.onmessage?.({ data });
    }

    private workerFailed() {
        this.stopWorker();
        this.preferLocal = true;
        if (!this.ready) this.useLocal();
        else this.onerror?.(new Error('Simulation stopped. Return to Drive to restart.'));
    }

    private useLocal() {
        if (this.local) return;
        try {
            this.local = createSimulationHost(data => {
                // Host snapshots already own all their data; avoid cloning every
                // piece, metric and input a second time in file compatibility mode.
                queueMicrotask(() => this.receive(data));
            });
            if (this.init) void this.local.handle(structuredClone(this.init));
        } catch (error) {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private stopWorker() {
        clearTimeout(this.timer);
        if (this.worker) {
            this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
            this.worker.terminate();
            this.worker = undefined;
        }
    }

    terminate() {
        this.stopWorker();
        this.local?.dispose();
        this.local = undefined;
        this.init = undefined;
    }
}
