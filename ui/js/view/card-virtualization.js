/* 활성/가시 카드만 무거운 블록을 마운트한다. 좌표와 세션 프로세스는 유지한다. */
let powerSave = readJSON("omp-map-power-save", true)!==false;
let suspendFrames = readJSON("omp-map-suspend-frames",false)===true;
const PARKED_SCROLL=new Map(), CARD_PAINT_AT=new Map();
let visibilityTimer=0;
const parkSelectors=[".cmsgs",".tout",".bgout",".ctlist",".dres",".extree"];
function cardContentVisible(id){
  const el=ELS.get(id);
  if(!el || el.dataset.virtual)return false;
  // 한 맵(map)에서는 세션을 맵 카드로만 보여 준다. 무거운 블록은 세션 전체 화면(workspace)의 그 카드에만 둔다.
  return mapMode==="workspace"&&activeCardId===id;
}
function cardInViewport(box,rect,k,x,y){
  const margin=240;
  return box.x*k+x+box.w*k>=-margin && box.y*k+y+box.h*k>=-margin &&
    box.x*k+x<=rect.width+margin && box.y*k+y<=rect.height+margin && box.w*k>=180 && box.h*k>=110;
}
function fullCardWanted(id){
  const old=ELS.get(id),b=SATS.get(id);
  if(!b)return false;
  // iframe 내 폼/실행 중 화면은 사용자가 해제를 명시적으로 허용했을 때만 제거한다.
  if(!suspendFrames && old?.querySelector("iframe.bframe.on"))return true;
  return mapMode==="workspace"&&activeCardId===id;
}
function virtualBigCard(n){
  const b=SATS.get(n.id), r=monitorResMeasured(n.res)?n.res:null;
  const style=`left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
  const name=displayName(n), state={live:"실행 중",idle:"유휴",done:"완료"}[n.status]||n.status;
  return `<div class="node big virtual-card ${esc(n.kind)} ${esc(n.status)}" data-virtual="1" data-id="${esc(n.id)}" style="${style}">
    <div class="hd"><i class="dot ${esc(n.status)}"></i><span class="nm">${esc(name)}</span><span>${esc(state)}</span>${cardWindowActions(n.id)}</div>
    <div class="virtual-stats"><span>${r?"RAM "+esc(memSize(r.mb)):"RAM 미수집"}</span><span>${r?"CPU "+esc(r.cpu)+"%":"CPU 미수집"}</span><span>토큰 ${esc(fmt(n.tokens?.total||0))}</span></div>
    <span class="virtual-hint">비활성 카드 · 세션은 계속 실행될 수 있습니다.</span><button data-card-resume="1">카드 열기</button>${resizeGrip()}</div>`;
}
function cardRenderPiece(n,force){
  const id=n.id,key="b:"+id,old=ELS.get(id),full=fullCardWanted(id),b=SATS.get(id);
  const same=old&&parseFloat(old.style.left)===b.x&&parseFloat(old.style.top)===b.y&&parseFloat(old.style.width)===b.w&&parseFloat(old.style.height)===b.h;
  if(!force&&same&&!!old.dataset.virtual===!full&&id!==activeCardId&&Date.now()-(CARD_PAINT_AT.get(id)||0)<750)
    return {key,retain:true,virtual:!full};
  CARD_PAINT_AT.set(id,Date.now());
  return full?{key,html:bigCard(n),keep:".body"}:{key,html:virtualBigCard(n),virtual:true};
}
function parkCard(el){
  const id=el.dataset.id,scroll=[];
  for(const b of el.querySelectorAll(".blk[data-bkey]")){
    for(const selector of parkSelectors){
      const x=b.querySelector(selector);
      if(x)scroll.push({key:b.dataset.bkey,selector,top:x.scrollTop,left:x.scrollLeft,bottom:x.scrollTop+x.clientHeight>=x.scrollHeight-8});
    }
    const input=b.querySelector(".bin");
    if(input)scroll.push({key:b.dataset.bkey,selector:".bin",value:input.value});
  }
  PARKED_SCROLL.set(id,scroll);
  if(typeof edSuspend==="function")edSuspend(id);
}
function restoreCardScroll(id,el){
  const records=PARKED_SCROLL.get(id);
  if(!records||!el||el.dataset.virtual)return;
  PARKED_SCROLL.delete(id);
  requestAnimationFrame(()=>{
    if(!el.isConnected)return;
    for(const r of records){
      const x=el.querySelector('.blk[data-bkey="'+CSS.escape(r.key)+'"] '+r.selector);
      if(!x)continue;
      if(r.value!==undefined)x.value=r.value;
      else{x.scrollTop=r.bottom?x.scrollHeight:r.top;x.scrollLeft=r.left;}
    }
  });
}
function clearParkedCard(id){PARKED_SCROLL.delete(id);CARD_PAINT_AT.delete(id);}
function queueCardVisibility(){
  if(!powerSave||mapMode!=="map")return;
  clearTimeout(visibilityTimer);
  visibilityTimer=setTimeout(()=>{
    if(DEFER)return;
    for(const id of openIds){const el=ELS.get(id);if(el && !!el.dataset.virtual===fullCardWanted(id)){renderMap(false,true);break;}}
  },100);
}
// 절전·비활성 브라우저 해제는 자원 서랍(view/umap-topbar.js)에서 바꾼다.
function paintPowerSave(){ if(mapMode==="workspace")renderMap(false,true); }
