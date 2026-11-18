import {useCallback,useEffect,useRef,useState} from 'react';
import {readableError,supabase} from './client';

export type SystemDirectMessage={
  id:string;
  recipient_id:string;
  admin_sender_id:string|null;
  message_kind?:'admin'|'welcome'|'poll';
  poll_id?:string|null;
  subject:string;
  body:string;
  created_at:string;
  read_at:string|null;
};

/** Fixed, official sender. Ordinary users cannot reply because this isn't a DM
 * conversation and the only INSERT path is an admin-checked SQL function. */
export function useSystemDirectMessages(
  userId:string|null,
  onIncoming:(message:SystemDirectMessage)=>void
){
  const [messages,setMessages]=useState<SystemDirectMessage[]>([]);
  const [error,setError]=useState('');
  const callback=useRef(onIncoming);
  useEffect(()=>{callback.current=onIncoming},[onIncoming]);

  const refresh=useCallback(async()=>{
    if(!supabase||!userId)return;
    const {data,error:requestError}=await supabase.from('system_direct_messages')
      .select('*')
      .eq('recipient_id',userId).order('created_at',{ascending:false}).limit(200);
    if(requestError){setError(readableError(requestError));return;}
    setError('');setMessages((data||[]) as SystemDirectMessage[]);
  },[userId]);

  useEffect(()=>{
    setMessages([]);setError('');
    if(!supabase||!userId)return;
    const client=supabase;
    void refresh();
    const channel=client.channel(`system-direct-recipient-${userId}`)
      .on('postgres_changes',{
        event:'INSERT',schema:'public',table:'system_direct_messages',
        filter:`recipient_id=eq.${userId}`
      },payload=>{
        const message=payload.new as SystemDirectMessage;
        if(message.recipient_id!==userId)return;
        setMessages(old=>old.some(m=>m.id===message.id)?old:[message,...old].slice(0,200));
        callback.current(message);
      })
      .on('postgres_changes',{
        event:'UPDATE',schema:'public',table:'system_direct_messages',
        filter:`recipient_id=eq.${userId}`
      },payload=>{
        const updated=payload.new as SystemDirectMessage;
        setMessages(old=>old.map(m=>m.id===updated.id?{...m,read_at:updated.read_at}:m));
      }).subscribe();
    const timer=window.setInterval(()=>void refresh(),60000);
    return()=>{window.clearInterval(timer);void client.removeChannel(channel)};
  },[userId,refresh]);

  const markRead=useCallback(async()=>{
    if(!supabase||!userId)return;
    const unread=messages.filter(m=>m.recipient_id===userId&&!m.read_at);
    if(!unread.length)return;
    const ids=unread.map(m=>m.id);
    const stamp=new Date().toISOString();
    const {error:updateError}=await supabase.from('system_direct_messages')
      .update({read_at:stamp}).eq('recipient_id',userId).in('id',ids);
    if(updateError){setError(readableError(updateError));return;}
    setMessages(old=>old.map(m=>ids.includes(m.id)?{...m,read_at:stamp}:m));
  },[messages,userId]);

  return {
    messages,
    unreadCount:messages.filter(m=>!m.read_at).length,
    error,
    refresh,
    markRead
  };
}
