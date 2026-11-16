/* omp-live-map · viewmodel · 프롬프트 첨부(붙여넣기·끌어 놓기한 이미지·파일) 목록 */

const ATTACH_MAX = 20 * 1024 * 1024; // 파일당
const ATTACH_TOTAL = 60 * 1024 * 1024; // 한 번에 보내는 합계(서버 본문 상한 100MB 안쪽)
// 대화 말풍선에 그릴 수 있는 이미지. 서버 uploads.js 의 INLINE_MIME 과 같다.
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
let attachSeq = 0;

const readBase64 = (file) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
  r.onerror = () => no(r.error);
  r.readAsDataURL(file);
});

// 파일들을 목록에 넣는다. 읽는 동안 reading 칩을 먼저 보이고, 다 읽으면 다시 그린다(onChange).
// 상한을 넘거나 빈 파일은 읽지 않고 err 만 남긴다: 칩에 표시하고 전송을 막는다.
async function addAttachments(list, files, onChange) {
  const items = [...files].map((file) => {
    const it = { id: ++attachSeq, name: file.name || "file", mime: file.type || "application/octet-stream", size: file.size,
      data: "", url: "", err: file.size > ATTACH_MAX ? "20MB 초과" : !file.size ? "빈 파일" : "", reading: false, file };
    if (!it.err) it.reading = true;
    if (!it.err && /^image\//.test(it.mime)) it.url = URL.createObjectURL(file);
    list.push(it);
    return it;
  });
  onChange();
  await Promise.all(items.filter((it) => it.reading).map(async (it) => {
    try { it.data = await readBase64(it.file); } catch { it.err = "읽기 실패"; }
    it.reading = false;
  }));
  for (const it of items) delete it.file;
  onChange();
}

function removeAttachment(list, id) {
  const i = list.findIndex((it) => it.id === id);
  if (i < 0) return;
  const [it] = list.splice(i, 1);
  if (it.url) URL.revokeObjectURL(it.url);
}

// keep 에 든 objectURL 은 대화 말풍선이 아직 그리는 중일 수 있으므로 해제하지 않는다.
function clearAttachments(list, keep) {
  for (const it of list) if (it.url && !(keep && keep.has(it.url))) URL.revokeObjectURL(it.url);
  list.length = 0;
}

// 대화 말풍선용 이미지: 다 읽었고 오류가 없는 이미지 첨부만 {mime, data(base64)} 로.
const attachImages = (list) => list
  .filter((it) => !it.err && !it.reading && IMAGE_MIMES.has(it.mime) && it.data)
  .map((it) => ({ mime: it.mime, data: it.data }));

// 보내면 안 되는 이유. 없으면 "".
function attachProblem(list) {
  const bad = list.find((it) => it.err);
  if (bad) return `첨부 오류(${bad.name}: ${bad.err}) · 칩의 ×로 빼고 보내세요`;
  if (list.some((it) => it.reading)) return "첨부를 아직 읽는 중입니다";
  if (list.reduce((n, it) => n + it.size, 0) > ATTACH_TOTAL) return "첨부 합계가 60MB를 넘습니다";
  return "";
}

const attachPayload = (list) => list.map((it) => ({ name: it.name, mimeType: it.mime, data: it.data }));
