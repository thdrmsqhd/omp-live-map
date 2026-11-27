/* Composer state and explicit, session-local dispatch. Text drafts persist; attachments remain in memory. */
const promptKey=id=>"omp-map-draft-v1:"+id;
function loadPromptDraft(id){const v=readJSON(promptKey(id),"");return typeof v==="string"?v:"";}
function persistPromptDraft(id,st){try{if(st.draft)writeJSON(promptKey(id),st.draft);else localStorage.removeItem(promptKey(id));st.storageError=false;}catch{st.storageError=true;}}
function promptHistory(id){const v=readJSON("omp-map-prompt-history:"+id,[]);return Array.isArray(v)?v.filter(x=>typeof x==="string").slice(0,30):[];}
function rememberPrompt(id,text){if(!text)return;try{writeJSON("omp-map-prompt-history:"+id,[text,...promptHistory(id).filter(x=>x!==text)].slice(0,30));}catch{}}
function promptTemplates(){const v=readJSON("omp-map-prompt-templates",[]);return Array.isArray(v)?v.filter(x=>typeof x?.name==="string"&&typeof x?.text==="string"):[];}
function savePromptTemplates(v){try{writeJSON("omp-map-prompt-templates",v.slice(0,50));return true;}catch{return false;}}
function promptConnected(){return navigator.onLine!==false&&$("conn").hidden;}
function promptBusy(id){const s=chatState(id);return !!(s.busy||s.sending||actItems(id).running);}
function promptQueue(id){return chatState(id).queue||(chatState(id).queue=[]);}
function promptCanSend(id){const s=chatState(id);return promptConnected()&&!askPending(id)&&!s.sending&&!s.compacting&&!s.clearing&&!!(s.draft.trim()||s.files.length)&&!attachProblem(s.files);}
function submitPrompt(id){
  const s=chatState(id),n=nodeById(id);
  if(!n||dockReadOnly(id)||!promptCanSend(id))return;
  if(s.sendMode==="queue"||(promptBusy(id)&&capsOf(n).id==="claude")){
    if(capsOf(n).id==="claude"){void enqueueClaudePrompt(id);return;}
    const q=promptQueue(id);if(q.length>=20){s.error="예약 지시는 최대 20개입니다";viewUpdates.chat?.(id);return;}
    q.push({id:crypto.randomUUID(),text:s.draft,files:s.files});s.draft="";s.files=[];persistPromptDraft(id,s);viewUpdates.chat?.(id);
    // Idle sessions may dispatch only after an explicit queue request.
    if(!promptBusy(id))void drainPromptQueue(id);
    return;
  }
  void sendChat(id);
}
async function drainPromptQueue(id,explicit=false){
  const s=chatState(id),q=promptQueue(id),n=nodeById(id);
  if(!n||!q.length||s.queueRunning||s.queuePaused||!promptConnected()||askPending(id)||s.sending||s.busy||actItems(id).running||s.compacting||s.clearing)return;
  const entry=q[0];s.queueRunning=true;
  // Never replace a user's unsent draft or current attachment list.
  const draft=s.draft,files=s.files;
  try{
    const result=await sendChat(id,{text:entry.text,files:entry.files,queued:true});
    if(result===true)q.shift();else s.queuePaused=true;
  }finally{s.queueRunning=false;persistPromptDraft(id,s);viewUpdates.chat?.(id);}
}
function queuePromptDone(id,success){const s=chatState(id);if(!success){s.queuePaused=true;viewUpdates.chat?.(id);return;}if(promptQueue(id).length)setTimeout(()=>void drainPromptQueue(id),400);}
function promptQueueChange(id,index,action){
  const s=chatState(id),q=promptQueue(id);if(s.queueRunning||!q[index])return;
  if(action==="delete"){if(!confirm("예약 지시를 삭제할까요?"))return;clearAttachments(q[index].files);q.splice(index,1);}
  if(action==="up"&&index>0)[q[index-1],q[index]]=[q[index],q[index-1]];
  if(action==="down"&&index<q.length-1)[q[index+1],q[index]]=[q[index],q[index+1]];
  if(action==="edit"){const value=prompt("예약 지시 수정",q[index].text);if(value!==null&&(value.trim()||q[index].files.length))q[index].text=value;}
  viewUpdates.chat?.(id);
}
