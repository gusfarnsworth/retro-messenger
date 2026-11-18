import {OverlayPortal} from './FloatingUI';
import {CalendarDays,Flag,MessageSquare,UserRound,X} from 'lucide-react';
import type {Profile} from './client';

export function ContactOverview({person,status,onClose,onMessage,onReport,alias}:{
  person:Profile;status?:string;onClose:()=>void;onMessage?:()=>void;onReport?:()=>void;alias?:string;
}){
  const shown=alias||person.display_name||person.username;
  const joined=person.created_at?new Date(person.created_at).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):null;
  return <OverlayPortal><div className="contact-overview-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="xp-window contact-overview" role="dialog" aria-modal="true" aria-labelledby="contact-overview-name">
      <div className="contact-overview-title"><UserRound size={15}/><b>Contact Information</b><button type="button" onClick={onClose} aria-label="Close profile"><X size={17}/></button></div>
      <div className="contact-overview-header">
        <div className="contact-overview-picture">{person.avatar_url?<img src={person.avatar_url} alt="Profile picture"/>:(person.display_name||person.username)[0]?.toUpperCase()}</div>
        <div className="contact-overview-identity"><h2 id="contact-overview-name">{shown}</h2><span>@{person.username}</span>{status&&<small>{status==='offline'?'Offline':status==='online'?'Online':status}</small>}</div>
      </div>
      <div className="contact-overview-body"><strong>Personal message</strong><p>{person.personal_message||'No personal message set.'}</p>{person.now_playing_enabled&&person.now_playing_title&&<p className="now-playing-text">♫ Now playing: {person.now_playing_title}{person.now_playing_artist?` — ${person.now_playing_artist}`:''}</p>}
        {joined&&<div className="contact-overview-joined"><CalendarDays size={14}/> Member since {joined}</div>}
        <small>Only public profile details are shown here. Email addresses are private.</small>
      </div>
      <div className="contact-overview-actions">
        {onReport&&<button className="xp-button" type="button" onClick={onReport}><Flag size={14}/> Report</button>}
        <button className="xp-button" type="button" onClick={onClose}>Close</button>
        {onMessage&&<button className="xp-button primary" type="button" onClick={onMessage}><MessageSquare size={14}/> Message</button>}
      </div>
    </section>
  </div></OverlayPortal>;
}
