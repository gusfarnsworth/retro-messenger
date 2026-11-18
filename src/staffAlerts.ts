import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase,readableError} from './client';

export type StaffAlert={
  id:string;
  batch_id:string;
  recipient_id:string;
  author_id:string;
  title:string;
  body:string;
  created_at:string;
  read_at:string|null;
};
export type StaffRole='staff'|'admin';

/** The server is authoritative: a role is read through an RLS-protected table,
 *  and sending is independently authorised again inside the SQL RPC. */
export function useStaffAlerts(userId:string|null,onIncoming:(alert:StaffAlert)=>void){
  const [alerts,setAlerts]=useState<StaffAlert[]>([]);
  const [staffRole,setStaffRole]=useState<StaffRole|null>(null);
  const [error,setError]=useState('');
  const callback=useRef(onIncoming);
  useEffect(()=>{callback.current=onIncoming},[onIncoming]);

  const refresh=useCallback(async()=>{
    if(!supabase||!userId)return;
    const {data,error:queryError}=await supabase.from('staff_alerts').select('*')
      .eq('recipient_id',userId).order('created_at',{ascending:false}).limit(100);
    if(queryError){setError(readableError(queryError));return;}
    setAlerts((data||[]) as StaffAlert[]);setError('');
  },[userId]);

  useEffect(()=>{
    setAlerts([]);setStaffRole(null);setError('');
    if(!supabase||!userId)return;
    const client=supabase;
    let cancelled=false;
    void client.from('messenger_staff').select('role').eq('user_id',userId).maybeSingle()
      .then(({data,error})=>{if(!cancelled){if(error)setError(readableError(error));setStaffRole((data?.role||null) as StaffRole|null)}});
    void refresh();
    const channel=client.channel(`staff-alert-inbox-${userId}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'staff_alerts',filter:`recipient_id=eq.${userId}`},payload=>{
        const row=payload.new as StaffAlert;
        if(row.recipient_id!==userId)return;
        setAlerts(old=>old.some(x=>x.id===row.id)?old:[row,...old].slice(0,100));
        callback.current(row);
      }).subscribe();
    const timer=window.setInterval(()=>void refresh(),60000);
    return()=>{cancelled=true;window.clearInterval(timer);void client.removeChannel(channel)};
  },[userId,refresh]);

  const markRead=useCallback(async(id:string)=>{
    if(!supabase||!userId)return;
    const stamp=new Date().toISOString();
    const {error:err}=await supabase.from('staff_alerts').update({read_at:stamp})
      .eq('id',id).eq('recipient_id',userId);
    if(err){setError(readableError(err));return;}
    setAlerts(old=>old.map(a=>a.id===id?{...a,read_at:stamp}:a));
  },[userId]);

  return {alerts,unreadCount:alerts.filter(a=>!a.read_at).length,staffRole,error,markRead,refresh};
}
