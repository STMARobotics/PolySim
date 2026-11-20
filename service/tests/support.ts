import {randomUUID} from 'node:crypto';
import type {TokenPayload} from 'google-auth-library';
import {createApplication} from '../app';
import {MemoryStore} from '../memory-store';
import type {Config} from '../config';
import {hash,random,type Request} from '../http';
export const config:Config={origin:'https://polysim.example.test',allowedDomain:'stmarobotics.org',googleClientId:'test-client',secretParameter:'/test/secret',dataTable:'data',sessionsTable:'sessions',secureCookies:true,adminEmails:['admin@stmarobotics.org'],sessionSeconds:28800};
export function request(path:string,method='GET',body?:unknown,extra:Record<string,string>={}):Request {
    const url=new URL(path,config.origin);
    return {rawPath:url.pathname,queryStringParameters:Object.fromEntries(url.searchParams),headers:{origin:config.origin,'sec-fetch-site':'same-origin',...(body!==undefined?{'content-type':'application/json'}:{}),...extra},body:body!==undefined?JSON.stringify(body):undefined,isBase64Encoded:false,requestContext:{http:{method},requestId:randomUUID()}};
}
export function fixture() {
    const store=new MemoryStore();
    let calls=0, claims:Partial<TokenPayload & {nonce:string}>={};
    const app=createApplication(config,store,{async exchange(code,verifier,nonce) {calls++;return {...{iss:'https://accounts.google.com',aud:config.googleClientId,sub:'member-sub',email:'student@stmarobotics.org',email_verified:true,hd:'stmarobotics.org',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,nonce},...claims};}});
    async function login(sub='member-sub',ttl=Math.floor(Date.now()/1000)+3600) {
        const email=sub==='admin-sub'?'admin@stmarobotics.org':'member@stmarobotics.org';
        const token=random();await store.put(config.sessionsTable,{pk:'SESSION#'+hash(token),sk:'SESSION',ttl,user:{sub,email,name:'Member',role:config.adminEmails.includes(email)?'admin':'member'}});
        return {cookie:`__Host-polysim-session=${token}`,'x-csrf-token':hash('csrf:'+token)};
    }
    return {store,app,login,setClaims:(v:typeof claims)=>{claims=v;},calls:()=>calls};
}
