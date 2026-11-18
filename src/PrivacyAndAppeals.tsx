import {useEffect,useState} from 'react';
import {ShieldCheck,Send} from 'lucide-react';
import {readableError,supabase} from './client';

type Privacy={allow_contact_requests:boolean;discoverable:boolean;show_music:boolean};
const DEFAULT:Privacy={allow_contact_requests:true,discoverable:true,show_music:true};
export function PrivacySettings({userId}:{userId:string}){
 const [prefs,setPrefs]=useState<Privacy>(DEFAULT),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
 useEffect(()=>{if(!supabase)return;void supabase.from('user_privacy_settings').select('allow_contact_requests,discoverable,show_music').eq('user_id',userId).maybeSingle().then(({data,error})=>{if(data)setPrefs(data as Privacy);if(error)setMessage(readableError(error));setLoading(false)})},[userId]);
 async function save(){if(!supabase)return;setMessage('');const {error}=await supabase.from('user_privacy_settings').upsert({user_id:userId,...prefs,updated_at:new Date().toISOString()},{onConflict:'user_id'});setMessage(error?readableError(error):'Privacy preferences saved.');}
 return <div className="settings-panel"><h3>Privacy & discovery</h3><p>Choose how other Messenger members can find or contact you.</p>
  {([['allow_contact_requests','Allow new contact requests'],['discoverable','Show my profile to users who are not contacts']] as const).map(([id,label])=><label className="sound-setting" key={id}><input type="checkbox" checked={prefs[id]} onChange={e=>setPrefs(p=>({...p,[id]:e.target.checked}))}/>{label}</label>)}
  <button type="button" className="xp-button primary" onClick={()=>void save()} disabled={loading}>Save privacy settings</button><p role="status">{message}</p>
 </div>;
}
export function NowPlayingEditor({userId,title,artist,enabled,onSaved}:{userId:string;title:string;artist:string;enabled:boolean;onSaved:()=>void|Promise<void>}){
 const [song,setSong]=useState(title),[performer,setPerformer]=useState(artist),[active,setActive]=useState(enabled),[message,setMessage]=useState('');
 useEffect(()=>{setSong(title);setPerformer(artist);setActive(enabled)},[title,artist,enabled]);
 async function save(){if(!supabase)return;const {error}=await supabase.from('profiles').update({now_playing_title:song.trim(),now_playing_artist:performer.trim(),now_playing_enabled:active}).eq('id',userId);setMessage(error?readableError(error):'Music status updated.');if(!error)await onSaved()}
 return <div className="settings-panel"><h3>What I'm Listening To</h3><p>Share your favourite song underneath your profile name, like classic MSN Messenger.</p><label>Song title<input maxLength={100} value={song} onChange={e=>setSong(e.target.value)} placeholder="Song title"/></label><label>Artist<input maxLength={100} value={performer} onChange={e=>setPerformer(e.target.value)} placeholder="Artist"/></label><label className="sound-setting"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Show Now Playing</label><button type="button" className="xp-button primary" onClick={()=>void save()}>Update music status</button><p role="status">{message}</p><small>This is a manually selected music status. Spotify or external-player synchronisation would require a separate account connection.</small></div>;
}

type Appeal={id:string;reason:string;state:string;staff_note:string;created_at:string};
export function SuspensionAppeal({userId}:{userId:string}){
 const [reason,setReason]=useState(''),[appeals,setAppeals]=useState<Appeal[]>([]),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){if(!supabase)return;const {data,error}=await supabase.from('moderation_appeals').select('id,reason,state,staff_note,created_at').eq('appellant_id',userId).order('created_at',{ascending:false}).limit(5);if(error)setStatus(readableError(error));else setAppeals((data||[]) as Appeal[])}
 useEffect(()=>{void refresh()},[userId]);
 async function send(e:React.FormEvent){e.preventDefault();if(!supabase||busy)return;setBusy(true);setStatus('');try{const {error}=await supabase.rpc('submit_moderation_appeal',{p_reason:reason.trim()});if(error)throw error;setReason('');setStatus('Appeal submitted for review.');await refresh()}catch(e){setStatus(readableError(e))}finally{setBusy(false)}}
 return <div className="appeal-form"><h3><ShieldCheck size={16}/> Request a review</h3><p>Submit one appeal at a time. Explain why the suspension should be reconsidered.</p>
  {appeals.map(a=><div className="appeal-history" key={a.id}><strong>{a.state.toUpperCase()}</strong><small>{new Date(a.created_at).toLocaleDateString()}</small><p>{a.reason}</p>{a.staff_note&&<p>Staff response: {a.staff_note}</p>}</div>)}
  {!appeals.some(a=>a.state==='pending')&&<form onSubmit={e=>void send(e)}><textarea minLength={20} maxLength={2000} required placeholder="Explain your appeal (at least 20 characters)…" value={reason} onChange={e=>setReason(e.target.value)}/><button type="submit" className="xp-button primary" disabled={busy||reason.trim().length<20}><Send size={13}/> Submit appeal</button></form>}
  {status&&<p role="status">{status}</p>}
 </div>;
}
export function StaffAppealsPanel(){
 const [items,setItems]=useState<(Appeal&{appellant_id:string})[]>([]),[note,setNote]=useState<Record<string,string>>({}),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 async function load(){if(!supabase)return;const {data,error}=await supabase.from('moderation_appeals').select('id,appellant_id,reason,state,staff_note,created_at').order('created_at',{ascending:false}).limit(100);if(error)setStatus(readableError(error));else setItems((data||[]) as (Appeal&{appellant_id:string})[])}
 useEffect(()=>{void load()},[]);
 async function review(id:string,accept:boolean){if(!supabase||busy)return;setBusy(true);setStatus('');try{const {error}=await supabase.rpc('review_moderation_appeal',{p_appeal:id,p_accept:accept,p_note:(note[id]||'').trim()});if(error)throw error;setStatus(accept?'Appeal approved and suspension lifted.':'Appeal declined.');await load()}catch(e){setStatus(readableError(e))}finally{setBusy(false)}}
 return <section className="staff-compose"><h3>Moderation appeals</h3><p>Review submitted appeals. Accepting an appeal reverses all active suspensions for that account.</p><button type="button" className="xp-button" onClick={()=>void load()}>Refresh appeals</button>{items.map(a=><article key={a.id} className="appeal-history"><strong>{a.state} · {a.appellant_id}</strong><time>{new Date(a.created_at).toLocaleString()}</time><p>{a.reason}</p>{a.state==='pending'?<><textarea value={note[a.id]||''} onChange={e=>setNote(old=>({...old,[a.id]:e.target.value}))} placeholder="Internal review decision/reason (min 10 chars)"/><button type="button" className="xp-button primary" disabled={busy||(note[a.id]||'').trim().length<10} onClick={()=>void review(a.id,true)}>Accept appeal</button><button type="button" className="xp-button" disabled={busy||(note[a.id]||'').trim().length<10} onClick={()=>void review(a.id,false)}>Decline appeal</button></>:<p>Decision: {a.staff_note}</p>}</article>)}{!items.length&&<p>No appeals submitted.</p>}{status&&<p role="status">{status}</p>}</section>
}
