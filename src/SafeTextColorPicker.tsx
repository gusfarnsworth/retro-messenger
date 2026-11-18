import {useEffect, useRef, useState} from 'react';
import {Check, ChevronDown, Palette} from 'lucide-react';
import {APPROVED_TEXT_COLORS, safeMessageColor} from './messageFormatting';
import {FloatingPopup} from './FloatingUI';

/**
 * Compact, keyboard-accessible Messenger palette. Avoid the operating system's
 * native <input type="color"> popup: it overwhelms the narrow chat window and
 * offers pale/grey values which the server must reject anyway.
 * All displayed choices satisfy the colour safety rules.
 */
export function SafeTextColorPicker({color,onChange}:{color:string;onChange:(color:string)=>void}){
  const [open,setOpen]=useState(false);
  const wrapper=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const menu=useRef<HTMLDivElement>(null);
  const current=safeMessageColor(color);

  useEffect(()=>{
    if(!open)return;
    function handleOutside(event:PointerEvent){
      if(!wrapper.current?.contains(event.target as Node)&&!menu.current?.contains(event.target as Node))setOpen(false);
    }
    function handleEscape(event:KeyboardEvent){
      if(event.key==='Escape')setOpen(false);
    }
    document.addEventListener('pointerdown',handleOutside);
    document.addEventListener('keydown',handleEscape);
    return()=>{
      document.removeEventListener('pointerdown',handleOutside);
      document.removeEventListener('keydown',handleEscape);
    };
  },[open]);

  const selected=APPROVED_TEXT_COLORS.find(item=>item.hex===current);
  return <div className="safe-color-picker" ref={wrapper}>
    <button
      type="button"
      ref={trigger}
      className={'safe-color-trigger'+(open?' is-open':'')}
      aria-label={`Text colour: ${selected?.name||'Custom'}. Choose a colour`}
      title="Choose message text colour"
      aria-haspopup="true"
      aria-expanded={open}
      onClick={()=>setOpen(value=>!value)}
    >
      <Palette size={13} aria-hidden="true"/>
      <span className="safe-color-trigger-label">Colour</span>
      <span className="safe-color-current" style={{backgroundColor:current,backgroundImage:'none'}} aria-hidden="true"/>
      <ChevronDown size={12} aria-hidden="true"/>
    </button>
    {open&&<FloatingPopup anchor={trigger.current} panelRef={menu} placement="top" align="end" className="safe-color-menu"><div role="group" aria-label="Message text colour palette">
      <div className="safe-color-menu-title">Choose text colour</div>
      <div className="safe-color-swatches">
        {APPROVED_TEXT_COLORS.map(preset=><button
          key={preset.hex}
          type="button"
          className={'safe-color-preset'+(current===preset.hex?' selected':'')}
          style={{backgroundColor:preset.hex,backgroundImage:'none'}}
          aria-label={preset.name}
          aria-pressed={current===preset.hex}
          title={preset.name}
          onClick={()=>{onChange(preset.hex);setOpen(false)}}
        >{current===preset.hex&&<Check size={16} color="#ffffff" aria-hidden="true"/>}</button>)}
      </div>
      <p className="safe-color-hint">Dark, readable colours only.</p>
    </div></FloatingPopup>}
  </div>;
}
