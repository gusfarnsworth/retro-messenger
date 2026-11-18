import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {BarChart3,Check,Lock,Send} from 'lucide-react';
import {readableError,supabase} from './client';

export type PollOption={id:string;label:string;position:number;votes:number};
export type PollResult={id:string;question:string;description:string;created_at:string;closes_at:string|null;closed_at:string|null;is_closed:boolean;total_votes:number;my_option_id:string|null;options:PollOption[]};

/** Deliberately uses an admin/recipient-checked RPC, never direct vote table reads. */
export function useSystemPollResults(ids:string[]){
  const signature=useMemo(()=>[...new Set(ids)].sort().join(','),[ids.join(',')]);
  const [results,setResults]=useState<Record<string,PollResult>>({});
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    if(!supabase||!signature){setResults({});return;}
    try{
      const {data,error:dbError}=await supabase.rpc('get_system_poll_results',{p_poll_ids:signature.split(',').slice(0,60)});
      if(dbError)throw dbError;
      setResults(Object.fromEntries(((data||[]) as PollResult[]).map(p=>[p.id,p])));
      setError('');
    }catch(err){setError(readableError(err));}
  },[signature]);
  useEffect(()=>{void refresh();if(!signature)return;const interval=window.setInterval(()=>void refresh(),20000);return()=>window.clearInterval(interval)},[refresh,signature]);
  async function vote(pollId:string,optionId:string){
    if(!supabase||busy)return;
    setBusy(pollId);setError('');
    try{const {error:dbError}=await supabase.rpc('vote_system_poll',{p_poll_id:pollId,p_option_id:optionId});if(dbError)throw dbError;await refresh();}
    catch(err){setError(readableError(err));}
    finally{setBusy(null)}
  }
  async function close(pollId:string){
    if(!supabase||busy||!window.confirm('Close this poll? Members will no longer be able to vote.'))return;
    setBusy(pollId);setError('');
    try{const {error:dbError}=await supabase.rpc('close_system_poll',{p_poll_id:pollId});if(dbError)throw dbError;await refresh();}
    catch(err){setError(readableError(err));}
    finally{setBusy(null)}
  }
  return {results,error,busy,refresh,vote,close};
}

export function SystemPollCard({poll,busy,onVote,onClose,admin=false}:{
  poll:PollResult|undefined;busy:boolean;onVote?:(id:string,choice:string)=>void;
  onClose?:(id:string)=>void;admin?:boolean;
}){
  if(!poll)return <div className="poll-card poll-loading">Loading poll…</div>;
  const total=Number(poll.total_votes)||0;
  return <section className="poll-card" aria-label={`Poll: ${poll.question}`}>
    <div className="poll-heading"><BarChart3 size={17}/><strong>{poll.question}</strong></div>
    {poll.description&&<p className="poll-description">{poll.description}</p>}
    <div className="poll-options">{poll.options.map(option=>{
      const selected=poll.my_option_id===option.id;
      const count=Number(option.votes)||0;
      const percent=total?Math.round(count/total*100):0;
      return <button className={'poll-choice'+(selected?' selected':'')} key={option.id} type="button"
        disabled={poll.is_closed||busy||!onVote} onClick={()=>onVote?.(poll.id,option.id)}
        title={poll.is_closed?'Voting has closed':selected?'Your vote (click a different answer to change)':'Vote for this option'}>
        <span className="poll-bar" style={{width:`${percent}%`}}/>
        <span className="poll-choice-label">{selected?<Check size={13}/>:<span className="poll-radio"/>}{option.label}</span>
        <span className="poll-count">{percent}% ({count})</span>
      </button>;
    })}</div>
    <div className="poll-bottom"><span>{total} vote{total===1?'':'s'} · {poll.is_closed?<><Lock size={11}/> Closed</>:poll.closes_at?`Ends ${new Date(poll.closes_at).toLocaleString()}`:'Open'}</span>
      {poll.my_option_id&&!poll.is_closed&&<small>You can change your vote.</small>}
      {admin&&!poll.is_closed&&onClose&&<button type="button" className="xp-button" disabled={busy} onClick={()=>onClose(poll.id)}>Close poll</button>}
    </div>
  </section>;
}

export function StaffPollComposer(){
  const [question,setQuestion]=useState('');
  const [description,setDescription]=useState('');
  const [options,setOptions]=useState(['Yes','No']);
  const [days,setDays]=useState('7');
  const [historyIds,setHistoryIds]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const {results,error,busy:pollBusy,refresh,close}=useSystemPollResults(historyIds);
  const loadHistory=useCallback(async()=>{
    if(!supabase)return;
    const {data,error:dbError}=await supabase.rpc('list_admin_system_poll_ids');
    if(dbError){setNotice(readableError(dbError));return;}
    setHistoryIds((data||[]) as string[]);
  },[]);
  useEffect(()=>{void loadHistory()},[loadHistory]);
  async function submit(e:FormEvent){
    e.preventDefault();if(!supabase||busy)return;
    const choices=options.map(x=>x.trim()).filter(Boolean);
    if(choices.length<2||new Set(choices.map(x=>x.toLowerCase())).size!==choices.length){setNotice('Enter at least two different choices.');return;}
    if(!window.confirm('Send this poll to EVERY existing Retro Messenger account as an official System DM?'))return;
    setBusy(true);setNotice('');
    try{
      const closesAt=days==='none'?null:new Date(Date.now()+Number(days)*86400000).toISOString();
      const {error:dbError}=await supabase.rpc('create_system_poll',{
        p_question:question.trim(),p_description:description.trim(),p_options:choices,p_closes_at:closesAt
      });
      if(dbError)throw dbError;
      setQuestion('');setDescription('');setOptions(['Yes','No']);
      setNotice('Poll sent to all existing accounts via Retro Messenger System.');
      await loadHistory();await refresh();
    }catch(err){setNotice(readableError(err))}finally{setBusy(false)}
  }
  return <section className="staff-compose poll-admin-panel">
    <div className="staff-panel-heading"><BarChart3 size={16}/><strong>System Polls</strong><small>Administrators only</small></div>
    <p className="staff-panel-explain">Broadcast a no-reply poll to everyone. Recipients vote inside their Retro Messenger System conversation. You can review totals and close polls here.</p>
    <form className="staff-compose-form" onSubmit={submit}>
      <label>Question<input required minLength={10} maxLength={180} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Should we add custom status messages?"/></label>
      <label>Additional description (optional)<textarea maxLength={750} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Tell members about the proposed feature…"/></label>
      <strong className="poll-fields-label">Answer choices (2–6)</strong>
      {options.map((option,index)=><label key={index}>Choice {index+1}<span className="poll-option-editor"><input required minLength={1} maxLength={100} value={option} onChange={e=>setOptions(list=>list.map((x,i)=>i===index?e.target.value:x))}/>{options.length>2&&<button className="xp-button" type="button" onClick={()=>setOptions(list=>list.filter((_,i)=>i!==index))}>Remove</button>}</span></label>)}
      {options.length<6&&<button className="xp-button" type="button" onClick={()=>setOptions(list=>[...list,''])}>+ Add choice</button>}
      <label>Poll duration<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="none">Open until manually closed</option></select></label>
      <button className="xp-button primary" type="submit" disabled={busy||question.trim().length<10||options.some(x=>!x.trim())}><Send size={14}/>{busy?'Sending…':'Send poll to everyone'}</button>
      {notice&&<p className="staff-result" role="status">{notice}</p>}
    </form>
    <div className="poll-history"><h3>Previous polls</h3>{error&&<p className="notice" role="alert">{error}</p>}
      {!historyIds.length&&<p className="staff-empty">No polls yet.</p>}
      {historyIds.slice(0,20).map(id=><SystemPollCard key={id} poll={results[id]} busy={pollBusy===id} admin onClose={item=>void close(item)}/>)}</div>
  </section>;
}
