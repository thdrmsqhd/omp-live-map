"use strict";
function makeDelta(previous,data){const old=new Map((previous?.sessions||[]).map(s=>[s.key,JSON.stringify(s)]));const next=new Set(data.sessions.map(s=>s.key));const {sessions,...meta}=data;return {meta,upsert:sessions.filter(s=>old.get(s.key)!==JSON.stringify(s)),remove:[...old.keys()].filter(k=>!next.has(k)),order:sessions.map(s=>s.key)};}
function applyDelta(previous,d){const map=new Map((previous?.sessions||[]).map(s=>[s.key,s]));for(const k of d.remove)map.delete(k);for(const s of d.upsert)map.set(s.key,s);return {...d.meta,sessions:d.order.map(k=>map.get(k)).filter(Boolean)};}
module.exports={makeDelta,applyDelta};
