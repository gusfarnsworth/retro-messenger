/** Independent Staff/Admin window. The staff role is always checked against
 * Supabase; the local UI is not an authorisation boundary. All write actions
 * continue to be enforced by the existing RLS policies and secure RPCs. */
import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {Minus,ShieldCheck,Square,X} from 'lucide-react';
import {supabase,readableError} from './client';
import {StaffAlertConsole} from './StaffPanels';
import type {StaffRole} from './staffAlerts';
import {controlWindow,startNativeDrag,type WindowAction} from './windowing';
import retroMessengerLogo from './assets/retro-messenger-logo.png';

/** Also reused as a draggable window inside the browser desktop. */
export function AdminConsoleFrame({role,minimized=false,standalone=false}:{
  role:StaffRole;
  minimized?:boolean;
  standalone?:boolean;
}){
  const native=isTauri();
  function onControl(action:WindowAction){
    if(standalone&&!native){
      if(action==='close')window.location.assign('/');
      return;
    }
    controlWindow(action,'admin-console');
  }
  return <section className={
    'xp-window admin-console-window'+
    (!native&&!standalone?' web-floating':'')+
    (minimized?' window-minimized':'')
  } data-window-id="admin-console" aria-label="Retro Messenger Staff Console">
    <header className="xp-title admin-console-title" onPointerDown={startNativeDrag}>
      <div className="xp-title-name"><img src={retroMessengerLogo} alt="" className="titlebar-logo"/>
        Retro Messenger — {role==='admin'?'Administration':'Staff Console'}
      </div>
      <div className="window-symbols" data-no-drag>
        {(['minimize','maximize','close'] as WindowAction[]).map(action=><button
          key={action} type="button"
          aria-label={action==='minimize'?'Minimise window':action==='maximize'?'Maximise or restore window':'Close window'}
          title={action}
          onClick={e=>{e.stopPropagation();onControl(action)}}
        >{action==='minimize'?<Minus size={12}/>:action==='maximize'?<Square size={11}/>:<X size={13}/>}</button>)}
      </div>
    </header>
    <div className="admin-console-info"><ShieldCheck size={16}/>
      <div><strong>{role==='admin'?'Administration Centre':'Staff Centre'}</strong>
        <small>Official messages, polls, reports and moderation actions</small>
      </div>
      <span className="admin-role-marker">{role}</span>
    </div>
    <div className="admin-console-content"><StaffAlertConsole role={role}/></div>
    <footer className="admin-console-footer">Retro Messenger · Private staff workspace · Actions are recorded in Supabase</footer>
  </section>;
}

/** Rendered as a separate native Tauri webview at /?admin=1.
 * It must re-authenticate and re-check role; URL alone never grants access. */
export function StandaloneAdminPage(){
  const [userId,setUserId]=useState<string|null>(null);
  const [role,setRole]=useState<StaffRole|null>(null);
  const [status,setStatus]=useState<'checking'|'signed-out'|'denied'|'ready'|'error'>('checking');
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!supabase){setError('Supabase is not configured.');setStatus('error');return;}
    const auth=supabase.auth;
    let active=true;
    void auth.getUser().then(({data,error:authError})=>{
      if(!active)return;
      if(authError){setError(readableError(authError));setStatus('error');return;}
      setUserId(data.user?.id??null);
      if(!data.user)setStatus('signed-out');
    }).catch(e=>{if(active){setError(readableError(e));setStatus('error')}});
    const {data:{subscription}}=auth.onAuthStateChange((event,session)=>{
      if(!active)return;
      if(event==='SIGNED_OUT'){setUserId(null);setRole(null);setStatus('signed-out');}
      else if(event==='SIGNED_IN'&&session?.user){setUserId(session.user.id);setStatus('checking');}
    });
    return()=>{active=false;subscription.unsubscribe()};
  },[]);

  useEffect(()=>{
    if(!supabase||!userId)return;
    let active=true;
    const client=supabase;
    async function refreshRole(){
      const {data,error:roleError}=await client.from('messenger_staff')
        .select('role').eq('user_id',userId).maybeSingle();
      if(!active)return;
      if(roleError){setRole(null);setError(readableError(roleError));setStatus('error');return;}
      const nextRole=data?.role;
      if(nextRole==='admin'||nextRole==='staff'){setRole(nextRole);setStatus('ready')}
      else{setRole(null);setStatus('denied')}
    }
    setRole(null);setStatus('checking');
    void refreshRole();
    const timer=window.setInterval(()=>void refreshRole(),60000);
    const onFocus=()=>void refreshRole();
    window.addEventListener('focus',onFocus);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',onFocus)};
  },[userId]);

  if(status==='ready'&&role)return <main className="desktop native-mode admin-only" data-interface-font="tahoma">
    <AdminConsoleFrame role={role} standalone/>
  </main>;
  return <main className="desktop native-mode admin-only admin-access-state">
    <section className="xp-window admin-console-window">
      <header className="xp-title" onPointerDown={startNativeDrag}><div className="xp-title-name"><img src={retroMessengerLogo} alt="" className="titlebar-logo"/> Retro Messenger — Staff Console</div>
        <div className="window-symbols" data-no-drag><button type="button" aria-label="Close window" onClick={()=>{if(isTauri())controlWindow('close','admin-console');else window.location.assign('/')}}><X size={13}/></button></div>
      </header>
      <div className="admin-access-message">
        <ShieldCheck size={36}/>
        <h2>{status==='checking'?'Checking staff permissions…':status==='signed-out'?'Sign in required':status==='denied'?'Access restricted':'Unable to open staff console'}</h2>
        <p>{status==='checking'?'Verifying your account with Supabase…':status==='signed-out'?'Sign in to your account in the main Messenger window, then reopen the Staff Console.':status==='denied'?'Only authorised Retro Messenger staff can access this window.':error}</p>
      </div>
    </section>
  </main>;
}
