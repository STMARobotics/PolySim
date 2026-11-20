import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,random} from '../http';
import {configuration} from '../config';
import {Auth,verifyClaims} from '../auth';
import {config,fixture,request} from './support';
async function start(f=fixture()) {
    const response=await f.app.handle(request('/api/auth/start'));
    assert.equal(response.statusCode,302);
    const url=new URL(response.headers.location),cookie=response.cookies![0].split(';')[0];
    return {f,response,url,cookie,callback:()=>f.app.handle({...request('/api/auth/callback?state='+url.searchParams.get('state')+'&code=test-code'),cookies:[cookie]})};
}
test('OAuth uses server-side PKCE, nonce, state, fixed redirect and a host-only secure HttpOnly cookie',async()=>{
    const s=await start(), q=s.url.searchParams;
    assert.equal(q.get('code_challenge_method'),'S256');assert.equal(q.get('hd'),'stmarobotics.org');
    assert.equal(q.get('redirect_uri'),config.origin+'/api/auth/callback');assert.equal(q.get('scope'),'openid email profile');
    assert.equal(q.get('code_challenge')!.length,43);assert.equal(q.get('state')!.length,43);assert.equal(q.get('nonce')!.length,43);
    assert.match(s.response.cookies![0],/HttpOnly; SameSite=Lax; Max-Age=300; Secure/);assert.ok(!s.response.cookies![0].includes('Domain='));
    assert.ok(!s.url.href.includes('code_verifier'));
    const state=await s.f.store.get('sessions','OAUTH#'+hash(q.get('state')!),'STATE');assert.equal(state!.verifier.length,43);
});
test('successful Google callback rotates opaque sessions and replaying the same callback cannot create another session',async()=>{
    const s=await start(),r=await s.callback();assert.equal(r.statusCode,302);assert.equal(r.headers.location,config.origin+'/');
    const sessionCookie=r.cookies![0].split(';')[0], token=sessionCookie.split('=')[1];
    const row=await s.f.store.get('sessions','SESSION#'+hash(token),'SESSION');assert.equal(row!.user.sub,'member-sub');
    assert.ok(!JSON.stringify([...s.f.store.rows.values()]).includes(token));
    const info=await s.f.app.handle({...request('/api/auth/session'),cookies:[sessionCookie]});assert.equal(info.statusCode,200);assert.equal(JSON.parse(info.body).csrfToken,hash('csrf:'+token));
    const repeated=await s.callback();assert.match(repeated.headers.location,/auth=denied/);assert.equal(s.f.calls(),1);
});
test('OAuth rejects missing state, wrong browser, expired state and Google errors before exchanging a code',async()=>{
    for(const variant of ['missing','browser','expired','error']) {
        const s=await start();let req={...request('/api/auth/callback?state='+s.url.searchParams.get('state')+'&code=x'),cookies:[s.cookie]};
        if(variant==='missing')req.queryStringParameters={code:'x'};
        if(variant==='browser')req.cookies=['__Host-polysim-oauth='+random()];
        if(variant==='expired')for(const row of s.f.store.rows.values())row.ttl=0;
        if(variant==='error')req.queryStringParameters!.error='access_denied';
        const r=await s.f.app.handle(req);assert.match(r.headers.location,/auth=denied/);assert.equal(s.f.calls(),0);
    }
});
test('Google callback rejects domain lookalikes, unverified mail, missing hd and invalid identity claims',async()=>{
    for(const claims of [{hd:'evil.org'},{hd:undefined},{email:'student@stmarobotics.org.evil.test'},{email_verified:false},{nonce:'wrong'},{aud:'another-app'},{iss:'https://evil.test'},{exp:1},{sub:''},{iat:Math.floor(Date.now()/1000)+500}]) {
        const s=await start();s.f.setClaims(claims);const r=await s.callback();assert.match(r.headers.location,/auth=denied/,JSON.stringify(claims));
        assert.equal([...s.f.store.rows.values()].filter(r=>r.sk==='SESSION').length,0);
    }
});
test('verified admin email grants admin role and is re-derived from the stored email',async()=>{
    const s=await start();s.f.setClaims({email:'ADMIN@STMAROBOTICS.ORG'});const r=await s.callback();
    assert.equal(r.statusCode,302);const sessionCookie=r.cookies![0].split(';')[0];
    const info=await s.f.app.handle({...request('/api/auth/session'),cookies:[sessionCookie]});
    assert.equal(JSON.parse(info.body).user.role,'admin');
});
test('all data endpoints reject missing sessions; forged and expired cookies fail regardless of DynamoDB TTL cleanup',async()=>{
    const f=fixture();
    for(const path of ['/api/auth/session','/api/seasons','/api/robots','/api/robots/00000000-0000-4000-8000-000000000000'])assert.equal((await f.app.handle(request(path))).statusCode,401);
    assert.equal((await f.app.handle(request('/api/robots','GET',undefined,{cookie:'__Host-polysim-session='+random()}))).statusCode,401);
    const expired=await f.login('member-sub',1);assert.equal((await f.app.handle(request('/api/robots','GET',undefined,expired))).statusCode,401);
    assert.equal(f.store.rows.size,1,'TTL cleanup has not removed the expired row');
});
test('writes require exact same origin and CSRF token; duplicate cookies fail closed',async()=>{
    const f=fixture(),session=await f.login();
    for(const overrides of ([{origin:'https://evil.test'},{origin:''},{'x-csrf-token':'bad'},{'sec-fetch-site':'cross-site'}] as Record<string,string>[]))assert.equal((await f.app.handle(request('/api/robots','POST',{}, {...session,...overrides}))).statusCode,403);
    assert.equal((await f.app.handle(request('/api/auth/session','GET',undefined,{...session,cookie:session.cookie+'; '+session.cookie}))).statusCode,401);
});
test('logout revokes a session immediately, and responses never cache identities or team data',async()=>{
    const f=fixture(),session=await f.login();
    const before=await f.app.handle(request('/api/auth/session','GET',undefined,session));assert.equal(before.statusCode,200);assert.match(before.headers['cache-control'],/no-store/);
    const out=await f.app.handle(request('/api/auth/logout','POST',{},session));assert.equal(out.statusCode,204);assert.match(out.cookies![0],/Max-Age=0/);
    assert.equal((await f.app.handle(request('/api/auth/session','GET',undefined,session))).statusCode,401);
});
test('configuration validates origins and normalizes approved-domain admin emails',()=>{
    const valid={APP_ORIGIN:config.origin,ALLOWED_DOMAIN:config.allowedDomain,GOOGLE_CLIENT_ID:'id',GOOGLE_SECRET_PARAMETER:'/x',DATA_TABLE:'x',SESSIONS_TABLE:'y',ADMIN_EMAILS:' ADMIN@STMAROBOTICS.ORG,admin@stmarobotics.org '};
    assert.equal(configuration(valid).secureCookies,true);
    assert.deepEqual(configuration(valid).adminEmails,['admin@stmarobotics.org']);
    for(const patch of [{APP_ORIGIN:'http://example.test'},{APP_ORIGIN:config.origin+'/'},{ALLOWED_DOMAIN:'evil.org'},{GOOGLE_CLIENT_ID:''},{APP_ENV:'local',APP_ORIGIN:'http://example.test'},{ADMIN_EMAILS:'admin@example.com'}])assert.throws(()=>configuration({...valid,...patch}));
    assert.equal(configuration({...valid,APP_ENV:'local',APP_ORIGIN:'http://127.0.0.1:5173'}).secureCookies,false);
});
