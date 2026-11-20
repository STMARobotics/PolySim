import { GoogleOIDC } from './auth';
import { createApplication } from './app';
import { configuration } from './config';
import { DynamoStore } from './store';
import type { Request } from './http';
let application: ReturnType<typeof createApplication>;
export function applicationHandler(req: Request) {
    if(!application) {const config=configuration();application=createApplication(config,new DynamoStore(),new GoogleOIDC(config));}
    return application.handle(req);
}
