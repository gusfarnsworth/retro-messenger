import {StaffAppealsPanel} from './PrivacyAndAppeals';
import {useEffect,useState,type FormEvent} from 'react';
import {Bell,Check,Send,ShieldCheck} from 'lucide-react';
import {supabase,readableError} from './client';
import type {StaffAlert,StaffRole} from './staffAlerts';
import {StaffReportsPanel} from './Reports';
import {Flag} from 'lucide-react';
import {BarChart3} from 'lucide-react';
import {StaffPollComposer} from './SystemPolls';

function formatDate(date:string){return new Date(date).toLocaleString()}

export function AlertsInbox({alerts,unreadCount,error,onRead,onTestToast}:{
  alerts:StaffAlert[];unreadCount:number;error:string;
  onRead:(id:string)=>void;onTestToast:()=>void;
}){
  return <div className="staff-inbox">
    <div className="staff-panel-heading"><Bell size={16}/><strong>Retro Messenger Alerts</strong><small>{unreadCount} unread</small></div>
    <p className="staff-panel-explain">Official notices from Retro Messenger Staff. These are read-only and cannot be replied to.</p>
    <button className="xp-button" type="button" onClick={onTestToast}>Test MSN popup</button>
    {error&&<p className="notice" role="alert">{error}. Check whether migration 0005_staff_alerts.sql has been installed.</p>}
    {alerts.length===0&&!error&&<p className="staff-empty">No staff alerts yet.</p>}
    {alerts.map(alert=><article className={'staff-alert-card'+(!alert.read_at?' unread':'')} key={alert.id}>
      <div className="staff-alert-row"><span className="staff-alert-symbol"><ShieldCheck size={15}/></span><strong>{alert.title}</strong>{!alert.read_at&&<span className="staff-new">New</span>}</div>
      <span className="staff-alert-meta">Retro Messenger Staff · {formatDate(alert.created_at)}</span>
      <p>{alert.body}</p>
      <div className="staff-alert-bottom"><span>No reply</span>{!alert.read_at&&<button type="button" className="xp-button" onClick={()=>onRead(alert.id)}><Check size={13}/> Mark read</button>}</div>
    </article>)}
  </div>;
}

type Batch={id:string,title:string,audience:string,created_at:string,target_user_id:string|null};
function StaffBroadcastComposer({role}:{role:StaffRole}){
  const [audience,setAudience]=useState<'everyone'|'user'>('user');
  const [username,setUsername]=useState('');
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [sending,setSending]=useState(false);
  const [result,setResult]=useState('');
  const [history,setHistory]=useState<Batch[]>([]);
  useEffect(()=>{if(!supabase)return;
    void supabase.from('staff_alert_batches').select('id,title,audience,created_at,target_user_id')
      .order('created_at',{ascending:false}).limit(10).then(({data})=>setHistory((data||[]) as Batch[]));
  },[]);
  async function submit(event:FormEvent){
    event.preventDefault();if(!supabase||sending)return;
    if(audience==='everyone'&&!window.confirm('Send this official notice to ALL existing Retro Messenger accounts?'))return;
    setSending(true);setResult('');
    try{
      const {data,error}=await supabase.rpc('send_staff_alert',{
        p_title:title.trim(),p_body:body.trim(),p_audience:audience,p_username:audience==='user'?username.trim().toLowerCase():null
      });
      if(error)throw error;
      setResult(`Sent to ${Number(data)} account${Number(data)===1?'':'s'}. Recipients will see this in Alerts.`);
      setBody('');setTitle('');
      const {data:latest}=await supabase.from('staff_alert_batches')
        .select('id,title,audience,created_at,target_user_id').order('created_at',{ascending:false}).limit(10);
      setHistory((latest||[]) as Batch[]);
    }catch(error){setResult(readableError(error))}finally{setSending(false)}
  }
  return <section className="staff-compose">
    <div className="staff-panel-heading"><ShieldCheck size={17}/><strong>Staff Announcement Console</strong><small>{role}</small></div>
    <p className="staff-panel-explain">Send official no-reply alerts. Regular users cannot access this system. Sending permissions are enforced in Supabase.</p>
    <form onSubmit={submit} className="staff-compose-form">
      <label>Deliver to<select value={audience} onChange={e=>setAudience(e.target.value as 'everyone'|'user')}>
        <option value="user">One username</option><option value="everyone">Everyone (all existing accounts)</option>
      </select></label>
      {audience==='user'&&<label>Recipient username<input required maxLength={20} placeholder="e.g. alex2005" value={username} onChange={e=>setUsername(e.target.value)} /></label>}
      <label>Alert title<input required maxLength={100} placeholder="Official Messenger Notice" value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Message<textarea required maxLength={2500} rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message to the user(s)..."/></label>
      <p className="staff-no-reply">Messages appear as <b>Retro Messenger Staff</b> with replies disabled.</p>
      <button className="xp-button primary" disabled={sending||!title.trim()||!body.trim()||(audience==='user'&&!username.trim())} type="submit"><Send size={14}/>{sending?'Sending…':'Send Staff Alert'}</button>
      {result&&<p role="status" className="staff-result">{result}</p>}
    </form>
    {history.length>0&&<div className="staff-sent-list"><strong>Recent staff sends</strong>{history.map(batch=><div key={batch.id}><small>{formatDate(batch.created_at)}</small> · {batch.title} <em>({batch.audience})</em></div>)}</div>}
  </section>;
}


/** Admin-only direct message: delivered in the recipient's System conversation,
 * not the shared Alerts inbox. SQL verifies the admin role on every send. */
function SystemDirectComposer(){
  const [username,setUsername]=useState('');
  const [subject,setSubject]=useState('Important account notice');
  const [body,setBody]=useState('');
  const [sending,setSending]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [failed,setFailed]=useState(false);
  async function submit(event:FormEvent){
    event.preventDefault();if(!supabase||sending)return;
    const to=username.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,20}$/.test(to)){setFailed(true);setFeedback('Enter an exact valid username.');return;}
    if(!subject.trim()||!body.trim())return;
    if(!window.confirm(`Send a no-reply system message to @${to}?`))return;
    setSending(true);setFeedback('');setFailed(false);
    try{
      const {data,error}=await supabase.rpc('send_system_direct_message',{
        p_username:to,p_subject:subject.trim(),p_body:body.trim()
      });
      if(error)throw error;
      if(!data)throw Error('No message confirmation returned.');
      setFeedback(`Delivered to @${to}. It will appear as a Retro Messenger System conversation and cannot be replied to.`);
      setBody('');
    }catch(error){setFailed(true);setFeedback(readableError(error))}finally{setSending(false)}
  }
  return <section className="staff-compose system-direct-compose">
    <div className="staff-panel-heading"><ShieldCheck size={17}/><strong>Send a System Message</strong><small>Admin only</small></div>
    <p className="staff-panel-explain">Send an official, private message to one username. It appears as a message from <b>Retro Messenger System</b> in the recipient's contact list, with no reply option. This is separate from Alerts.</p>
    <p className="staff-panel-explain">New accounts also receive a personalised welcome message automatically. You do not need to send these manually.</p>
    <form onSubmit={submit} className="staff-compose-form">
      <label>Recipient username<input required maxLength={20} autoComplete="off" spellCheck={false} placeholder="e.g. alex2005" value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label>Subject<input required maxLength={100} placeholder="Important account notice" value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label>Personal message<textarea required maxLength={2500} rows={6} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write the individual system message..."/></label>
      <p className="staff-no-reply"><ShieldCheck size={13}/> <b>NO REPLY:</b> The recipient cannot send messages back to the System account.</p>
      <button className="xp-button primary" type="submit" disabled={sending||!username.trim()||!subject.trim()||!body.trim()}><Send size={14}/>{sending?'Sending…':'Send System Message'}</button>
      {feedback&&<p role="status" className={'staff-result'+(failed?' staff-result-error':'')}>{feedback}</p>}
    </form>
  </section>;
}

/** Existing announcements remain available to staff; individual System DMs
 * are offered to admins only. */
export function StaffAlertConsole({role}:{role:StaffRole}){
  const [section,setSection]=useState<'alerts'|'system'|'polls'|'reports'|'appeals'>('alerts');
  return <div className="staff-console">
    <div className="staff-console-tabs" role="tablist" aria-label="Staff console sections">
      <button type="button" role="tab" aria-selected={section==='alerts'} className={'xp-button'+(section==='alerts'?' active':'')} onClick={()=>setSection('alerts')}><Bell size={14}/> Announcements</button>
      {role==='admin'&&<button type="button" role="tab" aria-selected={section==='system'} className={'xp-button'+(section==='system'?' active':'')} onClick={()=>setSection('system')}><ShieldCheck size={14}/> System Direct Message</button>}
      {role==='admin'&&<button type="button" role="tab" aria-selected={section==='polls'} className={'xp-button'+(section==='polls'?' active':'')} onClick={()=>setSection('polls')}><BarChart3 size={14}/> System Polls</button>}
      <button type="button" role="tab" aria-selected={section==='appeals'} className={'xp-button'+(section==='appeals'?' active':'')} onClick={()=>setSection('appeals')}><ShieldCheck size={14}/> Appeals</button>
      <button type="button" role="tab" aria-selected={section==='reports'} className={'xp-button'+(section==='reports'?' active':'')} onClick={()=>setSection('reports')}><Flag size={14}/> Reports</button>
    </div>
    {section==='appeals'?<StaffAppealsPanel/>:section==='reports'?<StaffReportsPanel role={role}/>:section==='polls'&&role==='admin'?<StaffPollComposer/>:section==='system'&&role==='admin'?<SystemDirectComposer/>:<StaffBroadcastComposer role={role}/>}
  </div>;
}
