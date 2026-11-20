import { Auth, type GoogleProvider } from './auth';
import type { Config } from './config';
import { boundary, HttpError, response, type Request } from './http';
import { Robots } from './robots';
import type { Store } from './store';
import { practice } from '../seasons/practice';
export function createApplication(config: Config, store: Store, google: GoogleProvider) {
    const auth=new Auth(config,store,google), robots=new Robots(config,store,auth);
    return {auth, handle:(req: Request)=>boundary(req,async()=>{
        const method=req.requestContext.http.method, path=req.rawPath;
        if(method==='GET' && path==='/api/auth/start')return auth.start();
        if(method==='GET' && path==='/api/auth/callback')return auth.callback(req);
        if(method==='GET' && path==='/api/auth/session')return auth.info(req);
        if(method==='POST' && path==='/api/auth/logout')return auth.logout(req);
        if(path==='/api/robots' || path.startsWith('/api/robots/'))return robots.handle(req);
        if(method==='GET' && (path==='/api/seasons' || path==='/api/seasons/practice-balls')) {
            await auth.session(req);
            const manifest={id:practice.id,title:practice.title,version:practice.version,engine:'0.5.0',units:'in',coverage:['Practice fixture only; no official FRC rules'],capabilities:['boxes','ball-intake','ball-outtake','timed-transitions']};
            return response(200,path==='/api/seasons'?{items:[manifest]}:manifest);
        }
        throw new HttpError(404,'NOT_FOUND','Route not found.');
    })};
}
