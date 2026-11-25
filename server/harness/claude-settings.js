"use strict";
const fs=require("node:fs"),path=require("node:path"),{execFile}=require("node:child_process");
const {ROOT}=require("../config");
const dir=process.env.OMP_MAP_STATE||path.join(ROOT,"data"),file=path.join(dir,"claude-options.json");
function load(){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return {};}}
const key=id=>process.platform==="win32"?path.normalize(id).toLowerCase():path.normalize(id);
function get(id){return load()[key(id)]||{permission:"default",effort:"default"};}
function set(id,opts){const permission=String(opts.permission||"default"),effort=String(opts.effort||"default");
 if(!["default","acceptEdits","plan","dontAsk"].includes(permission)||!["default","low","medium","high","max"].includes(effort))return {ok:false,out:"지원하지 않는 실행 옵션"};
 try{const data=load();data[key(id)]={permission,effort};fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file+".tmp",JSON.stringify(data));fs.renameSync(file+".tmp",file);return {ok:true,options:data[key(id)]};}catch(e){return {ok:false,out:e.message};}
}
function cli(args){return new Promise(resolve=>execFile("claude",args,{timeout:8000,windowsHide:true,maxBuffer:512*1024},(error,stdout)=>resolve({ok:!error,text:String(stdout||"")})));}
let memo=null,until=0;
async function status(){if(memo&&Date.now()<until)return memo;
 const version=await cli(["--version"]);if(!version.ok)return {ok:false,installed:false};
 const [help,auth]=await Promise.all([cli(["--help"]),cli(["auth","status","--json"])]);let a={};try{a=JSON.parse(auth.text);}catch{}
 memo={ok:true,installed:true,version:version.text.trim().slice(0,100),effort:help.ok&&help.text.includes("--effort"),permission:help.ok&&help.text.includes("--permission-mode"),auth:{loggedIn:typeof a.loggedIn==="boolean"?a.loggedIn:null,method:typeof a.authMethod==="string"?a.authMethod:"unknown",apiKeyPresent:!!process.env.ANTHROPIC_API_KEY}};until=Date.now()+30000;return memo;
}
module.exports={get,set,status};
