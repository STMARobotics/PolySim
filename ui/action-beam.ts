import {beamGeometry,type Point} from './action-beam-model';
import type {FaceTarget} from './face-target';
export class ActionBeam {
    constructor(root:HTMLElement,private editable:()=>boolean,private target:(x:number,y:number)=>FaceTarget|undefined,private highlight:(target?:FaceTarget)=>void,private dragging:(on:boolean)=>void,private assign:(target:FaceTarget,type:'intake'|'outtake'|'score')=>void) {
        root.addEventListener('pointerdown',event=>{
            const button=(event.target as Element).closest<HTMLButtonElement>('[data-drag-action]');
            if(!button||button.disabled||event.button!==0||!this.editable())return;
            const type=button.dataset.dragAction;if(type!=='intake'&&type!=='outtake'&&type!=='score')return;
            event.preventDefault();event.stopPropagation();this.begin(button,event,type);
        });
    }
    private begin(button:HTMLButtonElement,event:PointerEvent,type:'intake'|'outtake'|'score') {
        const bounds=button.getBoundingClientRect(),start:Point=[bounds.left+bounds.width/2,bounds.top+bounds.height/2];
        const overlay=document.createElement('div');overlay.className='action-beam-overlay';overlay.setAttribute('aria-hidden','true');
        overlay.innerHTML='<svg><defs><linearGradient id="action-beam-gradient" gradientUnits="userSpaceOnUse"><stop stop-color="#4c9cff"/><stop offset=".5" stop-color="#d4eeff"/><stop offset="1" stop-color="#ffda45"/></linearGradient></defs><path class="beam-glow"/><path class="beam-ribbon"/><path class="beam-core"/><circle class="beam-tip" r="6"/></svg>';
        document.body.append(overlay);document.body.classList.add('assigning-action');this.dragging(true);
        const svg=overlay.querySelector('svg')!,gradient=overlay.querySelector('linearGradient')!,glow=overlay.querySelector('.beam-glow')!,ribbon=overlay.querySelector('.beam-ribbon')!,core=overlay.querySelector('.beam-core')!,tip=overlay.querySelector('.beam-tip')!;
        let current:FaceTarget|undefined,active=true;
        button.setPointerCapture(event.pointerId);
        const move=(e:PointerEvent)=>{
            if(e.pointerId!==event.pointerId)return;
            current=this.target(e.clientX,e.clientY);this.highlight(current);
            const end:Point=current?.screen ?? [e.clientX,e.clientY],geometry=beamGeometry(start,end);
            svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);gradient.setAttribute('x1',String(start[0]));gradient.setAttribute('y1',String(start[1]));gradient.setAttribute('x2',String(end[0]));gradient.setAttribute('y2',String(end[1]));
            glow.setAttribute('d',geometry.path);core.setAttribute('d',geometry.path);ribbon.setAttribute('d',geometry.ribbon);tip.setAttribute('cx',String(end[0]));tip.setAttribute('cy',String(end[1]));overlay.classList.toggle('snapped',!!current);
        };
        const finish=(commit:boolean,e?:PointerEvent)=>{
            if(!active)return;if(e && e.pointerId!==event.pointerId)return;if(e)move(e);active=false;
            window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key);window.removeEventListener('blur',blur);
            if(button.hasPointerCapture(event.pointerId))button.releasePointerCapture(event.pointerId);
            overlay.remove();document.body.classList.remove('assigning-action');this.highlight();this.dragging(false);
            if(commit&&current)this.assign(current,type);
        };
        const up=(e:PointerEvent)=>finish(true,e),cancel=(e:PointerEvent)=>finish(false,e),blur=()=>finish(false),key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();finish(false);}};
        window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key);window.addEventListener('blur',blur);move(event);
    }
}
