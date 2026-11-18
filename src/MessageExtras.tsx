import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Search,Edit3,Trash2,X} from 'lucide-react';
import {supabase,readableError,type Message} from './client';
import {FloatingPopup} from './FloatingUI';

const EMOJIS=['👍','❤️','😂','😮','😢','🎉'];
type Reaction={message_id:string;user_id:string;emoji:string};
export function useConversationExtras(conversationId:string|undefined,messages:Message[]){
  const [reactions,setReactions]=useState<Reaction[]>([]);
  const messageIds=messages.map(m=>m.id).slice(0,200).join(',');
  const refresh=useCallback(async()=>{
    if(!supabase||!conversationId){setReactions([]);return;}
    const ids=messageIds.split(',').filter(Boolean);
    if(!ids.length){setReactions([]);return;}
    const {data,error}=await supabase.from('message_reactions').select('message_id,user_id,emoji')
      .in('message_id',ids);
    if(!error)setReactions((data||[]) as Reaction[]);
  },[conversationId,messageIds]);
  useEffect(()=>{void refresh()},[refresh]);
  useEffect(()=>{
    if(!supabase||!conversationId)return;
    const client=supabase;
    const channel=client.channel(`react-${conversationId}`).on('postgres_changes',{event:'*',schema:'public',table:'message_reactions'},()=>void refresh()).subscribe();
    return()=>{void client.removeChannel(channel)};
  },[conversationId,refresh]);
  async function toggle(messageId:string,emoji:string,userId:string){if(!supabase)return;
    const exists=reactions.some(r=>r.message_id===messageId&&r.emoji===emoji&&r.user_id===userId);
    const q=supabase.from('message_reactions');
    const {error}=exists?await q.delete().eq('message_id',messageId).eq('emoji',emoji).eq('user_id',userId):await q.insert({message_id:messageId,emoji,user_id:userId});
    if(error)throw error;await refresh();
  }
  return {reactions,toggle,refresh};
}
export function MessageExtras({message,userId,reactions,onToggle,onChanged}:{message:Message;userId:string;reactions:Reaction[];onToggle:(messageId:string,emoji:string,userId:string)=>Promise<void>;onChanged:()=>void|Promise<void>}){
  const [editing,setEditing]=useState(false),[text,setText]=useState(message.body),[error,setError]=useState(''),[busy,setBusy]=useState(false),[picker,setPicker]=useState(false);
  const reactButton=useRef<HTMLButtonElement>(null);
  const reactionPanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!picker)return;
    const onDown=(event:PointerEvent)=>{
      if(!reactButton.current?.contains(event.target as Node)&&!reactionPanel.current?.contains(event.target as Node))setPicker(false);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setPicker(false)};
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)};
  },[picker]);
  const mine=message.sender_id===userId;
  const summaries=useMemo(()=>EMOJIS.map(emoji=>({emoji,users:reactions.filter(r=>r.message_id===message.id&&r.emoji===emoji)})).filter(r=>r.users.length),[reactions,message.id]);
  async function save(){if(!supabase||!text.trim())return;setBusy(true);setError('');try{const {error}=await supabase.rpc('edit_own_message',{p_message:message.id,p_body:text.trim()});if(error)throw error;setEditing(false);await onChanged()}catch(e){setError(readableError(e))}finally{setBusy(false)}}
  async function remove(){if(!supabase||!window.confirm('Remove this message from the conversation?'))return;setBusy(true);try{const {error}=await supabase.rpc('delete_own_message',{p_message:message.id});if(error)throw error;await onChanged()}catch(e){setError(readableError(e))}finally{setBusy(false)}}
  return <div className="message-extras">
    {message.deleted_at?<span className="message-edited">Message deleted</span>:<>
      {message.edited_at&&<span className="message-edited">(edited)</span>}
      {summaries.length>0&&<span className="reaction-summaries">{summaries.map(s=><button type="button" key={s.emoji} title={`${s.users.length} reaction(s)`} className={s.users.some(u=>u.user_id===userId)?'my-reaction':''} onClick={()=>void onToggle(message.id,s.emoji,userId)}>{s.emoji} {s.users.length}</button>)}</span>}
      <button ref={reactButton} type="button" className="extra-action" onClick={()=>setPicker(v=>!v)} aria-expanded={picker}>React</button>
      {mine&&message.kind!=='file'&&!message.deleted_at&&<button type="button" className="extra-action" onClick={()=>{setText(message.body);setEditing(true)}}><Edit3 size={12}/> Edit</button>}
      {mine&&<button type="button" className="extra-action" onClick={()=>void remove()} disabled={busy}><Trash2 size={12}/> Delete</button>}
      {picker&&<FloatingPopup anchor={reactButton.current} panelRef={reactionPanel} className="reaction-menu" placement="top" align="start">{EMOJIS.map(emoji=><button type="button" key={emoji} title={`React ${emoji}`} onClick={()=>{setPicker(false);void onToggle(message.id,emoji,userId).catch(e=>setError(readableError(e)))}}>{emoji}</button>)}</FloatingPopup>}
      {editing&&<div className="inline-edit"><textarea maxLength={2000} value={text} onChange={e=>setText(e.target.value)}/><button className="xp-button primary" type="button" onClick={()=>void save()} disabled={busy}>Save</button><button className="xp-button" type="button" onClick={()=>setEditing(false)}><X size={12}/> Cancel</button></div>}
    </>}
    {error&&<span role="alert" className="group-error">{error}</span>}
  </div>;
}
export function MessageSearch({conversationId,onClose,onJump}:{conversationId:string;onClose:()=>void;onJump:(id:string)=>void}){
  const [term,setTerm]=useState(''),[results,setResults]=useState<Message[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function search(e:React.FormEvent){e.preventDefault();if(!supabase||!term.trim())return;setBusy(true);setError('');
    try{const clean=term.trim().replace(/[%,]/g,' ').slice(0,70);const {data,error:q}=await supabase.from('messages').select('*').eq('conversation_id',conversationId).eq('kind','text').is('deleted_at',null).ilike('body',`%${clean}%`).order('created_at',{ascending:false}).limit(30);if(q)throw q;setResults((data||[]) as Message[])}catch(e){setError(readableError(e))}finally{setBusy(false)}}
  return <section className="message-search"><form onSubmit={e=>void search(e)}><Search size={15}/><input aria-label="Find messages" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search messages in this conversation…"/><button className="xp-button" type="submit" disabled={busy||!term.trim()}>{busy?'…':'Find'}</button><button type="button" title="Close search" onClick={onClose}><X size={14}/></button></form>{error&&<p role="alert">{error}</p>}{results.map(m=><button key={m.id} className="search-result" type="button" onClick={()=>onJump(m.id)}><time>{new Date(m.created_at).toLocaleString()}</time><span>{m.body.slice(0,180)}</span></button>)}</section>;
}

export function ConversationExtrasBoundary({conversationId,messages,children}:{conversationId:string|undefined;messages:Message[];children:(extras:ReturnType<typeof useConversationExtras>)=>ReactNode}){
 const extras=useConversationExtras(conversationId,messages);
 return <>{children(extras)}</>;
}
