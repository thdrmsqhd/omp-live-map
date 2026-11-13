/* omp-live-map · view · db 블록 (SQLite·MySQL·MariaDB·Oracle 조회) */

const DB_ROW_SHOWN = 500;
const DB_REASON = {
  "missing-cli": "실행 파일 없음", auth: "인증 실패", connect: "연결 실패",
  profile: "접속 정보 부족", input: "입력 오류", network: "통신 실패", query: "쿼리 오류",
};

const dbInput = (label, cls, value, ph, type) => `<label class="dbf"><span>${esc(label)}</span>
    <input class="${cls}"${type ? ` type="${type}"` : ""} autocomplete="off" spellcheck="false"
      placeholder="${esc(ph)}" value="${esc(value)}"></label>`;

function dbProfileOptions(st) {
  if (!st.profiles.length) return '<option value="-1">저장된 프로필 없음</option>';
  return st.profiles.map((p, i) =>
    `<option value="${i}"${i === st.sel ? " selected" : ""}>${esc(p.name || "프로필 " + (i + 1))}</option>`).join("");
}

function dbResultHTML(res) {
  if (!res) return '<div class="dbn">접속 정보와 SQL 을 넣고 실행하세요 · Ctrl+Enter</div>';
  if (!res.ok) {
    const why = DB_REASON[res.reason] || "오류";
    return `<div class="dbmsg x"><b>${esc(why)}</b>${res.hint ? esc(" · " + res.hint) : ""}
      <div class="dbraw">${esc(res.error || "")}</div></div>`;
  }
  const cols = res.columns || [];
  const rows = res.rows || [];
  const meta = res.changes !== null && res.changes !== undefined
    ? `변경 ${res.changes}행`
    : `${res.total ?? rows.length}행${res.truncated ? ` · ${DB_ROW_SHOWN}행까지만 표시` : ""}`;
  const html = `<div class="dbmsg">${esc(meta)} · ${esc(res.ms ?? 0)}ms</div>`;
  if (!rows.length) return cols.length ? html + '<div class="dbn">결과 없음</div>' : html;
  const th = cols.map((c) => `<th title="${esc(c)}">${esc(c)}</th>`).join("");
  const tr = rows.map((r) => "<tr>" + r.map((v) => (v === null
    ? '<td class="nul">NULL</td>' : `<td title="${esc(v)}">${esc(v)}</td>`)).join("") + "</tr>").join("");
  return `${html}<div class="dbwrap"><table class="dbtab"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function dbHistHTML(st) {
  if (!st.hist.length) return "";
  return '<span class="dbhl">최근</span>' + st.hist.map((q, i) =>
    `<button class="dbh" data-dbh="${i}" title="${esc(q)}">${esc(q.replace(/\s+/g, " ").slice(0, 36))}</button>`).join("");
}

function dbBlock(n) {
  const st = dbState(n.id);
  const f = st.form;
  const opts = DB_TYPES.map((t) => `<option value="${t}"${t === f.type ? " selected" : ""}>${t}</option>`).join("");
  return `<div class="db">
    <div class="dbtop">
      <select class="dbtype" title="DB 유형">${opts}</select>
      <select class="dbsel" title="저장된 연결 프로필">${dbProfileOptions(st)}</select>
      <button data-dbsave="1" title="현재 접속 정보를 프로필로 저장(비밀번호 제외)">프로필 저장</button>
      <button data-dbrun="1" class="dbrun" title="실행 (Ctrl+Enter)">실행</button>
    </div>
    <div class="dbnet"${f.type === "sqlite" ? " hidden" : ""}>
      ${dbInput("host", "dh", f.host, "127.0.0.1")}
      ${dbInput("port", "dp", f.port, DB_PORTS[f.type] || "")}
      ${dbInput("db / service", "dd", f.database, DB_DBNAME[f.type] || "")}
      ${dbInput("user", "du", f.user, "user")}
      ${dbInput("password", "dpw", "", "저장하지 않음", "password")}
    </div>
    <div class="dbpath"${f.type !== "sqlite" ? " hidden" : ""}>
      ${dbInput("path", "dfile", f.path, "C:\\path\\app.db")}
    </div>
    <textarea class="dsql" spellcheck="false" placeholder="SELECT * FROM table LIMIT 20;  (Ctrl+Enter 실행)">${esc(st.sql)}</textarea>
    <div class="dres">${dbResultHTML(st.res)}</div>
    <div class="dhist">${dbHistHTML(st)}</div>
  </div>`;
}

// 폼 입력을 상태에 반영한다. paint 는 포커스가 없는 칸만 값을 덮어쓴다.
function mountDb(box, n) {
  const id = n.id;
  const st = dbState(id);
  const form = st.form;
  const bind = (sel, key) => {
    const el = box.querySelector(sel);
    el.addEventListener("input", () => { form[key] = el.value; });
  };
  bind(".dh", "host"); bind(".dp", "port"); bind(".dd", "database");
  bind(".du", "user"); bind(".dfile", "path");
  const pw = box.querySelector(".dpw");
  pw.value = st.password || "";
  pw.addEventListener("input", () => { st.password = pw.value; });
  box.querySelector(".dbtype").addEventListener("change", (e) => dbSetType(id, e.target.value));
  box.querySelector(".dbsel").addEventListener("change", (e) => dbSelect(id, Number(e.target.value)));
  box.querySelector("[data-dbsave]").addEventListener("click", () => dbSaveProfile(id));
  box.querySelector("[data-dbrun]").addEventListener("click", () => runDb(id));
  const sql = box.querySelector(".dsql");
  sql.value = st.sql || "";
  sql.addEventListener("input", () => { st.sql = sql.value; });
  sql.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runDb(id); }
  });
  box.querySelector(".dhist").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dbh]");
    if (b) dbUseHistory(id, Number(b.dataset.dbh));
  });
  paintDb(id);
}

function paintDb(id) {
  const card = ELS.get(id);
  const st = DBUI.get(id);
  const box = card && card.querySelector('.blk[data-blk="db"]');
  if (!box || !st) return;
  const f = st.form;
  const put = (sel, v) => {
    const el = box.querySelector(sel);
    if (el && el.value !== v && el !== document.activeElement) el.value = v;
  };
  put(".dh", f.host); put(".dp", f.port); put(".dd", f.database);
  put(".du", f.user); put(".dfile", f.path);
  const type = box.querySelector(".dbtype");
  if (type.value !== f.type) type.value = f.type;
  box.querySelector(".dbnet").hidden = f.type === "sqlite";
  box.querySelector(".dbpath").hidden = f.type !== "sqlite";
  const sel = box.querySelector(".dbsel");
  const sig = st.profiles.map((p) => p.name).join("\u0001") + "|" + st.sel;
  if (sel.dataset.sig !== sig && document.activeElement !== sel) {
    sel.innerHTML = dbProfileOptions(st);
    sel.dataset.sig = sig;
  }
  box.querySelector(".dres").innerHTML = dbResultHTML(st.res);
  box.querySelector(".dhist").innerHTML = dbHistHTML(st);
  const run = box.querySelector("[data-dbrun]");
  run.disabled = !!st.busy;
  run.textContent = st.busy ? "실행 중…" : "실행";
}

registerBlock({ type: "db", slot: "main", flex: 1, render: dbBlock, mount: mountDb });
