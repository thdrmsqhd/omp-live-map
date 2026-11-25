"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
function inspect(cwd){
 const root=path.resolve(cwd),home=os.homedir(),sources=[];
 function file(p,type){try{const st=fs.statSync(p);if(st.isFile())sources.push({path:p,type,bytes:st.size});}catch{}}
 function dir(p,type){try{for(const e of fs.readdirSync(p,{withFileTypes:true}).slice(0,100)){if(e.isFile()&&e.name.endsWith(".md"))file(path.join(p,e.name),type);if(e.isDirectory())file(path.join(p,e.name,"SKILL.md"),type);}}catch{}}
 for(const base of [home,root]){file(path.join(base,"CLAUDE.md"),"memory");file(path.join(base,".claude","CLAUDE.md"),"memory");file(path.join(base,".claude","settings.json"),"settings/hooks");file(path.join(base,".claude","settings.local.json"),"local settings");file(path.join(base,".mcp.json"),"MCP configuration");dir(path.join(base,".claude","skills"),"skill");dir(path.join(base,".claude","agents"),"subagent");dir(path.join(base,".claude","commands"),"command");}
 let parent=path.dirname(root);while(parent!==root&&parent!==home){file(path.join(parent,"CLAUDE.md"),"ancestor memory");const next=path.dirname(parent);if(next===parent)break;parent=next;}
 return sources;
}
module.exports={inspect};
