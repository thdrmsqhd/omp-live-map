"use strict";
const os=require("node:os"),{monitorEventLoopDelay,performance}=require("node:perf_hooks");
const delay=monitorEventLoopDelay({resolution:20});delay.enable();
let last=performance.eventLoopUtilization(),lastAt=Date.now(),cpu=process.cpuUsage(),samples=[];
function policy(free=os.freemem(),total=os.totalmem()){const ratio=free/Math.max(1,total);const level=ratio<.1||free<512*1024*1024?3:ratio<.2||free<1024*1024*1024?2:ratio<.3?1:0;return {level,free,total,ratio,idleMs:[60000,15000,0,0][level],pollMs:[4000,8000,15000,30000][level],admit:level<2};}
function sample(){const now=Date.now(),elapsed=Math.max(1,now-lastAt),next=process.cpuUsage(),u=performance.eventLoopUtilization(last),m=process.memoryUsage();const value={at:now,pid:process.pid,memory:m,cpuPct:((next.user-cpu.user+next.system-cpu.system)/1000/elapsed)*100,loopP95Ms:delay.percentile(95)/1e6,loopUtilization:u.utilization,host:policy()};lastAt=now;cpu=next;last=performance.eventLoopUtilization();delay.reset();samples.push(value);if(samples.length>240)samples.shift();return value;}
const timer=setInterval(sample,5000);timer.unref();
function read(){return {current:samples.at(-1)||sample(),samples:samples.slice()};}
module.exports={policy,sample,read};
