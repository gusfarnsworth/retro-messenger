import { useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowAction = 'minimize' | 'maximize' | 'close';

/** Native app windows are actual OS windows; web windows are positioned in the desktop. */
export function controlWindow(action: WindowAction, id?:string) {
  if (isTauri()) {
    const win = getCurrentWindow();
    const work = action === 'minimize' ? win.minimize() : action === 'maximize'
      ? win.isMaximized().then(max => max ? win.unmaximize() : win.maximize()) : win.close();
    void work.catch(error => console.error('Window action failed:', error));
  } else {
    document.dispatchEvent(new CustomEvent('retro-window-action', {detail:{action,id}}));
  }
}

const saved = (key:string) => {
  try {const value = JSON.parse(localStorage.getItem(key)||'null');
    if(value && Number.isFinite(value.x) && Number.isFinite(value.y)) return value as {x:number,y:number};
  } catch { /* reset invalid saved position */ }
  return null;
};

/** Pointer-driven window manager: draggable, movable and persistent positions on web. */
export function useWindowDragging() {
  useEffect(() => {
    if(isTauri()) return;
    let highest = 100;
    let dragging:null|{node:HTMLElement,startX:number,startY:number,left:number,top:number,pointerId:number} = null;
    function prepare(){
      document.querySelectorAll<HTMLElement>('.web-floating[data-window-id]').forEach((node,idx) => {
        if(node.dataset.ready==='yes') return;
        const id=node.dataset.windowId||'window';
        const preferred=saved(`retro-position:${id}`);
        const initial = id === 'contacts' ? {x:25,y:24} : id === 'login' ?
          {x:Math.max(8,Math.round((innerWidth-node.offsetWidth)/2)),y:Math.max(14,Math.round((innerHeight-node.offsetHeight)/2))} :
          id==='settings' ? {x:Math.max(8,Math.round((innerWidth-node.offsetWidth)/2)),y:Math.max(15,Math.round((innerHeight-node.offsetHeight)/2))} :
          {x:Math.min(Math.max(12,innerWidth-node.offsetWidth-12),410+idx*24),y:62+idx*18};
        node.style.left=`${Math.max(0,Math.min(innerWidth-140,preferred?.x??initial.x))}px`;
        node.style.top=`${Math.max(0,Math.min(innerHeight-52,preferred?.y??initial.y))}px`;
        node.style.zIndex=String(++highest);
        node.dataset.ready='yes';
      });
    }
    prepare();
    const observer=new MutationObserver(prepare);
    observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
    const down=(event:PointerEvent)=>{
      if(event.button!==0) return;
      const target=event.target as HTMLElement;
      const node=target.closest<HTMLElement>('.web-floating[data-window-id]');
      if(!node) return;
      node.style.zIndex=String(++highest);
      if(!target.closest('.xp-title')||target.closest('button, a, input, select, [data-no-drag]')) return;
      if(node.dataset.maximized==='yes') return;
      dragging={node,startX:event.clientX,startY:event.clientY,left:parseFloat(node.style.left)||0,top:parseFloat(node.style.top)||0,pointerId:event.pointerId};
      document.body.classList.add('window-is-dragging');
      event.preventDefault();
    };
    const move=(event:PointerEvent)=>{
      if(!dragging||dragging.pointerId!==event.pointerId) return;
      const {node,startX,startY,left,top}=dragging;
      const x=Math.min(Math.max(0,left+event.clientX-startX),Math.max(0,innerWidth-140));
      const y=Math.min(Math.max(0,top+event.clientY-startY),Math.max(0,innerHeight-44));
      node.style.left=`${x}px`;node.style.top=`${y}px`;
    };
    const up=()=>{
      if(!dragging) return;
      const {node}=dragging;
      const id=node.dataset.windowId||'window';
      localStorage.setItem(`retro-position:${id}`,JSON.stringify({x:parseFloat(node.style.left)||0,y:parseFloat(node.style.top)||0}));
      dragging=null;
      document.body.classList.remove('window-is-dragging');
    };
    const dbl=(event:MouseEvent)=>{
      const target=event.target as HTMLElement;
      if(!target.closest('.xp-title')||target.closest('button'))return;
      const id=target.closest<HTMLElement>('[data-window-id]')?.dataset.windowId;
      if(id)controlWindow('maximize',id);
    };
    document.addEventListener('pointerdown',down);
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
    document.addEventListener('pointercancel',up);
    document.addEventListener('dblclick',dbl);
    return()=>{observer.disconnect();document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);document.removeEventListener('dblclick',dbl);document.body.classList.remove('window-is-dragging')};
  },[]);
}

export function startNativeDrag(event:ReactPointerEvent) {
  if(!isTauri()||event.button!==0||((event.target as HTMLElement).closest('button, input, select')))return;
  void getCurrentWindow().startDragging().catch(console.error);
}
