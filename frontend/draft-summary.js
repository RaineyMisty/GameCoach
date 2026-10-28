"use strict";

// 整个阵容面板可拖动；边缘箭头负责收纳，悬停锁图标负责锁定位置。
(() => {
  const panel=document.getElementById('draft-summary'),content=document.getElementById('summary-content');
  const pin=document.getElementById('summary-pin'),toggle=document.getElementById('summary-toggle');
  const shackle=document.getElementById('summary-lock-shackle'),layout=document.querySelector('.app-layout');
  if(!panel||!content||!pin||!toggle||!layout)return;
  const tr=key=>window.GameCoachI18n?window.GameCoachI18n.t(key):key;
  const compact=()=>window.innerWidth<=760;
  let bucket=compact()?'compact':'wide',state,drag=null,revealTimer;
  const key=()=>'gamecoach-draft-panel:v1:'+bucket;
  function load(){
    let saved;try{saved=JSON.parse(localStorage.getItem(key())||'null');}catch{}
    state={collapsed:typeof saved?.collapsed==='boolean'?saved.collapsed:compact(),pinned:saved?.pinned===true,
      x:Number.isFinite(saved?.x)?saved.x:null,y:Number.isFinite(saved?.y)?saved.y:null,
      side:saved?.side==='left'?'left':'right'};
  }
  function persist(){try{localStorage.setItem(key(),JSON.stringify(state));}catch{}}
  function bounds(){
    const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
    const right=left+(viewport?.width||window.innerWidth),bottom=top+(viewport?.height||window.innerHeight);
    const headerBottom=document.querySelector('.topbar')?.getBoundingClientRect().bottom||0;
    return{left,top:Math.min(Math.max(top+8,headerBottom+8),Math.max(top+8,bottom-72)),right,bottom:bottom-8};
  }
  function controls(){
    panel.classList.toggle('dock-left',state.side==='left');panel.classList.toggle('dock-right',state.side==='right');
    panel.classList.toggle('is-pinned',state.pinned);
    const action=tr(state.collapsed?'展开':'收起');
    toggle.textContent=(state.side==='right')!==state.collapsed?'›':'‹';
    toggle.title=action;toggle.setAttribute('aria-label',action);toggle.setAttribute('aria-expanded',String(!state.collapsed));
    const lockLabel=tr(state.pinned?'解除固定后可拖动':'固定当前位置');
    pin.title=lockLabel;pin.setAttribute('aria-label',lockLabel);pin.setAttribute('aria-pressed',String(state.pinned));
    shackle?.setAttribute('d',state.pinned?'M8 11V7a4 4 0 0 1 8 0v4':'M8 11V7a4 4 0 0 1 7.5-2');
  }
  function move(x,y){
    const box=bounds();panel.style.maxHeight=Math.max(64,box.bottom-box.top)+'px';
    const rect=panel.getBoundingClientRect();
    if(state.collapsed){
      panel.style.left=(state.side==='left'?box.left:box.right)+'px';
      panel.style.top=Math.max(box.top,Math.min(state.y??y,Math.max(box.top,box.bottom-64)))+'px';
    }else{
      state.x=Math.max(box.left+12,Math.min(x,Math.max(box.left+12,box.right-rect.width-12)));
      state.y=Math.max(box.top,Math.min(y,Math.max(box.top,box.bottom-rect.height)));
      state.side=state.x+rect.width/2<(box.left+box.right)/2?'left':'right';
      panel.style.left=state.x+'px';panel.style.top=state.y+'px';
    }
    panel.style.right='auto';controls();
  }
  function constrain(){const rect=panel.getBoundingClientRect();move(state.x??rect.left,state.y??rect.top);}
  function render(){
    content.hidden=state.collapsed;panel.classList.toggle('is-collapsed',state.collapsed);
    layout.classList.toggle('summary-collapsed',state.collapsed);controls();constrain();
  }
  function endDrag(event){
    if(!drag||(event?.pointerId!==undefined&&event.pointerId!==drag.id))return;
    const id=drag.id;drag=null;panel.classList.remove('is-dragging-panel');
    if(panel.hasPointerCapture?.(id))panel.releasePointerCapture(id);persist();
  }
  toggle.onclick=()=>{endDrag();state.collapsed=!state.collapsed;panel.classList.remove('show-controls');render();persist();};
  pin.onclick=()=>{endDrag();state.pinned=!state.pinned;controls();persist();};
  panel.onpointerdown=event=>{
    if(event.pointerType==='touch'){
      panel.classList.add('show-controls');clearTimeout(revealTimer);
      revealTimer=setTimeout(()=>panel.classList.remove('show-controls'),2800);
    }
    // 控件自身只执行点击，不触发拖动；其余头像、禁用位和空白均可拖。
    if(event.target?.closest?.('button')||state.pinned||state.collapsed||event.button!==0)return;
    event.preventDefault();const rect=panel.getBoundingClientRect();
    drag={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x:rect.left,y:rect.top};
    panel.setPointerCapture?.(event.pointerId);panel.classList.add('is-dragging-panel');
  };
  panel.onpointermove=event=>{if(drag&&event.pointerId===drag.id)move(drag.x+event.clientX-drag.clientX,drag.y+event.clientY-drag.clientY);};
  panel.onpointerup=endDrag;panel.onpointercancel=endDrag;panel.onlostpointercapture=endDrag;
  panel.ondragstart=event=>event.preventDefault();
  panel.onkeydown=event=>{
    if(event.target!==panel||state.pinned||state.collapsed)return;
    const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!direction)return;
    event.preventDefault();const step=event.shiftKey?40:10;move(state.x+direction[0]*step,state.y+direction[1]*step);persist();
  };
  function resize(){
    const next=compact()?'compact':'wide';endDrag();
    if(next!==bucket){bucket=next;load();panel.style.left='';panel.style.top='';panel.style.right='';render();}else constrain();
  }
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  window.addEventListener('gamecoach:language-changed',render);
  load();render();if(typeof ResizeObserver!=='undefined')new ResizeObserver(constrain).observe(panel);
})();
