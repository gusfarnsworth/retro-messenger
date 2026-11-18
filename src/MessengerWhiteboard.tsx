import {useCallback,useEffect,useRef,useState} from 'react';
import {Eraser,Download,Undo2,RefreshCw} from 'lucide-react';
import {supabase,readableError} from './client';

type Point=[number,number];
type Stroke={id:number;author_id:string;colour:string;width:number;points:Point[]};
const PALETTE=['#174978','#0059a8','#176b40','#a51624','#6b2f9a','#9c4700','#222222','#ffffff'];
export function MessengerWhiteboard({conversationId,userId}:{conversationId:string;userId:string}){
 const [strokes,setStrokes]=useState<Stroke[]>([]),[colour,setColour]=useState('#174978'),[brush,setBrush]=useState(4),[eraser,setEraser]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),points=useRef<Point[]>([]),active=useRef<number|null>(null);
 const load=useCallback(async()=>{if(!supabase)return;const {data,error:e}=await supabase.from('messenger_whiteboard_strokes').select('id,author_id,colour,width,points').eq('conversation_id',conversationId).order('id',{ascending:true}).limit(600);if(e)setError(readableError(e));else {setStrokes((data||[]) as Stroke[]);setError('')}},[conversationId]);
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),2500);const channel=supabase?.channel('whiteboard-'+conversationId).on('postgres_changes',{event:'*',schema:'public',table:'messenger_whiteboard_strokes',filter:`conversation_id=eq.${conversationId}`},()=>void load()).subscribe();return()=>{window.clearInterval(timer);if(channel)void supabase?.removeChannel(channel)}},[conversationId,load]);
 function paint(ctx:CanvasRenderingContext2D,stroke:{colour:string;width:number;points:Point[]}){if(!stroke.points?.length)return;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=stroke.width;ctx.strokeStyle=stroke.colour;ctx.beginPath();stroke.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke()}
 useEffect(()=>{const node=canvas.current;if(!node)return;const ctx=node.getContext('2d');if(!ctx)return;ctx.fillStyle='#fff';ctx.fillRect(0,0,node.width,node.height);strokes.forEach(stroke=>paint(ctx,stroke));if(points.current.length)paint(ctx,{colour:eraser?'#ffffff':colour,width:eraser?brush*5:brush,points:points.current})},[strokes,colour,brush,eraser]);
 function position(e:React.PointerEvent<HTMLCanvasElement>):Point{const node=canvas.current!,r=node.getBoundingClientRect();return [Math.min(720,Math.max(0,Math.round((e.clientX-r.left)*720/r.width))),Math.min(420,Math.max(0,Math.round((e.clientY-r.top)*420/r.height)))]}
 function down(e:React.PointerEvent<HTMLCanvasElement>){if(saving)return;active.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);const p=position(e);points.current=[p,p];drawNow()}
 function drawNow(){const node=canvas.current,ctx=node?.getContext('2d');if(!ctx||!node)return;ctx.fillStyle='#fff';ctx.fillRect(0,0,node.width,node.height);strokes.forEach(stroke=>paint(ctx,stroke));if(points.current.length)paint(ctx,{colour:eraser?'#ffffff':colour,width:eraser?brush*5:brush,points:points.current})}
 function move(e:React.PointerEvent<HTMLCanvasElement>){if(active.current!==e.pointerId)return;if(points.current.length>=200)return;points.current.push(position(e));drawNow()}
 async function up(e:React.PointerEvent<HTMLCanvasElement>){if(active.current!==e.pointerId||!supabase)return;active.current=null;const sent=points.current.slice();points.current=[];setSaving(true);try{const {error:e}=await supabase.from('messenger_whiteboard_strokes').insert({conversation_id:conversationId,author_id:userId,colour:eraser?'#ffffff':colour,width:eraser?brush*5:brush,points:sent});if(e)throw e;await load()}catch(err){setError(readableError(err))}finally{setSaving(false)}}
 async function undo(){if(!supabase)return;const mine=strokes.filter(s=>s.author_id===userId).at(-1);if(!mine)return;const {error:e}=await supabase.from('messenger_whiteboard_strokes').delete().eq('id',mine.id).eq('author_id',userId);if(e)setError(readableError(e));else void load()}
 function exportImage(){const canvasNode=canvas.current;if(!canvasNode)return;const link=document.createElement('a');link.href=canvasNode.toDataURL('image/png');link.download=`retro-whiteboard-${new Date().toISOString().slice(0,10)}.png`;link.click()}
 return <div className="messenger-whiteboard">
  <p>Everyone in this conversation can draw here. Strokes are shared securely with members, and you can undo your own work.</p>
  <div className="whiteboard-controls"><div className="whiteboard-palette">{PALETTE.map(c=><button key={c} type="button" title={c==='#ffffff'?'White pen':c} className={colour===c&&!eraser?'picked':''} style={{background:c}} onClick={()=>{setColour(c);setEraser(false)}}/>)}</div>
   <label>Brush <input aria-label="Brush width" type="range" min="1" max="6" value={brush} onChange={e=>setBrush(Number(e.target.value))}/></label>
   <button className={'xp-button'+(eraser?' active':'')} type="button" onClick={()=>setEraser(x=>!x)}><Eraser size={14}/> Eraser</button>
   <button className="xp-button" type="button" onClick={()=>void undo()}><Undo2 size={14}/> Undo mine</button>
   <button className="xp-button" type="button" onClick={()=>void load()}><RefreshCw size={14}/></button>
   <button className="xp-button" type="button" onClick={exportImage}><Download size={14}/> Save PNG</button>
  </div>
  {error&&<p className="games-error" role="alert">{error}</p>}
  <canvas className="whiteboard-canvas" width={720} height={420} ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={e=>void up(e)} onPointerCancel={e=>void up(e)} aria-label="Shared whiteboard"/>
  <small>{strokes.length} shared strokes{saving?' · Sending drawing…':''}</small>
 </div>;
}
