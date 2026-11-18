import type {Message} from './client';

/** Message presentation is stored with each message, not only on the sender's device. */
export type MessageStyle={color:string;bold:boolean;italic:boolean;underline:boolean};
export const DEFAULT_MESSAGE_STYLE:MessageStyle={color:'#174978',bold:false,italic:false,underline:false};

// All preset colours are saturated and have at least 4.5:1 contrast on white.
export const APPROVED_TEXT_COLORS=[
  {name:'Messenger navy',hex:'#174978'},
  {name:'Deep blue',hex:'#0059a8'},
  {name:'Ocean blue',hex:'#155c84'},
  {name:'Forest green',hex:'#176b40'},
  {name:'Red',hex:'#a51624'},
  {name:'Purple',hex:'#6b2f9a'},
  {name:'Teal',hex:'#00666b'},
  {name:'Berry',hex:'#9c256c'},
  {name:'Burnt orange',hex:'#9c4700'},
  {name:'Brown',hex:'#82421b'},
] as const;

/** Reject white, pale colours and grey and greyish shades, including dark greys. */
export function isAllowedMessageColor(color:unknown):color is string{
  if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))return false;
  const channels=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255);
  const hi=Math.max(...channels),lo=Math.min(...channels);
  if(hi===0||(hi-lo)/hi<0.65)return false;
  const linear=channels.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  const luminance=0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
  return luminance<=0.1833; // WCAG contrast against white >= ~4.5:1
}

export function safeMessageColor(input:unknown):string{
  return isAllowedMessageColor(input)?input.toLowerCase():DEFAULT_MESSAGE_STYLE.color;
}

export function safeMessageStyle(input:unknown):MessageStyle{
  if(!input||typeof input!=='object')return {...DEFAULT_MESSAGE_STYLE};
  const obj=input as Partial<MessageStyle>;
  return {
    color:safeMessageColor(obj.color),
    bold:obj.bold===true,
    italic:obj.italic===true,
    underline:obj.underline===true,
  };
}

function parseLegacy(body:string):{text:string;style:MessageStyle}|null{
  try{
    const obj=JSON.parse(body) as {v?:number;text?:string;color?:string;bold?:boolean;italic?:boolean;underline?:boolean};
    if(obj?.v===1&&typeof obj.text==='string')return {text:obj.text,style:safeMessageStyle(obj)};
  }catch{/* Older plaintext messages are normal. */}
  return null;
}

export function plainMessageText(body:string):string{
  return parseLegacy(body)?.text??body;
}

export function getMessageStyle(message:Pick<Message,'body'|'format'>):MessageStyle{
  const legacy=parseLegacy(message.body)?.style;
  const modern=message.format;
  // Older messages stored style inside JSON body; new ones store it in the format column.
  return safeMessageStyle({...DEFAULT_MESSAGE_STYLE,...(legacy||{}),...(modern||{})});
}

const EMOTE_PATTERN=/(:lol:|:hug:|8-\)|:\)|:D|;\)|:P|:'\(|<3|:O|\(y\)|:@)/gi;
const EMOJI:Record<string,string>={':lol:':'😂',':hug:':'🤗','8-)':'😎',':)':'🙂',':d':'😃',';)':'😉',':p':'😛',":'(":'😢','<3':'❤️',':o':'😮','(y)':'👍',':@':'😡'};

/** Shared renderer used by direct messages and group chats on every device. */
export function FormattedMessageText({message}:{message:Pick<Message,'body'|'format'>}){
  const style=getMessageStyle(message);
  const body=plainMessageText(message.body);
  return <p className="formatted-message-text" style={{
    color:style.color,
    fontWeight:style.bold?700:400,
    fontStyle:style.italic?'italic':'normal',
    textDecorationLine:style.underline?'underline':'none',
  }}>{body.split(EMOTE_PATTERN).map((text,i)=><span key={i}>{EMOJI[text.toLowerCase()]||text}</span>)}</p>;
}
