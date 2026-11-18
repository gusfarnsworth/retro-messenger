/** Original, deterministic mini-game rules. These are casual social games, not wagered competitions. */
export const GAMES = [
 {id:'mines',title:'Minesweeper Flags',detail:'Race to discover ten hidden mines. Correct flags earn points.'},
 {id:'checkers',title:'Checkers',detail:'Capture your opponent’s pieces on an 8 × 8 board.'},
 {id:'tictactoe',title:'Noughts & Crosses',detail:'Get three in a row.'},
 {id:'solitaire',title:'Solitaire Sprint',detail:'Race to build four foundations from Ace through Five.'},
 {id:'connect4',title:'Four in a Row',detail:'Drop a counter into a column and connect four.'},
 {id:'chess',title:'Chess',detail:'Play standard piece movement with check and checkmate.'},
 {id:'colourclash',title:'Colour Clash',detail:'Match colour or number and empty your hand first.'},
 {id:'match3',title:'Gem Match',detail:'Swap neighbouring gems and score matching groups.'},
 {id:'sudoku',title:'Sudoku Race',detail:'Complete a shared Sudoku puzzle before your opponent.'},
 {id:'words',title:'Word Blitz',detail:'Make words from the given letters. First to eight scores wins.'}
] as const;
export type GameKind=typeof GAMES[number]['id'];
export type GameAction={kind:string;cell?:number;column?:number;from?:number;to?:number;card?:number;digit?:number;word?:string;hit?:boolean};
export type LoggedAction={seq:number;player_id:string;action:GameAction};
export type Room={id:string;conversation_id:string;game_type:GameKind;inviter_id:string;opponent_id:string;status:'invited'|'active'|'declined'|'finished';turn_id:string|null;winner_id:string|null;seed:number;move_number:number;created_at:string;updated_at:string};
export type PlayerIndex=0|1;
export function playerIndex(room:Room,id:string):PlayerIndex{return id===room.inviter_id?0:1}
export function makeRandom(seed:number){let x=(seed||1)|0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296}}
export function shuffle<T>(values:T[],seed:number){const r=makeRandom(seed);const out=values.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out}
const other=(i:PlayerIndex):PlayerIndex=>i===0?1:0;
const inBounds=(row:number,col:number)=>row>=0&&row<8&&col>=0&&col<8;
const toPos=(i:number):[number,number]=>[Math.floor(i/8),i%8];
const winnerTtt=(b:string[])=>{for(const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]!=='.'&&b[a]===b[c]&&b[a]===b[d])return b[a];return null};
export type GameState={board:string[];score:[number,number];winner:PlayerIndex|null;draw:boolean;extra:Record<string,unknown>};
export const EMPTY=():GameState=>({board:[],score:[0,0] as [number,number],winner:null,draw:false,extra:{}});

function checkerStart(){const b=Array(64).fill('.');for(let r=0;r<8;r++)for(let c=0;c<8;c++)if((r+c)%2===1){if(r<=2)b[r*8+c]='b';if(r>=5)b[r*8+c]='w'}return b}
export function checkerValid(b:string[],from:number,to:number,who:PlayerIndex):{ok:boolean;capture?:number}{
 const p=b[from], [r,c]=toPos(from),[tr,tc]=toPos(to),dr=tr-r,dc=tc-c;
 if(!p||p==='.'||b[to]!=='.'||(who===0?p.toLowerCase()!=='w':p.toLowerCase()!=='b')||Math.abs(dr)!==Math.abs(dc))return {ok:false};
 if(p===p.toLowerCase()&&Math.sign(dr)!==(who===0?-1:1))return {ok:false};
 if(Math.abs(dr)===1)return {ok:true};
 if(Math.abs(dr)===2){const middle=(r+dr/2)*8+c+dc/2;const q=b[middle];return {ok:q!=='.'&&q.toLowerCase()!==(who===0?'w':'b'),capture:middle}}
 return {ok:false};
}
function chessStart(){return 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR'.split('')}
function chessOwn(piece:string,side:PlayerIndex){return piece!=='.'&&(side===0?piece===piece.toUpperCase():piece===piece.toLowerCase())}
function chessAttack(board:string[],from:number,to:number){const p=board[from],type=p.toLowerCase(),[r,c]=toPos(from),[rr,cc]=toPos(to),dr=rr-r,dc=cc-c,ar=Math.abs(dr),ac=Math.abs(dc);
 if(from===to||p==='.')return false;
 if(type==='p')return ar===1&&ac===1&&Math.sign(dr)===(p==='P'?-1:1);
 if(type==='n')return (ar===2&&ac===1)||(ar===1&&ac===2);
 if(type==='k')return Math.max(ar,ac)===1;
 if(type==='r'&&dr!==0&&dc!==0)return false;
 if(type==='b'&&ar!==ac)return false;
 if(type==='q'&&!(dr===0||dc===0||ar===ac))return false;
 if(!'rbq'.includes(type))return false;
 const sr=Math.sign(dr),sc=Math.sign(dc);for(let cr=r+sr,ccol=c+sc;cr!==rr||ccol!==cc;cr+=sr,ccol+=sc){if(!inBounds(cr,ccol)||board[cr*8+ccol]!=='.')return false}return true;
}
function chessInCheck(board:string[],side:PlayerIndex){const king=side===0?'K':'k',target=board.indexOf(king);if(target<0)return true;return board.some((p,idx)=>p!=='.'&&!chessOwn(p,side)&&chessAttack(board,idx,target))}
export function chessValid(board:string[],from:number,to:number,side:PlayerIndex):boolean{
 const p=board[from],q=board[to];if(!p||!chessOwn(p,side)||!q||chessOwn(q,side)||q.toLowerCase()==='k')return false;
 const [r,c]=toPos(from),[tr,tc]=toPos(to),dr=tr-r,dc=tc-c;
 if(p.toLowerCase()==='p'){
  const dir=side===0?-1:1;
  const ok=(dc===0&&q==='.'&&(dr===dir||(r===(side===0?6:1)&&dr===dir*2&&board[(r+dir)*8+c]==='.')))||(Math.abs(dc)===1&&dr===dir&&q!=='.');if(!ok)return false;
 }else if(!chessAttack(board,from,to))return false;
 const next=board.slice();next[to]=p;next[from]='.';if(p==='P'&&tr===0)next[to]='Q';if(p==='p'&&tr===7)next[to]='q';return !chessInCheck(next,side);
}
const sudokuPuzzle='530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const sudokuSolution='534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const wordPuzzles=[
 {letters:'STREAMLINE',words:['stream','line','steam','stare','smile','mine','name','mean','main','meal','real','mile','mist','seat','east','team','tear','time','lime','same','sale','isle','slime','term','lean','learn','near','rail','rain','rate','late','least','master','remain','tire','rise','stir','star','merit','tame','metal','train','marine','retail','strain']},
 {letters:'FRIENDSHIP',words:['friend','ship','fish','find','fine','hide','ride','rise','side','spin','pine','shine','spend','send','dish','red','den','pin','dip','hen','end','his','hers','her','rip','fire','siren','pride','spider']},
 {letters:'CONVERSATION',words:['conversation','version','voice','stone','note','tone','vote','oven','over','ocean','cone','coat','cove','rest','store','star','rise','train','stove','roast','rain','coin','care','near','nose','sore','save','cater','rave','race','react','cart','iron','ones','vast','vase']}
];
export function sudokuCorrect(cell:number,digit:number){return sudokuSolution[cell]===String(digit)}
export function wordPuzzle(seed:number){return wordPuzzles[Math.abs(seed)%wordPuzzles.length]}
function initialGem(seed:number){const r=makeRandom(seed),shapes=['◆','●','■','★','♥'];return Array.from({length:36},()=>shapes[Math.floor(r()*5)])}
function gemMatches(board:string[]){const ids=new Set<number>();for(let r=0;r<6;r++)for(let c=0;c<6;c++){
 if(c<=3&&board[r*6+c]===board[r*6+c+1]&&board[r*6+c]===board[r*6+c+2]){let x=c;while(x<6&&board[r*6+x]===board[r*6+c])ids.add(r*6+x++);}
 if(r<=3&&board[r*6+c]===board[(r+1)*6+c]&&board[r*6+c]===board[(r+2)*6+c]){let x=r;while(x<6&&board[x*6+c]===board[r*6+c])ids.add(x++*6+c);}
 }return ids}
function gemSwap(b:string[],a:number,z:number,seed:number):{board:string[];score:number}{
 const next=b.slice();[next[a],next[z]]=[next[z],next[a]];let matches=gemMatches(next);if(!matches.size)return {board:b,score:0};const r=makeRandom(seed),shapes=['◆','●','■','★','♥'];let pts=0;
 for(let pass=0;pass<5&&matches.size;pass++){pts+=matches.size*10;for(const index of matches)next[index]='.';
 for(let c=0;c<6;c++){const column=[];for(let row=5;row>=0;row--)if(next[row*6+c]!=='.')column.push(next[row*6+c]);while(column.length<6)column.push(shapes[Math.floor(r()*shapes.length)]);for(let row=5;row>=0;row--)next[row*6+c]=column[5-row]}
 matches=gemMatches(next)}return {board:next,score:pts};
}
function initialCards(seed:number){return shuffle(Array.from({length:40},(_,i)=>({colour:Math.floor(i/10),rank:i%10,id:i})),seed)}
function cardMatches(card:{colour:number;rank:number},top:{colour:number;rank:number}){return card.colour===top.colour||card.rank===top.rank}

/** Derive a complete shared game view by replaying the append-only move log. */
export function derive(room:Room,moves:LoggedAction[]):GameState{
 const type=room.game_type,ordered=moves.slice().sort((a,b)=>a.seq-b.seq),base=EMPTY();
 if(type==='tictactoe'){
  const b=Array(9).fill('.');
  for(const m of ordered){const at=m.action.cell;if(typeof at!=='number'||at<0||at>8||b[at]!=='.'||base.winner!==null)continue;b[at]=playerIndex(room,m.player_id)===0?'X':'O';const who=winnerTtt(b);if(who)base.winner=who==='X'?0:1;}
  base.board=b;base.draw=!b.includes('.')&&base.winner===null;
 }else if(type==='connect4'){
  const b=Array(42).fill('.');for(const m of ordered){const c=m.action.column;if(typeof c!=='number'||c<0||c>=7||base.winner!==null)continue;let row=5;while(row>=0&&b[row*7+c]!=='.')row--;if(row<0)continue;
    const mark=playerIndex(room,m.player_id)===0?'X':'O';b[row*7+c]=mark;
    for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]){let count=1;for(const sign of [-1,1]){let r=row+dr*sign,cc=c+dc*sign;while(r>=0&&r<6&&cc>=0&&cc<7&&b[r*7+cc]===mark){count++;r+=dr*sign;cc+=dc*sign}}if(count>=4)base.winner=playerIndex(room,m.player_id)}
  }base.board=b;base.draw=!b.includes('.')&&base.winner===null;
 }else if(type==='checkers'){
  const b=checkerStart();for(const m of ordered){const {from,to}=m.action,who=playerIndex(room,m.player_id);if(typeof from!=='number'||typeof to!=='number'||from<0||from>=64||to<0||to>=64)continue;
   const result=checkerValid(b,from,to,who);if(!result.ok)continue;const p=b[from];b[to]=p;b[from]='.';if(result.capture!==undefined)b[result.capture]='.';if(p==='w'&&Math.floor(to/8)===0)b[to]='W';if(p==='b'&&Math.floor(to/8)===7)b[to]='B';}
  base.board=b;if(!b.some(c=>c.toLowerCase()==='b'))base.winner=0;else if(!b.some(c=>c.toLowerCase()==='w'))base.winner=1;
 }else if(type==='chess'){
  const b=chessStart();for(const m of ordered){const {from,to}=m.action,side=playerIndex(room,m.player_id);if(typeof from!=='number'||typeof to!=='number'||from<0||from>=64||to<0||to>=64||!chessValid(b,from,to,side))continue;const p=b[from];b[from]='.';b[to]=p;if(p==='P'&&Math.floor(to/8)===0)b[to]='Q';if(p==='p'&&Math.floor(to/8)===7)b[to]='q'}
  base.board=b;const nextSide:PlayerIndex=ordered.length%2?1:0;let any=false;for(let from=0;from<64&&!any;from++)for(let to=0;to<64;to++)if(chessValid(b,from,to,nextSide)){any=true;break}
  if(!any){if(chessInCheck(b,nextSide))base.winner=other(nextSide);else base.draw=true}
 }else if(type==='mines'){
  const b=Array(64).fill('·');for(const m of ordered){const index=m.action.cell;if(typeof index!=='number'||index<0||index>=64||b[index]!=='·')continue;b[index]=m.action.hit?'⚑':'×';if(m.action.hit)base.score[playerIndex(room,m.player_id)]++}
  base.board=b;const count=base.score[0]+base.score[1];if(count>=10){if(base.score[0]!==base.score[1])base.winner=base.score[0]>base.score[1]?0:1;else base.draw=true}
 }else if(type==='solitaire'){
  const decks=[shuffle(Array.from({length:20},(_,i)=>i),room.seed+12),shuffle(Array.from({length:20},(_,i)=>i),room.seed+12)];const remaining=[decks[0].slice(),decks[1].slice()],foundation=[Array(4).fill(0),Array(4).fill(0)],idx=[0,0];
  for(const m of ordered){const side=playerIndex(room,m.player_id),a=m.action;const deck=remaining[side];if(!deck.length)continue;
   if(a.kind==='draw'){idx[side]=(idx[side]+1)%deck.length;continue}
   const card=deck[idx[side]%deck.length];if(a.kind==='collect'&&a.card===card&&foundation[side][card%4]+1===Math.floor(card/4)+1){foundation[side][card%4]++;deck.splice(idx[side]%deck.length,1);if(deck.length)idx[side]%=deck.length;}
  }base.extra={remaining,foundation,indices:idx};base.score=[foundation[0].reduce((a,b)=>a+b,0),foundation[1].reduce((a,b)=>a+b,0)];if(base.score[0]>=20)base.winner=0;else if(base.score[1]>=20)base.winner=1;
 }else if(type==='colourclash'){
  const cards=initialCards(room.seed),hands=[cards.slice(0,6),cards.slice(6,12)],draw=cards.slice(13),pile=[cards[12]];let index=0;
  for(const m of ordered){const side=playerIndex(room,m.player_id),a=m.action;if(a.kind==='draw'){if(index<draw.length)hands[side].push(draw[index++]);continue}
   const at=hands[side].findIndex(c=>c.id===a.card);if(at<0||!cardMatches(hands[side][at],pile[pile.length-1]))continue;pile.push(hands[side].splice(at,1)[0]);}
  base.score=[6-hands[0].length,6-hands[1].length];base.extra={hands,top:pile[pile.length-1],drawLeft:draw.length-index};if(!hands[0].length)base.winner=0;else if(!hands[1].length)base.winner=1;
 }else if(type==='match3'){
  const b=[initialGem(room.seed+3),initialGem(room.seed+11)];let step=0;
  for(const m of ordered){const {from,to}=m.action,side=playerIndex(room,m.player_id);if(typeof from!=='number'||typeof to!=='number'||from<0||to<0||from>=36||to>=36||Math.abs(from-to)!==1&&Math.abs(from-to)!==6||Math.abs(from-to)===1&&Math.floor(from/6)!==Math.floor(to/6))continue;
    const result=gemSwap(b[side],from,to,room.seed+1000+step++*137);b[side]=result.board;base.score[side]+=result.score;}
  base.board=b[0];base.extra={grids:b};if(base.score[0]>=500||base.score[1]>=500)base.winner=base.score[0]>=500?0:1;
 }else if(type==='sudoku'){
  const entries:[Record<number,number>,Record<number,number>]=[{},{}];for(const m of ordered){const {cell,digit}=m.action;if(typeof cell!=='number'||typeof digit!=='number'||cell<0||cell>=81||digit<1||digit>9||sudokuPuzzle[cell]!=='0'||String(digit)!==sudokuSolution[cell])continue;entries[playerIndex(room,m.player_id)][cell]=digit}
  base.score=[Object.keys(entries[0]).length,Object.keys(entries[1]).length];base.extra={entries,puzzle:sudokuPuzzle};const blanks=sudokuPuzzle.split('').filter(c=>c==='0').length;if(base.score[0]>=blanks)base.winner=0;else if(base.score[1]>=blanks)base.winner=1;
 }else if(type==='words'){
  const found:[string[],string[]]=[[],[]],puzzle=wordPuzzle(room.seed);for(const m of ordered){const word=(m.action.word||'').toLowerCase(),side=playerIndex(room,m.player_id);if(puzzle.words.includes(word)&&!found[side].includes(word))found[side].push(word)}
  base.score=[found[0].length,found[1].length];base.extra={words:found,letters:puzzle.letters};if(base.score[0]>=8)base.winner=0;else if(base.score[1]>=8)base.winner=1;
 }
 return base;
}
