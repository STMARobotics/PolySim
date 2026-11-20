import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
export type Request = Pick<APIGatewayProxyEventV2, 'rawPath' | 'headers' | 'body' | 'isBase64Encoded' | 'cookies' | 'queryStringParameters'> & {requestContext: {http: {method: string}; requestId: string}};
export interface Response {statusCode: number; headers: Record<string,string>; body: string; cookies?: string[]}
export class HttpError extends Error {constructor(public status: number, public code: string, message: string, public details?: unknown) {super(message);}}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export function equal(a: string, b: string) {const x=Buffer.from(a), y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export function headers(req: Request) {return Object.fromEntries(Object.entries(req.headers ?? {}).map(([k,v])=>[k.toLowerCase(),v]));}
export function cookie(req: Request, name: string): string | undefined {
    const values = (req.cookies?.length ? req.cookies : [headers(req).cookie ?? '']).flatMap(s=>s.split(';')).map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
    // Duplicate session/state cookies are ambiguous and must fail closed.
    return values.length===1 ? values[0].slice(name.length+1) : undefined;
}
export const tokenShape = (value: unknown): value is string => typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function response(statusCode: number, value?: unknown, extra: Record<string,string> = {}, cookies?: string[]): Response {
    return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra},body:value===undefined?'':JSON.stringify(value),...(cookies?{cookies}:{})};
}
export function json(req: Request, max=270*1024): unknown {
    if (headers(req)['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json') throw new HttpError(415,'CONTENT_TYPE','Use application/json.');
    const text=req.isBase64Encoded ? Buffer.from(req.body ?? '', 'base64').toString('utf8') : req.body ?? '';
    if(Buffer.byteLength(text)>max)throw new HttpError(413,'TOO_LARGE','Request exceeds the size limit.');
    try {return JSON.parse(text);} catch {throw new HttpError(400,'INVALID_JSON','Malformed JSON.');}
}
export function sameOrigin(req: Request, origin: string) {
    const h=headers(req);
    if(h.origin!==origin || (h['sec-fetch-site'] && h['sec-fetch-site']!=='same-origin'))throw new HttpError(403,'ORIGIN','Request must come from this app.');
}
export function canonical(value: unknown): string {
    if (Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
    return JSON.stringify(value);
}
export async function boundary(req: Request, action: ()=>Promise<Response>): Promise<Response> {
    try {return await action();} catch(error) {
        if(error instanceof HttpError)return response(error.status,{error:{code:error.code,message:error.message,details:error.details},requestId:req.requestContext.requestId});
        // Never log events, cookies, OAuth codes, request bodies or Google tokens.
        console.error(JSON.stringify({event:'request_failed',requestId:req.requestContext.requestId,type:error instanceof Error?error.name:'Unknown'}));
        return response(503,{error:{code:'UNAVAILABLE',message:'Service temporarily unavailable. Your draft is preserved; try saving again.'},requestId:req.requestContext.requestId});
    }
}
