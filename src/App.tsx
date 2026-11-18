import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { controlWindow, startNativeDrag, useWindowDragging, type WindowAction } from './windowing';
import { MessengerMenu, type MenuDefinition } from './MessengerMenu';
import {FloatingPopup} from './FloatingUI';
import { AlertsInbox } from './StaffPanels';
import { AdminConsoleFrame } from './AdminConsole';
import { ReportDialog, type ReportTarget } from './Reports';
import { useStaffAlerts, type StaffAlert } from './staffAlerts';
import { useSystemDirectMessages, type SystemDirectMessage } from './systemDirectMessages';
import { BrowserToastStack, showMessengerToast, type MessengerToast } from './retroToasts';
import { mergeConversationTimeline } from './conversationTimeline';
import {DEFAULT_MESSAGE_STYLE,FormattedMessageText,isAllowedMessageColor,plainMessageText,safeMessageStyle,type MessageStyle} from './messageFormatting';
import {SafeTextColorPicker} from './SafeTextColorPicker';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogIn, UserRoundPlus, Settings, Send, Smile, Circle, X, Reply, Users, Search, ChevronDown, LogOut, Bell, Monitor, Minus, Square, Camera, Trash2, Zap, Download, Palette, Volume2, VolumeX, ShieldCheck, Flag } from 'lucide-react';
import type { User, RealtimeChannel } from '@supabase/supabase-js';
import { configured, supabase, readableError, type Profile, type Request, type Message } from './client';
import retroMessengerLogo from './assets/retro-messenger-logo.png';
import {SystemPollCard,useSystemPollResults} from './SystemPolls';
import {GroupsHub,GroupChatWindow} from './GroupChats';
import {ContactOverview} from './ContactOverview';
import {MessageAttachment} from './MessageAttachment';
import {ClassicDrawingPad} from './ClassicDrawingPad';
import {GamesButton} from './MessengerGamesCenter';
import {ConversationExtrasBoundary,MessageExtras,MessageSearch} from './MessageExtras';
import {PrivacySettings,NowPlayingEditor,SuspensionAppeal} from './PrivacyAndAppeals';
import {UpdateChecker} from './UpdateChecker';

type Status = Profile['status_preference'];
type ModerationStatus={
  is_suspended:boolean;is_muted:boolean;
  suspended_until:string|null;muted_until:string|null;
  suspension_reason:string|null;mute_reason:string|null
};
type InterfaceFont = 'tahoma'|'verdana'|'arial'|'trebuchet';
type MessageFont = 'ms-sans'|'tahoma'|'comic'|'verdana'|'georgia';
const chatQuery = new URLSearchParams(window.location.search).get('chat');
const systemQuery = new URLSearchParams(window.location.search).get('system') === '1';
const display = (p:Profile) => p.display_name || p.username;
const dateTime = (d:string) => new Date(d).toLocaleTimeString([], { hour:'2-digit',minute:'2-digit' });
const EMOTES=[['🙂',':)'],['😃',':D'],['😉',';)'],['😛',':P'],['😢',":'("],['❤️','<3'],['😎','8-)'],['😮',':O'],['😂',':lol:'],['👍','(y)'],['😡',':@'],['🤗',':hug:']];
type ChatEvent={id:string,conversation_id:string,sender_id:string,kind:string,created_at:string,payload?:{variant?:string}};
function MessageBody({message,onError}:{message:Message,onError?:(msg:string)=>void}){
  if(message.deleted_at)return <p className="message-deleted">This message was deleted.</p>;
  if(message.kind==='file'&&message.attachment_path)return <MessageAttachment message={message} onError={onError}/>;
  return <FormattedMessageText message={message}/>;
}
function soundNotification(){try {if(localStorage.getItem('retro-sound-theme')==='custom'){const sound=localStorage.getItem('retro-custom-sound');if(sound){const player=new Audio(sound);player.volume=.55;void player.play().catch(()=>{});return;}}const AudioCtor=window.AudioContext;if(!AudioCtor)return;const ctx=new AudioCtor();const oscillator=ctx.createOscillator();const gain=ctx.createGain();oscillator.type='sine';const theme=localStorage.getItem('retro-sound-theme')||'classic';const pitches=theme==='gentle'?[523,659]:theme==='bright'?[784,1046]:theme==='quiet'?[440,523]:[660,880];oscillator.frequency.setValueAtTime(pitches[0],ctx.currentTime);oscillator.frequency.setValueAtTime(pitches[1],ctx.currentTime+.09);gain.gain.setValueAtTime(theme==='quiet'?.014:.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.19);oscillator.connect(gain);gain.connect(ctx.destination);oscillator.start();oscillator.stop(ctx.currentTime+.2);oscillator.onended=()=>void ctx.close()}catch{/* Browser audio may be unavailable until a user gesture. */}}


function Header({children}:{children:React.ReactNode}) {return <div className="xp-title" onPointerDown={startNativeDrag}><div className="xp-title-name"><img src={retroMessengerLogo} alt="" className="titlebar-logo"/>{children}</div><div className="window-symbols" data-no-drag>
  {(['minimize','maximize','close'] as WindowAction[]).map(action=><button type="button" key={action} aria-label={action==='minimize'?'Minimise window':action==='maximize'?'Maximise or restore window':'Close window'} title={action} onClick={e=>{e.stopPropagation();const id=(e.currentTarget.closest('[data-window-id]') as HTMLElement|null)?.dataset.windowId;controlWindow(action,id)}}>{action==='minimize'?<Minus size={12}/>:action==='maximize'?<Square size={11}/>:<X size={13}/>}</button>)}
</div></div>}
function Avatar({person,small=false}:{person:Profile,small?:boolean}) {return <div className={'avatar'+(small?' small':'')}>{person.avatar_url?<img src={person.avatar_url} alt={display(person)+' profile picture'} loading="lazy" referrerPolicy="no-referrer"/>:display(person)[0]?.toUpperCase()}</div>}
function StatusDot({status}:{status:Status|'offline'}) {return <span className={'status-dot '+(['brb','phone','lunch'].includes(status)?'away':status)} title={status}/>}

function Login({onLogin,interfaceFont,rememberedUser,minimized,onRestore}:{onLogin:(u:User)=>void,interfaceFont:InterfaceFont,rememberedUser:User|null,minimized:boolean,onRestore:()=>void}) {
  const native = isTauri();
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState(localStorage.getItem('retro-login-email')||'');
  const [password,setPassword]=useState('');
  const [username,setUsername]=useState('');
  const [usernameStatus,setUsernameStatus]=useState<'idle'|'checking'|'available'|'taken'|'error'>('idle');
  const usernameCheckSequence=useRef(0);
  const [displayName,setDisplayName]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [verificationEmail,setVerificationEmail]=useState<string|null>(null);
  const [verificationCode,setVerificationCode]=useState('');
  const [resendCooldown,setResendCooldown]=useState(0);
  const [loginStatus,setLoginStatus]=useState<Status>(()=>(localStorage.getItem('retro-login-status') as Status)||'online');
  const [rememberMe,setRememberMe]=useState(localStorage.getItem('retro-remember-me')==='1');
  const [rememberPassword,setRememberPassword]=useState(localStorage.getItem('retro-remember-password')==='1');
  const [autoSignIn,setAutoSignIn]=useState(localStorage.getItem('retro-auto-signin')==='1');

  // Supabase controls expiry and server-side resend limits. The client-side
  // countdown only discourages unnecessary repeat requests.
  useEffect(()=>{
    if (!verificationEmail || resendCooldown<=0) return;
    const timer=window.setTimeout(()=>setResendCooldown(value=>Math.max(0,value-1)),1000);
    return ()=>window.clearTimeout(timer);
  },[verificationEmail,resendCooldown]);
  useEffect(()=>{localStorage.removeItem('retro-login-password');},[]);

  function storePrefs(nextEmail:string){
    localStorage.setItem('retro-login-status',loginStatus);
    localStorage.setItem('retro-remember-me',rememberMe?'1':'0');
    localStorage.setItem('retro-remember-password',rememberPassword?'1':'0');
    localStorage.setItem('retro-auto-signin',autoSignIn?'1':'0');
    if(rememberMe) localStorage.setItem('retro-login-email',nextEmail);
    else localStorage.removeItem('retro-login-email');
    // Never persist credentials or verification codes in browser storage.
    localStorage.removeItem('retro-login-password');
  }
  function showSignIn(){setRegister(false);setVerificationEmail(null);setVerificationCode('');setNotice('');}
  function showSignUp(){setRegister(true);setVerificationEmail(null);setVerificationCode('');setNotice('');setUsernameStatus('idle');}

  // This RPC checks only a public username, never whether a private email exists.
  // The profile's UNIQUE constraint still enforces the result during signup.
  async function checkUsernameAvailable(rawHandle:string):Promise<boolean>{
    if(!supabase)throw Error('Supabase is not configured.');
    const handle=rawHandle.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,20}$/.test(handle))return false;
    const check=++usernameCheckSequence.current;
    setUsernameStatus('checking');
    const {data,error}=await supabase.rpc('username_is_available',{p_username:handle});
    if(error){
      if(check===usernameCheckSequence.current)setUsernameStatus('error');
      throw Error('Username check is unavailable. Run migration 0013 in Supabase, then try again.');
    }
    const available=data===true;
    if(check===usernameCheckSequence.current)setUsernameStatus(available?'available':'taken');
    return available;
  }

  function startVerification(address:string,initialCooldown=0){
    if(!address.trim()){setNotice('Enter your email address first.');return;}
    setEmail(address.trim().toLowerCase());
    setVerificationEmail(address.trim().toLowerCase());
    setVerificationCode('');
    setResendCooldown(initialCooldown);
    setNotice('Enter the verification code sent to your email address.');
  }
  async function doSignIn(){
    const address=email.trim().toLowerCase();
    const {data,error}=await supabase!.auth.signInWithPassword({email:address,password});
    if(error){
      if(error.code==='email_not_confirmed'){
        startVerification(address);
        return;
      }
      throw error;
    }
    storePrefs(address);
    if(data.user){
      await supabase!.from('profiles').update({status_preference:loginStatus}).eq('id',data.user.id);
      onLogin(data.user);
    }
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();if(!supabase)return;
    setBusy(true);setNotice('');
    try{
      if(register){
        const handle=username.trim().toLowerCase();
        if(!/^[a-z0-9_]{3,20}$/.test(handle))throw Error('Username must be 3–20 letters, numbers or underscores.');
        if(!await checkUsernameAvailable(handle)){
          throw Error('You cannot make more than one account with this username. Please choose another username.');
        }
        const address=email.trim().toLowerCase();
        const {data,error}=await supabase.auth.signUp({
          email:address,password,options:{data:{username:handle,display_name:displayName.trim()||handle}}
        });
        if(error){
          if(error.code==='user_already_exists'||/user already registered|email already (registered|exists|in use)/i.test(error.message)){
            throw Error('You cannot make more than one account with this email. Please sign in or reset your password.');
          }
          // A second signup can race the availability check. Database uniqueness
          // still wins, and the UI can give a helpful error rather than a generic
          // Supabase "Database error saving new user" message.
          if(/database error saving new user|duplicate key|unique constraint/i.test(error.message)){
            const {data:stillAvailable,error:checkError}=await supabase.rpc('username_is_available',{p_username:handle});
            if(!checkError&&stillAvailable===false){
              setUsernameStatus('taken');
              throw Error('You cannot make more than one account with this username. Please choose another username.');
            }
          }
          throw error;
        }
        // With email confirmation enabled, Supabase may intentionally return
        // an obfuscated user for an already-confirmed email. An empty identity
        // list indicates an existing account; never pretend a code was sent.
        if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0){
          throw Error('You cannot make more than one account with this email. Please sign in or reset your password.');
        }
        if(!data.user)throw Error('Account registration did not complete. Please try again.');
        storePrefs(address);
        if(data.session?.user)onLogin(data.session.user);
        else startVerification(address,60);
      }else await doSignIn();
    }catch(err){setNotice(readableError(err));}
    finally{setBusy(false);}
  }
  async function verifyEmail(e:React.FormEvent){
    e.preventDefault();
    if(!supabase||!verificationEmail)return;
    // The OTP length is set in Supabase Auth (6–10 digits). Validate the
    // whole numeric token, rather than assuming Supabase always sends six.
    if(!/^\d{6,10}$/.test(verificationCode)){
      setNotice('Enter the complete verification code from your email (6–10 digits).');return;
    }
    setBusy(true);setNotice('');
    try{
      const {data,error}=await supabase.auth.verifyOtp({
        email:verificationEmail,token:verificationCode,type:'email'
      });
      if(error)throw error;
      setVerificationCode('');
      if(data.user&&data.session){
        storePrefs(verificationEmail);
        await supabase.from('profiles').update({status_preference:loginStatus}).eq('id',data.user.id);
        onLogin(data.user);
      }else{
        // Verification was accepted but no session was returned; sign in normally.
        setVerificationEmail(null);
        setRegister(false);
        setPassword('');
        setNotice('Email verified successfully. Sign in with your password.');
      }
    }catch(err){setNotice(readableError(err));}
    finally{setBusy(false);}
  }
  async function resendCode(){
    if(!supabase||!verificationEmail||resendCooldown>0)return;
    setBusy(true);setNotice('');
    try{
      const {error}=await supabase.auth.resend({type:'signup',email:verificationEmail});
      if(error)throw error;
      setVerificationCode('');
      setResendCooldown(60);
      setNotice('A new verification code has been requested. Check your inbox and spam folder.');
    }catch(err){setNotice(readableError(err));}
    finally{setBusy(false);}
  }
  async function forgotPassword(){
    if(!supabase)return;
    if(!email.trim()){setNotice('Enter your email address first.');return;}
    setBusy(true);setNotice('');
    try{
      const {error}=await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:'https://retromessenge.vercel.app/reset-password'});
      if(error)throw error;
      setNotice('If this email is registered, a password reset link has been sent. Open it to choose a new password on the Retro Messenger website.');
    }catch(err){setNotice(readableError(err));}
    finally{setBusy(false);}
  }

  return <div className={'page-center login-page'+(native?' native-login-page':'')} data-interface-font={interfaceFont}>
    <section className={'xp-window login-window msn-login-window'+(native?'':' web-floating')+(!native&&minimized?' window-minimized':'')} data-window-id="login">
      <Header>Retro Messenger</Header>
      <MessengerMenu menus={[
        {label:'File',items:[{label:'Sign In',action:showSignIn},{label:'Create Account',action:showSignUp}]},
        {label:'Tools',items:[{label:'Remember My Email',action:()=>setRememberMe(v=>!v)},{label:'Remember My Session',action:()=>setRememberPassword(v=>!v)}]},
        {label:'Help',items:[{label:'About Retro Messenger',action:()=>setNotice('Retro Messenger is a community-built messenger inspired by MSN 7.5.')}]}
      ]}/>
      <div className="login-body classic-login-body">
        <div className="classic-login-top">
          <div className="classic-login-logo">
            <div className="logo-round classic logo-card"><img src={retroMessengerLogo} alt="Retro Messenger logo" className="hero-logo"/></div>
            <div className="login-brand-copy"><h1><em>retro</em> Messenger</h1><p className="subtitle">{verificationEmail?'Email verification':'Sign in to Messenger'}</p></div>
          </div>
        </div>
        {verificationEmail ? <form onSubmit={verifyEmail} className="otp-verify-form">
          <div className="otp-verify-heading"><strong>Verify your email</strong><p>Enter the verification code we sent to <b>{verificationEmail}</b>.</p></div>
          <label htmlFor="retro-email-code">Verification code</label>
          <input id="retro-email-code" type="text" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={10} pattern="[0-9]{6,10}"
            aria-describedby="retro-code-help" placeholder="Enter email code" className="otp-code-input"
            value={verificationCode} onChange={e=>setVerificationCode(e.target.value.replace(/\D/g,'').slice(0,10))}/>
          <small id="retro-code-help" className="otp-code-help">The code expires according to your Supabase email security settings.</small>
          <button className="xp-button primary otp-verify-button" disabled={busy||!/^[0-9]{6,10}$/.test(verificationCode)} type="submit">{busy?'Verifying…':'Verify email address'}</button>
          <button className="link-button otp-resend" type="button" onClick={()=>void resendCode()} disabled={busy||resendCooldown>0}>
            {resendCooldown>0?`Resend code in ${resendCooldown}s`:'Send a new code'}
          </button>
          <button className="link-button otp-back" type="button" onClick={showSignIn}>Back to sign in</button>
        </form> : <form onSubmit={submit} className="stack-form login-stack classic-login-form">
          {register&&<>
            <label>Username<input required value={username} maxLength={20}
              onChange={e=>{usernameCheckSequence.current++;setUsername(e.target.value);setUsernameStatus('idle')}}
              onBlur={()=>{if(/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase()))void checkUsernameAvailable(username).catch(err=>setNotice(readableError(err)))}}
              aria-describedby="username-availability" placeholder="yourname2005" autoComplete="username"/>
              <small id="username-availability" className={'signup-username-status '+usernameStatus} aria-live="polite">{usernameStatus==='checking'?'Checking username…':usernameStatus==='available'?'Username is available.':usernameStatus==='taken'?'This username is already taken. Please choose another.':usernameStatus==='error'?'Username availability check failed.':''}</small>
            </label>
            <label>Display name<input value={displayName} maxLength={40} onChange={e=>setDisplayName(e.target.value)} placeholder="Your display name"/></label>
          </>}
          {rememberedUser&&!register&&<div className="remembered-session">
            <span>Signed in previously as <b>{rememberedUser.email}</b></span>
            <button type="button" className="xp-button primary" onClick={()=>onLogin(rememberedUser)}>Continue to Messenger</button>
            <button type="button" className="link-button" onClick={()=>{void supabase?.auth.signOut();setNotice('Enter another account below.')}}>Use another account</button>
          </div>}
          <label>E-mail address:<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email"/>
            {register&&<small className="signup-email-hint">One account per email address. Already registered? Sign in or reset your password.</small>}
          </label>
          <label>Password:<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={register?'new-password':'current-password'}/></label>
          <label>Status:<select value={loginStatus} onChange={e=>setLoginStatus(e.target.value as Status)}>
            <option value="online">Online</option><option value="away">Away</option><option value="brb">Be Right Back</option><option value="phone">On the Phone</option><option value="lunch">Out to Lunch</option><option value="busy">Busy</option><option value="invisible">Appear Offline</option>
          </select></label>
          <div className="login-options">
            <label><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)}/> Remember Me</label>
            <label><input type="checkbox" checked={rememberPassword} onChange={e=>{const checked=e.target.checked;setRememberPassword(checked);if(!checked)setAutoSignIn(false);if(checked)setRememberMe(true);}}/> Remember my Password</label>
            <label><input type="checkbox" checked={autoSignIn} onChange={e=>{const checked=e.target.checked;setAutoSignIn(checked);if(checked){setRememberMe(true);setRememberPassword(true);}}}/> Sign me in automatically</label>
          </div>
          <div className="login-main-actions">
            <button className="xp-button primary signin-btn" disabled={busy}>{busy?'Please wait…':register?'Create account':'Sign In'} <LogIn size={15}/></button>
            <div className="login-side-links">
              <button type="button" className="link-button" onClick={()=>void forgotPassword()}>Forgot your password?</button>
              <button type="button" className="link-button" onClick={register?showSignIn:showSignUp}>{register?'Already have an account? Sign in':'Get a new account'}</button>
              {!register&&<button type="button" className="link-button" onClick={()=>startVerification(email)}>Have a verification code?</button>}
              <span className="service-status"><span className="status-dot online"/> Service Status: Online</span>
            </div>
          </div>
        </form>}
        {notice&&<p className="notice" role="status">{notice}</p>}
        <p className="fineprint">Microsoft Passport nostalgia, modernised for Retro Messenger.</p>
      </div>
    </section>
    {!native&&<nav className="web-taskbar"><button type="button" className={minimized?'minimized':''} onClick={onRestore}><img src={retroMessengerLogo} alt="" className="taskbar-logo-icon"/> Retro Messenger</button></nav>}
  </div>;
}

export default function App() {
  useWindowDragging();
  const settingsQuery = new URLSearchParams(window.location.search).get('settings')==='1';
  const [rememberedUser,setRememberedUser]=useState<User|null>(null);
  const [minimizedWindows,setMinimizedWindows]=useState<string[]>([]);
  const [about,setAbout]=useState(false);
  const [shortcuts,setShortcuts]=useState(false);
  const [sidebarPanel,setSidebarPanel]=useState<'messenger'|'alerts'>('messenger');
  const [adminOpen,setAdminOpen]=useState(false);
  const [reportTarget,setReportTarget]=useState<ReportTarget|null>(null);
  const [overviewContact,setOverviewContact]=useState<string|null>(null);
  const [groupOpenIds,setGroupOpenIds]=useState<string[]>([]);
  const [replyTo,setReplyTo]=useState<Record<string,string|null>>({});
  const [systemOpen,setSystemOpen]=useState(false);
  const systemPane=useRef<HTMLDivElement>(null);
  const [collapsedGroups,setCollapsedGroups]=useState<string[]>([]);
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[profile,setProfile]=useState<Profile|null>(null);
  const [moderation,setModeration]=useState<ModerationStatus|null>(null);
  const refreshModeration=useCallback(async()=>{
    if(!supabase||!user)return;
    const {data,error:moderationError}=await supabase.rpc('get_my_moderation_status');
    // Older Supabase projects may not yet have installed migration 0009.
    if(moderationError){console.warn('Moderation status unavailable; install migration 0009',moderationError.message);return;}
    if(data)setModeration(data as ModerationStatus);
  },[user?.id]);
  useEffect(()=>{
    if(!user){setModeration(null);return;}
    void refreshModeration();
    const timer=window.setInterval(()=>void refreshModeration(),15000);
    const onFocus=()=>void refreshModeration();
    window.addEventListener('focus',onFocus);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus)};
  },[user?.id,refreshModeration]);
  const cannotSend=moderation?.is_muted||moderation?.is_suspended||false;
  const [profiles,setProfiles]=useState<Profile[]>([]),[contactIds,setContactIds]=useState<string[]>([]),[requests,setRequests]=useState<Request[]>([]),[blocked,setBlocked]=useState<string[]>([]);
  const [search,setSearch]=useState(''),[openChats,setOpenChats]=useState<string[]>([]),[active,setActive]=useState<string|null>(null),[messages,setMessages]=useState<Record<string,Message[]>>({});
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[chatMap,setChatMap]=useState<Record<string,string>>({}),[error,setError]=useState(''),[settings,setSettings]=useState(false),[newDisplay,setNewDisplay]=useState(''),[newPersonal,setNewPersonal]=useState(''),[newAvatar,setNewAvatar]=useState<File|null>(null),[avatarPreview,setAvatarPreview]=useState<string|null>(null),[removeAvatar,setRemoveAvatar]=useState(false),[avatarError,setAvatarError]=useState('');
  const [messageStyles,setMessageStyles]=useState<Record<string,MessageStyle>>({});
  const [pending,setPending]=useState(false),[onlineIds,setOnlineIds]=useState<Set<string>>(new Set());
  const [events,setEvents]=useState<Record<string,ChatEvent[]>>({});
  // Keep the latest item visible while the user is at the bottom. If they
  // scroll up to read history, incoming nudges/messages won't yank the view.
  const messagePanes=useRef<Record<string,HTMLDivElement|null>>({});
  const followLatest=useRef<Record<string,boolean>>({});
  useEffect(()=>{
    Object.entries(messagePanes.current).forEach(([id,pane])=>{
      if(pane&&followLatest.current[id]!==false) pane.scrollTop=pane.scrollHeight;
    });
  },[messages,events,openChats,active]);
  const [emoteOpen,setEmoteOpen]=useState<string|null>(null);
  const [emoteAnchor,setEmoteAnchor]=useState<HTMLElement|null>(null);
  const emotePanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!emoteOpen)return;
    const onDown=(event:PointerEvent)=>{
      if(!emoteAnchor?.contains(event.target as Node)&&!emotePanel.current?.contains(event.target as Node))setEmoteOpen(null);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setEmoteOpen(null)};
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)};
  },[emoteOpen,emoteAnchor]);
  const [chatStyle,setChatStyle]=useState<'blue'|'rose'|'mint'>(()=>(localStorage.getItem('retro-style') as 'blue'|'rose'|'mint')||'blue');
  const [interfaceFont,setInterfaceFont]=useState<InterfaceFont>(()=>(localStorage.getItem('retro-interface-font') as InterfaceFont)||'tahoma');
  const [messageFont,setMessageFont]=useState<MessageFont>(()=>(localStorage.getItem('retro-message-font') as MessageFont)||'ms-sans');
  const [soundEnabled,setSoundEnabled]=useState(()=>localStorage.getItem('retro-sounds')!=='off');
  const [soundTheme,setSoundTheme]=useState(()=>localStorage.getItem('retro-sound-theme')||'classic');
  // Classic MSN auto-away: after 10 minutes idle, switch Online -> Away;
  // only restore Online when this window caused the away state.
  const autoAwayMade=useRef(false);
  useEffect(()=>{
    if(!user||!profile||!supabase)return;
    let lastActivity=Date.now();
    const record=()=>{
      lastActivity=Date.now();
      if(autoAwayMade.current&&profile.status_preference==='away'){
        autoAwayMade.current=false;
        void supabase!.from('profiles').update({status_preference:'online'}).eq('id',user.id).then(()=>void load());
      }
    };
    const tick=()=>{
      if(profile.status_preference==='online'&&Date.now()-lastActivity>=600000&&!autoAwayMade.current){
        autoAwayMade.current=true;
        void supabase!.from('profiles').update({status_preference:'away'}).eq('id',user.id).then(()=>void load());
      }
    };
    const timer=window.setInterval(tick,60000);
    window.addEventListener('pointerdown',record);window.addEventListener('keydown',record);
    return()=>{window.clearInterval(timer);window.removeEventListener('pointerdown',record);window.removeEventListener('keydown',record)};
  },[user?.id,profile?.status_preference]);

  const [doodleFor,setDoodleFor]=useState<string|null>(null);
  const [searchChat,setSearchChat]=useState<string|null>(null);
  const [popupEnabled,setPopupEnabled]=useState(()=>localStorage.getItem('retro-popups')!=='off');
  const noticePrefs=useRef({profiles,soundEnabled,popupEnabled});
  useEffect(()=>{noticePrefs.current={profiles,soundEnabled,popupEnabled}},[profiles,soundEnabled,popupEnabled]);
  const [settingsTab,setSettingsTab]=useState<'personal'|'appearance'|'sounds'|'privacy'|'music'|'updates'>('personal');
  const [groupMap,setGroupMap]=useState<Record<string,string>>({});
  const [nicknameMap,setNicknameMap]=useState<Record<string,string>>({});
  const [showWink,setShowWink]=useState<string|null>(null);
  const [sendingFile,setSendingFile]=useState<string|null>(null);
  const [typingBy,setTypingBy]=useState<Record<string,boolean>>({});
  const typingChannel=useRef<RealtimeChannel|null>(null);
  const lastTypingAt=useRef(0);
  const onIncomingStaffAlert=useCallback((alert:StaffAlert)=>{
    if(chatQuery||settingsQuery)return;
    if(soundEnabled)soundNotification();
    if(popupEnabled)void showMessengerToast({
      id:alert.id,kind:'staff',title:alert.title,body:alert.body.slice(0,145),alertId:alert.id
    });
  },[soundEnabled,popupEnabled,settingsQuery]);
  const {alerts,unreadCount,staffRole,error:alertsError,markRead}=useStaffAlerts(user?.id||null,onIncomingStaffAlert);
  const onIncomingSystemMessage=useCallback((message:SystemDirectMessage)=>{
    if(chatQuery||settingsQuery||systemQuery)return; // only the main window shows a toast
    if(noticePrefs.current.soundEnabled)soundNotification();
    if(noticePrefs.current.popupEnabled){
      // An arriving welcome must not trigger a second popup when the inbox refreshes.
      if(message.message_kind==='welcome')
        localStorage.setItem(`retro-welcome-popup-${message.id}`,'shown');
      void showMessengerToast({
        id:message.id,kind:'system',title:'Retro Messenger System',
        body:message.body.slice(0,145),systemMessageId:message.id
      });
    }
  },[settingsQuery]);
  const {
    messages:systemMessages,unreadCount:systemUnread,
    error:systemError,markRead:markSystemRead
  }=useSystemDirectMessages(user?.id||null,onIncomingSystemMessage);
  const {results:pollResults,error:pollError,busy:pollBusy,vote:votePoll}=useSystemPollResults(systemMessages.filter(m=>m.poll_id).map(m=>m.poll_id!));
  // Welcome is queued during signup, often before e-mail verification. Show the
  // first-login popup once; later visits retain the message but don't re-alert.
  useEffect(()=>{
    if(!user||chatQuery||settingsQuery||systemQuery||!popupEnabled)return;
    const welcome=systemMessages.find(m=>m.message_kind==='welcome'&&!m.read_at);
    if(!welcome)return;
    const key=`retro-welcome-popup-${welcome.id}`;
    if(localStorage.getItem(key))return;
    localStorage.setItem(key,'shown');
    if(soundEnabled)soundNotification();
    void showMessengerToast({
      id:welcome.id,kind:'system',title:'Welcome to Retro Messenger!',
      body:`Hello! ${welcome.subject}`,systemMessageId:welcome.id
    });
  },[user?.id,systemMessages,popupEnabled,soundEnabled,settingsQuery]);
  useEffect(()=>{
    if((systemOpen||systemQuery)&&systemUnread>0)void markSystemRead();
  },[systemOpen,systemQuery,systemUnread,markSystemRead]);
  useEffect(()=>{
    if(!(systemOpen||systemQuery))return;
    const pane=systemPane.current;if(pane)pane.scrollTop=pane.scrollHeight;
  },[systemOpen,systemQuery,systemMessages.length]);

  const [nudgeAt,setNudgeAt]=useState<Record<string,number>>({});
  const [shaking,setShaking]=useState<string|null>(null);
  const [cropping,setCropping]=useState(false),[cropZoom,setCropZoom]=useState(1);
  const cropCanvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{localStorage.setItem('retro-style',chatStyle)},[chatStyle]);
  useEffect(()=>{localStorage.setItem('retro-interface-font',interfaceFont)},[interfaceFont]);
  useEffect(()=>{localStorage.setItem('retro-message-font',messageFont)},[messageFont]);
  useEffect(()=>{localStorage.setItem('retro-sounds',soundEnabled?'on':'off')},[soundEnabled]);
  useEffect(()=>{localStorage.setItem('retro-popups',popupEnabled?'on':'off')},[popupEnabled]);
  async function saveContactOptions(contactId:string,group:string,nickname:string){if(!user||!supabase)return;const {error}=await supabase.from('contact_options').upsert({user_id:user.id,contact_id:contactId,group_name:group,nickname},{onConflict:'user_id,contact_id'});if(error)setError(readableError(error));}
  function setGroup(contactId:string,group:string){setGroupMap(old=>({...old,[contactId]:group}));void saveContactOptions(contactId,group,nicknameMap[contactId]||'')}
  function setNickname(contactId:string){const value=prompt('Custom name for this contact (leave blank to use their display name):',nicknameMap[contactId]||'');if(value===null)return;const nickname=value.trim().slice(0,40);setNicknameMap(old=>({...old,[contactId]:nickname}));void saveContactOptions(contactId,groupMap[contactId]||'Friends',nickname)}
  const labelFor=(person:Profile)=>nicknameMap[person.id]||display(person);
  function openReport(person:Profile,message?:Message){
    if(person.id===user?.id)return;
    setReportTarget({userId:person.id,username:person.username,displayName:display(person),
      ...(message?{messageId:message.id,messagePreview:message.kind==='file'?`File: ${message.body}`:plainMessageText(message.body),messageTime:message.created_at}:{})
    });
  }

  const shake=useCallback((id:string)=>{setShaking(id);window.setTimeout(()=>setShaking(current=>current===id?null:current),650)},[]);
  const alive=useRef(true);
  useEffect(()=>{
    function onAction(ev:Event){const {action,id}=(ev as CustomEvent<{action:WindowAction,id?:string}>).detail;if(!id)return;
      const node=document.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(id)}"]`);
      if(action==='maximize'&&node){node.dataset.maximized=node.dataset.maximized==='yes'?'no':'yes';return;}
      if(action==='minimize'||(action==='close'&&id==='contacts')){setMinimizedWindows(old=>old.includes(id)?old:[...old,id]);return;}
      if(action==='close'){
        if(id==='settings')setSettings(false);
        else if(id==='about')setAbout(false);
        else if(id==='shortcuts')setShortcuts(false);
        else if(id==='system-inbox')setSystemOpen(false);
        else if(id==='admin-console')setAdminOpen(false);
        else if(id.startsWith('chat-')){const chatId=id.substring(5);setOpenChats(old=>old.filter(x=>x!==chatId));setActive(a=>a===chatId?null:a);}
      }
    }
    document.addEventListener('retro-window-action',onAction);
    return()=>document.removeEventListener('retro-window-action',onAction);
  },[]);
  function restoreWindow(id:string){setMinimizedWindows(old=>old.filter(x=>x!==id));requestAnimationFrame(()=>{const node=document.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(id)}"]`);if(node)node.style.zIndex=String(Date.now()%100000+1000)})}
  function focusSearch(){setSidebarPanel('messenger');setMinimizedWindows(old=>old.filter(x=>x!=='contacts'));setTimeout(()=>{document.querySelector<HTMLInputElement>('#buddy-search')?.focus()},0)}
  useEffect(()=>{
    alive.current=true;localStorage.removeItem('retro-login-password');
    if(!supabase){setLoading(false);return;}
    const client=supabase;
    const mayAuto = Boolean(chatQuery || settingsQuery || systemQuery || localStorage.getItem('retro-auto-signin')==='1');
    void client.auth.getUser().then(({data})=>{if(!alive.current)return;const u=data.user??null;if(u&&!mayAuto&&localStorage.getItem('retro-remember-password')!=='1'){void client.auth.signOut({scope:'local'});setRememberedUser(null)}else{setRememberedUser(u);if(mayAuto)setUser(u)}setLoading(false)}).catch(()=>setLoading(false));
    const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{
      if(!alive.current)return;
      if(event==='SIGNED_OUT'){setUser(null);setRememberedUser(null);}
      if(event==='SIGNED_IN'&&session?.user){setRememberedUser(session.user);if(mayAuto)setUser(session.user)}
    });
    return()=>{alive.current=false;subscription.unsubscribe()};
  },[]);

  const load = useCallback(async()=>{if(!supabase||!user)return;const s=supabase;try{
    const [p,c,r,b,all,options]=await Promise.all([
      s.from('profiles').select('*').eq('id',user.id).single(),
      s.from('contacts').select('contact_id').eq('user_id',user.id),
      s.from('contact_requests').select('*').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).eq('status','pending'),
      s.from('user_blocks').select('blocked_id').eq('blocker_id',user.id),
      s.from('profiles').select('*').order('username',{ascending:true}).limit(300),
      s.from('contact_options').select('contact_id,group_name,nickname').eq('user_id',user.id)
    ]);
    for(const x of [p,c,r,b,all,options])if(x.error)throw x.error;
    setProfile(p.data as Profile);setContactIds((c.data??[]).map(x=>x.contact_id));setRequests((r.data??[]) as Request[]);setBlocked((b.data??[]).map(x=>x.blocked_id));setProfiles((all.data??[]) as Profile[]);setGroupMap(Object.fromEntries((options.data??[]).map(x=>[x.contact_id,x.group_name])));setNicknameMap(Object.fromEntries((options.data??[]).map(x=>[x.contact_id,x.nickname])));
  }catch(e){setError(readableError(e));}},[user]);
  useEffect(()=>{if(!user)return;void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer)},[user,load]);
  useEffect(()=>{if(!user||!supabase)return;const s=supabase;const channel=s.channel(`user-db-${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'contact_requests',filter:`receiver_id=eq.${user.id}`},()=>void load()).on('postgres_changes',{event:'*',schema:'public',table:'contacts',filter:`user_id=eq.${user.id}`},()=>void load()).subscribe();return()=>{void s.removeChannel(channel)}},[user,load]);
  // Presence is deliberately not a public roster. In the MVP, presence is only
  // shared between accepted contacts through authorised per-user channels.
  useEffect(()=>{if(!user||!supabase||!profile)return;const s=supabase;let cancelled=false;
    const subscriptions:ReturnType<typeof s.channel>[]=[];
    const mine=s.channel(`presence-${user.id}`,{config:{private:true,presence:{key:user.id}}});
    mine.on('presence',{event:'sync'},()=>{}).subscribe(async status=>{if(status==='SUBSCRIBED'&&!cancelled){await mine.track({status:profile.status_preference,at:Date.now()})}});subscriptions.push(mine);
    const seen=new Set<string>();for(const id of contactIds){const ch=s.channel(`presence-${id}`,{config:{private:true}});ch.on('presence',{event:'sync'},()=>{const state=ch.presenceState();if(Object.values(state).some(items=>items.some((i:unknown)=>typeof i==='object' && i!==null && (i as {status?:string}).status!=='invisible')))seen.add(id);else seen.delete(id);setOnlineIds(new Set(seen))});ch.subscribe();subscriptions.push(ch)}
    return()=>{cancelled=true;subscriptions.forEach(ch=>{void s.removeChannel(ch)})};
  },[user?.id,profile?.status_preference,contactIds.join(',')]);
  const contacts=useMemo(()=>profiles.filter(p=>contactIds.includes(p.id)&&!blocked.includes(p.id)),[profiles,contactIds,blocked]);
  useEffect(()=>{if(chatQuery&&contacts.some(c=>c.id===chatQuery)){setActive(chatQuery);setOpenChats([chatQuery])}},[chatQuery,contacts.map(c=>c.id).join(',')]);
  const requestedByMe=new Set(requests.filter(r=>r.sender_id===user?.id).map(r=>r.receiver_id));
  const received=requests.filter(r=>r.receiver_id===user?.id);
  const candidates=profiles.filter(p=>p.id!==user?.id&&!contactIds.includes(p.id)&&!blocked.includes(p.id)&&p.username.toLowerCase().includes(search.toLowerCase())).slice(0,12);
  const contactGroups=['Friends','Family','Work','Other'];
  function renderContactSection(title:'Online'|'Offline',items:Profile[],offline=false){return <div className="contact-section"><h3><button className="group-toggle" type="button" aria-expanded={!collapsedGroups.includes(title)} onClick={()=>setCollapsedGroups(old=>old.includes(title)?old.filter(x=>x!==title):[...old,title])}><ChevronDown className={collapsedGroups.includes(title)?"turned":""} size={15}/> {title} ({items.length})</button></h3>{!collapsedGroups.includes(title)&&items.length===0&&<p className="empty-group">No contacts here.</p>}{!collapsedGroups.includes(title)&&contactGroups.map(groupName=>{const groupItems=items.filter(c=>(groupMap[c.id]||'Friends')===groupName);if(groupItems.length===0)return null;return <div className="contact-group" key={`${title}-${groupName}`}><div className="contact-group-title">{groupName} ({groupItems.length})</div>{groupItems.map(c=><ContactRow key={c.id} person={c} displayLabel={labelFor(c)} status={offline?'offline':buddyStatus(c)} onOpen={()=>setOverviewContact(c.id)} onMessage={()=>void openChat(c.id)} onRemove={()=>void removeContact(c.id)} onBlock={()=>void blockContact(c.id)} onNickname={()=>setNickname(c.id)} onReport={()=>openReport(c)} group={groupMap[c.id]||'Friends'} onGroup={value=>setGroup(c.id,value)}/>)}</div>})}</div>}
  function buddyStatus(p:Profile):Status|'offline' {return onlineIds.has(p.id)?p.status_preference==='invisible'?'offline':p.status_preference:'offline'}
  async function act<T>(work:()=>Promise<T>,after=true) {setPending(true);setError('');try{await work();if(after)await load()}catch(e){setError(readableError(e))}finally{setPending(false)}}
  async function requestContact(id:string){if(!supabase||!user)return;if(cannotSend){setError('Messaging is currently restricted on your account.');return;}await act(async()=>{const {error}=await supabase!.from('contact_requests').insert({sender_id:user.id,receiver_id:id});if(error)throw error;})}
  async function respond(id:string,accept:boolean){if(!supabase)return;await act(async()=>{const {error}=await supabase!.rpc('respond_contact_request',{request_id:id,accept_request:accept});if(error)throw error;})}
  async function removeContact(id:string){if(!supabase||!user)return;await act(async()=>{const {error}=await supabase!.rpc('remove_contact',{other_user:id});if(error)throw error;setOpenChats(old=>old.filter(x=>x!==id) )})}
  async function blockContact(id:string){if(!supabase||!user)return;await act(async()=>{const {error}=await supabase!.from('user_blocks').insert({blocker_id:user.id,blocked_id:id});if(error)throw error;setOpenChats(old=>old.filter(x=>x!==id))})}
  const loadChat=useCallback(async(id:string)=>{if(!supabase)return;const s=supabase;try{
    const {data:cid,error:e}=await s.rpc('get_or_create_dm',{other_user:id});if(e)throw e;const conversation=cid as string;setChatMap(old=>({...old,[id]:conversation}));
    const {data,error}=await s.from('messages').select('*').eq('conversation_id',conversation).order('created_at',{ascending:true}).limit(200);if(error)throw error;
    setMessages(old=>({...old,[id]:(data??[]) as Message[]}));
  }catch(e){setError(readableError(e))}},[]);
  useEffect(()=>{if(!active)return;void loadChat(active)},[active,loadChat]);
  // Global subscription: show incoming messages even when the conversation is
  // closed/minimised. The main window alone owns desktop popup notifications.
  useEffect(()=>{
    if(!supabase||!user||chatQuery||settingsQuery||systemQuery)return;
    const client=supabase;
    const channel=client.channel(`global-new-messages-${user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{
        const incoming=payload.new as Message;
        if(incoming.sender_id===user.id)return;
        const prefs=noticePrefs.current;
        if(prefs.soundEnabled)soundNotification();
        if(!prefs.popupEnabled)return;
        const friend=prefs.profiles.find(p=>p.id===incoming.sender_id);
        // Identify groups before creating a popup: a group notification must
        // reopen its GROUP, not a one-to-one chat with the sender.
        void (async()=>{
          const {data:conversation}=await client.from('conversations')
            .select('type,group_title').eq('id',incoming.conversation_id).maybeSingle();
          const group=conversation?.type==='group';
          await showMessengerToast({
            id:incoming.id,kind:'message',
            title:group?(conversation.group_title||'Group chat'):(friend?display(friend):'New instant message'),
            body:incoming.kind==='file'?`Sent a file: ${incoming.body}`:plainMessageText(incoming.body).slice(0,145),
            ...(group?{groupId:incoming.conversation_id}:{contactId:incoming.sender_id})
          });
        })();
      }).subscribe();
    return()=>{void client.removeChannel(channel)};
  },[user?.id,chatQuery,settingsQuery,systemQuery]);

  // Clicks on native popups restore Messenger and open the correct conversation
  // or the no-reply Alerts inbox.
  useEffect(()=>{
    if(!isTauri()||chatQuery||settingsQuery||systemQuery)return;
    let unsubscribe:undefined|(()=>void);let cancelled=false;
    void listen<MessengerToast>('retro-toast-open',event=>{
      const toast=event.payload;
      void (async()=>{
        const win=getCurrentWindow();
        await win.show().catch(()=>{});
        await win.unminimize().catch(()=>{});
        await win.setFocus().catch(()=>{});
        if(toast.kind==='system'){void openSystemConversation();}
        else if(toast.kind==='staff'){
          setSidebarPanel('alerts');setMinimizedWindows(old=>old.filter(id=>id!=='contacts'));
          if(toast.alertId)void markRead(toast.alertId);
        }else if(toast.groupId){void openGroup(toast.groupId)}
        else if(toast.groupId){void openGroup(toast.groupId)}
    else if(toast.contactId){void openChat(toast.contactId)}
      })();
    }).then(fn=>{if(cancelled)fn();else unsubscribe=fn});
    return()=>{cancelled=true;unsubscribe?.()};
  },[chatQuery,settingsQuery,systemQuery,markRead]);

  useEffect(()=>{if(!supabase||!active||!chatMap[active])return;const s=supabase;const id=active;const conversation=chatMap[id];const ch=s.channel(`dm-${conversation}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversation}`},payload=>{const entry=payload.new as Message;setMessages(old=>({...old,[id]:[...(old[id]??[]).filter(m=>m.id!==entry.id),entry]}))}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`conversation_id=eq.${conversation}`},payload=>{const m=payload.new as Message;setMessages(old=>({...old,[id]:(old[id]||[]).map(item=>item.id===m.id?m:item)}))}).subscribe();return()=>{void s.removeChannel(ch)}},[active,chatMap,user?.id,soundEnabled]);
  useEffect(()=>{if(!supabase||!active||!chatMap[active])return;const s=supabase;const friendId=active;const conversation=chatMap[friendId];
    void s.from('chat_events').select('*').eq('conversation_id',conversation).order('created_at',{ascending:false}).limit(20).then(({data})=>{if(data)setEvents(old=>({...old,[friendId]:[...data].reverse() as ChatEvent[]}))});
    const ch=s.channel(`events-${conversation}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_events',filter:`conversation_id=eq.${conversation}`},payload=>{const item=payload.new as ChatEvent;setEvents(old=>({...old,[friendId]:[...(old[friendId]||[]).filter(x=>x.id!==item.id),item]}));if(item.sender_id!==user?.id){if(item.kind==='nudge')shake(friendId);if(item.kind==='wink'){setShowWink(item.payload?.variant||'heart');setTimeout(()=>setShowWink(null),1800)}if(soundEnabled)soundNotification()}}).subscribe();
    return()=>{void s.removeChannel(ch)};
  },[active,chatMap,user?.id,soundEnabled,shake]);
  useEffect(()=>{if(!supabase||!active||!chatMap[active])return;
    const id=active;const cid=chatMap[id];const ch=supabase.channel(`typing-${cid}`,{config:{private:true,broadcast:{self:false}}});
    typingChannel.current=ch;
    let timer:ReturnType<typeof setTimeout>|null=null;
    ch.on('broadcast',{event:'typing'},({payload})=>{if(payload?.from===user?.id)return;setTypingBy(old=>({...old,[id]:true}));if(timer)clearTimeout(timer);timer=setTimeout(()=>setTypingBy(old=>({...old,[id]:false})),2500)}).subscribe();
    return()=>{if(timer)clearTimeout(timer);typingChannel.current=null;void supabase!.removeChannel(ch)};
  },[active,chatMap,user?.id]);
  function notifyTyping(id:string){if(cannotSend||id!==active||!typingChannel.current||!user)return;
    const now=Date.now();if(now-lastTypingAt.current<900)return;lastTypingAt.current=now;
    void typingChannel.current.send({type:'broadcast',event:'typing',payload:{from:user.id}}).catch(()=>{});
  }
  async function nudge(id:string){if(!supabase||!user)return;if(cannotSend){setError('Nudges are disabled while your account is restricted.');return;}const now=Date.now();if(now-(nudgeAt[id]||0)<15000){setError('You can only send a nudge once every 15 seconds.');return;}try{let cid=chatMap[id];if(!cid){const {data,error}=await supabase.rpc('get_or_create_dm',{other_user:id});if(error)throw error;cid=data as string;setChatMap(old=>({...old,[id]:cid}))}const {data,error}=await supabase.from('chat_events').insert({conversation_id:cid,sender_id:user.id,kind:'nudge'}).select('*').single();if(error)throw error;setNudgeAt(old=>({...old,[id]:now}));setEvents(old=>({...old,[id]:[...(old[id]||[]).filter(x=>x.id!==data.id),data as ChatEvent]}));shake(id)}catch(e){setError(readableError(e))}}
  async function sendFile(id:string,file?:File){if(!supabase||!user||!file)return;if(cannotSend){setError('File transfers are disabled while your account is restricted.');return;}
    const allowed=['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','application/zip','application/x-zip-compressed'];
    if(!allowed.includes(file.type)||file.size>10*1024*1024){setError('Select JPG, PNG, GIF, WebP, PDF, TXT or ZIP, at most 10 MB.');return;}
    setSendingFile(id);
    try{
      let conversation=chatMap[id];if(!conversation){const {data,error}=await supabase.rpc('get_or_create_dm',{other_user:id});if(error)throw error;conversation=data as string;setChatMap(old=>({...old,[id]:conversation}));}
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,80)||'file';
      const path=`${conversation}/${crypto.randomUUID()}-${safe}`;
      const {error:uploadError}=await supabase.storage.from('transfers').upload(path,file,{upsert:false,contentType:file.type});if(uploadError)throw uploadError;
      const {data,error}=await supabase.from('messages').insert({conversation_id:conversation,sender_id:user.id,body:file.name.slice(0,200),kind:'file',attachment_path:path,reply_to_id:replyTo[id]??null}).select('*').single();if(error)throw error;
      setMessages(old=>({...old,[id]:[...(old[id]||[]).filter(m=>m.id!==data.id),data as Message]}));setReplyTo(old=>({...old,[id]:null}));
    }catch(e){setError(readableError(e))}finally{setSendingFile(null)}
  }
  async function sendWink(id:string,variant:string){if(!supabase||!user)return;if(cannotSend){setError('Winks are disabled while your account is restricted.');return;}try{
    let cid=chatMap[id];if(!cid){const {data,error}=await supabase.rpc('get_or_create_dm',{other_user:id});if(error)throw error;cid=data as string;setChatMap(old=>({...old,[id]:cid}));}
    const {data,error}=await supabase.from('chat_events').insert({conversation_id:cid,sender_id:user.id,kind:'wink',payload:{variant}}).select('*').single();if(error)throw error;
    setEvents(old=>({...old,[id]:[...(old[id]||[]).filter(x=>x.id!==data.id),data as ChatEvent]}));
    setShowWink(variant);window.setTimeout(()=>setShowWink(null),1800);
  }catch(e){setError(readableError(e))}}
  function exportChat(id:string){const friend=contacts.find(x=>x.id===id);if(!friend)return;const content=(messages[id]||[]).map(m=>`[${new Date(m.created_at).toLocaleString()}] ${m.sender_id===user?.id?display(profile!):display(friend)}: ${plainMessageText(m.body)}`).join('\n');const blob=new Blob([`Retro Messenger - ${display(friend)}\n\n${content}`],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`retro-chat-${friend.username}.txt`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function insertEmote(id:string,shortcut:string){setDrafts(old=>({...old,[id]:(old[id]||'')+shortcut}));setEmoteOpen(null)}
  const styleFor=(id:string)=>messageStyles[id]||DEFAULT_MESSAGE_STYLE;
  function setMessageStyle(id:string,patch:Partial<MessageStyle>){if(patch.color!==undefined&&!isAllowedMessageColor(patch.color)){setError('Please choose a readable colour. Pale shades, white and greys are not allowed.');return;}setMessageStyles(old=>({...old,[id]:safeMessageStyle({...(old[id]||DEFAULT_MESSAGE_STYLE),...patch})}))}
  function toggleMessageFlag(id:string,key:'bold'|'italic'|'underline'){const base=styleFor(id);setMessageStyle(id,{[key]:!base[key]} as Partial<MessageStyle>)}
  async function cropImage(){if(!newAvatar||!avatarPreview)return;const image=new window.Image();image.src=avatarPreview;await image.decode();const canvas=cropCanvas.current||document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)return;const square=Math.min(image.naturalWidth,image.naturalHeight)/cropZoom;const x=(image.naturalWidth-square)/2,y=(image.naturalHeight-square)/2;ctx.clearRect(0,0,256,256);ctx.drawImage(image,x,y,square,square,0,0,256,256);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)return;setNewAvatar(new File([blob],'avatar.png',{type:'image/png'}));setCropping(false);setCropZoom(1)}
  async function openChat(id:string){setActive(id);setOpenChats(old=>old.includes(id)?old:[...old,id]);if(isTauri()&&!chatQuery){try{const label=`chat-${id.replace(/[^a-zA-Z0-9]/g,'')}`;const already=await WebviewWindow.getByLabel(label);if(already){await already.setFocus();return;}const child=new WebviewWindow(label,{url:`/?chat=${encodeURIComponent(id)}`,title:'Retro Messenger — Chat',width:540,height:600,minWidth:400,minHeight:420,decorations:false});child.once('tauri://error', e=>setError(String(e)));}catch(e){setError(readableError(e))}}}
  async function openGroup(id:string){
    if(isTauri()){
      try{
        const label=`group-${id.replace(/[^a-zA-Z0-9]/g,'')}`;
        const existing=await WebviewWindow.getByLabel(label);
        if(existing){await existing.show();await existing.setFocus();return;}
        const win=new WebviewWindow(label,{url:`/?group=${encodeURIComponent(id)}`,title:'Retro Messenger — Group Chat',width:550,height:620,minWidth:410,minHeight:440,decorations:false});
        win.once('tauri://error',event=>setError(String(event.payload)));
      }catch(e){setError(readableError(e))}
      return;
    }
    setGroupOpenIds(old=>old.includes(id)?old:[...old,id]);
  }
  async function send(id:string){
    if(!supabase||!user)return;
    if(cannotSend){setError('You cannot send messages while your account is restricted.');return;}
    const text=(drafts[id]??'').trim();if(!text||text.length>2000)return;
    const style=safeMessageStyle(styleFor(id));
    const replyId=replyTo[id]||null;
    setDrafts(old=>({...old,[id]:''}));
    try{
      let conversation=chatMap[id];
      if(!conversation){const {data,error}=await supabase.rpc('get_or_create_dm',{other_user:id});if(error)throw error;conversation=data as string;setChatMap(old=>({...old,[id]:conversation}))}
      const {data,error}=await supabase.from('messages').insert({conversation_id:conversation,sender_id:user.id,body:text,kind:'text',format:style,reply_to_id:replyId}).select('*').single();
      if(error)throw error;
      setMessages(old=>({...old,[id]:[...(old[id]??[]).filter(m=>m.id!==data.id),data as Message]}));
      setReplyTo(old=>({...old,[id]:null}));
    }catch(e){setDrafts(old=>({...old,[id]:text}));setError(readableError(e))}
  }
  async function openAdminConsole(){
    // A role is read from Supabase (and all staff writes are server-authorised).
    if(!staffRole)return;
    if(isTauri()){
      try{
        const existing=await WebviewWindow.getByLabel('admin-console');
        if(existing){await existing.show();await existing.unminimize();await existing.setFocus();return;}
        const win=new WebviewWindow('admin-console',{
          url:'/?admin=1',title:'Retro Messenger — Staff Console',
          width:830,height:680,minWidth:620,minHeight:460,
          decorations:false,shadow:false
        });
        win.once('tauri://error',event=>setError(String(event.payload)));
      }catch(err){setError(readableError(err))}
      return;
    }
    setAdminOpen(true);
    setMinimizedWindows(old=>old.filter(id=>id!=='admin-console'));
    requestAnimationFrame(()=>restoreWindow('admin-console'));
  }
  function openSettings(){if(!profile)return;
    if(isTauri()&&!settingsQuery){void (async()=>{
      const already=await WebviewWindow.getByLabel('options');if(already){await already.setFocus();return;}
      const win=new WebviewWindow('options',{url:'/?settings=1',title:'Retro Messenger — Options',width:650,height:540,minWidth:540,minHeight:450,decorations:false});
      win.once('tauri://error',event=>setError(String(event.payload)));
    })().catch(err=>setError(readableError(err)));return;}
    setNewDisplay(profile.display_name);setNewPersonal(profile.personal_message);setNewAvatar(null);setAvatarPreview(null);setRemoveAvatar(false);setCropping(false);setAvatarError('');setSettingsTab('personal');setSettings(true);
  }
  useEffect(()=>{if(settingsQuery&&profile){setNewDisplay(profile.display_name);setNewPersonal(profile.personal_message);setSettings(true)}},[settingsQuery,profile?.id]);

  function selectAvatar(file:File|undefined){if(!file)return;setAvatarError('');
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){setAvatarError('Choose a JPG, PNG, WebP or animated GIF picture.');return;}
    if(file.size>2*1024*1024){setAvatarError('Profile pictures must be 2 MB or smaller.');return;}
    setNewAvatar(file);setRemoveAvatar(false);setCropping(file.type!=='image/gif');setCropZoom(1);
  }
  useEffect(()=>{if(!newAvatar){setAvatarPreview(null);return;}const url=URL.createObjectURL(newAvatar);setAvatarPreview(url);return()=>URL.revokeObjectURL(url)},[newAvatar]);
  async function saveProfile(e:React.FormEvent){e.preventDefault();if(!supabase||!user)return;await act(async()=>{
    const updates:{display_name:string,personal_message:string,avatar_url?:string|null}={display_name:newDisplay.trim(),personal_message:newPersonal.trim()};
    if(removeAvatar)updates.avatar_url=null;
    if(newAvatar){
      const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[newAvatar.type];
      if(!ext||newAvatar.size>2*1024*1024)throw Error('Choose a JPG, PNG, WebP or GIF under 2 MB.');
      const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
      const {error:uploadError}=await supabase!.storage.from('avatars').upload(path,newAvatar,{contentType:newAvatar.type,upsert:false});
      if(uploadError)throw uploadError;
      const {data}=supabase!.storage.from('avatars').getPublicUrl(path);
      updates.avatar_url=data.publicUrl;
    }
    const {error}=await supabase!.from('profiles').update(updates).eq('id',user.id);
    if(error)throw error;
    setSettings(false);setNewAvatar(null);setRemoveAvatar(false);if(settingsQuery&&isTauri())controlWindow('close','settings');
  })}
  async function setStatus(status:Status){if(!supabase||!user)return;await act(async()=>{const {error}=await supabase!.from('profiles').update({status_preference:status}).eq('id',user.id);if(error)throw error})}
  async function logout(){localStorage.setItem('retro-auto-signin','0');await supabase?.auth.signOut();setProfile(null);setActive(null);setOpenChats([]);setRememberedUser(null)}
  if(!configured)return <div className="page-center"><div className="xp-window setup"><Header>Retro Messenger — Setup</Header><div className="setup-body"><Monitor size={40} color="#4384cb"/><h2>Connect your Supabase project</h2><p>Copy <code>.env.example</code> to <code>.env</code> and add your Supabase project URL and publishable key. Then run the SQL migration and restart the dev server.</p><p>See <strong>README.md</strong> for step-by-step instructions.</p></div></div></div>;
  if(loading)return <div className="page-center">Connecting to Messenger…</div>;
  if(!user)return <Login onLogin={setUser} interfaceFont={interfaceFont} rememberedUser={rememberedUser} minimized={minimizedWindows.includes("login")} onRestore={()=>restoreWindow("login")}/>;
  if(moderation?.is_suspended)return <div className="page-center moderation-blocked-page">
    <section className="xp-window moderation-blocked-window"><Header>Retro Messenger — Account Suspended</Header>
      <div className="moderation-blocked-content"><ShieldCheck size={42}/><h2>Your account is suspended</h2>
        <p>Your access to Retro Messenger is temporarily restricted following a staff decision.</p>
        <p><strong>Reason:</strong> {moderation.suspension_reason||'Please refer to your official System message.'}</p>
        <p><strong>Expires:</strong> {moderation.suspended_until?new Date(moderation.suspended_until).toLocaleString():'Until an administrator reverses the action'}</p>
        <p className="staff-panel-explain">This restriction is enforced by the server. You can sign out or check whether the restriction has expired.</p>
        <SuspensionAppeal userId={user.id}/><div className="moderation-blocked-controls"><button className="xp-button" type="button" onClick={()=>void logout()}>Sign Out</button><button className="xp-button primary" type="button" onClick={()=>void refreshModeration()}>Refresh Status</button></div>
      </div>
    </section>
  </div>;
  if(!profile)return <div className="page-center"><div className="xp-window setup"><Header>Loading profile…</Header><div className="setup-body"><p>{error||'Loading your messenger account. If you just registered, check your email verification and run the database migration.'}</p><button className="xp-button" onClick={()=>void load()}>Try again</button><button className="xp-button" onClick={()=>void logout()}>Sign out</button></div></div></div>;
  const overviewPerson=overviewContact?profiles.find(p=>p.id===overviewContact):undefined;
  const overviewModal=overviewPerson&&<ContactOverview person={overviewPerson} status={buddyStatus(overviewPerson)} alias={nicknameMap[overviewPerson.id]||undefined}
    onClose={()=>setOverviewContact(null)}
    onMessage={contactIds.includes(overviewPerson.id)?()=>{const id=overviewPerson.id;setOverviewContact(null);void openChat(id)}:undefined}
    onReport={()=>{setOverviewContact(null);openReport(overviewPerson)}}/>;
  const reportModal=reportTarget&&<ReportDialog target={reportTarget} onClose={()=>setReportTarget(null)}/>;
  const showOnlyChat=Boolean(chatQuery&&contacts.some(c=>c.id===chatQuery));
  if(chatQuery&&!showOnlyChat)return <div className="page-center"><p>This conversation is not available. Open it from your contact list.</p></div>;
  const chatView=(id:string)=>{
    const friend=contacts.find(c=>c.id===id);
    if(!friend)return null;
    const msgStyle=styleFor(id);
    const timeline=mergeConversationTimeline(messages[id]??[],events[id]??[]);
    const replyTarget=(messages[id]||[]).find(m=>m.id===replyTo[id]);
    return <section className={'xp-window chat-window theme-'+chatStyle+(shaking===id?' nudge-shake':'')+(!isTauri()?' web-floating':'')+(minimizedWindows.includes('chat-'+id)?' window-minimized':'')} data-window-id={'chat-'+id} key={id}>
      <Header>{labelFor(friend)} — Conversation</Header>
      <div className="chat-banner">
        <button type="button" className="chat-profile-trigger" onClick={()=>setOverviewContact(id)} title="View contact profile"><Avatar person={friend} small/>
          <span><strong>{display(friend)}</strong><small><StatusDot status={buddyStatus(friend)}/> {buddyStatus(friend)} · @{friend.username}</small></span>
        </button>
        <button type="button" className="icon-btn close-chat" title="Close chat" onClick={()=>{setOpenChats(old=>old.filter(x=>x!==id));if(active===id)setActive(null)}}><X size={17}/></button>
      </div>
      <div className="chat-toolbar">
        <button disabled={cannotSend} title="Send a nudge" onClick={()=>void nudge(id)}><Zap size={14}/> Nudge</button>
        <button disabled={cannotSend} onClick={()=>void sendWink(id,'heart')} title="Send an animated Wink">Wink ♥</button>
        <GamesButton conversationId={chatMap[id]} userId={user.id} peers={[friend]} disabled={cannotSend}/>
        <button type="button" title="Search this conversation" onClick={()=>setSearchChat(old=>old===id?null:id)}><Search size={14}/> Search</button>
         <button onClick={()=>exportChat(id)} title="Save message history"><Download size={14}/> History</button>
        <button onClick={()=>setOverviewContact(id)} title="View contact profile"><Users size={14}/> Profile</button>
        <button type="button" title="Report this user" onClick={()=>openReport(friend)}><Flag size={14}/> Report</button>
        <label title="Conversation background"><Palette size={14}/><select value={chatStyle} onChange={e=>setChatStyle(e.target.value as typeof chatStyle)}><option value="blue">Blue</option><option value="rose">Rose</option><option value="mint">Mint</option></select></label>
      </div>
      {error&&<div className="chat-error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
      {searchChat===id&&chatMap[id]&&<MessageSearch conversationId={chatMap[id]} onClose={()=>setSearchChat(null)} onJump={msgId=>document.querySelector<HTMLElement>(`[data-message-id="${msgId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}/>}
       <ConversationExtrasBoundary conversationId={chatMap[id]} messages={messages[id]??[]}>{extras=><div className="messages font-chat" data-message-font={messageFont} aria-live="polite" ref={node=>{messagePanes.current[id]=node}} onScroll={e=>{const pane=e.currentTarget;followLatest.current[id]=pane.scrollHeight-pane.scrollTop-pane.clientHeight<56;}}>
        {showWink&&<div className="wink-overlay" aria-label="Animated Wink"><span className="wink-heart">{showWink==='heart'?'♥':'☺'}</span><strong>Wink!</strong></div>}
        {timeline.length===0&&<p className="empty-chat">It's quiet here. Say hello!</p>}
        {timeline.map(item=>item.kind==='message'?<div className="message" key={'message-'+item.entry.id} data-message-id={item.entry.id}>
          <div className="message-with-avatar">
            <Avatar person={item.entry.sender_id===user.id?profile:friend} small/>
            <div className="message-content">
              <div className={'message-author '+(item.entry.sender_id===user.id?'me':'')}><strong>{item.entry.sender_id===user.id?display(profile):display(friend)} says:</strong><time>{dateTime(item.entry.created_at)}</time></div>
              {item.entry.reply_to_id&&(()=>{const parent=(messages[id]??[]).find(m=>m.id===item.entry.reply_to_id);return <button type="button" className="quote-message" title="Jump to quoted message" onClick={()=>document.querySelector<HTMLElement>(`[data-message-id="${item.entry.reply_to_id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}>
                <strong>{parent?(parent.sender_id===user.id?display(profile):display(friend)):'Earlier message'}</strong><span>{parent?plainMessageText(parent.body).slice(0,130):'Message not in recent history'}</span>
              </button>})()}
              <MessageBody message={item.entry} onError={setError}/>
              <MessageExtras message={item.entry} userId={user.id} reactions={extras.reactions} onToggle={extras.toggle} onChanged={()=>loadChat(id)}/>
              <div className="message-item-actions"><button type="button" onClick={()=>setReplyTo(old=>({...old,[id]:item.entry.id}))}><Reply size={12}/> Reply</button>
                {item.entry.sender_id!==user.id&&<button type="button" className="report-message-button" title="Report this message" onClick={()=>openReport(friend,item.entry)}><Flag size={11}/> Report</button>}
              </div>
            </div>
          </div>
        </div>:<p className="nudge-event" key={'event-'+item.entry.id}><Zap size={13}/> {item.entry.sender_id===user.id?'You':labelFor(friend)} sent {item.entry.kind==='wink'?'a Wink!':'a Nudge!'}</p>)}
        {typingBy[id]&&<p className="typing-indicator">{labelFor(friend)} is typing a message...</p>}
      </div>}</ConversationExtrasBoundary>
      <div className="composer">
        {cannotSend&&<p className="moderation-chat-banner" role="status"><ShieldCheck size={14}/> Messaging is restricted on this account.{moderation?.muted_until?` Ends ${new Date(moderation.muted_until).toLocaleString()}.`:''}</p>}
        {replyTarget&&<div className="reply-preview"><Reply size={14}/><span><strong>Replying to {replyTarget.sender_id===user.id?'yourself':display(friend)}</strong><small>{plainMessageText(replyTarget.body).slice(0,150)}</small></span><button type="button" onClick={()=>setReplyTo(old=>({...old,[id]:null}))} title="Cancel reply"><X size={13}/></button></div>}
        <div className="composer-tools rich">
          <button type="button" title="Emoticons" onClick={e=>{setEmoteAnchor(e.currentTarget);setEmoteOpen(old=>old===id?null:id)}}><Smile size={16}/> Emoticons</button>
          <label className="file-picker xp-button">{sendingFile===id?'Sending…':'Send Image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={cannotSend||Boolean(sendingFile)} onChange={e=>{void sendFile(id,e.target.files?.[0]);e.currentTarget.value=''}}/></label>
          <button type="button" className="xp-button" disabled={cannotSend} title="Draw a picture or handwritten note" onClick={()=>setDoodleFor(id)}>Ink / Draw</button>
           <label className="file-picker xp-button">Custom Wink GIF<input type="file" accept="image/gif" disabled={cannotSend} onChange={e=>{void sendFile(id,e.target.files?.[0]);e.currentTarget.value=''}}/></label>
           <label className="file-picker xp-button">Send File<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip" disabled={cannotSend||Boolean(sendingFile)} onChange={e=>{void sendFile(id,e.target.files?.[0]);e.currentTarget.value=''}}/></label>
          <button type="button" className={msgStyle.bold?'active':''} onClick={()=>toggleMessageFlag(id,'bold')}><strong>B</strong></button>
          <button type="button" className={msgStyle.italic?'active':''} onClick={()=>toggleMessageFlag(id,'italic')}><em>I</em></button>
          <button type="button" className={msgStyle.underline?'active':''} onClick={()=>toggleMessageFlag(id,'underline')}><u>U</u></button>
          <SafeTextColorPicker color={msgStyle.color} onChange={color=>setMessageStyle(id,{color})}/>
          {emoteOpen===id&&<FloatingPopup anchor={emoteAnchor} panelRef={emotePanel} placement="top" align="start" className="emote-panel">{EMOTES.map(([emoji,shortcut])=><button key={shortcut} type="button" title={shortcut} onClick={()=>insertEmote(id,shortcut)}>{emoji}</button>)}</FloatingPopup>}
        </div>
        <form onSubmit={e=>{e.preventDefault();void send(id)}}>
          <textarea aria-label="Message" value={drafts[id]??''} maxLength={2000} style={{color:msgStyle.color,fontWeight:msgStyle.bold?'bold':undefined,fontStyle:msgStyle.italic?'italic':undefined,textDecoration:msgStyle.underline?'underline':undefined}} onChange={e=>{setDrafts(old=>({...old,[id]:e.target.value}));notifyTyping(id)}} onPaste={e=>{const image=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(image){e.preventDefault();void sendFile(id,image)}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(id)}}} placeholder={cannotSend?'Your messaging is restricted':`Message ${display(friend)}…`} disabled={cannotSend}/>
          <button className="xp-button primary" disabled={cannotSend||!(drafts[id]??'').trim()}><Send size={14}/> Send</button>
        </form>
      </div>
      {doodleFor===id&&<ClassicDrawingPad onClose={()=>setDoodleFor(null)} onSend={file=>sendFile(id,file)} disabled={cannotSend}/>}
    </section>;
  };
  async function openSystemConversation(){
    if(isTauri()&&!systemQuery){
      try{
        const label='system-inbox';
        const existing=await WebviewWindow.getByLabel(label);
        if(existing){await existing.show();await existing.setFocus();return;}
        const win=new WebviewWindow(label,{
          url:'/?system=1',title:'Retro Messenger System — No Reply',
          width:510,height:540,minWidth:390,minHeight:330,decorations:false
        });
        win.once('tauri://error',event=>setError(String(event.payload)));
      }catch(e){setError(readableError(e))}
      return;
    }
    setSystemOpen(true);restoreWindow('system-inbox');
  }
  const systemWindow=<section className={'xp-window chat-window system-thread-window'+(!isTauri()?' web-floating':'')+(minimizedWindows.includes('system-inbox')?' window-minimized':'')} data-window-id="system-inbox">
    <Header>Retro Messenger System — No Reply</Header>
    <div className="system-thread-heading"><span className="system-thread-avatar"><ShieldCheck size={29}/></span><div><strong>Retro Messenger System</strong><small>Official private messages · Verified sender</small></div><span className="system-thread-badge">NO REPLY</span></div>
    <div className="system-thread-history" ref={systemPane}>
      {systemError&&<p className="notice" role="alert">{systemError}. Check your System DM migration.</p>}
      {pollError&&<p className="notice" role="alert">{pollError}. Check migration 0010_system_polls.sql.</p>}
      {systemMessages.length===0&&!systemError&&<p className="empty-chat">You have no system messages.</p>}
      {[...systemMessages].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).map(item=><article className="system-thread-item" key={item.id}>
        <div className="system-thread-meta"><strong>Retro Messenger System says:</strong><time>{dateTime(item.created_at)}</time></div>
        <strong className="system-thread-subject">{item.message_kind==='welcome'&&<span className="system-welcome-label">WELCOME</span>}{item.message_kind==='poll'&&<span className="system-welcome-label">POLL</span>}{item.subject}</strong>
        {item.message_kind!=='poll'&&<p>{item.body}</p>}
        {item.poll_id&&<SystemPollCard poll={pollResults[item.poll_id]} busy={pollBusy===item.poll_id} onVote={(poll,option)=>void votePoll(poll,option)}/>}

      </article>)}
    </div>
    <div className="system-thread-footer"><ShieldCheck size={17}/><div><b>Official system conversation</b><small>Replies are disabled. This account cannot receive instant messages.</small></div></div>
  </section>;
  function testPopup(){
    void showMessengerToast({id:`demo-${Date.now()}`,kind:'message',title:'Retro Messenger',body:'You have received a new instant message!'});
  }
  function openToastTarget(toast:MessengerToast){
    if(toast.kind==='system'){void openSystemConversation();}
    else if(toast.kind==='staff'){setSidebarPanel('alerts');restoreWindow('contacts');if(toast.alertId)void markRead(toast.alertId)}
    else if(toast.groupId){void openGroup(toast.groupId)}
    else if(toast.contactId){void openChat(toast.contactId)}
  }
  const mainMenus:MenuDefinition[]=[
    {label:'File',items:[{label:'New instant message…',action:focusSearch},{label:'My Status: Online',action:()=>void setStatus('online')},{label:'My Status: Away',action:()=>void setStatus('away')},{label:'Appear Offline',action:()=>void setStatus('invisible')},{label:'',divider:true},{label:'Sign Out',action:()=>void logout()}]},
    {label:'Contacts',items:[{label:'Add a Contact…',action:focusSearch},{label:'Show Contact List',action:()=>{setSidebarPanel('messenger');restoreWindow('contacts')}},{label:'View Contact Requests',action:()=>setSidebarPanel('alerts')},{label:'',divider:true},{label:'Options for Contact Groups…',action:openSettings}]},
    {label:'Actions',items:[{label:'Send an Instant Message…',action:focusSearch},{label:'Send a Nudge',action:()=>{if(active)void nudge(active)},disabled:!active},{label:'Save Conversation',action:()=>{if(active)exportChat(active)},disabled:!active}]},
    {label:'Tools',items:[...(staffRole?[{label:'Staff / Admin Console…',action:()=>void openAdminConsole()},{label:'',divider:true}]:[]),{label:'Change My Display Picture…',action:openSettings},{label:'My Emoticons…',action:()=>{if(active)setEmoteOpen(active)},disabled:!active},{label:'Backgrounds and Fonts…',action:()=>{openSettings();setSettingsTab('appearance')}},{label:'Sounds…',action:()=>{openSettings();setSettingsTab('sounds')}},{label:'Options…',action:openSettings}]},
    {label:'Help',items:[{label:'Keyboard Shortcuts',action:()=>setShortcuts(true)},{label:'About Retro Messenger',action:()=>setAbout(true)}]}
  ];
  const settingsWindow = <>{settings&&<div className={isTauri()?"modal-backdrop":"settings-host"} onClick={()=>setSettings(false)}><div className={"xp-window settings-window messenger-settings-window"+(!isTauri()?" web-floating":"")+(minimizedWindows.includes("settings")?" window-minimized":"")} data-window-id="settings" onClick={e=>e.stopPropagation()}><Header>Messenger Options</Header><div className="settings-layout"><aside className="settings-sidebar"><button type="button" className={settingsTab==='personal'?'active':''} onClick={()=>setSettingsTab('personal')}>Personal</button><button type="button" className={settingsTab==='appearance'?'active':''} onClick={()=>setSettingsTab('appearance')}>Fonts & appearance</button><button type="button" className={settingsTab==='sounds'?'active':''} onClick={()=>setSettingsTab('sounds')}>Sounds</button><button type="button" className={settingsTab==='music'?'active':''} onClick={()=>setSettingsTab('music')}>Now Playing</button><button type="button" className={settingsTab==='privacy'?'active':''} onClick={()=>setSettingsTab('privacy')}>Privacy</button><button type="button" className={settingsTab==='updates'?'active':''} onClick={()=>setSettingsTab('updates')}>Updates</button></aside><form onSubmit={saveProfile} className="stack-form setting-form">{settingsTab==='personal'&&<><div className="avatar-editor"><div className="avatar preview-avatar">{!removeAvatar&&(avatarPreview||profile.avatar_url)?<img src={avatarPreview||profile.avatar_url||''} alt="Profile picture preview"/>:display(profile)[0]?.toUpperCase()}</div><div className="avatar-picker"><strong>Display picture</strong><span>JPG, PNG, WebP or animated GIF · Maximum 2 MB</span><label className="xp-button avatar-upload"><Camera size={15}/> Choose picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{selectAvatar(e.target.files?.[0]);e.currentTarget.value=''}}/></label>{(profile.avatar_url||newAvatar)&&<button type="button" className="xp-button remove-avatar" onClick={()=>{setNewAvatar(null);setRemoveAvatar(true)}}><Trash2 size={13}/> Remove picture</button>}</div></div>{cropping&&avatarPreview&&<div className="crop-panel"><strong>Crop display picture</strong><div className="crop-picture" style={{backgroundImage:`url(${avatarPreview})`,backgroundSize:`${cropZoom*100}% auto`}}/><label>Zoom <input type="range" min="1" max="3" step="0.1" value={cropZoom} onChange={e=>setCropZoom(Number(e.target.value))}/></label><button type="button" className="xp-button primary" onClick={()=>void cropImage()}>Apply square crop</button><canvas ref={cropCanvas} hidden/></div>}{avatarError&&<p className="notice" role="alert">{avatarError}</p>}{error&&<p className="notice" role="alert">{error}</p>}<label>Display name<input value={newDisplay} maxLength={40} required onChange={e=>setNewDisplay(e.target.value)}/></label><label>Personal message<input value={newPersonal} maxLength={100} onChange={e=>setNewPersonal(e.target.value)}/></label></>}{settingsTab==='appearance'&&<div className="settings-panel"><label>Interface font<select value={interfaceFont} onChange={e=>setInterfaceFont(e.target.value as InterfaceFont)}><option value="tahoma">Tahoma (classic MSN)</option><option value="verdana">Verdana</option><option value="arial">Arial</option><option value="trebuchet">Trebuchet MS</option></select></label><label>Conversation font<select value={messageFont} onChange={e=>setMessageFont(e.target.value as MessageFont)}><option value="ms-sans">Microsoft Sans Serif</option><option value="tahoma">Tahoma</option><option value="comic">Comic Sans MS</option><option value="verdana">Verdana</option><option value="georgia">Georgia</option></select></label><label>Conversation background<select value={chatStyle} onChange={e=>setChatStyle(e.target.value as typeof chatStyle)}><option value="blue">Messenger blue</option><option value="rose">Rose</option><option value="mint">Mint</option></select></label><div className="font-preview-card" data-message-font={messageFont}><strong>Preview</strong><p className="preview-contact">CJayStreamz says:</p><p>Hello! This is how your Retro Messenger text will look.</p></div></div>}{settingsTab==='sounds'&&<div className="settings-panel"><label className="sound-setting"><input type="checkbox" checked={soundEnabled} onChange={e=>setSoundEnabled(e.target.checked)}/>{soundEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>} Play message sounds</label><label className="sound-setting"><input type="checkbox" checked={popupEnabled} onChange={e=>setPopupEnabled(e.target.checked)}/> Show MSN-style popup for messages and official notices</label><label>Notification melody<select value={soundTheme} onChange={e=>{setSoundTheme(e.target.value);localStorage.setItem('retro-sound-theme',e.target.value)}}><option value="classic">Classic two-tone</option><option value="gentle">Gentle chime</option><option value="bright">Bright alert</option><option value="quiet">Soft ping</option><option value="custom">My custom sound</option></select></label><label>Upload custom WAV/MP3/OGG sound (max 150 KB)<input type="file" accept="audio/wav,audio/mpeg,audio/ogg,audio/mp3" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>150000){setError('Custom sound must be under 150 KB.');return;}const reader=new FileReader();reader.onload=()=>{localStorage.setItem('retro-custom-sound',String(reader.result));setSoundTheme('custom');localStorage.setItem('retro-sound-theme','custom')};reader.readAsDataURL(f);e.currentTarget.value=''}}/></label><button className="xp-button" type="button" onClick={soundNotification}>Preview sound</button><button className="xp-button" type="button" onClick={testPopup}>Test desktop popup</button><p className="settings-help">When enabled, Retro Messenger plays a classic-style alert when you receive a new message or nudge.</p></div>}{settingsTab==='music'&&<NowPlayingEditor userId={user.id} title={profile.now_playing_title||''} artist={profile.now_playing_artist||''} enabled={Boolean(profile.now_playing_enabled)} onSaved={load}/>}
          {settingsTab==='privacy'&&<PrivacySettings userId={user.id}/>}
          {settingsTab==='updates'&&<UpdateChecker/>}
          <div className="settings-actions"><button className="xp-button" type="button" onClick={()=>setSettings(false)}>Close</button><button className="xp-button primary" disabled={pending}>{pending?'Saving…':'Save changes'}</button></div></form></div></div></div>}</>;
  if(settingsQuery)return <div className="desktop native-mode settings-only">{settingsWindow}</div>;
  if(systemQuery)return <main className="desktop chat-only native-mode" data-interface-font={interfaceFont}>{systemWindow}</main>;
  if(showOnlyChat)return <><main className={"desktop chat-only"+(isTauri()?" native-mode":"")} data-interface-font={interfaceFont}>{chatView(chatQuery!)}</main>{overviewModal}{reportModal}</>;
  return <><div className={"desktop"+(isTauri()?" native-mode":"")} data-interface-font={interfaceFont}><div className="app-shell"><section className={"xp-window buddy-window"+(!isTauri()?" web-floating":"")+(minimizedWindows.includes("contacts")?" window-minimized":"")} data-window-id="contacts"><Header>Retro Messenger — Contacts</Header><MessengerMenu menus={mainMenus}/><div className="buddy-brand-strip"><span className="brand-strip-main"><img src={retroMessengerLogo} alt="Retro Messenger" className="brand-strip-logo"/><b><i>retro</i> Messenger</b></span><span>● Connected</span></div><div className="my-profile"><Avatar person={profile}/><div className="profile-text"><strong>{display(profile)}</strong><small>@{profile.username}</small><span>{profile.personal_message||'Share a personal message…'}</span>{profile.now_playing_enabled&&profile.now_playing_title&&<small className="now-playing-text">♫ {profile.now_playing_title}{profile.now_playing_artist?` — ${profile.now_playing_artist}`:''}</small>}</div><select title="Your status" value={profile.status_preference} onChange={e=>void setStatus(e.target.value as Status)}><option value="online">Online</option><option value="away">Away</option><option value="brb">Be Right Back</option><option value="phone">On the Phone</option><option value="lunch">Out to Lunch</option><option value="busy">Busy</option><option value="invisible">Appear Offline</option></select></div><div className="action-strip"><button className="xp-button" onClick={openSettings}><Settings size={14}/> Options</button><button className="xp-button" onClick={()=>{document.querySelector<HTMLInputElement>('#buddy-search')?.focus()}}><UserRoundPlus size={14}/> Add Contact</button><button className="xp-button" title="Sign out" onClick={()=>void logout()}><LogOut size={14}/></button></div><div className="contacts-layout"><aside className="buddy-sidebar"><button className={"sidebar-btn"+(sidebarPanel==='messenger'?" active":"")} type="button" title="Messenger" onClick={()=>setSidebarPanel('messenger')}><img src={retroMessengerLogo} alt="" className="sidebar-logo-icon"/><span>Messenger</span></button><button className="sidebar-btn" type="button" title="Contacts" onClick={focusSearch}><UserRoundPlus size={18}/><span>Contacts</span></button><button className={"sidebar-btn"+(sidebarPanel==='alerts'?" active":"")} type="button" title="Alerts" onClick={()=>setSidebarPanel('alerts')}><Bell size={18}/>{unreadCount>0&&<b className="alert-sidebar-count">{unreadCount>99?'99+':unreadCount}</b>}<span>Alerts</span></button>{staffRole&&<button className="sidebar-btn" type="button" title="Open Staff / Administration window" onClick={()=>void openAdminConsole()}><ShieldCheck size={18}/><span>{staffRole==='admin'?'Admin':'Staff'}</span></button>}<button className="sidebar-btn" type="button" title="Settings" onClick={openSettings}><Settings size={18}/><span>Options</span></button></aside><div className="contacts-main">{moderation?.is_muted&&<p className="moderation-contacts-notice"><ShieldCheck size={14}/> Messaging restriction active{moderation.muted_until?` until ${new Date(moderation.muted_until).toLocaleString()}`: "."}. You can still read your messages.</p>}<div className="search-row"><Search size={15}/><input id="buddy-search" placeholder="Search usernames to add contacts…" value={search} onChange={e=>setSearch(e.target.value)}/></div>{error&&<div className="error-message" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={13}/></button></div>}<div className="buddy-list">{sidebarPanel==='alerts'&&<AlertsInbox alerts={alerts} unreadCount={unreadCount} error={alertsError} onRead={id=>void markRead(id)} onTestToast={testPopup}/>} {sidebarPanel==='messenger'&&received.length>0&&<div className="requests"><h3><Bell size={15}/> Contact requests ({received.length})</h3>{received.map(r=>{const p=profiles.find(x=>x.id===r.sender_id);return <div className="request-row" key={r.id}><span>@{p?.username??'Unknown'}</span><button disabled={pending} onClick={()=>void respond(r.id,true)}>Accept</button><button disabled={pending} onClick={()=>void respond(r.id,false)}>Decline</button></div>})}</div>}{sidebarPanel==='messenger'&&search.trim()&&<div className="search-results"><h3>Find contacts</h3>{candidates.length===0&&<p>No usernames found.</p>}{candidates.map(p=><div className="find-row" key={p.id}><button className="find-profile-trigger" type="button" title={`View @${p.username} profile`} onClick={()=>setOverviewContact(p.id)}>{display(p)} <small>@{p.username}</small></button><button className="xp-button" disabled={cannotSend||pending||requestedByMe.has(p.id)} onClick={()=>void requestContact(p.id)}>{requestedByMe.has(p.id)?'Requested':'Add +'}</button><button type="button" className="xp-button report-contact-button" title={`Report @${p.username}`} onClick={()=>openReport(p)}><Flag size={12}/> Report</button></div>)}</div>}{sidebarPanel==='messenger'&&<GroupsHub userId={user.id} contacts={contacts} disabled={cannotSend} onOpen={id=>void openGroup(id)}/>}
      {sidebarPanel==='messenger'&&systemMessages.length>0&&<div className="system-contact-group"><h3><ShieldCheck size={14}/> Official Messenger</h3><button className="system-contact-entry" type="button" onClick={()=>void openSystemConversation()}><span className="system-mini-avatar"><ShieldCheck size={20}/></span><span className="system-contact-text"><strong>Retro Messenger System</strong><small>Official message · No reply</small></span>{systemUnread>0&&<span className="system-unread-count">{systemUnread>99?'99+':systemUnread}</span>}</button></div>}{sidebarPanel==='messenger'&&renderContactSection('Online',contacts.filter(c=>buddyStatus(c)!=='offline'))}{sidebarPanel==='messenger'&&renderContactSection('Offline',contacts.filter(c=>buddyStatus(c)==='offline'),true)}{sidebarPanel==='messenger'&&contacts.length===0&&<p className="no-contacts">Your contact list is empty.<br/>Search for a username to add your first friend.</p>}</div></div></div><div className="buddy-footer"><Circle size={10} fill="#65b845" color="#65b845"/> Online · {contacts.length} contacts</div></section>{!isTauri()&&openChats.length>0&&<section className="chat-grid">{openChats.map(id=>chatView(id))}</section>}{!isTauri()&&systemOpen&&systemWindow}{!isTauri()&&groupOpenIds.map(groupId=><GroupChatWindow key={groupId} groupId={groupId} onClose={()=>setGroupOpenIds(old=>old.filter(id=>id!==groupId))}/>)}</div>{!isTauri()&&adminOpen&&staffRole&&<AdminConsoleFrame role={staffRole} minimized={minimizedWindows.includes('admin-console')}/>} {settingsWindow}{about&&<div className="xp-window web-floating info-window" data-window-id="about"><Header>About Retro Messenger</Header><div className="info-content"><img src={retroMessengerLogo} alt="Retro Messenger logo" className="about-logo"/><h2>Retro Messenger</h2><p>Inspired by MSN Messenger 7.5, rebuilt for modern browsers and Windows.</p><p>Version 1.1.1 — Community edition</p><button className="xp-button primary" type="button" onClick={()=>setAbout(false)}>OK</button></div></div>}{shortcuts&&<div className="xp-window web-floating info-window" data-window-id="shortcuts"><Header>Keyboard Shortcuts</Header><div className="info-content"><h2>Shortcuts</h2><p><b>Enter:</b> Send a message</p><p><b>Shift + Enter:</b> New line</p><p><b>Escape:</b> Close open menus</p><p><b>Double-click title:</b> Maximise / restore web windows</p><button className="xp-button primary" type="button" onClick={()=>setShortcuts(false)}>OK</button></div></div>}{!isTauri()&&<nav className="web-taskbar" aria-label="Open Messenger windows"><button type="button" onClick={()=>restoreWindow('contacts')} className={minimizedWindows.includes('contacts')?'minimized':''}><img src={retroMessengerLogo} alt="" className="taskbar-logo-icon"/> Contacts</button>{openChats.map(id=>{const friend=contacts.find(c=>c.id===id);return <button type="button" key={id} className={minimizedWindows.includes('chat-'+id)?'minimized':''} onClick={()=>restoreWindow('chat-'+id)}><img src={retroMessengerLogo} alt="" className="taskbar-logo-icon"/> {friend?display(friend):'Chat'}</button>})}{systemOpen&&<button type="button" className={minimizedWindows.includes('system-inbox')?'minimized':''} onClick={()=>restoreWindow('system-inbox')}><ShieldCheck size={15}/> System</button>}{groupOpenIds.map(id=><button type="button" key={id} onClick={()=>restoreWindow('group-'+id)}><Users size={15}/> Group chat</button>)}{adminOpen&&staffRole&&<button type="button" onClick={()=>restoreWindow('admin-console')} className={minimizedWindows.includes('admin-console')?'minimized':''}><ShieldCheck size={15}/> {staffRole==='admin'?'Administration':'Staff Console'}</button>}{settings&&<button type="button" onClick={()=>restoreWindow('settings')} className={minimizedWindows.includes('settings')?'minimized':''}><Settings size={15}/> Options</button>}</nav>}<div className="desktop-footer">Retro Messenger · Bringing back the good old days.</div><BrowserToastStack onOpen={openToastTarget}/></div>{overviewModal}{reportModal}</>;
}
function ContactRow({person,displayLabel,status,onOpen,onMessage,onRemove,onBlock,onNickname,onReport,group,onGroup}:{
  person:Profile;displayLabel:string;status:Status|'offline';onOpen:()=>void;onMessage:()=>void;
  onRemove:()=>void;onBlock:()=>void;onNickname:()=>void;onReport:()=>void;group:string;onGroup:(value:string)=>void;
}){
  const [optionsOpen,setOptionsOpen]=useState(false);
  const optionsButton=useRef<HTMLButtonElement>(null);
  const optionsPanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!optionsOpen)return;
    const onDown=(event:PointerEvent)=>{
      if(!optionsButton.current?.contains(event.target as Node)&&!optionsPanel.current?.contains(event.target as Node))setOptionsOpen(false);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setOptionsOpen(false)};
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)};
  },[optionsOpen]);
  return <div className="contact-row">
    <button type="button" onClick={onOpen} title={`View ${displayLabel}'s profile`}><span className="contact-avatar-wrap"><Avatar person={person} small/><StatusDot status={status}/></span><span>{displayLabel} <small className="group-name">[{group}]</small> <small>{person.personal_message?`— ${person.personal_message}`:''}</small></span></button>
    <div className="contact-options-anchor"><button ref={optionsButton} className="contact-options-toggle" type="button" title="Contact options" aria-haspopup="menu" aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(open=>!open)}>•••</button>
      {optionsOpen&&<FloatingPopup anchor={optionsButton.current} panelRef={optionsPanel} placement="bottom" align="end" className="contact-menu"><div role="menu" aria-label={`Options for ${displayLabel}`}>
        <button type="button" onClick={()=>{setOptionsOpen(false);onOpen()}}>View Profile</button>
        <button type="button" onClick={()=>{setOptionsOpen(false);onMessage()}}>Message</button>
        <button type="button" onClick={()=>{setOptionsOpen(false);onNickname()}}>Set Nickname…</button>
        <button type="button" className="report-contact-button" onClick={()=>{setOptionsOpen(false);onReport()}}>Report User…</button>
        <label className="group-option">Group<select value={group} onChange={e=>{onGroup(e.target.value);setOptionsOpen(false)}}><option>Friends</option><option>Family</option><option>Work</option><option>Other</option></select></label>
        <button type="button" onClick={()=>{setOptionsOpen(false);if(window.confirm('Remove this contact?'))onRemove()}}>Remove</button>
        <button type="button" onClick={()=>{setOptionsOpen(false);if(window.confirm('Block this contact?'))onBlock()}}>Block</button>
      </div></FloatingPopup>}
    </div>
  </div>;
}
