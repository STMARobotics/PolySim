import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createHash } from 'node:crypto';
import type { Config } from './config';
import type { Store, Item } from './store';
import { cookie, equal, hash, headers, HttpError, random, response, sameOrigin, tokenShape, type Request } from './http';
export interface User {sub: string; email: string; name: string; role: 'member'|'admin'}
export interface Session {user: User; ttl: number}
export interface GoogleProvider {exchange(code: string, verifier: string, nonce: string): Promise<TokenPayload>}
export async function verifyGoogleToken(idToken: string, nonce: string, config: Config, client = new OAuth2Client(config.googleClientId)) {
    const ticket=await client.verifyIdToken({idToken,audience:config.googleClientId});
    const payload=ticket.getPayload();verifyClaims(payload,nonce,config);return payload!;
}
export class GoogleOIDC implements GoogleProvider {
    private secret?: {value: string; until: number};
    private ssm=new SSMClient({maxAttempts:3});
    constructor(private config: Config) {}
    async exchange(code: string, verifier: string, nonce: string) {
        if(!this.secret || this.secret.until<Date.now()) {
            const value=(await this.ssm.send(new GetParameterCommand({Name:this.config.secretParameter,WithDecryption:true}))).Parameter?.Value;
            if(!value)throw Error('OAuth configuration unavailable');
            this.secret={value,until:Date.now()+300000};
        }
        const client=new OAuth2Client({clientId:this.config.googleClientId,clientSecret:this.secret.value,redirectUri:this.config.origin+'/api/auth/callback'});
        const {tokens}=await client.getToken({code,codeVerifier:verifier});
        if(!tokens.id_token)throw new HttpError(403,'LOGIN_DENIED','Google did not return an identity.');
        return verifyGoogleToken(tokens.id_token,nonce,this.config,client);
    }
}
// Called after cryptographic verification; repeated here for injected-provider tests.
export function verifyClaims(p: TokenPayload|undefined, nonce: string, config: Config, now=Math.floor(Date.now()/1000)) {
    const claims=p as (TokenPayload & {nonce?: string; azp?: string})|undefined;
    if(!claims || typeof claims.sub!=='string' || !claims.sub || claims.sub.length>255 || !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) || claims.aud!==config.googleClientId || !Number.isFinite(claims.exp) || claims.exp<=now || !Number.isFinite(claims.iat) || claims.iat>now+60 || typeof claims.nonce!=='string' || !equal(claims.nonce,nonce) || (claims.azp && claims.azp!==config.googleClientId)) throw new HttpError(403,'LOGIN_DENIED','Invalid Google identity.');
    if(claims.hd!==config.allowedDomain || claims.email_verified!==true || typeof claims.email!=='string' || claims.email.length>320 || claims.email.split('@').length!==2 || claims.email.split('@')[1].toLowerCase()!==config.allowedDomain) throw new HttpError(403,'DOMAIN_DENIED','Sign in with your stmarobotics.org Google Workspace account.');
}
export class Auth {
    constructor(public config: Config, private store: Store, private google: GoogleProvider, private now=()=>Math.floor(Date.now()/1000)) {}
    get sessionCookie() {return this.config.secureCookies?'__Host-polysim-session':'polysim-local-session';}
    get stateCookie() {return this.config.secureCookies?'__Host-polysim-oauth':'polysim-local-oauth';}
    private setCookie(name: string, value: string, age: number) {return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.config.secureCookies?'; Secure':''}`;}
    async start() {
        const state=random(), browser=random(), nonce=random(), verifier=random(), ttl=this.now()+300;
        await this.store.put(this.config.sessionsTable,{pk:'OAUTH#'+hash(state),sk:'STATE',browserHash:hash(browser),nonce,verifier,ttl});
        const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search=new URLSearchParams({client_id:this.config.googleClientId,redirect_uri:this.config.origin+'/api/auth/callback',response_type:'code',scope:'openid email profile',hd:this.config.allowedDomain,prompt:'select_account',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        return response(302,undefined,{location:url.toString()},[this.setCookie(this.stateCookie,browser,300)]);
    }
    async callback(req: Request) {
        const q=req.queryStringParameters ?? {}, browser=cookie(req,this.stateCookie);
        const failed=()=>response(302,undefined,{location:this.config.origin+'/?auth=denied'},[this.setCookie(this.stateCookie,'',0)]);
        if(!tokenShape(q.state) || !tokenShape(browser))return failed();
        // Consume atomically even if exchange fails; neither state nor code can be retried/replayed.
        const state=await this.store.consume(this.config.sessionsTable,'OAUTH#'+hash(q.state),'STATE',this.now());
        if(!state || !equal(state.browserHash,hash(browser)) || q.error || !q.code || q.code.length>4096)return failed();
        let payload: TokenPayload;
        try {payload=await this.google.exchange(q.code,state.verifier,state.nonce);verifyClaims(payload,state.nonce,this.config,this.now());}
        catch {return failed();}
        const user: User={sub:payload.sub,email:payload.email!,name:(payload.name ?? payload.email!).slice(0,100),role:this.config.adminEmails.includes(payload.email!.toLowerCase())?'admin':'member'};
        const session=random(), ttl=this.now()+this.config.sessionSeconds;
        await this.store.put(this.config.sessionsTable,{pk:'SESSION#'+hash(session),sk:'SESSION',user,ttl});
        const prior=cookie(req,this.sessionCookie);
        if(tokenShape(prior))await this.store.remove(this.config.sessionsTable,'SESSION#'+hash(prior),'SESSION');
        return response(302,undefined,{location:this.config.origin+'/'},[this.setCookie(this.sessionCookie,session,this.config.sessionSeconds),this.setCookie(this.stateCookie,'',0)]);
    }
    async session(req: Request): Promise<Session> {
        const raw=cookie(req,this.sessionCookie);
        const row=tokenShape(raw)?await this.store.get(this.config.sessionsTable,'SESSION#'+hash(raw),'SESSION'):undefined;
        if(!row || !Number.isSafeInteger(row.ttl) || row.ttl<=this.now() || typeof row.user?.sub!=='string' || !row.user.sub || typeof row.user?.email!=='string' || row.user.email.split('@')[1]?.toLowerCase()!==this.config.allowedDomain)throw new HttpError(401,'UNAUTHENTICATED','Sign in to continue.');
        // Roles are derived on every request so config changes revoke privileges immediately.
        return {user:{...row.user,role:this.config.adminEmails.includes(row.user.email.toLowerCase())?'admin':'member'},ttl:row.ttl};
    }
    async mutation(req: Request): Promise<Session> {
        sameOrigin(req,this.config.origin);
        const session=await this.session(req), raw=cookie(req,this.sessionCookie)!;
        if(!equal(headers(req)['x-csrf-token'] ?? '',hash('csrf:'+raw)))throw new HttpError(403,'CSRF','Refresh the app and retry.');
        return session;
    }
    async info(req: Request) {const s=await this.session(req);return response(200,{user:s.user,expiresAt:new Date(s.ttl*1000).toISOString(),csrfToken:hash('csrf:'+cookie(req,this.sessionCookie)!)});}
    async logout(req: Request) {await this.mutation(req);await this.store.remove(this.config.sessionsTable,'SESSION#'+hash(cookie(req,this.sessionCookie)!),'SESSION');return response(204,undefined,{},[this.setCookie(this.sessionCookie,'',0),this.setCookie(this.stateCookie,'',0)]);}
}
