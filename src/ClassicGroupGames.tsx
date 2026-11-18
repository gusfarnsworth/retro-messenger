import {OverlayPortal} from './FloatingUI';
import {useCallback,useEffect,useState} from 'react';
import {Gamepad2,X} from 'lucide-react';
import {supabase,readableError,type Profile} from './client';
type Game={id:string;group_id:string;player_x:string;player_o:string;board:string;turn_id:string;winner_id:string|null;state:'active'|'won'|'draw'};
export function ClassicGroupGames({groupId,userId,members,onClose}:{groupId:string;userId:string;members:Profile[];onClose:()=>void}){
 const [game,setGame]=useState<Game|null>(null),[opponent,setOpponent]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{if(!supabase)return;const {data,error:e}=await supabase.from('group_games').select('*').eq('group_id',groupId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(e)setError(readableError(e));else setGame(data as Game|null)},[groupId]);
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),3000);return()=>window.clearInterval(timer)},[refresh]);
 async function start(){if(!supabase||!opponent||busy)return;setBusy(true);setError('');try{const {error:e}=await supabase.rpc('start_group_game',{p_group:groupId,p_opponent:opponent});if(e)throw e;await refresh()}catch(e){setError(readableError(e))}finally{setBusy(false)}}
 async function play(cell:number){if(!supabase||!game||busy)return;setBusy(true);setError('');try{const {error:e}=await supabase.rpc('play_group_game',{p_game:game.id,p_cell:cell});if(e)throw e;await refresh()}catch(e){setError(readableError(e))}finally{setBusy(false)}}
 const name=(id:string|null)=>members.find(m=>m.id===id)?.display_name||members.find(m=>m.id===id)?.username||'Unknown';
 return <OverlayPortal><div className="game-overlay" role="presentation" onClick={onClose}><section className="xp-window game-panel" role="dialog" aria-modal="true" aria-label="Messenger games" onClick={e=>e.stopPropagation()}>
  <div className="ink-title"><strong><Gamepad2 size={16}/> Messenger Games</strong><button onClick={onClose} type="button" aria-label="Close games"><X size={15}/></button></div>
  <h3>Noughts & Crosses</h3><p>Play a classic turn-based game with someone in this group.</p>
  {game&&<div className="game-status"><strong>{name(game.player_x)} (X) vs {name(game.player_o)} (O)</strong><span>{game.state==='won'?`${name(game.winner_id)} wins!`:game.state==='draw'?"It's a draw!":`Turn: ${name(game.turn_id)}`}</span></div>}
  {game&&<div className="game-board">{game.board.split('').map((c,i)=><button key={i} type="button" disabled={busy||game.state!=='active'||game.turn_id!==userId||c!=='.'} onClick={()=>void play(i)}>{c==='.'?'':c}</button>)}</div>}
  {(!game||game.state!=='active')&&<div className="game-new"><label>Choose opponent<select value={opponent} onChange={e=>setOpponent(e.target.value)}><option value="">Select group member</option>{members.filter(m=>m.id!==userId).map(p=><option value={p.id} key={p.id}>{p.display_name||p.username}</option>)}</select></label><button type="button" className="xp-button primary" onClick={()=>void start()} disabled={busy||!opponent}>Start new game</button></div>}
  {error&&<p role="alert" className="group-error">{error}</p>}
 </section></div></OverlayPortal>;
}
