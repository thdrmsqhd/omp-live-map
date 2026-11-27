/* omp-live-map · viewmodel · DB 연결 프로필(sqlite·mysql·mariadb·oracle)과 쿼리 실행 */

const DB_TYPES = ["sqlite", "mysql", "mariadb", "oracle"];
const DB_PORTS = { sqlite: "", mysql: "3306", mariadb: "3306", oracle: "1521" };
const DB_DBNAME = { oracle: "ORCLPDB1", mysql: "mysql", mariadb: "mysql", sqlite: "" };
const DB_HIST_MAX = 8;

// 프로필에 저장해도 되는 필드. password 는 여기 없으므로 저장 경로가 아예 없다.
const DB_KEYS = ["name", "type", "host", "port", "database", "user", "path"];
const dbProfile = (f) => Object.fromEntries(DB_KEYS.map((k) => [k, String(f[k] || "")]));

const dbBlank = (type) => ({
  name: "", type, host: "127.0.0.1", port: DB_PORTS[type] || "",
  database: type === "sqlite" ? "" : DB_DBNAME[type] || "", user: "", path: "",
});

function dbState(id) {
  let st = DBUI.get(id);
  if (st) return st;
  const saved = DBPROF.get(id) || [];
  st = {
    form: saved.length ? dbProfile(saved[0]) : dbBlank("sqlite"),
    profiles: saved.slice(),
    sel: saved.length ? 0 : -1,
    password: "", sql: "", hist: [], busy: false, res: null,
  };
  DBUI.set(id, st);
  return st;
}

// 저장된 프로필을 폼으로 불러온다. 비밀번호는 메모리에만 있으므로 비운다.
function dbSelect(id, i) {
  const st = dbState(id);
  const p = st.profiles[i];
  if (!p) return;
  st.sel = i;
  st.form = dbProfile(p);
  st.password = "";
  const card = ELS.get(id);
  const pw = card && card.querySelector('.blk[data-blk="db"] .dpw');
  if (pw) pw.value = "";
  viewUpdates.db?.(id);
}

function dbSaveProfile(id) {
  const st = dbState(id);
  const entry = dbProfile(st.form);
  const f = st.form;
  entry.name = entry.name || `${f.type} · ${f.user || f.host || f.path || "기본"}`;
  st.form.name = entry.name;
  const i = st.profiles.findIndex((p) => p.name === entry.name);
  if (i >= 0) st.profiles[i] = entry;
  else st.profiles.push(entry);
  st.sel = st.profiles.findIndex((p) => p.name === entry.name);
  saveDbProfiles(id, st.profiles);
  viewUpdates.db?.(id);
}

function dbSetType(id, type) {
  const st = dbState(id);
  const old = st.form.type;
  st.form.type = DB_TYPES.includes(type) ? type : "sqlite";
  // 포트가 이전 유형의 기본값이면 새 유형의 기본값으로 바꿔 준다(직접 넣은 값은 지킨다).
  if (!st.form.port || st.form.port === DB_PORTS[old]) st.form.port = DB_PORTS[st.form.type] || "";
  if (st.form.type !== "sqlite" && !st.form.database) st.form.database = DB_DBNAME[st.form.type] || "";
  viewUpdates.db?.(id);
}

const dbHistPush = (st, sql) => {
  st.hist = [sql, ...st.hist.filter((q) => q !== sql)].slice(0, DB_HIST_MAX);
};

async function runDb(id) {
  const st = dbState(id);
  if (st.busy) return;
  const sql = String(st.sql || "").trim();
  if (!sql) {
    st.res = { ok: false, reason: "input", error: "SQL 이 비었습니다" };
    return viewUpdates.db?.(id);
  }
  st.busy = true;
  viewUpdates.db?.(id);
  try {
    const res = await postJSON("/api/db/query", { ...dbProfile(st.form), password: st.password, sql });
    st.res = await res.json();
    if (st.res.ok) dbHistPush(st, sql);
  } catch (e) {
    st.res = { ok: false, reason: "network", error: "요청 실패: " + e.message };
  }
  st.busy = false;
  viewUpdates.db?.(id);
}

function dbUseHistory(id, i) {
  const st = dbState(id);
  const q = st.hist[i];
  if (q === undefined) return;
  st.sql = q;
  const card = ELS.get(id);
  const box = card && card.querySelector('.blk[data-blk="db"] textarea');
  if (box) { box.value = q; box.focus(); }
}
