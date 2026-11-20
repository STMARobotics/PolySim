import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {configuration} from './config';
import {createApplication} from './app';
import {GoogleOIDC} from './auth';
import {MemoryStore} from './memory-store';
import {production} from '../cdk/lib/config';
const port=Number(process.env.API_PORT ?? 3000);
const config=configuration({...process.env,APP_ENV:'local',APP_ORIGIN:process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',ALLOWED_DOMAIN:production.allowedDomain,GOOGLE_CLIENT_ID:production.googleClientId,GOOGLE_SECRET_PARAMETER:production.googleSecretParameter,DATA_TABLE:'local-data',SESSIONS_TABLE:'local-sessions'});
// Local development NEVER accesses the production DynamoDB tables.
const app=createApplication(config,new MemoryStore(),new GoogleOIDC(config));
const root=resolve('dist');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.json':'application/json'};
createServer(async(req,res)=>{
    try {
        const url=new URL(req.url ?? '/',config.origin);
        if(url.pathname.startsWith('/api/')) {
            let size=0;const chunks:Buffer[]=[];
            for await(const chunk of req) {const bytes=Buffer.from(chunk);size+=bytes.length;if(size>270*1024){res.writeHead(413);res.end();return;}chunks.push(bytes);}
            const result=await app.handle({rawPath:url.pathname,queryStringParameters:Object.fromEntries(url.searchParams),headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join('; '):v])),body:Buffer.concat(chunks).toString(),isBase64Encoded:false,requestContext:{requestId:randomUUID(),http:{method:req.method ?? 'GET'}}});
            res.writeHead(result.statusCode,{...result.headers,...(result.cookies?{'set-cookie':result.cookies}:{})});res.end(result.body);return;
        }
        const pathname=decodeURIComponent(url.pathname),file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
        if(!file.startsWith(root+sep) || !['GET','HEAD'].includes(req.method ?? '')) {res.writeHead(404);res.end();return;}
        const body=await readFile(file);
        res.writeHead(200,{'content-type':mime[extname(file)] ?? 'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`PolySim local API http://127.0.0.1:${port} · isolated memory store · real Google login · origin ${config.origin}`));
