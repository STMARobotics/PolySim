import { createSimulationHost } from './host';
import type { FromWorker, ToWorker } from './protocol';
const host = createSimulationHost((message: FromWorker) => postMessage(message));
onmessage = ({data}: MessageEvent<ToWorker>) => { void host.handle(data); };
