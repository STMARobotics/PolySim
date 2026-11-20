import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('../dist-offline/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('PORT must be an integer from 1024 to 65535.'); process.exit(1); }
const url = `http://127.0.0.1:${port}`;
const openBrowser = () => {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { windowsHide:true, stdio:'ignore' });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
};
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.json':'application/json', '.ttf':'font/ttf', '.woff2':'font/woff2' };
try { await stat(resolve(root, 'index.html')); } catch { console.error('Build missing. Run npm ci, then npm run build:offline first.'); process.exit(1); }
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/health') { res.writeHead(200, { 'Content-Type':'application/json' }); res.end(JSON.stringify({app:'polysim',version:'0.8.0'})); return; }
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
    if (pathname === '/') file = resolve(root, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try { const response=await fetch(url+'/health'); const data=await response.json(); if(data.app==='polysim') {console.log(`PolySim is already running at ${url}`);if(process.argv.includes('--open'))openBrowser();return;} } catch {}
  }
  console.error(error.message); process.exitCode=1;
});
server.listen(port, '127.0.0.1', () => { console.log(`PolySim offline lab: ${url}\nKeep this terminal open. Press Ctrl+C to stop.`); if(process.argv.includes('--open'))openBrowser(); });
