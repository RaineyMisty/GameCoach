const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/draft-summary.js'),'utf8');
function setup({width=1200,height=800,saved=new Map(),blocked=false}={}){
  function node(){const classes=new Set();return{style:{},hidden:false,textContent:'',attrs:{},
    classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key),toggle(key,on){if(on)classes.add(key);else classes.delete(key);}},
    setAttribute(key,value){this.attrs[key]=value;}};}
  const nodes=Object.fromEntries(['draft-summary','summary-content','summary-pin','summary-toggle','summary-lock-shackle'].map(id=>[id,node()]));
  const panel=nodes['draft-summary'],layout=node(),listeners=new Map();
  const window={innerWidth:width,innerHeight:height,addEventListener:(key,fn)=>listeners.set(key,fn)};
  panel.getBoundingClientRect=()=>{
    const collapsed=panel.classList.contains('is-collapsed');
    const width=collapsed?0:Math.min(250,window.innerWidth-24),height=Math.min(collapsed?64:112,parseFloat(panel.style.maxHeight)||Infinity);
    const left=Number.isFinite(parseFloat(panel.style.left))?parseFloat(panel.style.left):window.innerWidth-width-28;
    const top=Number.isFinite(parseFloat(panel.style.top))?parseFloat(panel.style.top):112;
    return{left,top,width,height,bottom:top+height,right:left+width};
  };
  panel.setPointerCapture=id=>panel.pointer=id;panel.hasPointerCapture=id=>panel.pointer===id;panel.releasePointerCapture=()=>{panel.pointer=null;};
  const ctx={window,setTimeout:()=>1,clearTimeout(){},document:{getElementById:id=>nodes[id],querySelector:selector=>selector==='.app-layout'?layout:selector==='.topbar'?{getBoundingClientRect:()=>({bottom:80})}:null},
    localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return saved.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');saved.set(key,value);}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const pointer=(type,x,y,{id=1,buttonTarget=false,touch=false}={})=>panel['onpointer'+type]({button:0,pointerId:id,clientX:x,clientY:y,pointerType:touch?'touch':'mouse',target:{closest:()=>buttonTarget?{}:null},preventDefault(){}});
  return{nodes,panel,layout,window,listeners,saved,pointer};
}

test('mobile defaults to a thin right edge tab and expands without text controls',()=>{
  const mobile=setup({width:360,height:640});
  assert.equal(mobile.nodes['summary-content'].hidden,true);assert.equal(mobile.panel.style.left,'360px');
  assert.equal(mobile.nodes['summary-toggle'].textContent,'‹');assert.equal(mobile.nodes['summary-toggle'].attrs['aria-expanded'],'false');
  mobile.nodes['summary-toggle'].onclick();assert.equal(mobile.nodes['summary-content'].hidden,false);
  assert.equal(mobile.nodes['summary-toggle'].textContent,'›');
  const box=mobile.panel.getBoundingClientRect();assert.ok(box.right<=348);
  const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
  assert.ok(!html.includes('summary-toolbar'));assert.ok(!html.includes('summary-drag'));
  assert.ok(html.includes('id="summary-lock-shackle"'));
});

test('dragging any non-button panel area changes side and collapse docks to that screen edge',()=>{
  const w=setup();w.pointer('down',100,100);w.pointer('move',-10000,-10000);w.pointer('up',-10000,-10000);
  assert.equal(w.panel.style.left,'12px');assert.equal(w.panel.style.top,'88px');
  assert.equal(w.panel.classList.contains('dock-left'),true);assert.equal(w.nodes['summary-toggle'].textContent,'‹');
  w.nodes['summary-toggle'].onclick();assert.equal(w.panel.style.left,'0px');assert.equal(w.nodes['summary-toggle'].textContent,'›');
  w.nodes['summary-toggle'].onclick();assert.equal(w.panel.style.left,'12px');
  w.pointer('down',0,0);w.pointer('move',10000,10000);w.pointer('up',10000,10000);
  assert.equal(w.panel.classList.contains('dock-right'),true);assert.ok(w.panel.getBoundingClientRect().right<=1188);
  w.nodes['summary-toggle'].onclick();assert.equal(w.panel.style.left,'1200px');assert.equal(w.nodes['summary-toggle'].textContent,'‹');
});

test('lock prevents whole-panel dragging and buttons never begin a drag',()=>{
  const w=setup();let before=JSON.stringify(w.panel.style);
  w.pointer('down',0,0,{buttonTarget:true});w.pointer('move',-200,-200);w.pointer('up',-200,-200);
  assert.equal(JSON.stringify(w.panel.style),before);
  w.nodes['summary-pin'].onclick();assert.equal(w.nodes['summary-pin'].attrs['aria-pressed'],'true');
  before=JSON.stringify(w.panel.style);w.pointer('down',0,0);w.pointer('move',-200,-200);w.pointer('up',-200,-200);
  assert.equal(JSON.stringify(w.panel.style),before);assert.equal(w.nodes['summary-pin'].textContent,'');
  const restored=setup({saved:w.saved});assert.equal(restored.nodes['summary-pin'].attrs['aria-pressed'],'true');
  w.nodes['summary-toggle'].onclick();assert.equal(w.nodes['summary-content'].hidden,true);
});

test('touch reveals lock, positions remain reachable on resize, and desktop/mobile preferences stay separate',()=>{
  const w=setup();w.pointer('down',0,0,{touch:true});assert.equal(w.panel.classList.contains('show-controls'),true);w.pointer('up',0,0);
  w.panel.onkeydown({target:w.panel,key:'ArrowLeft',shiftKey:true,preventDefault(){}});
  const desktopX=w.panel.style.left;w.window.innerWidth=400;w.window.innerHeight=400;w.listeners.get('resize')();
  assert.equal(w.nodes['summary-content'].hidden,true);assert.equal(w.panel.style.left,'400px');
  assert.ok(w.panel.getBoundingClientRect().bottom<=392);
  w.window.innerWidth=1200;w.window.innerHeight=800;w.listeners.get('resize')();
  assert.equal(w.nodes['summary-content'].hidden,false);assert.equal(w.panel.style.left,desktopX);
});

test('malformed preferences and blocked storage do not disable the controls',()=>{
  const w=setup({saved:new Map([['gamecoach-draft-panel:v1:wide','not json']])});assert.equal(w.nodes['summary-content'].hidden,false);
  const blocked=setup({blocked:true});blocked.nodes['summary-toggle'].onclick();blocked.nodes['summary-pin'].onclick();
  assert.equal(blocked.nodes['summary-content'].hidden,true);assert.equal(blocked.nodes['summary-pin'].attrs['aria-pressed'],'true');
});
