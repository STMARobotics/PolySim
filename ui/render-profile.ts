export class RenderProfile {
    private output?: HTMLOutputElement;
    private start = performance.now();
    private frames: number[] = [];
    private renderTimes: number[] = [];
    constructor() {
        if (!new URLSearchParams(location.search).has('profile')) return;
        this.output = document.createElement('output');
        this.output.id = 'render-profile';
        this.output.style.cssText = 'margin-left:auto;font:11px monospace;color:#ffd135';
        document.querySelector('.statusbar')?.append(this.output);
    }
    frame(dt: number, renderMs: number, ratio: number, width: number, height: number) {
        if (!this.output) return;
        this.frames.push(dt * 1000);
        this.renderTimes.push(renderMs);
        const now = performance.now();
        if (now - this.start < 1000) return;
        const p95 = (a: number[]) => a.sort((a,b) => a-b)[Math.floor((a.length - 1) * .95)] ?? 0;
        const stats = { fps: +(this.frames.length * 1000 / (now - this.start)).toFixed(1), frameP95: +p95(this.frames).toFixed(1), renderP95: +p95(this.renderTimes).toFixed(1), ratio, width, height };
        this.output.textContent = JSON.stringify(stats);
        this.frames = []; this.renderTimes = []; this.start = now;
    }
}
