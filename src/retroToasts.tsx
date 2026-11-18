import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {emitTo,listen} from '@tauri-apps/api/event';
import {WebviewWindow} from '@tauri-apps/api/webviewWindow';
import {currentMonitor,getCurrentWindow} from '@tauri-apps/api/window';
import {ShieldCheck,X} from 'lucide-react';
import retroMessengerLogo from './assets/retro-messenger-logo.png';

export type MessengerToast={
  id:string;
  kind:'message'|'staff'|'system';
  title:string;
  body:string;
  contactId?:string;
  groupId?:string;
  alertId?:string;
  systemMessageId?:string;
};
export const isToastPage=new URLSearchParams(window.location.search).get('toast')==='1';
let serial=0;
const openedToasts:string[]=[];

/** Custom XP-style native popup positioned in the monitor's WORK area (not behind
 * the Windows taskbar). No notification permission or system toast assets needed. */
export async function showMessengerToast(toast:MessengerToast):Promise<void>{
  if(!isTauri()){
    window.dispatchEvent(new CustomEvent('retro-toast-local',{detail:toast}));
    return;
  }
  const label=`toast-${Date.now()}-${++serial}`;
  try {
    // Reuse at most three small separate windows, stacked vertically.
    if(openedToasts.length>=3){
      const oldest=openedToasts.shift();
      if(oldest){const win=await WebviewWindow.getByLabel(oldest);await win?.close().catch(()=>{});}
    }
    const slot=openedToasts.length;
    openedToasts.push(label);
    const monitor=await currentMonitor();
    const width=320,height=110,margin=12;
    const workPos=monitor?.workArea.position.toLogical(monitor.scaleFactor);
    const workSize=monitor?.workArea.size.toLogical(monitor.scaleFactor);
    const x=workPos&&workSize?Math.round(workPos.x+workSize.width-width-margin):undefined;
    const y=workPos&&workSize?Math.round(workPos.y+workSize.height-height-margin-slot*(height+10)):undefined;

    // Handshake avoids losing the event while the new webview is loading.
    const unlisten=await listen<{label:string}>('retro-toast-ready',async event=>{
      if(event.payload.label!==label)return;
      unlisten();
      try{
        await emitTo(label,'retro-toast-data',toast);
        const view=await WebviewWindow.getByLabel(label);
        await view?.show();
      }catch(e){console.error('Could not display Messenger toast',e)}
    });
    const view=new WebviewWindow(label,{
      url:'/?toast=1',title:'Retro Messenger Notice',width,height,
      ...(x===undefined?{}:{x}),...(y===undefined?{}:{y}),
      decorations:false,resizable:false,maximizable:false,minimizable:false,
      skipTaskbar:true,alwaysOnTop:true,focus:false,visible:false,shadow:true
    });
    view.once('tauri://error',event=>{unlisten();const i=openedToasts.indexOf(label);if(i>=0)openedToasts.splice(i,1);console.error('Toast window creation failed',event.payload)});
    const cleanup=await listen<{label:string}>('retro-toast-finished',event=>{
      if(event.payload.label!==label)return;
      cleanup();const index=openedToasts.indexOf(label);if(index>=0)openedToasts.splice(index,1);
    });
    // Prevent listeners from lingering if a window never reports ready.
    window.setTimeout(()=>{unlisten();cleanup()},13000);
  }catch(error){
    console.error('Native Messenger popup unavailable; showing in-app popup',error);
    const index=openedToasts.indexOf(label);if(index>=0)openedToasts.splice(index,1);
    window.dispatchEvent(new CustomEvent('retro-toast-local',{detail:toast}));
  }
}

export function NativeToastPage(){
  const [toast,setToast]=useState<MessengerToast|null>(null);
  useEffect(()=>{
    let stopped=false;let timeout:number|undefined;
    let unsubscribe:(()=>void)|undefined;
    void (async()=>{
      unsubscribe=await listen<MessengerToast>('retro-toast-data',event=>{
        if(stopped)return;
        setToast(event.payload);
        if(timeout)window.clearTimeout(timeout);
        timeout=window.setTimeout(()=>void finish(),8000);
      });
      if(!stopped)await emitTo('main','retro-toast-ready',{label:getCurrentWindow().label});
    })();
    async function finish(){
      const current=getCurrentWindow();
      await emitTo('main','retro-toast-finished',{label:current.label}).catch(()=>{});
      await current.close().catch(()=>{});
    }
    return()=>{stopped=true;if(timeout)window.clearTimeout(timeout);unsubscribe?.()};
  },[]);
  async function close(){
    await emitTo('main','retro-toast-finished',{label:getCurrentWindow().label}).catch(()=>{});
    await getCurrentWindow().close().catch(()=>{});
  }
  async function open(){if(!toast)return;
    await emitTo('main','retro-toast-open',toast).catch(console.error);
    await close();
  }
  if(!toast)return <main className="native-toast-loading"/>;
  return <main className="native-toast-shell"><ToastCard toast={toast} onOpen={()=>void open()} onClose={()=>void close()}/></main>;

}

function ToastCard({toast,onOpen,onClose}:{toast:MessengerToast;onOpen:()=>void;onClose:()=>void}){
  return <article className="retro-toast" role="status">
    <div className="retro-toast-title"><img src={retroMessengerLogo} alt="" className="toast-title-logo"/><strong>Retro Messenger</strong><button title="Dismiss" type="button" onClick={onClose}><X size={14}/></button></div>
    <button className="retro-toast-content" type="button" onClick={onOpen}>
      {toast.kind==='staff'||toast.kind==='system'?<ShieldCheck size={30}/>:<img src={retroMessengerLogo} alt="" className="toast-main-logo"/>}
      <span><strong>{toast.title}</strong><small>{toast.body}</small></span>
    </button>
  </article>;
}

/** Browser version cannot draw outside the tab, so show the same card near its bottom right. */
export function BrowserToastStack({onOpen}:{onOpen:(toast:MessengerToast)=>void}){
  const [items,setItems]=useState<MessengerToast[]>([]);
  useEffect(()=>{
    function show(event:Event){const item=(event as CustomEvent<MessengerToast>).detail;
      setItems(old=>[...old.filter(x=>x.id!==item.id).slice(-2),item]);
      window.setTimeout(()=>setItems(old=>old.filter(x=>x.id!==item.id)),8000);
    }
    window.addEventListener('retro-toast-local',show);
    return()=>window.removeEventListener('retro-toast-local',show);
  },[]);
  return <div className="browser-toasts">{items.map(toast=><ToastCard key={toast.id} toast={toast} onOpen={()=>{onOpen(toast);setItems(old=>old.filter(x=>x.id!==toast.id))}} onClose={()=>setItems(old=>old.filter(x=>x.id!==toast.id))}/>)}</div>;
}
