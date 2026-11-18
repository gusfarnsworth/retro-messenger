import {OverlayPortal} from './FloatingUI';
import {useEffect,useState} from 'react';
import {Download,Image as ImageIcon,Paperclip,X} from 'lucide-react';
import {supabase,readableError,type Message} from './client';

type AttachmentMessage=Pick<Message,'body'|'kind'|'attachment_path'>;
const IMAGE_EXTENSIONS=/\.(?:png|jpe?g|webp|gif)$/i;

export function isImageAttachment(message:AttachmentMessage):boolean{
  if(message.kind!=='file'||!message.attachment_path)return false;
  return IMAGE_EXTENSIONS.test(message.attachment_path)||IMAGE_EXTENSIONS.test(message.body);
}

/** Download through authenticated Storage rather than opening a raw Supabase URL. */
export async function saveTransfer(path:string,fileName:string):Promise<void>{
  if(!supabase)throw new Error('Supabase is not configured.');
  const {data,error}=await supabase.storage.from('transfers').download(path);
  if(error)throw error;
  const objectUrl=URL.createObjectURL(data);
  const link=document.createElement('a');
  link.href=objectUrl;link.download=fileName||'attachment';
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
}

/** The transfers bucket remains PRIVATE. Images get a short-lived signed URL
 * for embedding in the chat; other attachments are authenticated downloads. */
export function MessageAttachment({message,onError}:{message:AttachmentMessage;onError?:(error:string)=>void}){
  const path=message.attachment_path||'';
  const image=isImageAttachment(message);
  const [url,setUrl]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!image||!path)return;
    let active=true;
    setUrl(null);setError('');
    if(!supabase){setError('Storage is not configured.');return;}
    void supabase.storage.from('transfers').createSignedUrl(path,600).then(({data,error:linkError})=>{
      if(!active)return;
      if(linkError||!data?.signedUrl){setError('Image preview could not be loaded.');return;}
      setUrl(data.signedUrl);
    }).catch(e=>{if(active)setError(readableError(e));});
    return()=>{active=false};
  },[path,image,retry]);
  useEffect(()=>{
    if(!open)return;
    function escape(event:KeyboardEvent){if(event.key==='Escape')setOpen(false)}
    window.addEventListener('keydown',escape);
    return()=>window.removeEventListener('keydown',escape);
  },[open]);
  async function download(){if(!path||saving)return;setSaving(true);
    try{await saveTransfer(path,message.body);}catch(e){const msg=readableError(e);setError(msg);onError?.(msg);}
    finally{setSaving(false)}
  }
  if(!path)return null;
  if(!image)return <div className="retro-file-attachment"><button className="xp-button" type="button" onClick={()=>void download()} disabled={saving}><Paperclip size={14}/>{saving?'Downloading…':message.body}</button></div>;
  return <div className="retro-image-attachment">
    {url&&!error?<>
      <button type="button" className="retro-image-preview" title={`View ${message.body}`} onClick={()=>setOpen(true)}>
        <img src={url} alt={message.body} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>{if(retry<1)setRetry(x=>x+1);else setError('Image preview could not be loaded.')}}/>
      </button>
      <div className="retro-image-details"><ImageIcon size={13}/><span title={message.body}>{message.body}</span><button type="button" onClick={()=>void download()} disabled={saving} title="Save image"><Download size={14}/> Save</button></div>
    </>:<div className="retro-image-loading"><ImageIcon size={16}/>{error||'Loading image…'}{error&&<button type="button" onClick={()=>void download()} disabled={saving}>Download file</button>}</div>}
    {open&&url&&<OverlayPortal><div className="retro-image-lightbox" role="presentation" onClick={()=>setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label={`Image: ${message.body}`} className="retro-image-lightbox-panel" onClick={e=>e.stopPropagation()}>
        <div className="retro-image-lightbox-toolbar"><span>{message.body}</span><button className="xp-button" type="button" onClick={()=>void download()} disabled={saving}><Download size={14}/> Save</button><button className="xp-button" type="button" onClick={()=>setOpen(false)} aria-label="Close image"><X size={14}/></button></div>
        <img src={url} alt={message.body} referrerPolicy="no-referrer"/>
      </section>
    </div></OverlayPortal>}
  </div>;
}
