import './style.css';
import './workspace.css';
import './login.css';
import { configureCloud, type Identity } from './cloud';
import { scopeStorage, clearScopedStorage } from './storage';
const root=document.querySelector<HTMLDivElement>('#app')!;
function gate(message: string, login=true) {
    root.replaceChildren();
    const card=document.createElement('main');card.className='login-card';
    const logo=document.createElement('h1');logo.textContent='PolySim';
    const detail=document.createElement('p');detail.textContent=message;
    const action=document.createElement('a');action.className='primary';action.textContent=login?'Sign in with Google':'Retry';action.href=login?'/api/auth/start':'/';
    const domain=document.createElement('small');domain.textContent='stmarobotics.org accounts only';
    card.append(logo,detail,action,domain);root.append(card);
}
gate('Checking your session…',false);
async function boot() {
    let result:Response;
    try {result=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});}
    catch {gate('Unable to reach PolySim. Check your connection and retry.',false);return;}
    if(result.status===401) {scopeStorage();clearScopedStorage();gate(new URLSearchParams(location.search).get('auth')==='denied'?'Access requires your stmarobotics.org Google Workspace account.':'Sign in to open your team workspace.');return;}
    if(!result.ok) {gate('PolySim is temporarily unavailable. Please retry.',false);return;}
    const session=await result.json() as Identity;
    if(!session.user?.sub || !session.csrfToken)throw Error('Invalid session response');
    scopeStorage(session.user.sub);configureCloud(session);
    window.addEventListener('polysim:session-expired',()=>{clearScopedStorage();location.replace('/');},{once:true});
    window.addEventListener('storage',event=>{
        if(event.key==='polysim.active-user' && event.newValue!==session.user.sub)location.replace('/');
    });
    await import('./main');
    // Detect server expiry/revocation while the user is driving or editing without saves.
    setInterval(async()=>{
        try {
            const r=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
            if(r.status===401)window.dispatchEvent(new Event('polysim:session-expired'));
            else if(r.ok) {const current=await r.json() as Identity;if(current.user.sub!==session.user.sub)window.dispatchEvent(new Event('polysim:session-expired'));else configureCloud(current);}
        }
        catch {/* Network loss keeps the loaded workspace available; saves stay explicit. */}
    },60000);
}
void boot().catch(()=>gate('Unable to load the workspace. Please retry.',false));
