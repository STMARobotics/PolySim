import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClient } from '../simulation/client';
import { sampleRobot } from '../seasons/practice';
import type { FromWorker, Snapshot } from '../simulation/protocol';

function harness(client: SimulationClient) {
    let latest: Snapshot | undefined;
    const waiters: { accept: (data: FromWorker) => boolean; resolve: () => void }[] = [];
    client.onmessage = ({ data }) => {
        if (data.type === 'error') throw new Error(data.message);
        if (data.type === 'snapshot') latest = data.snapshot;
        for (const waiter of [...waiters]) if (waiter.accept(data)) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve();
        }
    };
    client.onerror = error => { throw error; };
    const wait = (accept: (data: FromWorker) => boolean) => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Simulation response timed out')), 2000);
        waiters.push({ accept, resolve: () => { clearTimeout(timer); resolve(); } });
    });
    return { wait, latest: () => latest! };
}

async function exerciseDriving(client: SimulationClient) {
    const h = harness(client);
    const ready = h.wait(data => data.type === 'ready');
    client.postMessage({ type: 'init', document: sampleRobot() });
    await ready;
    const initial = h.latest().pose.x;
    client.postMessage({ type: 'controls', controls: { x: 1, y: 0, turn: 0, held: [] } });
    const moved = h.wait(data => data.type === 'snapshot' && data.snapshot.tick === 240);
    for (let i = 0; i < 240; i++) client.postMessage({ type: 'step' });
    await moved;
    assert.ok(h.latest().pose.x > initial + .5, 'local physics responds to driving input');
    const reset = h.wait(data => data.type === 'snapshot' && data.snapshot.tick === 0);
    client.postMessage({ type: 'reset' });
    await reset;
    assert.equal(h.latest().pose.x, initial);
}

test('file mode drives without constructing a worker; editor startup is independent of physics', async () => {
    let attempts = 0;
    const client = new SimulationClient(() => { attempts++; throw new Error('Workers blocked'); }, true);
    assert.equal(attempts, 0);
    try { await exerciseDriving(client); assert.equal(attempts, 0); }
    finally { client.terminate(); }
});

test('a worker constructor failure transparently falls back to working physics', async () => {
    const client = new SimulationClient(() => { throw new Error('SecurityError'); });
    try { await exerciseDriving(client); }
    finally { client.terminate(); }
});

test('an asynchronous worker error with no message falls back and terminates the failed worker', async () => {
    let terminated = false;
    const endpoint = {
        onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'], onmessageerror: null as Worker['onmessageerror'],
        postMessage() { queueMicrotask(() => endpoint.onerror?.call(endpoint as unknown as Worker, {} as ErrorEvent)); },
        terminate() { terminated = true; }
    };
    const client = new SimulationClient(() => endpoint);
    try { await exerciseDriving(client); assert.ok(terminated); }
    finally { client.terminate(); }
});

test('normal worker responses keep using the worker rather than restarting the run locally', () => {
    const endpoint = {
        onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'], onmessageerror: null as Worker['onmessageerror'],
        messages: [] as unknown[], postMessage(message: unknown) { this.messages.push(message); }, terminate() {}
    };
    const client = new SimulationClient(() => endpoint);
    const received: FromWorker[] = [];
    client.onmessage = ({ data }) => received.push(data);
    try {
        client.postMessage({ type: 'init', document: sampleRobot() });
        endpoint.onmessage?.call(endpoint as unknown as Worker, { data: { type: 'ready' } } as MessageEvent);
        client.postMessage({ type: 'play' });
        assert.deepEqual(received, [{ type: 'ready' }]);
        assert.equal(endpoint.messages.length, 2);
    } finally { client.terminate(); }
});

test('recording deltas append without duplication and preserve paused run snapshots across resume', () => {
    const endpoint = {onmessage:null as Worker['onmessage'],onerror:null as Worker['onerror'],onmessageerror:null as Worker['onmessageerror'],postMessage() {},terminate() {}};
    const client = new SimulationClient(()=>endpoint), h=harness(client);
    const a={tick:1,controls:{x:1,y:0,turn:0,held:[]}}, b={tick:2,controls:{x:0,y:0,turn:0,held:[]}};
    const emit=(offset:number,recording: typeof a[],running:boolean) => endpoint.onmessage?.call(endpoint as unknown as Worker,{data:{type:'snapshot',snapshot:{recordingOffset:offset,recording,running}}} as MessageEvent);
    try {
        client.postMessage({type:'init',document:sampleRobot()});
        emit(0,[a],false);
        const paused=h.latest();
        emit(1,[],true); // Resume publishes before another input has arrived.
        emit(1,[b],true);
        assert.deepEqual(h.latest().recording,[a,b]);
        assert.deepEqual(paused.recording,[a]);
        emit(2,[],true);
        assert.equal(h.latest().recording.length,2);
        emit(0,[],false);
        assert.equal(h.latest().recording.length,0);
    } finally { client.terminate(); }
});
