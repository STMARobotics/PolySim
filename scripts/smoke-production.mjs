import assert from 'node:assert/strict';
import {production} from '../cdk/lib/config.ts';
const origin=process.argv[2] ?? 'https://'+production.hostname;
const get=path=>fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
const home=await get('/');assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy') ?? '',/frame-ancestors 'none'/);
for(const path of ['/api/auth/session','/api/robots','/api/seasons']) {const r=await get(path);assert.equal(r.status,401,path);assert.match(r.headers.get('cache-control') ?? '',/no-store/);}
const start=await get('/api/auth/start');assert.equal(start.status,302);const target=new URL(start.headers.get('location'));assert.equal(target.hostname,'accounts.google.com');assert.equal(target.searchParams.get('hd'),production.allowedDomain);assert.equal(target.searchParams.get('redirect_uri'),origin+'/api/auth/callback');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.match(start.headers.get('set-cookie') ?? '',/HttpOnly/);assert.match(start.headers.get('set-cookie') ?? '',/Secure/);
console.log('Public smoke checks passed. A real Workspace login/save/logout test is still required.');
