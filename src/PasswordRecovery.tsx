import {useEffect,useRef,useState,type FormEvent} from 'react';
import {KeyRound,LockKeyhole,CheckCircle2,AlertCircle} from 'lucide-react';
import {supabase,readableError} from './client';
import retroMessengerLogo from './assets/retro-messenger-logo.png';

type RecoveryState='checking'|'ready'|'invalid'|'saving'|'complete';

/** Standalone route: never render the main Messenger app while recovery tokens
 * are being exchanged. Supabase Auth consumes the redirect tokens from the URL. */
export default function PasswordRecovery(){
  const [state,setState]=useState<RecoveryState>('checking');
  const completed=useRef(false);
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!supabase){setState('invalid');setError('Messenger is not connected to Supabase.');return;}
    let active=true;
    const params=new URLSearchParams(window.location.hash.slice(1));
    const redirectError=params.get('error_description')||new URLSearchParams(window.location.search).get('error_description');
    const client=supabase;
    const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{
      if(!active)return;
      if(event==='PASSWORD_RECOVERY'&&session){setError('');setState('ready');}
      else if(event==='INITIAL_SESSION'){
        if(session){setError('');setState('ready');}
        else{setError(redirectError||'Your password reset link is invalid or expired. Please request a new email.');setState('invalid');}
      }else if(event==='SIGNED_OUT'&&!completed.current){
        setError('Your recovery session has expired. Request a new password reset link.');setState('invalid');
      }
    });
    // Also handles redirects processed before the event listener was attached.
    void client.auth.getSession().then(({data,error:sessionError})=>{
      if(!active)return;
      if(data.session){setError('');setState('ready');}
      else if(sessionError){setError(readableError(sessionError));setState('invalid');}
    }).catch(e=>{if(active){setError(readableError(e));setState('invalid')}});
    return()=>{active=false;subscription.unsubscribe()};
  },[]);

  async function savePassword(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||state!=='ready')return;
    if(password.length<8){setError('Choose a password with at least eight characters.');return;}
    if(password!==confirmPassword){setError('The passwords do not match.');return;}
    setState('saving');setError('');
    try{
      const {error:updateError}=await supabase.auth.updateUser({password});
      if(updateError)throw updateError;
      setPassword('');setConfirmPassword('');
      completed.current=true;
      setState('complete');
      // End the recovery session so the user signs in with their new password.
      await supabase.auth.signOut({scope:'local'}).catch(()=>{});
    }catch(e){setError(readableError(e));setState('ready');}
  }

  return <main className="password-recovery-page">
    <section className="password-recovery-window" aria-labelledby="recovery-title">
      <div className="password-recovery-titlebar"><img src={retroMessengerLogo} alt=""/> Retro Messenger — Account Recovery</div>
      <div className="password-recovery-content">
        <img className="password-recovery-logo" src={retroMessengerLogo} alt="Retro Messenger logo"/>
        <h1 id="recovery-title">Reset your password</h1>
        {state==='checking'&&<p role="status">Checking your secure recovery link…</p>}
        {state==='invalid'&&<div className="password-recovery-notice" role="alert"><AlertCircle size={20}/><span>{error||'This recovery link is no longer valid. Request a new link from Messenger.'}</span></div>}
        {state==='complete'&&<div className="password-recovery-success" role="status"><CheckCircle2 size={20}/><span>Your password has been updated. You can now sign in with your new password.</span></div>}
        {(state==='ready'||state==='saving')&&<>
          <p>Enter a new password for your Retro Messenger account.</p>
          <form onSubmit={e=>void savePassword(e)} className="password-recovery-form">
            <label htmlFor="new-retro-password">New password</label>
            <div className="password-recovery-input"><LockKeyhole size={16}/><input id="new-retro-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} disabled={state==='saving'}/></div>
            <label htmlFor="confirm-retro-password">Confirm new password</label>
            <div className="password-recovery-input"><KeyRound size={16}/><input id="confirm-retro-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} disabled={state==='saving'}/></div>
            {error&&<p className="password-recovery-error" role="alert">{error}</p>}
            <button className="xp-button primary" type="submit" disabled={state==='saving'||password.length<8||password!==confirmPassword}>{state==='saving'?'Updating…':'Save new password'}</button>
          </form>
        </>}
        {(state==='invalid'||state==='complete')&&<a className="password-recovery-return" href="/">Return to Retro Messenger</a>}
        <small className="password-recovery-footer">Retro Messenger · Account Security</small>
      </div>
    </section>
  </main>;
}
