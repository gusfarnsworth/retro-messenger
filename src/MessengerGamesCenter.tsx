import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {WebviewWindow} from '@tauri-apps/api/webviewWindow';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {Gamepad2,X,Flag,RefreshCw,Send,Paintbrush,Check,RotateCcw} from 'lucide-react';
import {OverlayPortal} from './FloatingUI';
import {supabase,readableError,type Profile} from './client';
import {GAMES,checkerValid,chessValid,derive,playerIndex,sudokuCorrect,wordPuzzle,type GameAction,type GameKind,type LoggedAction,type Room} from './MessengerGameRules';
import {MessengerWhiteboard} from './MessengerWhiteboard';

type Props={conversationId:string|null|undefined;userId:string;peers:Profile[];disabled?:boolean};
const gameName=(kind:GameKind)=>GAMES.find(g=>g.id===kind)?.title||'Messenger Game';
const coloured=['#206fb5','#d84c45','#e6b13b','#439b59'];
const chessGlyph:Record<string,string>={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const cardSign=['♥','♣','♦','♠'];

export function GamesButton({conversationId,userId,peers,disabled=false}:Props){
 const [open,setOpen]=useState(false),[pending,setPending]=useState(0),[openError,setOpenError]=useState('');
 useEffect(()=>{if(!conversationId||!supabase)return;let active=true;const refresh=async()=>{const {count}=await supabase!.from('messenger_activities').select('id',{count:'exact',head:true}).eq('conversation_id',conversationId).eq('opponent_id',userId).eq('status','invited');if(active)setPending(count||0)};void refresh();const timer=window.setInterval(()=>void refresh(),7000);return()=>{active=false;window.clearInterval(timer)}},[conversationId,userId]);
 async function launch(){if(!conversationId||disabled)return;setOpenError('');if(isTauri()){
   try{const label=`games-${conversationId.replace(/[^a-z0-9]/gi,'')}`;const existing=await WebviewWindow.getByLabel(label);if(existing){await existing.show();await existing.unminimize();await existing.setFocus();return}
     const window=new WebviewWindow(label,{url:`/?games=${encodeURIComponent(conversationId)}`,title:'Retro Messenger — Games & Activities',width:840,height:680,minWidth:580,minHeight:490,decorations:false});
     window.once('tauri://error',event=>setOpenError(String(event.payload)));
   }catch(e){setOpenError(readableError(e))}return;
  }setOpen(true)}
 return <>
  <button type="button" className="games-launch-btn" title={conversationId?'Games & Activities':'Open a conversation to play'} disabled={disabled||!conversationId} onClick={()=>void launch()}><Gamepad2 size={14}/> Games{pending>0&&<span className="games-invite-count">{pending}</span>}</button>
  {openError&&<small role="alert" className="games-error">{openError}</small>}
  {open&&conversationId&&<GamesCenter conversationId={conversationId} userId={userId} peers={peers} onClose={()=>setOpen(false)}/>}
 </>;
}
function GamesCenter({conversationId,userId,peers,onClose}:{conversationId:string;userId:string;peers:Profile[];onClose:()=>void}){
 const [rooms,setRooms]=useState<Room[]>([]),[chosen,setChosen]=useState<string>(''),[moves,setMoves]=useState<LoggedAction[]>([]);
 const [mode,setMode]=useState<'lobby'|'whiteboard'>('lobby');const [kind,setKind]=useState<GameKind>('mines');const [opponent,setOpponent]=useState(peers[0]?.id||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [offset,setOffset]=useState({x:0,y:0});
 const drag=useRef<{id:number;x:number;y:number;startX:number;startY:number}|null>(null);
 function startDragging(e:React.PointerEvent<HTMLDivElement>){if(isTauri()||(e.target as HTMLElement).closest('button'))return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,startX:offset.x,startY:offset.y};e.currentTarget.setPointerCapture(e.pointerId)}
 function moveDragging(e:React.PointerEvent<HTMLDivElement>){const current=drag.current;if(!current||current.id!==e.pointerId)return;setOffset({x:Math.max(-window.innerWidth/3,Math.min(window.innerWidth/3,current.startX+e.clientX-current.x)),y:Math.max(-window.innerHeight/3,Math.min(window.innerHeight/3,current.startY+e.clientY-current.y))})}
 function stopDragging(e:React.PointerEvent<HTMLDivElement>){if(drag.current?.id===e.pointerId)drag.current=null}
 const load=useCallback(async()=>{if(!supabase)return;const {data,error:e}=await supabase.from('messenger_activities').select('*').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(40);if(e)setError(readableError(e));else {setRooms((data||[]) as Room[]);setError('')}},[conversationId]);
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),3000);const channel=supabase?.channel('activities-'+conversationId).on('postgres_changes',{event:'*',schema:'public',table:'messenger_activities',filter:`conversation_id=eq.${conversationId}`},()=>void load()).subscribe();return()=>{window.clearInterval(timer);if(channel)void supabase?.removeChannel(channel)}},[conversationId,load]);
 const selected=rooms.find(x=>x.id===chosen)||null;
 useEffect(()=>{if(!chosen||!supabase){setMoves([]);return;}let active=true;const loadMoves=async()=>{const {data,error:e}=await supabase!.from('messenger_activity_moves').select('seq,player_id,action').eq('activity_id',chosen).order('seq',{ascending:true}).limit(1000);if(active){if(e)setError(readableError(e));else setMoves((data||[]) as LoggedAction[])}};void loadMoves();const timer=window.setInterval(()=>void loadMoves(),1700);const channel=supabase?.channel('activity-moves-'+chosen).on('postgres_changes',{event:'INSERT',schema:'public',table:'messenger_activity_moves',filter:`activity_id=eq.${chosen}`},()=>void loadMoves()).subscribe();return()=>{active=false;window.clearInterval(timer);if(channel)void supabase?.removeChannel(channel)}},[chosen]);
 const game=useMemo(()=>selected?derive(selected,moves):null,[selected,moves]);
 const displayName=(id:string)=>id===userId?'You':peers.find(x=>x.id===id)?.display_name||peers.find(x=>x.id===id)?.username||'Player';
 async function invite(){if(!supabase||!opponent||busy)return;setBusy(true);setError('');try{const {data,error:e}=await supabase.rpc('messenger_invite_game',{p_conversation:conversationId,p_game_type:kind,p_opponent:opponent});if(e)throw e;await load();setChosen(data as string)}catch(err){setError(readableError(err))}finally{setBusy(false)}}
 async function answer(accept:boolean){if(!supabase||!selected||busy)return;setBusy(true);setError('');try{const {error:e}=await supabase.rpc('messenger_answer_game',{p_activity:selected.id,p_accept:accept});if(e)throw e;await load()}catch(err){setError(readableError(err))}finally{setBusy(false)}}
 async function play(action:GameAction){if(!supabase||!selected||busy||selected.status!=='active'||game?.winner!==null||game.draw)return;setBusy(true);setError('');try{const {error:e}=await supabase.rpc('messenger_game_move',{p_activity:selected.id,p_action:action});if(e)throw e;const {data,error:moveErr}=await supabase.from('messenger_activity_moves').select('seq,player_id,action').eq('activity_id',selected.id).order('seq',{ascending:true}).limit(1000);if(moveErr)throw moveErr;setMoves((data||[]) as LoggedAction[]);await load()}catch(err){setError(readableError(err))}finally{setBusy(false)}}
 async function concede(){if(!supabase||!selected||busy)return;const other=userId===selected.inviter_id?selected.opponent_id:selected.inviter_id;if(!window.confirm('Concede this game to your opponent?'))return;setBusy(true);try{const {error:e}=await supabase.rpc('messenger_finish_game',{p_activity:selected.id,p_winner:other});if(e)throw e;await load()}catch(err){setError(readableError(err))}finally{setBusy(false)}}
 function openRematch(){if(!selected)return;setKind(selected.game_type);setOpponent(selected.inviter_id===userId?selected.opponent_id:selected.inviter_id);setChosen('')}
 const isParticipant=selected?(selected.inviter_id===userId||selected.opponent_id===userId):false;
 const turnBased=selected&&['tictactoe','checkers','mines','connect4','chess','colourclash'].includes(selected.game_type);
 const canPlay=Boolean(selected?.status==='active'&&isParticipant&&(!turnBased||selected.turn_id===userId)&&!busy&&game?.winner===null&&!game.draw);
 return <OverlayPortal><div className="games-backdrop" role="presentation" onClick={onClose}><section className="games-panel xp-window" role="dialog" aria-modal="true" aria-label="Messenger Games and Activities" style={isTauri()?undefined:{transform:`translate(${offset.x}px,${offset.y}px)`}} onClick={e=>e.stopPropagation()}>
  <div className="ink-title games-drag-handle" onPointerDown={startDragging} onPointerMove={moveDragging} onPointerUp={stopDragging} onPointerCancel={stopDragging}><strong><Gamepad2 size={16}/> Retro Messenger — Games & Activities</strong><button type="button" onClick={onClose} aria-label="Close Games"><X size={16}/></button></div>
  <div className="games-tabs"><button type="button" className={mode==='lobby'?'active':''} onClick={()=>setMode('lobby')}><Gamepad2 size={14}/> Games</button><button type="button" className={mode==='whiteboard'?'active':''} onClick={()=>setMode('whiteboard')}><Paintbrush size={14}/> Shared Whiteboard</button></div>
  {error&&<p role="alert" className="games-error">{error}</p>}
  {mode==='whiteboard'?<MessengerWhiteboard conversationId={conversationId} userId={userId}/>:<div className="games-body">
   <aside className="games-list">
    <div className="games-list-title">10 classic-inspired games <button type="button" title="Refresh" onClick={()=>void load()}><RefreshCw size={13}/></button></div>
    {GAMES.map(g=><button key={g.id} type="button" className={kind===g.id&&!chosen?'selected':''} onClick={()=>{setChosen('');setKind(g.id)}}><span>{g.title}</span><small>{g.detail}</small></button>)}
    <h4>Recent invitations & matches</h4>
    {rooms.length===0&&<p>No games yet. Invite a friend to begin!</p>}
    {rooms.map(r=><button type="button" key={r.id} className={chosen===r.id?'selected':''} onClick={()=>setChosen(r.id)}><span>{gameName(r.game_type)} {r.status==='invited'&&r.opponent_id===userId?'• NEW':''}</span><small>{r.status} · {new Date(r.created_at).toLocaleDateString()}</small></button>)}
   </aside>
   <div className="games-main">
    {!selected?<div className="games-new">
      <h3>{gameName(kind)}</h3><p>{GAMES.find(g=>g.id===kind)?.detail}</p>
      <label>Invite a player <select value={opponent} onChange={e=>setOpponent(e.target.value)}><option value="">Choose a contact</option>{peers.filter(p=>p.id!==userId).map(p=><option key={p.id} value={p.id}>{p.display_name||p.username}</option>)}</select></label>
      <button type="button" className="xp-button primary" disabled={busy||!opponent} onClick={()=>void invite()}><Send size={13}/> {busy?'Sending invitation…':'Send game invitation'}</button>
      <p className="games-subtle">Your friend accepts the invitation in their own Games & Activities menu. Scores and turns sync between clients.</p>
    </div>:<div className="games-play">
      <div className="games-status"><div><h3>{gameName(selected.game_type)}</h3><p>{displayName(selected.inviter_id)} vs {displayName(selected.opponent_id)}</p></div><span>{selected.status}</span></div>
      {selected.status==='invited'?<div className="games-invitation"><Gamepad2 size={34}/><h3>{selected.opponent_id===userId?'You have a game invitation!':'Waiting for your friend…'}</h3><p>{displayName(selected.inviter_id)} invites {displayName(selected.opponent_id)} to play {gameName(selected.game_type)}.</p>
       {selected.opponent_id===userId&&<div className="games-actions"><button type="button" className="xp-button primary" disabled={busy} onClick={()=>void answer(true)}><Check size={14}/> Accept</button><button type="button" className="xp-button" disabled={busy} onClick={()=>void answer(false)}>Decline</button></div>}</div>
      :selected.status==='declined'?<p>The invitation was declined.</p>
      :<><div className="games-score"><span>{displayName(selected.inviter_id)}: <b>{game?.score[0]??0}</b></span><span>{displayName(selected.opponent_id)}: <b>{game?.score[1]??0}</b></span></div>
       {selected.status==='finished'?<p className="games-result">{selected.winner_id?`${displayName(selected.winner_id)} wins!`:'Draw or game finished.'}</p>
        :game?.winner!==null&&game?.winner!==undefined?<p className="games-result">{displayName(game.winner===0?selected.inviter_id:selected.opponent_id)} wins!</p>
        :game?.draw?<p className="games-result">Draw game!</p>
        :<p className="games-turn">{turnBased?`Turn: ${displayName(selected.turn_id||'')}`:'Both players can play at the same time.'}{!isParticipant?' · Spectating':''}</p>}
       {game&&<GameBoard room={selected} game={game} userId={userId} canPlay={canPlay} onPlay={action=>void play(action)}/>}
       <div className="games-actions"><button type="button" className="xp-button" onClick={openRematch}><RotateCcw size={14}/> New match</button>{isParticipant&&selected.status==='active'&&game?.winner===null&&!game.draw&&<button type="button" className="xp-button" disabled={busy} onClick={()=>void concede()}><Flag size={14}/> Concede</button>}</div>
      </>}
    </div>}
   </div>
  </div>}
 </section></div></OverlayPortal>;
}

type BoardProps={room:Room;game:ReturnType<typeof derive>;userId:string;canPlay:boolean;onPlay:(action:GameAction)=>void};
function GameBoard({room,game,userId,canPlay,onPlay}:BoardProps){
 const [selected,setSelected]=useState<number|null>(null),[word,setWord]=useState(''),[sudokuInput,setSudokuInput]=useState('');
 const side=playerIndex(room,userId),b=game.board;
 useEffect(()=>{setSelected(null);setWord('');setSudokuInput('')},[room.id,room.move_number]);
 const boardMove=(i:number)=>{
  if(!canPlay)return;
  if(room.game_type==='mines'){onPlay({kind:'flag',cell:i});return}
  if(room.game_type==='tictactoe'){if(b[i]==='.')onPlay({kind:'cell',cell:i});return}
  if(room.game_type==='connect4'){onPlay({kind:'column',column:i});return}
  if(room.game_type==='checkers'||room.game_type==='chess'||room.game_type==='match3'){
   if(selected===null){setSelected(i);return}
   if(i===selected){setSelected(null);return}
   if(room.game_type==='checkers'&&!checkerValid(b,selected,i,side).ok){setSelected(i);return}
   if(room.game_type==='chess'&&!chessValid(b,selected,i,side)){setSelected(i);return}
   onPlay({kind:room.game_type==='match3'?'swap':'move',from:selected,to:i});setSelected(null);
  }
 };
 if(room.game_type==='tictactoe')return <div className="games-grid games-tictactoe">{b.map((c,i)=><button type="button" key={i} disabled={!canPlay||c!=='.'} onClick={()=>boardMove(i)}>{c==='.'?'':c}</button>)}</div>;
 if(room.game_type==='connect4')return <div className="games-connect-wrap"><div className="games-connect-choices">{Array.from({length:7},(_,c)=><button key={c} type="button" title={`Drop into column ${c+1}`} disabled={!canPlay} onClick={()=>boardMove(c)}>▼</button>)}</div><div className="games-grid games-connect4">{b.map((cell,i)=><div key={i} className={'connect-cell '+(cell==='X'?'red':cell==='O'?'yellow':'')}>{cell==='.'?'': '●'}</div>)}</div></div>;
 if(room.game_type==='mines')return <div className="games-grid games-mines">{b.map((cell,i)=><button key={i} type="button" disabled={!canPlay||cell!=='·'} className={cell==='⚑'?'found':cell==='×'?'miss':''} onClick={()=>boardMove(i)}>{cell==='·'?'?':cell}</button>)}</div>;
 if(room.game_type==='checkers'||room.game_type==='chess')return <><div className="games-grid games-checkers">{b.map((piece,i)=><button key={i} type="button" className={`${(Math.floor(i/8)+i%8)%2?'dark':'light'} ${selected===i?'selected':''}`} disabled={!canPlay} onClick={()=>boardMove(i)} title={`Square ${String.fromCharCode(97+i%8)}${8-Math.floor(i/8)}`}>
    {room.game_type==='chess'?<span className={piece===piece.toUpperCase()?'chess-white':'chess-black'}>{chessGlyph[piece]||''}</span>:piece==='.'?'':<span className={piece.toLowerCase()==='w'?'checker-white':'checker-black'}>{piece===piece.toUpperCase()?'♛':'●'}</span>}</button>)}</div><p className="games-subtle">{room.game_type==='chess'?'Move pieces to protect your king. This original compact edition supports basic movement and check; castling and en passant are not yet available.':'Select a piece and destination. Diagonal captures jump over a piece.'}</p></>;
 if(room.game_type==='solitaire'){
  const hands=game.extra.remaining as number[][]|undefined,foundation=game.extra.foundation as number[][]|undefined,indices=game.extra.indices as number[]|undefined;
  if(!hands||!foundation||!indices)return null;const cards=hands[side],current=cards.length?cards[indices[side]%cards.length]:null;
  const suit=current===null?0:current%4,rank=current===null?0:Math.floor(current/4)+1;
  return <div className="games-cards"><div className="games-foundations">{foundation[side].map((top,i)=><div key={i}>{cardSign[i]}<b>{top?['A','2','3','4','5'][top-1]:'–'}</b></div>)}</div><div className="games-card-big">{current!==null?<>{['A','2','3','4','5'][rank-1]}<span>{cardSign[suit]}</span></>:'Completed!'}</div><p>{cards.length} cards remaining in your deck</p><div className="games-actions"><button type="button" className="xp-button primary" disabled={!canPlay||current===null||foundation[side][suit]!==rank-1} onClick={()=>current!==null&&onPlay({kind:'collect',card:current})}>Build foundation</button><button type="button" className="xp-button" disabled={!canPlay||!cards.length} onClick={()=>onPlay({kind:'draw'})}>Next card</button></div></div>;
 }
 if(room.game_type==='colourclash'){
  const hands=game.extra.hands as {id:number;colour:number;rank:number}[][]|undefined,top=game.extra.top as {colour:number;rank:number}|undefined;
  if(!hands||!top)return null;return <div className="games-colour-clash"><h4>Current card</h4><div className="colour-card top" style={{background:coloured[top.colour]}}>{top.rank}</div><p>Your hand: {hands[side].length} cards · Opponent: {hands[side===0?1:0].length} cards</p><div className="colour-hand">{hands[side].map(card=><button type="button" key={card.id} style={{background:coloured[card.colour]}} disabled={!canPlay||(card.colour!==top.colour&&card.rank!==top.rank)} onClick={()=>onPlay({kind:'play',card:card.id})}>{card.rank}</button>)}</div><button type="button" className="xp-button" disabled={!canPlay} onClick={()=>onPlay({kind:'draw'})}>Draw a card / pass</button></div>;
 }
 if(room.game_type==='match3'){
  const boards=game.extra.grids as string[][]|undefined;if(!boards)return null;
  const shapeStyle:Record<string,string>={'◆':'#e74d4b','●':'#287fbb','■':'#31a463','★':'#e2a31b','♥':'#ab59c7'};
  return <><p>Swap two adjacent gems to make groups of three. First to 500 points wins.</p><div className="games-grid games-match3">{boards[side].map((gem,i)=><button type="button" key={i} className={selected===i?'selected':''} style={{color:shapeStyle[gem]}} disabled={!canPlay} onClick={()=>boardMove(i)}>{gem}</button>)}</div></>;
 }
 if(room.game_type==='sudoku'){
  const puzzle=game.extra.puzzle as string|undefined,entries=game.extra.entries as Record<number,number>[]|undefined;if(!puzzle||!entries)return null;
  return <><p>Fill each empty cell with the correct digit. The first complete board wins.</p><div className="games-grid games-sudoku">{puzzle.split('').map((v,i)=><button type="button" key={i} className={`${v!=='0'?'given':''} ${selected===i?'selected':''} ${(Math.floor(i/9)%3===2)?'endrow':''} ${i%9===2?'endcol':''}`} onClick={()=>setSelected(i)} disabled={!canPlay||v!=='0'}>{v!=='0'?v:entries[side][i]||''}</button>)}</div><form className="games-sudoku-entry" onSubmit={e=>{e.preventDefault();if(selected===null)return;const digit=Number(sudokuInput);if(sudokuCorrect(selected,digit))onPlay({kind:'fill',cell:selected,digit});else window.alert('That number is not correct for this square.');setSudokuInput('')}}><label>Selected square: {selected===null?'none':selected+1} <input inputMode="numeric" type="number" min="1" max="9" value={sudokuInput} onChange={e=>setSudokuInput(e.target.value)} placeholder="1–9"/></label><button type="submit" className="xp-button primary" disabled={!canPlay||selected===null||!sudokuInput}>Enter digit</button></form></>;
 }
 if(room.game_type==='words'){
  const puzzle=wordPuzzle(room.seed),words=game.extra.words as string[][]|undefined;return <div className="games-words"><h3>{puzzle.letters.split('').join(' ')}</h3><p>Find words of at least three letters. First to submit eight accepted words wins.</p><form onSubmit={e=>{e.preventDefault();const normalized=word.trim().toLowerCase();if(!puzzle.words.includes(normalized)){window.alert('Try another word using the letters.');return}if(words?.[side]?.includes(normalized)){window.alert('You already used that word.');return}onPlay({kind:'word',word:normalized});setWord('')}}><input type="text" maxLength={12} value={word} onChange={e=>setWord(e.target.value.replace(/[^a-z]/gi,''))} placeholder="Type a word"/><button className="xp-button primary" disabled={!canPlay||word.length<3}>Submit</button></form><div className="games-word-found">{(words?.[side]||[]).map(w=><span key={w}>{w}</span>)}</div></div>;
 }
 return <p>Game not available.</p>;
}


/** Tauri: games run in their own native webview rather than inside the chat. */
export function StandaloneGamesPage({conversationId}:{conversationId:string}){
 const [userId,setUserId]=useState<string|null>(null),[peers,setPeers]=useState<Profile[]>([]),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const load=async()=>{if(!supabase){if(alive)setError('Supabase is not configured.');return}const {data:auth,error:authError}=await supabase.auth.getUser();if(authError||!auth.user){if(alive)setError('Please sign in to Messenger first.');return}
  const currentId=auth.user.id;
  const {data:membership,error:membershipError}=await supabase.from('conversation_members').select('user_id').eq('conversation_id',conversationId);
  if(membershipError||!(membership||[]).some(row=>row.user_id===currentId)){if(alive)setError('This conversation is not available to you.');return}
  const ids=(membership||[]).map(row=>row.user_id).filter(id=>id!==currentId);
  const {data:profiles,error:profilesError}=await supabase.from('profiles').select('*').in('id',ids);
  if(profilesError){if(alive)setError(readableError(profilesError));return}if(alive){setUserId(currentId);setPeers((profiles||[]) as Profile[])}};
 void load();return()=>{alive=false}},[conversationId]);
 const close=()=>void getCurrentWindow().close();
 return <main className="native-games-page">{error?<div className="games-native-error" role="alert">{error}<button className="xp-button" onClick={close}>Close</button></div>:userId?<GamesCenter conversationId={conversationId} userId={userId} peers={peers} onClose={close}/>:<p>Loading your games…</p>}</main>;
}
