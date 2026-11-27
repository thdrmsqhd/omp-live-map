/* Shift+헤더 클릭: 다중 선택(세션 전체 화면의 큰 카드). 예전 맵의 배치 프리셋 버튼은 한 맵으로 바뀌며 없앴고 좌표 계산만 남긴다. */
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
