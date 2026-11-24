/* Shift+헤더 클릭: 다중 선택. 저장 프리셋은 좌표만 복원하며 프로세스/파일에는 영향 없음. */
const GROUP_CARDS=new Set();
function paintGroupCards(){for(const el of $("nodes").querySelectorAll(".node.big"))el.classList.toggle("group-selected",GROUP_CARDS.has(el.dataset.id));}
function presetPositions(items,mode){
  const cols=mode==="horizontal"?Math.max(1,items.length):mode==="vertical"?1:Math.ceil(Math.sqrt(items.length));
  const w=Math.max(0,...items.map(x=>x.w)),h=Math.max(0,...items.map(x=>x.h));
  const x=Math.min(...items.map(x=>x.x)),y=Math.min(...items.map(x=>x.y));
  return items.map((b,i)=>({...b,x:x+(i%cols)*(w+40),y:y+Math.floor(i/cols)*(h+40)}));
}
function applyLayoutPreset(mode){
  const ids=(GROUP_CARDS.size?[...GROUP_CARDS]:[...openIds]).filter(id=>SATS.has(id)&&(!SUBDOCK.has(id)||DOCK_FREE.has(id)));
  if(!ids.length)return;
  pushHistory(layoutSnapshot({big:ids}));
  const boxes=presetPositions(ids.map(id=>SATS.get(id)),mode);
  ids.forEach((id,i)=>BIGPOS.set(id,boxes[i]));
  saveOpenCards();renderMap(false,true);fit();
}
$("layout-apply").onclick=()=>applyLayoutPreset($("layout-preset").value);
$("layout-save").onclick=()=>{writeJSON("omp-map-layout-preset-v4",Object.fromEntries([...BIGPOS].filter(([id])=>openIds.has(id))));};
$("layout-restore").onclick=()=>{
  const saved=readJSON("omp-map-layout-preset-v4",{}), ids=Object.keys(saved).filter(id=>openIds.has(id)&&["x","y","w","h"].every(k=>Number.isFinite(saved[id]?.[k]))&&saved[id].w>0&&saved[id].h>0);
  if(!ids.length)return;
  pushHistory(layoutSnapshot({big:ids}));
  for(const id of ids)BIGPOS.set(id,saved[id]);saveOpenCards();renderMap(false,true);fit();
};
$("layout-undo").onclick=undoLayout;
$("layout-redo").onclick=redoLayout;
