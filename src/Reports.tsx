import {OverlayPortal} from './FloatingUI';
import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {AlertTriangle,CheckCircle2,Flag,RefreshCcw,ShieldCheck,X,ShieldAlert,RotateCcw} from 'lucide-react';
import {readableError,supabase} from './client';
import type {StaffRole} from './staffAlerts';

export const REPORT_REASONS = [
  {value:'harassment',label:'Harassment or bullying'},
  {value:'hate_speech',label:'Hate speech or discrimination'},
  {value:'spam',label:'Spam or unwanted messages'},
  {value:'scam',label:'Scams or suspicious links'},
  {value:'impersonation',label:'Impersonation'},
  {value:'inappropriate_content',label:'Inappropriate content'},
  {value:'threats',label:'Threats or intimidation'},
  {value:'other',label:'Other'}
] as const;
type ReportReason=(typeof REPORT_REASONS)[number]['value'];
type ReportStatus='open'|'reviewing'|'resolved'|'dismissed';
function reportError(e:unknown){if(e&&typeof e==='object'&&'message' in e)return String((e as {message:unknown}).message);return readableError(e)}

export type ReportTarget={
  userId:string;
  username:string;
  displayName:string;
  messageId?:string;
  messagePreview?:string;
  messageTime?:string;
};

export function ReportDialog({target,onClose}:{target:ReportTarget;onClose:()=>void}){
  const [reason,setReason]=useState<ReportReason>('harassment');
  const [details,setDetails]=useState('');
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [reference,setReference]=useState('');
  useEffect(()=>{const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',onEscape);return()=>window.removeEventListener('keydown',onEscape)},[onClose]);
  async function submit(event:FormEvent){
    event.preventDefault();if(!supabase||sending)return;
    setSending(true);setError('');
    try{
      const {data,error:dbError}=await supabase.rpc('submit_user_report',{
        p_target_id:target.userId,
        p_reason:reason,
        p_details:details.trim(),
        p_message_id:target.messageId??null
      });
      if(dbError)throw dbError;
      if(typeof data!=='string')throw Error('Report submission was not confirmed.');
      setReference(data);
    }catch(e){setError(reportError(e))}finally{setSending(false)}
  }
  return <OverlayPortal><div className="report-dialog-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="xp-window report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
      <div className="report-dialog-title"><Flag size={16}/><strong id="report-dialog-title">{target.messageId?'Report Message':'Report User'}</strong><button className="report-close" type="button" onClick={onClose} aria-label="Close report"><X size={16}/></button></div>
      {reference?<div className="report-dialog-body report-confirmation">
        <CheckCircle2 size={34}/>
        <h3>Report submitted</h3>
        <p>Your report has been sent privately to the Retro Messenger moderation team. A report does not automatically punish anyone.</p>
        <p className="report-reference">Case reference: <code>{reference}</code></p>
        <button type="button" className="xp-button primary" onClick={onClose}>Close</button>
      </div>:<form className="report-dialog-body" onSubmit={submit}>
        <p>Reporting <strong>{target.displayName}</strong> <small>(@{target.username})</small></p>
        {target.messageId&&<div className="report-evidence-preview"><strong>Selected message</strong><p>{(target.messagePreview||'Message attachment').slice(0,300)}</p>{target.messageTime&&<small>{new Date(target.messageTime).toLocaleString()}</small>}<small>The server will preserve the reported message, up to 10 earlier messages and up to 10 later messages from this conversation for staff review. Subsequent messages can fill the remaining slots while the case is open.</small></div>}
        <label>Reason for reporting
          <select required value={reason} onChange={e=>setReason(e.target.value as ReportReason)}>{REPORT_REASONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
        </label>
        <label>Additional details {reason==='other'?'(required)':'(optional)'}
          <textarea value={details} onChange={e=>setDetails(e.target.value)} maxLength={1500} rows={5} placeholder="Explain what happened. Avoid sharing passwords or other sensitive information." required={reason==='other'} minLength={reason==='other'?10:undefined}/>
        </label>
        <div className="report-form-hint">Reports are confidential and reviewed by staff. False or repeated reports can delay moderation.</div>
        {error&&<p className="report-error" role="alert">{error} {error.toLowerCase().includes('function')?'Make sure migration 0008_user_reporting.sql is installed.':''}</p>}
        <div className="report-dialog-buttons"><button type="button" className="xp-button" onClick={onClose}>Cancel</button><button type="submit" className="xp-button primary" disabled={sending||(reason==='other'&&details.trim().length<10)}><Flag size={14}/>{sending?'Submitting…':'Submit Report'}</button></div>
      </form>}
    </section>
  </div></OverlayPortal>;
}

type CaseRow={
  id:string;reporter_id:string;target_id:string;report_kind:'user'|'message';reason:ReportReason;
  details:string;message_id:string|null;evidence_body:string|null;evidence_kind:string|null;evidence_sent_at:string|null;
  created_at:string;status:ReportStatus;staff_note:string;reviewed_by:string|null;updated_at:string;
  context_collection_stopped_at:string|null;
};
type EvidenceMessage={
  report_id:string;
  position:number;
  source_message_id:string;
  sender_id:string;
  sender_name:string;
  message_body:string;
  message_kind:string;
  sent_at:string;
  edited_at:string|null;
  deleted_at:string|null;
  attachment_path:string|null;
  captured_at:string;
};
type ActionRow={id:string;actor_id:string;previous_status:string;next_status:string;note:string;created_at:string};
type ModerationKind='warning'|'mute'|'suspension';
type ModerationRow={id:string;report_id:string;target_id:string;actor_id:string;action_type:ModerationKind;reason:string;internal_note:string;issued_at:string;expires_at:string|null;revoked_at:string|null;revoked_by:string|null;revoke_reason:string|null};
const ACTION_LABELS:Record<ModerationKind,string>={warning:'Official Warning',mute:'Messaging Restriction',suspension:'Account Suspension'};
const DURATION_OPTIONS:Record<ModerationKind,{value:string,label:string}[]>={
  warning:[{value:'none',label:'Warning only — no restriction'}],
  mute:[{value:'1h',label:'1 hour'},{value:'24h',label:'24 hours'},{value:'7d',label:'7 days'},{value:'30d',label:'30 days (admin only)'}],
  suspension:[{value:'24h',label:'24 hours'},{value:'7d',label:'7 days'},{value:'30d',label:'30 days'},{value:'permanent',label:'Until revoked (permanent)'}]
};
function actionIsActive(a:ModerationRow){return !a.revoked_at&&(a.expires_at===null||new Date(a.expires_at).getTime()>Date.now())}

type PersonLabel={id:string;username:string;display_name:string};
const STATUS_LABELS:Record<ReportStatus,string>={open:'Open',reviewing:'Reviewing',resolved:'Resolved',dismissed:'Dismissed'};
function formatTimestamp(input:string){return new Date(input).toLocaleString()}
function caseMessage(body:string|null){if(!body)return '';
  try{const parsed=JSON.parse(body);if(parsed?.v===1&&typeof parsed.text==='string')return parsed.text as string;}catch{/** Plain text */}
  return body;
}
export function StaffReportsPanel({role}:{role:StaffRole}){
  const [reports,setReports]=useState<CaseRow[]>([]);
  const [context,setContext]=useState<EvidenceMessage[]>([]);
  const [contextLoading,setContextLoading]=useState(false);
  const [contextError,setContextError]=useState('');
  const [contextRefresh,setContextRefresh]=useState(0);

  const [people,setPeople]=useState<Record<string,PersonLabel>>({});
  const [filter,setFilter]=useState<ReportStatus|'all'>('open');
  const [selected,setSelected]=useState<string|null>(null);
  const [actions,setActions]=useState<ActionRow[]>([]);
  const [modActions,setModActions]=useState<ModerationRow[]>([]);
  const [modKind,setModKind]=useState<ModerationKind>('warning');
  const [modDuration,setModDuration]=useState('none');
  const [modReason,setModReason]=useState('');
  const [modInternal,setModInternal]=useState('');
  const [revokeId,setRevokeId]=useState<string|null>(null);
  const [revokeReason,setRevokeReason]=useState('');
  const [status,setStatus]=useState<ReportStatus>('reviewing');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=useCallback(async(silent=false)=>{
    if(!supabase)return;
    if(!silent)setLoading(true);
    try{
      const {data,error:dbError}=await supabase.from('user_reports').select('*').order('created_at',{ascending:false}).limit(200);
      if(dbError)throw dbError;
      const rows=(data||[]) as CaseRow[];
      setReports(rows);
      const ids=[...new Set(rows.flatMap(r=>[r.reporter_id,r.target_id,...(r.reviewed_by?[r.reviewed_by]:[])]))];
      if(ids.length){const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,display_name').in('id',ids);
        if(profileError)throw profileError;
        setPeople(Object.fromEntries(((profiles||[]) as PersonLabel[]).map(p=>[p.id,p])));
      }
      setError('');
    }catch(e){setError(reportError(e))}finally{setLoading(false)}
  },[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(true),45000);return()=>window.clearInterval(timer)},[load]);
  const current=reports.find(r=>r.id===selected)||null;
  // Staff can read snapshots only through the RLS-protected evidence table.
  // Poll while reviewing because future messages can fill the 10 after slots.
  useEffect(()=>{
    let disposed=false;
    if(!current||current.report_kind!=='message'){
      setContext([]);setContextError('');setContextLoading(false);return;
    }
    const reportId=current.id;
    setContext([]);setContextError('');setContextLoading(true);
    async function fetchContext(){
      if(!supabase)return;
      const {data,error:dbError}=await supabase.from('user_report_message_context')
        .select('report_id,position,source_message_id,sender_id,sender_name,message_body,message_kind,sent_at,edited_at,deleted_at,attachment_path,captured_at')
        .eq('report_id',reportId).order('position',{ascending:true});
      if(disposed)return;
      if(dbError)setContextError(reportError(dbError));
      else {setContext((data||[]) as EvidenceMessage[]);setContextError('');}
      setContextLoading(false);
    }
    void fetchContext();
    const timer=window.setInterval(()=>void fetchContext(),20000);
    return()=>{disposed=true;window.clearInterval(timer)};
  },[current?.id,current?.report_kind,contextRefresh]);

  async function fetchActions(reportId:string){
    if(!supabase)return;
    const [{data:reviewHistory,error:reviewError},{data:moderationHistory,error:moderationError}]=await Promise.all([
      supabase.from('user_report_actions').select('*').eq('report_id',reportId).order('created_at',{ascending:false}).limit(50),
      supabase.from('moderation_actions').select('*').eq('report_id',reportId).order('issued_at',{ascending:false}).limit(50)
    ]);
    if(reviewError)throw reviewError;
    if(moderationError)throw moderationError;
    setActions((reviewHistory||[]) as ActionRow[]);
    setModActions((moderationHistory||[]) as ModerationRow[]);
  }
  const visible=useMemo(()=>reports.filter(r=>filter==='all'||r.status===filter),[reports,filter]);
  const counts=useMemo(()=>({all:reports.length,open:reports.filter(r=>r.status==='open').length,reviewing:reports.filter(r=>r.status==='reviewing').length,resolved:reports.filter(r=>r.status==='resolved').length,dismissed:reports.filter(r=>r.status==='dismissed').length}),[reports]);
  const name=(id:string)=>people[id]?`@${people[id].username}`:`${id.slice(0,8)}…`;
  useEffect(()=>{
    if(!current){setActions([]);setModActions([]);return;}
    setStatus(current.status);setNote(current.staff_note);
    setModKind('warning');setModDuration('none');setModReason('');setModInternal('');setRevokeId(null);setRevokeReason('');
    void fetchActions(current.id).catch(e=>setError(reportError(e)));
  },[current?.id]);
  async function saveReview(event:FormEvent){
    event.preventDefault();if(!supabase||!current||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:dbError}=await supabase.rpc('review_user_report',{p_report_id:current.id,p_status:status,p_staff_note:note.trim()});
      if(dbError)throw dbError;
      setNotice(`Case ${current.id.slice(0,8)} updated to ${STATUS_LABELS[status]}.`);
      await fetchActions(current.id);
      await load(true);
    }catch(e){setError(reportError(e))}finally{setBusy(false)}
  }
  function changeKind(next:ModerationKind){setModKind(next);setModDuration(DURATION_OPTIONS[next][0].value)}
  async function issueModeration(event:FormEvent){
    event.preventDefault();if(!supabase||!current||busy)return;
    const who=name(current.target_id);
    if(!window.confirm(`Apply ${ACTION_LABELS[modKind]} to ${who}?\n\nThis will be enforced immediately and the user will receive a no-reply System message.`))return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:dbError}=await supabase.rpc('apply_report_moderation',{
        p_report_id:current.id,p_action_type:modKind,p_duration:modDuration,
        p_reason:modReason.trim(),p_internal_note:modInternal.trim()
      });
      if(dbError)throw dbError;
      setNotice(`${ACTION_LABELS[modKind]} applied to ${who}; a System notification was sent.`);
      setModReason('');setModInternal('');
      await fetchActions(current.id);await load(true);
    }catch(e){setError(reportError(e))}finally{setBusy(false)}
  }
  async function revokeModeration(event:FormEvent){
    event.preventDefault();if(!supabase||!current||!revokeId||busy)return;
    if(!window.confirm('Reverse this moderation action? This change will be saved in the audit log.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:dbError}=await supabase.rpc('revoke_moderation_action',{
        p_action_id:revokeId,p_reason:revokeReason.trim()
      });
      if(dbError)throw dbError;
      setNotice('Moderation action reversed. The recipient has been notified.');
      setRevokeId(null);setRevokeReason('');await fetchActions(current.id);
    }catch(e){setError(reportError(e))}finally{setBusy(false)}
  }
  return <section className="reports-staff-panel">
    <div className="staff-panel-heading"><ShieldCheck size={16}/><strong>User Reports / Moderation</strong><small>{counts.open} open</small></div>
    <p className="staff-panel-explain">Review private account and message reports. Evidence is copied by the server when submitted. Actions require an explicit staff decision and are enforced through Supabase. Closing a case alone does not punish anyone.</p>
    <div className="report-filter-row">
      {(['open','reviewing','all','resolved','dismissed'] as const).map(key=><button key={key} type="button" className={'xp-button'+(filter===key?' active':'')} onClick={()=>{setFilter(key);setSelected(null);setNotice('')}}>{key==='all'?'All':STATUS_LABELS[key]} ({counts[key]})</button>)}
      <button type="button" className="xp-button" onClick={()=>void load()} title="Refresh reports"><RefreshCcw size={13}/></button>
    </div>
    {loading&&<p className="staff-empty">Loading reports…</p>}
    {error&&<p role="alert" className="report-error">{error}</p>}
    {notice&&<p role="status" className="staff-result">{notice}</p>}
    {!loading&&visible.length===0&&!error&&<p className="staff-empty">There are no reports in this category.</p>}
    <div className="report-case-list">{visible.map(r=><button type="button" key={r.id} onClick={()=>{setSelected(r.id);setNotice('')}} className={'report-case-row'+(selected===r.id?' chosen':'')}>
      <span className="report-case-main"><Flag size={14}/><strong>{name(r.target_id)}</strong><small>{r.report_kind==='message'?'Message':'User'} · {REPORT_REASONS.find(reason=>reason.value===r.reason)?.label??r.reason}</small></span>
      <span className="report-case-meta">{STATUS_LABELS[r.status]} · {formatTimestamp(r.created_at)}</span>
    </button>)}</div>
    {current&&<div className="report-case-detail" key={current.id}>
      <h3>Case {current.id.slice(0,8)}</h3>
      <p><strong>Reported:</strong> {name(current.target_id)}<br/><strong>Submitted by:</strong> {name(current.reporter_id)}<br/><strong>Reason:</strong> {REPORT_REASONS.find(r=>r.value===current.reason)?.label}<br/><strong>Received:</strong> {formatTimestamp(current.created_at)}</p>
      <div className="report-staff-statement"><strong>Reporter statement</strong><p>{current.details||'No additional details supplied.'}</p></div>
      {current.report_kind==='message'&&<>
        <div className="report-evidence-preview">
          <strong>Reported message evidence</strong>
          <small>{current.evidence_sent_at?formatTimestamp(current.evidence_sent_at):'Timestamp unavailable'} · {current.evidence_kind??'text'} · {current.message_id?'Source ID: '+current.message_id:'Original message no longer exists'}</small>
          <p>{caseMessage(current.evidence_body)}</p>
        </div>
        <section className="report-context" aria-label="Surrounding conversation evidence">
          <div className="report-context-heading">
            <div><strong>Conversation context</strong><small>Up to 10 messages before · Reported message · Up to 10 after</small></div>
            <button className="xp-button" type="button" onClick={()=>setContextRefresh(v=>v+1)} title="Refresh captured conversation evidence"><RefreshCcw size={13}/> Refresh</button>
          </div>
          {contextLoading&&<p className="report-context-note">Loading captured messages…</p>}
          {contextError&&<p className="report-error" role="alert">{contextError}</p>}
          {!contextLoading&&!contextError&&context.length===0&&<p className="report-context-note">No surrounding message snapshot is available. Reports created before migration 0015 keep their original single-message evidence above.</p>}
          {context.length>0&&<>
            <div className="report-context-counts">
              <span>{context.filter(item=>item.position<0).length} before</span>
              <span>{context.some(item=>item.position===0)?'Reported message saved':'Reported message unavailable'}</span>
              <span>{context.filter(item=>item.position>0).length} after</span>
            </div>
            <div className="report-context-messages">
              {context.map(item=><article key={item.source_message_id} className={'report-context-message'+(item.position===0?' is-reported':'')}>
                <div className="report-context-message-head">
                  <span><strong>{item.sender_name}</strong> <small>({item.sender_id.slice(0,8)}…)</small></span>
                  <time dateTime={item.sent_at}>{formatTimestamp(item.sent_at)}</time>
                  {item.position===0&&<b className="report-context-flag">REPORTED MESSAGE</b>}
                </div>
                <p>{item.message_kind==='file'?`Attachment: ${item.message_body}`:caseMessage(item.message_body)}</p>
                {item.edited_at&&<small>Edited at {formatTimestamp(item.edited_at)} (captured state)</small>}
                {item.deleted_at&&<small>Already deleted at capture time</small>}
              </article>)}
            </div>
            {context.filter(item=>item.position>0).length<10&&['open','reviewing'].includes(current.status)&&!current.context_collection_stopped_at&&<p className="report-context-note">If more messages are sent in this conversation, up to 10 following the reported message will be captured automatically while the report stays open.</p>}
            {current.context_collection_stopped_at&&<p className="report-context-note">Evidence collection was permanently stopped on {formatTimestamp(current.context_collection_stopped_at)} when the case closed or the reporter left the chat.</p>}
            <p className="report-context-note">Saved server-side. These snapshots remain available if a message is edited or deleted later. Only staff can view this context.</p>
          </>}
        </section>
      </>}
      <form className="staff-compose-form" onSubmit={saveReview}>
        <label>Case status<select value={status} onChange={e=>setStatus(e.target.value as ReportStatus)}>{(['open','reviewing','resolved','dismissed'] as ReportStatus[]).map(v=><option value={v} key={v}>{STATUS_LABELS[v]}</option>)}</select></label>
        <label>Internal moderation notes (staff only)<textarea rows={4} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Record your findings or why the report was closed…"/></label>
        <button type="submit" className="xp-button primary" disabled={busy}>{busy?'Saving…':'Save Review'}</button>
      </form>
      <div className="report-moderation-panel">
        <h3><ShieldAlert size={15}/> Moderation actions</h3>
        <p className="staff-panel-explain">Send a warning or temporarily restrict messaging. Administrators can also suspend accounts. Each action is logged and sent to the account as a private, no-reply System message.</p>
        {modActions.length>0&&<div className="mod-action-list"><strong>Actions on this case</strong>{modActions.map(a=><article key={a.id} className={'mod-action-entry'+(actionIsActive(a)?' active':'')}>
          <strong>{ACTION_LABELS[a.action_type]}</strong><small>Issued {formatTimestamp(a.issued_at)} by {name(a.actor_id)}</small>
          <p>{a.reason}</p><small>{a.revoked_at?`Revoked ${formatTimestamp(a.revoked_at)}${a.revoked_by?' by '+name(a.revoked_by):''}. Reason: ${a.revoke_reason||'—'}`:a.expires_at?`Expires: ${formatTimestamp(a.expires_at)}${actionIsActive(a)?' · ACTIVE':' · Expired'}`:a.action_type==='warning'?'Warning on record':'ACTIVE · Until revoked'}</small>
          {a.internal_note&&<small className="mod-internal-note">Internal note: {a.internal_note}</small>}
          {a.revoked_at===null&&(a.action_type!=='suspension'||role==='admin')&&<button className="xp-button" type="button" onClick={()=>{setRevokeId(a.id);setRevokeReason('')}}><RotateCcw size={13}/> Revoke action</button>}
          {revokeId===a.id&&<form className="staff-compose-form" onSubmit={revokeModeration}><label>Reason for revoking<textarea value={revokeReason} onChange={e=>setRevokeReason(e.target.value)} required minLength={10} maxLength={500} rows={2}/></label><div className="mod-action-buttons"><button type="button" className="xp-button" onClick={()=>setRevokeId(null)}>Cancel</button><button type="submit" className="xp-button primary" disabled={busy||revokeReason.trim().length<10}>Confirm revocation</button></div></form>}
        </article>)}</div>}
        <form className="staff-compose-form" onSubmit={issueModeration}>
          <label>Action<select value={modKind} onChange={e=>changeKind(e.target.value as ModerationKind)}><option value="warning">Official warning</option><option value="mute">Messaging restriction</option>{role==='admin'&&<option value="suspension">Suspend account</option>}</select></label>
          <label>Duration<select value={modDuration} onChange={e=>setModDuration(e.target.value)}>{DURATION_OPTIONS[modKind].filter(d=>role==='admin'||d.value!=='30d').map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
          <label>Reason shown to user<textarea required minLength={10} maxLength={500} rows={3} value={modReason} onChange={e=>setModReason(e.target.value)} placeholder="State the behaviour, why it violates the rules, and how to avoid it…"/></label>
          <label>Internal note (staff only)<textarea maxLength={1000} rows={2} value={modInternal} onChange={e=>setModInternal(e.target.value)} placeholder="Evidence reviewed, context, moderator comments…"/></label>
          <p className="staff-panel-explain">Restrictions automatically expire at the selected time. Permanent suspensions require an administrator to revoke them. Reports alone never trigger actions.</p>
          <button className="xp-button primary" type="submit" disabled={busy||modReason.trim().length<10||current.status==='dismissed'}><ShieldAlert size={14}/>{busy?'Applying…':'Apply moderation action'}</button>
          {current.status==='dismissed'&&<p className="report-form-hint">Reopen the dismissed report before taking moderation action.</p>}
        </form>
      </div>
      {actions.length>0&&<div className="report-case-actions"><strong>Case history</strong>{actions.map(a=><div key={a.id}><small>{formatTimestamp(a.created_at)} · {name(a.actor_id)} · {a.previous_status} → {a.next_status}</small>{a.note&&<p>{a.note}</p>}</div>)}</div>}
    </div>}
    <div className="report-staff-footer"><AlertTriangle size={14}/><span>Do not treat a report as proof. Review the evidence and follow your moderation policy.</span></div>
  </section>;
}
