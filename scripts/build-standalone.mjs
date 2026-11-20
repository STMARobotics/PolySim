// Package the already-built static app as one file, including its WASM worker.
// File URLs run the shared physics host in-page; the embedded worker remains available for HTTP playback.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = 'dist-offline';
const output = resolve(process.argv[2] || resolve(project, buildDirectory, 'PolySim-Play.html'));
let html = await readFile(resolve(project, buildDirectory, 'index.html'), 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const stylesheet = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (!script || !stylesheet) throw Error('Expected one Vite script and stylesheet. Run npm run build first.');
let client = await readFile(resolve(project, buildDirectory, '.' + script[1]), 'utf8');
const worker = client.match(/new URL\("(\/assets\/worker-[^"]+\.js)",import\.meta\.url\)/);
if (!worker) throw Error('Could not locate the bundled simulation worker.');
const workerBytes = await readFile(resolve(project, buildDirectory, '.' + worker[1]));
const workerBlob = `URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(workerBytes.toString('base64'))}),c=>c.charCodeAt(0))],{type:"text/javascript"}))`;
client = client.replace(worker[0], workerBlob);
if (client.includes('import.meta.url')) throw Error('Unpackaged module URL remains.');
let css = await readFile(resolve(project, buildDirectory, '.' + stylesheet[1]), 'utf8');
for (const match of [...css.matchAll(/url\((['"]?)(\/fonts\/[^'"\)\s]+)\1\)/g)]) {
  const bytes = await readFile(resolve(project, buildDirectory, '.' + match[2]));
  const mime = match[2].endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
  css = css.replace(match[0], `url("data:${mime};base64,${bytes.toString('base64')}")`);
}
if (/url\(['"]?\/fonts\//.test(css)) throw Error('Unpackaged font URL remains.');
const icon = await readFile(resolve(project, buildDirectory, 'favicon.svg'));
html = html.replace(script[0], `<script type="module" src="data:text/javascript;base64,${Buffer.from(client).toString('base64')}"></script>`);
html = html.replace(stylesheet[0], `<style>${css}</style>`);
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${icon.toString('base64')}"`);
const notices = await Promise.all(['THREE-MIT.txt','APACHE-2.0.txt','GEO-OFL.txt','MONA-SANS-OFL.txt'].map(async name => `${name}\n${await readFile(resolve(project,'docs','licenses',name),'utf8')}`));
html = html.replace('</head>', `<script type="text/plain" id="third-party-licenses">${notices.join('\n\n')}</script></head>`);
if (/\b(?:src|href)="\/assets\//.test(html)) throw Error('External asset reference remains.');
await mkdir(dirname(output), { recursive:true });
await writeFile(output, html);
console.log(`Standalone demo: ${output}`);
console.log('Open this HTML file directly in Chrome or Edge. No local server is needed.');
