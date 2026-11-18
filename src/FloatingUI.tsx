import {useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';

type PopupPlacement='top'|'bottom';
type PopupAlignment='start'|'end';
type Coordinates={top:number;left:number;maxHeight:number;maxWidth:number;visibility:'hidden'|'visible'};

/**
 * Window-independent popup layer. Web windows intentionally clip their content;
 * portaling menus to document.body avoids clipping by the chat history, the
 * composer, window overflow, or nested stacking contexts. Also works in Tauri.
 * Position follows dragged windows and scrollable conversations.
 */
export function FloatingPopup({anchor,children,className='',placement='bottom',align='start',panelRef}: {
  anchor:HTMLElement|null;
  children:ReactNode;
  className?:string;
  placement?:PopupPlacement;
  align?:PopupAlignment;
  panelRef?:RefObject<HTMLDivElement|null>;
}){
  const localRef=useRef<HTMLDivElement>(null);
  const [coordinates,setCoordinates]=useState<Coordinates>({top:0,left:0,maxHeight:200,maxWidth:250,visibility:'hidden'});
  useLayoutEffect(()=>{
    if(!anchor)return;
    const panel=localRef.current;
    if(!panel)return;
    let scheduled=0;
    const update=()=>{
      scheduled=0;
      if(!anchor.isConnected||anchor.getClientRects().length===0){
        setCoordinates(previous=>previous.visibility==='hidden'?previous:{...previous,visibility:'hidden'});
        return;
      }
      const anchorRect=anchor.getBoundingClientRect();
      const margin=8,offset=5;
      const viewportWidth=document.documentElement.clientWidth;
      const viewportHeight=document.documentElement.clientHeight;
      const maxWidth=Math.max(0,viewportWidth-margin*2);
      // Read the natural size, not the previous max-height clamped size.
      const width=Math.min(panel.scrollWidth||panel.offsetWidth||210,maxWidth);
      const naturalHeight=panel.scrollHeight||panel.offsetHeight||80;
      const above=anchorRect.top-offset-margin;
      const below=viewportHeight-anchorRect.bottom-offset-margin;
      const putAbove=placement==='top' ? (above>=Math.min(naturalHeight,160)||above>below) : (below<Math.min(naturalHeight,160)&&above>below);
      const available=Math.max(40,putAbove?above:below);
      const height=Math.min(naturalHeight,available);
      let left=align==='end'?anchorRect.right-width:anchorRect.left;
      left=Math.max(margin,Math.min(left,viewportWidth-width-margin));
      const top=putAbove?anchorRect.top-offset-height:anchorRect.bottom+offset;
      const next:Coordinates={top:Math.max(margin,Math.min(top,viewportHeight-height-margin)),left,maxHeight:available,maxWidth,visibility:'visible'};
      setCoordinates(previous=>previous.top===next.top&&previous.left===next.left&&previous.maxHeight===next.maxHeight&&previous.maxWidth===next.maxWidth&&previous.visibility===next.visibility?previous:next);
    };
    const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(update)};
    update();
    // Capture scroll events even from nested chat-history and settings panes.
    document.addEventListener('scroll',schedule,true);
    document.addEventListener('pointermove',schedule,true);
    window.addEventListener('resize',schedule);
    document.addEventListener('dblclick',schedule,true);
    document.addEventListener('transitionend',schedule,true);
    const windowHost=anchor.closest('.web-floating');
    const positionObserver=windowHost?new MutationObserver(schedule):null;
    if(windowHost)positionObserver?.observe(windowHost,{attributes:true,attributeFilter:['style','class']});
    const observer=new ResizeObserver(schedule);
    observer.observe(panel);observer.observe(anchor);
    return()=>{
      if(scheduled)cancelAnimationFrame(scheduled);
      document.removeEventListener('scroll',schedule,true);
      document.removeEventListener('pointermove',schedule,true);
      window.removeEventListener('resize',schedule);
      document.removeEventListener('dblclick',schedule,true);
      document.removeEventListener('transitionend',schedule,true);
      positionObserver?.disconnect();
      observer.disconnect();
    };
  },[anchor,placement,align]);

  if(!anchor)return null;
  return createPortal(
    <div ref={node=>{localRef.current=node;if(panelRef)panelRef.current=node}}
      className={'retro-floating-popup '+className}
      style={{position:'fixed',top:coordinates.top,left:coordinates.left,maxHeight:coordinates.maxHeight,maxWidth:coordinates.maxWidth,visibility:coordinates.visibility,zIndex:2147483000}}
      data-retro-floating="true"
    >{children}</div>,
    document.body
  );
}

/** Used for full-screen dialogs and previews that must not be clipped by windows. */
export function OverlayPortal({children}:{children:ReactNode}){
  return createPortal(children,document.body);
}
