import {useEffect,useRef,useState} from 'react';
import {FloatingPopup} from './FloatingUI';

export type MenuItem={label:string,action?:()=>void,disabled?:boolean,divider?:boolean};
export type MenuDefinition={label:string,items:MenuItem[]};
/** All menus render above draggable windows rather than inside their clipped frames. */
export function MessengerMenu({menus}:{menus:MenuDefinition[]}){
  const [opened,setOpened]=useState<string|null>(null);
  const [anchor,setAnchor]=useState<HTMLElement|null>(null);
  const root=useRef<HTMLDivElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    function onDown(e:PointerEvent){
      if(!root.current?.contains(e.target as Node)&&!panel.current?.contains(e.target as Node))setOpened(null);
    }
    function onEscape(e:KeyboardEvent){if(e.key==='Escape')setOpened(null)}
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onEscape);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onEscape)};
  },[]);
  const selected=menus.find(menu=>menu.label===opened);
  return <div className="classic-menubar" ref={root} role="menubar">
    {menus.map(menu=><div className="classic-menu" key={menu.label}>
      <button type="button" className={opened===menu.label?'active':''} aria-haspopup="menu" aria-expanded={opened===menu.label}
        onClick={e=>{setAnchor(e.currentTarget);setOpened(o=>o===menu.label?null:menu.label)}}
        onMouseEnter={e=>{if(opened){setAnchor(e.currentTarget);setOpened(menu.label)}}}
      >{menu.label}</button>
    </div>)}
    {selected&&<FloatingPopup anchor={anchor} panelRef={panel} placement="bottom" align="start" className="menu-popup">
      <div role="menu" aria-label={selected.label}>
        {selected.items.map((item,i)=>item.divider?<div key={i} className="menu-divider" role="separator"/>:<button role="menuitem" key={`${item.label}-${i}`} type="button" disabled={item.disabled} onClick={()=>{setOpened(null);item.action?.()}}>{item.label}</button>)}
      </div>
    </FloatingPopup>}
  </div>;
}
