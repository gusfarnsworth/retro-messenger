import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {Send,Users,Plus,Reply,Image as ImageIcon,Smile,LogOut,X,ChevronDown,Flag} from 'lucide-react';
import {readableError,supabase,type Message,type Profile} from './client';
import {ReportDialog,type ReportTarget} from './Reports';
import {ContactOverview} from './ContactOverview';
import {startNativeDrag} from './windowing';
import retroMessengerLogo from './assets/retro-messenger-logo.png';
import {FormattedMessageText,DEFAULT_MESSAGE_STYLE,plainMessageText,safeMessageStyle,type MessageStyle} from './messageFormatting';
import {SafeTextColorPicker} from './SafeTextColorPicker';
import {FloatingPopup} from './FloatingUI';
import {MessageAttachment} from './MessageAttachment';
import {ClassicDrawingPad} from './ClassicDrawingPad';
import {useConversationExtras,MessageExtras,MessageSearch} from './MessageExtras';
import {GamesButton} from './MessengerGamesCenter';

type GroupRecord={id:string;type:string;group_title:string;owner_id:string;created_at:string};

export function GroupsHub({userId,contacts,onOpen,disabled}:{
  userId:string;contacts:Profile[];onOpen:(id:string)=>void;disabled:boolean;
}){
  const [groups,setGroups]=useState<GroupRecord[]>([]);
  const [showCreate,setShowCreate]=useState(false);
  const [name,setName]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    if(!supabase)return;
    const {data:members,error:e1}=await supabase.from('conversation_members').select('conversation_id').eq('user_id',userId);
    if(e1){setError(readableError(e1));return;}
    const ids=(members||[]).map(m=>m.conversation_id);
    if(!ids.length){setGroups([]);return;}
    const {data,error:e2}=await supabase.from('conversations').select('id,type,group_title,owner_id,created_at').eq('type','group').in('id',ids).order('created_at',{ascending:false});
    if(e2){setError(readableError(e2));return;}
    setGroups((data||[]) as GroupRecord[]);
  },[userId]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),20000);return()=>window.clearInterval(timer)},[refresh]);
  async function createGroup(e:FormEvent){
    e.preventDefault();if(!supabase||busy)return;
    if(selected.length<2){setError('Select at least two friends to create a group.');return;}
    setBusy(true);setError('');
    try{
      const {data,error:dbError}=await supabase.rpc('create_group_chat',{p_title:name.trim(),p_members:selected});
      if(dbError)throw dbError;
      setShowCreate(false);setName('');setSelected([]);
      await refresh();onOpen(data as string);
    }catch(err){setError(readableError(err))}finally{setBusy(false)}
  }
  return <section className="groups-hub">
    <div className="groups-hub-heading"><strong><Users size={14}/> Group chats ({groups.length})</strong><button className="xp-button" title="Create a new group" type="button" onClick={()=>setShowCreate(x=>!x)} disabled={disabled}><Plus size={13}/> New</button></div>
    {error&&<p className="group-error" role="alert">{error}</p>}
    {showCreate&&<form className="group-create" onSubmit={createGroup}>
      <label>Group name<input required minLength={2} maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="My friends"/></label>
      <b>Add friends (select at least two)</b>
      <div className="group-create-choices">{contacts.map(p=><label key={p.id}><input type="checkbox" disabled={!selected.includes(p.id)&&selected.length>=11} checked={selected.includes(p.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/><span>{p.display_name||p.username} <small>@{p.username}</small></span></label>)}
        {contacts.length<2&&<p>Add at least two contacts before creating a group.</p>}
      </div>
      <button className="xp-button primary" type="submit" disabled={busy||selected.length<2||name.trim().length<2}>{busy?'Creating…':'Create group'}</button>
    </form>}
    {groups.map(group=><button type="button" className="group-list-row" key={group.id} onClick={()=>onOpen(group.id)}><Users size={17}/><span>{group.group_title}</span><ChevronDown size={13}/></button>)}
  </section>;
}

function bodyText(message:Message){return plainMessageText(message.body)}
const extensionTypes=['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','application/zip','application/x-zip-compressed'];
const GROUP_EMOTES=[['🙂',':)'],['😃',':D'],['😉',';)'],['😛',':P'],['😢',":'("],['❤️','<3'],['😎','8-)'],['😂',':lol:']] as const;

export function GroupChatWindow({groupId,onClose,standalone=false}:{groupId:string;onClose?:()=>void;standalone?:boolean}){
  const [userId,setUserId]=useState<string|null>(null);
  const [group,setGroup]=useState<GroupRecord|null>(null);
  const [members,setMembers]=useState<Profile[]>([]);
  const [messages,setMessages]=useState<Message[]>([]);
  const [draft,setDraft]=useState('');
  const [messageStyle,setMessageStyle]=useState<MessageStyle>({...DEFAULT_MESSAGE_STYLE});
  const [showEmotes,setShowEmotes]=useState(false);
  const emoteButton=useRef<HTMLButtonElement>(null);
  const emotePanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!showEmotes)return;
    const onDown=(event:PointerEvent)=>{
      if(!emoteButton.current?.contains(event.target as Node)&&!emotePanel.current?.contains(event.target as Node))setShowEmotes(false);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setShowEmotes(false)};
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)};
  },[showEmotes]);
  const [replyTo,setReplyTo]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [adding,setAdding]=useState(false);
  const [available,setAvailable]=useState<Profile[]>([]);
  const [overview,setOverview]=useState<Profile|null>(null);
  const [report,setReport]=useState<ReportTarget|null>(null);
  const [fileUploading,setFileUploading]=useState(false);
  const [drawing,setDrawing]=useState(false),[searchOpen,setSearchOpen]=useState(false),[manageOpen,setManageOpen]=useState(false);
  const [moderators,setModerators]=useState<string[]>([]);
  const pane=useRef<HTMLDivElement>(null);
  const followLatest=useRef(true);
  useEffect(()=>{if(!supabase)return;void supabase.auth.getUser().then(({data})=>setUserId(data.user?.id||null))},[]);
  const load=useCallback(async()=>{
    if(!supabase||!userId)return;
    const [g,m,msg]=await Promise.all([
      supabase.from('conversations').select('id,type,group_title,owner_id,created_at').eq('id',groupId).eq('type','group').single(),
      supabase.from('conversation_members').select('user_id').eq('conversation_id',groupId),
      supabase.from('messages').select('*').eq('conversation_id',groupId).order('created_at',{ascending:false}).limit(200)
    ]);
    if(g.error||m.error||msg.error){setError('This group is unavailable, or you are not a member.');return;}
    setGroup(g.data as GroupRecord);
    const ids=(m.data||[]).map(x=>x.user_id);
    const {data:people,error:peopleError}=await supabase.from('profiles').select('*').in('id',ids);
    if(peopleError){setError(readableError(peopleError));return;}
    setMembers((people||[]) as Profile[]);setMessages(([...(msg.data||[])].reverse()) as Message[]);setError('');
    const {data:mods}=await supabase.from('group_moderators').select('user_id').eq('group_id',groupId);setModerators((mods||[]).map(x=>x.user_id));
  },[userId,groupId]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),25000);return()=>window.clearInterval(timer)},[load]);
  useEffect(()=>{
    if(!supabase||!userId)return;
    const client=supabase;
    const channel=client.channel(`group-messages-${groupId}`).on('postgres_changes',{
      event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${groupId}`
    },payload=>{
      const m=payload.new as Message;
      setMessages(old=>old.some(x=>x.id===m.id)?old:[...old,m]);
    }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`conversation_id=eq.${groupId}`},payload=>{
       const m=payload.new as Message;setMessages(old=>old.map(oldMessage=>oldMessage.id===m.id?m:oldMessage));
    }).subscribe();
    return()=>{void client.removeChannel(channel)};
  },[groupId,userId]);
  useEffect(()=>{if(pane.current&&followLatest.current)pane.current.scrollTop=pane.current.scrollHeight},[messages.length]);
  const names=useMemo(()=>Object.fromEntries(members.map(p=>[p.id,p])),[members]);
  const extras=useConversationExtras(groupId,messages);
  const reply=messages.find(m=>m.id===replyTo)||null;
  function displayUser(id:string){return names[id]?.display_name||names[id]?.username||'Unknown user'}
  function openReport(message:Message){const p=names[message.sender_id];if(!p)return;
    setReport({userId:p.id,username:p.username,displayName:p.display_name||p.username,
      messageId:message.id,messagePreview:bodyText(message).slice(0,300),messageTime:message.created_at});
  }
  async function send(e?:FormEvent){e?.preventDefault();if(!supabase||!userId||busy||!draft.trim())return;
    const body=draft.trim();setBusy(true);setError('');
    try{const {data,error:dbError}=await supabase.from('messages').insert({conversation_id:groupId,sender_id:userId,body,kind:'text',format:safeMessageStyle(messageStyle),reply_to_id:replyTo}).select('*').single();
      if(dbError)throw dbError;setMessages(old=>old.some(x=>x.id===data.id)?old:[...old,data as Message]);setDraft('');setReplyTo(null);followLatest.current=true;
    }catch(err){setError(readableError(err))}finally{setBusy(false)}
  }
  async function sendFile(file:File|undefined){if(!file||!supabase||!userId)return;
    if(!extensionTypes.includes(file.type)||file.size>10485760){setError('Upload a supported file of 10 MB or less.');return;}
    setFileUploading(true);setError('');
    try{
      const path=`${groupId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,80)}`;
      const {error:uploadError}=await supabase.storage.from('transfers').upload(path,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;
      const {data,error:msgError}=await supabase.from('messages').insert({conversation_id:groupId,sender_id:userId,body:file.name.slice(0,200),kind:'file',attachment_path:path,reply_to_id:replyTo}).select('*').single();
      if(msgError)throw msgError;setMessages(old=>old.some(x=>x.id===data.id)?old:[...old,data as Message]);setReplyTo(null);followLatest.current=true;
    }catch(err){setError(readableError(err))}finally{setFileUploading(false)}
  }
  async function leave(){if(!supabase||!userId||!window.confirm('Leave this group chat?'))return;
    const {error:dbError}=await supabase.rpc('leave_group_chat',{p_group_id:groupId});if(dbError){setError(readableError(dbError));return;}close();
  }
  async function showAdd(){if(!supabase||!userId)return;const {data:links,error:e}=await supabase.from('contacts').select('contact_id').eq('user_id',userId);if(e){setError(readableError(e));return;}
    const ids=(links||[]).map(x=>x.contact_id).filter(x=>!members.some(m=>m.id===x));
    if(ids.length){const {data}=await supabase.from('profiles').select('*').in('id',ids);setAvailable((data||[]) as Profile[])}else setAvailable([]);
    setAdding(true);
  }
  async function addMember(id:string){if(!supabase)return;const {error:e}=await supabase.rpc('add_group_member',{p_group_id:groupId,p_new_user:id});if(e){setError(readableError(e));return;}setAdding(false);await load();}
  async function manage(operation:'promote'|'demote'|'kick'|'rename',target?:string,title?:string){if(!supabase)return;setError('');const {error:e}=await supabase.rpc('manage_group',{p_group:groupId,p_operation:operation,p_target:target||null,p_title:title||null});if(e){setError(readableError(e));return;}await load();}
  function close(){if(onClose)onClose();else if(isTauri())void getCurrentWindow().close();else window.close()}
  return <section className={'xp-window group-chat-window'+(!isTauri()&&!standalone?' web-floating':'')} data-window-id={'group-'+groupId}>
    <div className="xp-title group-window-title" onPointerDown={startNativeDrag}><span className="xp-title-name"><img src={retroMessengerLogo} alt="" className="titlebar-logo"/>{group?.group_title||'Group Conversation'}</span><button type="button" onClick={close} title="Close conversation"><X size={15}/></button></div>
    <div className="group-chat-banner"><Users size={22}/><div><strong>{group?.group_title||'Group chat'}</strong><small>{members.length} member{members.length===1?'':'s'} · private group</small></div><button className="xp-button" title="Leave group" onClick={()=>void leave()}><LogOut size={13}/> Leave</button></div>
    <div className="group-member-strip">{members.map(p=><button type="button" key={p.id} title={`View ${p.display_name||p.username}'s profile`} onClick={()=>setOverview(p)}>{p.display_name||p.username}</button>)}
      {(group?.owner_id===userId||moderators.includes(userId||''))&&<button className="xp-button" type="button" onClick={()=>void showAdd()}><Plus size={12}/> Add member</button>}
    </div>
    <div className="group-game-toolbar">{userId&&<GamesButton conversationId={groupId} userId={userId} peers={members.filter(p=>p.id!==userId)}/> }<button className="xp-button" type="button" onClick={()=>setSearchOpen(x=>!x)}>Search</button>{(group?.owner_id===userId||moderators.includes(userId||''))&&<button className="xp-button" type="button" onClick={()=>setManageOpen(x=>!x)}>Manage group</button>}</div>
    {searchOpen&&<MessageSearch conversationId={groupId} onClose={()=>setSearchOpen(false)} onJump={id=>document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}/>}
    {manageOpen&&<div className="group-manage"><h3>Group management</h3><button type="button" className="xp-button" onClick={()=>{const name=window.prompt('New group name',group?.group_title||'');if(name)void manage('rename',undefined,name)}}>Rename group</button><div className="group-manage-members">{members.filter(m=>m.id!==group?.owner_id&&m.id!==userId).map(m=><div key={m.id}><b>{m.display_name||m.username}</b> {moderators.includes(m.id)?'(moderator)':''} <button className="xp-button" type="button" onClick={()=>void manage('kick',m.id)}>Remove</button>{group?.owner_id===userId&&<button className="xp-button" type="button" onClick={()=>void manage(moderators.includes(m.id)?'demote':'promote',m.id)}>{moderators.includes(m.id)?'Demote':'Promote'}</button>}</div>)}</div></div>}
    {adding&&<div className="group-add-panel"><b>Add a contact to this group</b><button className="group-inline-close" onClick={()=>setAdding(false)}>×</button>{available.length===0&&<p>No eligible contacts available.</p>}{available.map(p=><button className="xp-button" key={p.id} onClick={()=>void addMember(p.id)}>{p.display_name||p.username}</button>)}</div>}
    {error&&<p className="group-error" role="alert">{error}</p>}
    <div className="messages group-message-history" ref={pane} onScroll={e=>{const node=e.currentTarget;followLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<60}}>
      {!messages.length&&<p className="empty-chat">No messages yet. Say hello to the group!</p>}
      {messages.map(message=>{const parent=messages.find(m=>m.id===message.reply_to_id);return <article className="group-message" key={message.id} data-message-id={message.id}>
        <div className="group-message-by"><button type="button" onClick={()=>setOverview(names[message.sender_id]||null)}>{displayUser(message.sender_id)}</button><time>{new Date(message.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>
        {message.reply_to_id&&<button type="button" className="quote-message" onClick={()=>document.querySelector<HTMLElement>(`[data-message-id="${message.reply_to_id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}>
          <strong>{parent?displayUser(parent.sender_id):'Earlier message'}</strong><span>{parent?bodyText(parent).slice(0,125):'Message not in recent history'}</span>
        </button>}
        {message.deleted_at?<p className="message-deleted">This message was deleted.</p>:message.kind==='file'&&message.attachment_path?<MessageAttachment message={message} onError={setError}/>:<FormattedMessageText message={message}/>}
        {userId&&<MessageExtras message={message} userId={userId} reactions={extras.reactions} onToggle={extras.toggle} onChanged={load}/>}
        <div className="group-msg-actions"><button type="button" onClick={()=>setReplyTo(message.id)}><Reply size={12}/> Reply</button>{message.sender_id!==userId&&<button type="button" onClick={()=>openReport(message)}><Flag size={12}/> Report</button>}</div>
      </article>})}
    </div>
    <div className="group-composer">
      {reply&&<div className="reply-preview"><Reply size={14}/><span><strong>Replying to {displayUser(reply.sender_id)}</strong><small>{bodyText(reply).slice(0,130)}</small></span><button type="button" onClick={()=>setReplyTo(null)} aria-label="Cancel reply"><X size={13}/></button></div>}
      <div className="group-format-bar" aria-label="Group message formatting">
        <button type="button" className={messageStyle.bold?'active':''} aria-label="Bold" aria-pressed={messageStyle.bold} onClick={()=>setMessageStyle(s=>({...s,bold:!s.bold}))}><strong>B</strong></button>
        <button type="button" className={messageStyle.italic?'active':''} aria-label="Italic" aria-pressed={messageStyle.italic} onClick={()=>setMessageStyle(s=>({...s,italic:!s.italic}))}><em>I</em></button>
        <button type="button" className={messageStyle.underline?'active':''} aria-label="Underline" aria-pressed={messageStyle.underline} onClick={()=>setMessageStyle(s=>({...s,underline:!s.underline}))}><u>U</u></button>
        <SafeTextColorPicker color={messageStyle.color} onChange={color=>setMessageStyle(s=>({...s,color}))}/>
        <button ref={emoteButton} type="button" className={showEmotes?'active':''} title="Insert emoticon" aria-expanded={showEmotes} onClick={()=>setShowEmotes(x=>!x)}><Smile size={15}/></button>
      </div>
      {showEmotes&&<FloatingPopup anchor={emoteButton.current} panelRef={emotePanel} placement="top" align="start" className="group-emote-panel"><div role="group" aria-label="Choose an emoticon">{GROUP_EMOTES.map(([icon,shortcut])=><button type="button" key={shortcut} title={shortcut} onClick={()=>{setDraft(d=>d+shortcut);setShowEmotes(false)}}>{icon}</button>)}</div></FloatingPopup>}
      <form onSubmit={e=>void send(e)}><textarea value={draft} maxLength={2000} placeholder="Message this group…" style={{color:messageStyle.color,fontWeight:messageStyle.bold?700:400,fontStyle:messageStyle.italic?'italic':'normal',textDecorationLine:messageStyle.underline?'underline':'none'}} onChange={e=>setDraft(e.target.value)} onPaste={e=>{const image=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(image){e.preventDefault();void sendFile(image)}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}}/><button type="submit" disabled={busy||!draft.trim()} className="xp-button primary"><Send size={13}/> Send</button></form>
      <div className="group-attachment-tools"><button type="button" className="xp-button" onClick={()=>setDrawing(true)}>Ink / Draw</button><label className="group-attach">Custom Wink GIF<input type="file" accept="image/gif" disabled={fileUploading} onChange={e=>{void sendFile(e.target.files?.[0]);e.currentTarget.value=''}}/></label>
        <label className="group-attach"><ImageIcon size={13}/> {fileUploading?'Uploading…':'Send image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={fileUploading} onChange={e=>{void sendFile(e.target.files?.[0]);e.currentTarget.value=''}}/></label>
        <label className="group-attach">Send file<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip,application/x-zip-compressed" disabled={fileUploading} onChange={e=>{void sendFile(e.target.files?.[0]);e.currentTarget.value=''}}/></label>
      </div>
    </div>
    {drawing&&<ClassicDrawingPad onClose={()=>setDrawing(false)} onSend={sendFile} disabled={fileUploading}/>}
    
    {overview&&<ContactOverview person={overview} onClose={()=>setOverview(null)} onReport={overview.id!==userId?()=>{setReport({userId:overview.id,username:overview.username,displayName:overview.display_name||overview.username});setOverview(null)}:undefined}/>}
    {report&&<ReportDialog target={report} onClose={()=>setReport(null)}/>}
  </section>;
}

export function StandaloneGroupPage({groupId}:{groupId:string}){
  return <main className="desktop native-mode chat-only"><GroupChatWindow groupId={groupId} standalone/></main>;
}
