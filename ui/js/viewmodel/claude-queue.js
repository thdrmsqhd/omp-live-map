/* omp-live-map · viewmodel · Claude Code 서버 예약 지시 명령(목록·추가). 화면 갱신은 viewUpdates 로 알린다. */
async function ccPost(path,body){try{const r=await postJSON(path,body);return await r.json();}catch(e){return {ok:false,out:e.message};}}
async function refreshClaudeQueue(id){
 const s=chatState(id);if(s.ccQueueLoading)return;s.ccQueueLoading=true;
 try{const r=await ccPost("/api/claude/queue",{node:id,action:"list"});if(r.ok)s.ccQueue=r;}finally{s.ccQueueLoading=false;viewUpdates.chat?.(id);}
}
async function enqueueClaudePrompt(id){
 const s=chatState(id);if(s.sending)return;const text=s.draft,files=s.files;s.sending=true;viewUpdates.chat?.(id);
 const r=await ccPost("/api/claude/queue",{node:id,action:"enqueue",text,files:attachPayload(files)});
 s.sending=false;if(r.ok){if(s.draft===text)s.draft="";if(s.files===files){clearAttachments(files);s.files=[];}rememberPrompt(id,text);persistPromptDraft(id,s);s.ccQueue=r;}else s.error=r.out||"예약 실패";viewUpdates.chat?.(id);
}
