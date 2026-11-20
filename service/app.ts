import { Auth, type GoogleProvider } from './auth';
import type { Config } from './config';
import { boundary, HttpError, response, type Request } from './http';
import { Robots } from './robots';
import type { Store } from './store';
import { ENGINE_VERSION } from '../contracts/model';
import {seasons} from '../seasons/registry';
export function createApplication(config: Config, store: Store, google: GoogleProvider) {
    const auth=new Auth(config,store,google), robots=new Robots(config,store,auth);
    return {auth, handle:(req: Request)=>boundary(req,async()=>{
        const method=req.requestContext.http.method, path=req.rawPath;
        if(method==='GET' && path==='/api/auth/start')return auth.start();
        if(method==='GET' && path==='/api/auth/callback')return auth.callback(req);
        if(method==='GET' && path==='/api/auth/session')return auth.info(req);
        if(method==='POST' && path==='/api/auth/logout')return auth.logout(req);
        if(path==='/api/robots' || path.startsWith('/api/robots/'))return robots.handle(req);
        if(method==='GET' && (path==='/api/seasons'||path.startsWith('/api/seasons/'))) {
            await auth.session(req);
            const manifest=(season:typeof seasons[number])=>({...season,engine:ENGINE_VERSION,units:'m',displayUnits:'in',coverage:['Physical field and configurable scoring only; no match rules'],capabilities:['boxes','ball-intake','ball-outtake','timed-transitions','subsystem-states','not-pressed-trigger','subsystem-targeting','season-field-v1','typed-pieces','piece-physics-v2']});
            if(path==='/api/seasons')return response(200,{items:seasons.map(s=>({id:s.id,title:s.title,version:s.version,pieceTypes:s.pieceTypes}))});
            const season=seasons.find(s=>s.id===path.slice('/api/seasons/'.length));if(!season)throw new HttpError(404,'NOT_FOUND','Season not found.');return response(200,manifest(season));
        }
        throw new HttpError(404,'NOT_FOUND','Route not found.');
    })};
}
