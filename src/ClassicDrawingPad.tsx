import {OverlayPortal} from './FloatingUI';
import {useEffect,useRef,useState} from 'react';
import {Brush,Eraser,Trash2,Send,X} from 'lucide-react';

const COLOURS=['#164d96','#222222','#1f754a','#ad2231','#6b35a2','#d37a09','#008aab'];
/** Original ink drawings are sent as ordinary private PNG image attachments. */
export function ClassicDrawingPad({onClose,onSend,disabled=false}:{onClose:()=>void,onSend:(image:File)=>void|Promise<void>,disabled?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const pointer=useRef<number|null>(null);
  const [colour,setColour]=useState('#164d96');
  const [size,setSize]=useState(3);
  const [eraser,setEraser]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const c=canvas.current;const ctx=c?.getContext('2d');if(ctx&&c){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height)}},[]);
  function point(e:React.PointerEvent<HTMLCanvasElement>){const c=canvas.current!;const bounds=c.getBoundingClientRect();return {x:(e.clientX-bounds.left)*c.width/bounds.width,y:(e.clientY-bounds.top)*c.height/bounds.height}}
  function start(e:React.PointerEvent<HTMLCanvasElement>){if(disabled)return;const c=canvas.current!;pointer.current=e.pointerId;c.setPointerCapture(e.pointerId);const p=point(e);const ctx=c.getContext('2d')!;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.01,p.y+.01);ctx.strokeStyle=eraser?'#fff':colour;ctx.lineWidth=eraser?size*5:size;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}
  function move(e:React.PointerEvent<HTMLCanvasElement>){if(pointer.current!==e.pointerId)return;const ctx=canvas.current!.getContext('2d')!;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke()}
  function end(e:React.PointerEvent<HTMLCanvasElement>){if(pointer.current===e.pointerId)pointer.current=null}
  function clear(){const c=canvas.current!;const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height)}
  async function send(){if(disabled||busy)return;const c=canvas.current;if(!c)return;setBusy(true);try{const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw Error('Could not export drawing');await onSend(new File([blob],`retro-ink-${Date.now()}.png`,{type:'image/png'}));onClose()}catch(e){window.alert(e instanceof Error?e.message:'Unable to send drawing')}finally{setBusy(false)}}
  return <OverlayPortal><div className="ink-backdrop" role="presentation" onClick={onClose}><section className="ink-window xp-window" role="dialog" aria-modal="true" aria-label="Messenger handwriting" onClick={e=>e.stopPropagation()}>
    <div className="ink-title"><strong>Ink & Handwriting — Retro Messenger</strong><button type="button" onClick={onClose} aria-label="Close drawing canvas"><X size={16}/></button></div>
    <p className="ink-help">Draw a picture or write a handwritten note, then send it as an image.</p>
    <canvas ref={canvas} width={640} height={360} aria-label="Drawing canvas" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="ink-canvas"/>
    <div className="ink-controls"><div className="ink-colours" aria-label="Ink colours">{COLOURS.map(c=><button key={c} type="button" className={c===colour&&!eraser?'selected':''} title={c} aria-label={`Use colour ${c}`} style={{background:c}} onClick={()=>{setEraser(false);setColour(c)}}/>)}</div>
      <label>Brush <input type="range" min="1" max="12" value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <button type="button" className={'xp-button'+(!eraser?' active':'')} onClick={()=>setEraser(false)}><Brush size={14}/> Pen</button>
      <button type="button" className={'xp-button'+(eraser?' active':'')} onClick={()=>setEraser(true)}><Eraser size={14}/> Eraser</button>
      <button type="button" className="xp-button" onClick={clear}><Trash2 size={14}/> Clear</button>
    </div><div className="ink-footer"><button type="button" className="xp-button" onClick={onClose}>Cancel</button><button type="button" className="xp-button primary" disabled={disabled||busy} onClick={()=>void send()}><Send size={14}/>{busy?'Sending…':'Send drawing'}</button></div>
  </section></div></OverlayPortal>;
}
