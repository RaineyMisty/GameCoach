const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/draft-summary.js'),'utf8');
function setup({width=1200,height=800,saved=new Map(),blocked=false}={}){
  function node(){const classes=new Set();return{style:{},hidden:false,textContent:'',attrs:{},
    classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key),toggle(key,on){if(on)classes.add(key);else classes.delete(key);}},
    setAttribute(key,value){this.attrs[key]=value;}};}
  const nodes=Object.fromEntries(['draft-summary','summary-content','summary-drag','summary-pin','summary-toggle'].map(id=>[id,node()]));
  const panel=nodes['draft-summary'],handle=nodes['summary-drag'],layout=node(),listeners=new Map();
  const window={innerWidth:width,innerHeight:height,addEventListener:(key,fn)=>listeners.set(key,fn)};
  panel.getBoundingClientRect=()=>{
    const collapsed=panel.classList.contains('is-collapsed');
    const width=Math.min(collapsed?224:260,window.innerWidth-16);
    const height=Math.min(collapsed?48:168,parseFloat(panel.style.maxHeight)||Infinity);
    const left=Number.isFinite(parseFloat(panel.style.left))?parseFloat(panel.style.left):window.innerWidth-width-28;
    const top=Number.isFinite(parseFloat(panel.style.top))?parseFloat(panel.style.top):112;
    return{left,top,width,height,bottom:top+height,right:left+width};
  };
  handle.setPointerCapture=id=>handle.pointer=id;
  handle.hasPointerCapture=id=>handle.pointer===id;
  handle.releasePointerCapture=()=>{handle.pointer=null;};
  const ctx={window,document:{getElementById:id=>nodes[id],querySelector:selector=>selector==='.app-layout'?layout:selector==='.topbar'?{getBoundingClientRect:()=>({bottom:80})}:null},
    localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return saved.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');saved.set(key,value);}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const pointer=(type,x,y,id=1)=>handle['onpointer'+type]({button:0,pointerId:id,clientX:x,clientY:y,preventDefault(){}});
  return{nodes,panel,handle,layout,window,listeners,saved,pointer};
}

test('mobile starts collapsed, expands on demand and keeps separate preferences from desktop',()=>{
  const saved=new Map(),mobile=setup({width:360,height:640,saved});
  assert.equal(mobile.nodes['summary-content'].hidden,true);
  assert.equal(mobile.nodes['summary-toggle'].attrs['aria-expanded'],'false');
  assert.equal(mobile.layout.classList.contains('summary-collapsed'),true);
  mobile.nodes['summary-toggle'].onclick();assert.equal(mobile.nodes['summary-content'].hidden,false);
  const again=setup({width:360,height:640,saved});assert.equal(again.nodes['summary-content'].hidden,false);
  const desktop=setup({saved});assert.equal(desktop.nodes['summary-content'].hidden,false);
  desktop.nodes['summary-toggle'].onclick();assert.equal(desktop.nodes['summary-content'].hidden,true);
  const mobileAgain=setup({width:360,height:640,saved});assert.equal(mobileAgain.nodes['summary-content'].hidden,false);
});

test('pointer drag stays in viewport and pin prevents movement while retaining collapse controls',()=>{
  const w=setup();w.pointer('down',100,100);w.pointer('move',-10000,-10000);w.pointer('up',-10000,-10000);
  assert.equal(w.panel.style.left,'8px');assert.equal(w.panel.style.top,'88px');
  w.pointer('down',0,0);w.pointer('move',10000,10000);w.pointer('up',10000,10000);
  const box=w.panel.getBoundingClientRect();assert.ok(box.right<=1192);assert.ok(box.bottom<=792);
  w.nodes['summary-pin'].onclick();assert.equal(w.nodes['summary-pin'].attrs['aria-pressed'],'true');
  const before=JSON.stringify(w.panel.style);w.pointer('down',0,0);w.pointer('move',-500,-500);w.pointer('up',-500,-500);
  assert.equal(JSON.stringify(w.panel.style),before);
  w.nodes['summary-toggle'].onclick();assert.equal(w.nodes['summary-content'].hidden,true);
  const restored=setup({saved:w.saved});assert.equal(restored.nodes['summary-pin'].attrs['aria-pressed'],'true');
  assert.equal(restored.nodes['summary-content'].hidden,true);
});

test('keyboard moves panel, resize clamps positions and switching to mobile collapses by default',()=>{
  const w=setup(),before=parseFloat(w.panel.style.left);
  w.handle.onkeydown({key:'ArrowLeft',shiftKey:true,preventDefault(){}});
  assert.equal(parseFloat(w.panel.style.left),before-40);
  w.window.innerWidth=400;w.window.innerHeight=400;w.listeners.get('resize')();
  assert.equal(w.nodes['summary-content'].hidden,true);
  const box=w.panel.getBoundingClientRect();assert.ok(box.left>=8);assert.ok(box.right<=392);assert.ok(box.bottom<=392);
});

test('malformed saved settings and blocked storage do not prevent panel controls',()=>{
  const saved=new Map([['gamecoach-draft-panel:v1:wide','not json']]);
  const w=setup({saved});assert.equal(w.nodes['summary-content'].hidden,false);
  const blocked=setup({blocked:true});blocked.nodes['summary-toggle'].onclick();blocked.nodes['summary-pin'].onclick();
  assert.equal(blocked.nodes['summary-content'].hidden,true);assert.equal(blocked.nodes['summary-pin'].attrs['aria-pressed'],'true');
});
