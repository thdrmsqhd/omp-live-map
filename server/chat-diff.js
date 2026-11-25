"use strict";
const path=require("node:path"),fs=require("node:fs"),{execFile}=require("node:child_process");
function within(root,file){const r=path.relative(root,file);return r!==""&&!r.startsWith(".."+path.sep)&&r!==".."&&!path.isAbsolute(r);}
async function diff(root,requested){try{const cwd=await fs.promises.realpath(root),file=path.resolve(cwd,requested);if(!within(cwd,file))return {ok:false,out:"작업 폴더 외부 경로"};try{if(!within(cwd,await fs.promises.realpath(file)))return {ok:false,out:"작업 폴더 외부 링크"};}catch(e){if(e.code!=="ENOENT")throw e;}return await new Promise(resolve=>execFile("git",["--no-pager","diff","--no-ext-diff","--no-textconv","HEAD","--",path.relative(cwd,file)],{cwd,timeout:5000,maxBuffer:512*1024,windowsHide:true},(e,stdout)=>resolve(e?{ok:false,out:"Git Diff 조회 실패: "+e.message.slice(0,200)}:{ok:true,out:stdout||"(변경 내역 없음 또는 추적되지 않은 파일)"})));}catch(e){return {ok:false,out:e.message};}}
module.exports={diff,within};
