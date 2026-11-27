"use strict";

// 세션 프로필을 정의 저장소(definition kind='profile')에 둔다. 개인·팀 범위를 쓰고,
// session-profiles.js 의 list·get·pinned·save·remove 와 같은 모양으로 답한다(맵 세션 화면·Workflow 가 그대로 쓴다).
// 지운 프로필은 행을 남기고 은퇴로 표시해 Workflow 가 고정한 (id, 버전)이 계속 풀리게 한다.
const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");

const STALE = "하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.";
const SOURCE = "session-harness";

function profileDefinitions(db, catalog) {
  const retired = (id) => Boolean(db.prepare("SELECT 1 FROM definition_retired WHERE id=?").get(id));
  // 고정 버전(pinned)은 그 버전의 이름을, 목록·편집은 지금 이름(가져오기로 붙은 접미사 포함)을 쓴다.
  const unpack = (row, current = true) => ({ ...row.payload, id: row.id, version: row.version, scope: row.scope, team: row.team,
    ...(current ? { name: row.name } : {}) });
  function record(id, version) {
    try {
      const row = catalog.versionOf(id, version);
      return row.kind === "profile" ? row : null;
    } catch { return null; }
  }
  function current(id, version) {
    const row = typeof id === "string" && Number.isSafeInteger(version) ? record(id) : null;
    if (!row || row.version !== version || retired(id)) throw new Error(STALE);
    return row;
  }
  // 카탈로그 오류(영문 problem)를 화면이 쓰던 문장으로 바꾼다.
  function korean(error) {
    if (error?.status === 409 && /name/.test(error.message)) return new Error("같은 이름의 프로필이 이미 있습니다.");
    if (error?.status === 409) return new Error(STALE);
    if (error?.status === 404 && /Team/.test(error.message)) return new Error("팀을 찾을 수 없습니다.");
    return error instanceof Error ? new Error(error.message) : error;
  }
  return {
    list() {
      return db.prepare(`SELECT id FROM definition WHERE kind='profile'
        AND id NOT IN (SELECT id FROM definition_retired)`).all()
        .map(({ id }) => unpack(catalog.versionOf(id)))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    },
    get: (id, version) => unpack(current(id, version)),
    pinned(id, version) {
      const row = typeof id === "string" && Number.isSafeInteger(version) ? record(id, version) : null;
      return row ? unpack(row, false) : undefined;
    },
    save(input) {
      const previous = input?.id ? current(input.id, input.version) : null;
      const scope = previous?.scope ?? (input?.scope === "team" ? "team" : "personal");
      const team = previous?.team ?? (scope === "team" ? input.team : null);
      const { id, version, scope: _scope, team: _team, ...payload } = input ?? {};
      try {
        return unpack(catalog.saveDefinition({ kind: "profile", scope, team,
          ...(previous ? { id: previous.id, version: previous.version } : {}), payload }));
      } catch (error) { throw korean(error); }
    },
    remove(id, version) {
      transaction(db, () => {
        const row = current(id, version);
        // 같은 이름으로 새 프로필을 만들 수 있게 목록용 이름만 비켜 둔다. 버전별 페이로드는 그대로다.
        db.prepare("UPDATE definition SET name=? WHERE id=?").run(`${row.name} · 삭제됨 ${row.id.slice(0, 8)}`, row.id);
        db.prepare("INSERT INTO definition_retired VALUES (?,?)").run(row.id, Date.now());
        event(db, "definition.retired", { id: row.id, version: row.version, kind: "profile" });
      });
    },
  };
}

// session-harness.sqlite 의 profiles·profile_history 를 개인 범위 정의로 한 번 옮긴다.
// id·버전 번호를 그대로 두어 Workflow 의 (profileId, profileVersion) 참조가 이어진다. 원본 파일은 건드리지 않는다.
function importLegacyProfiles(db, rows) {
  if (!rows || db.prepare("SELECT 1 FROM profile_import WHERE source=?").get(SOURCE)) return 0;
  return transaction(db, () => {
    const versions = new Map();
    const add = ({ id, version, payload }) => {
      if (!versions.has(id)) versions.set(id, new Map());
      versions.get(id).set(version, payload);
    };
    rows.history.forEach(add);
    rows.current.forEach(add);
    const live = new Set(rows.current.map(({ id }) => id));
    const taken = new Set(db.prepare("SELECT name FROM definition WHERE kind='profile' AND scope='personal'").all().map(({ name }) => name));
    let count = 0;
    for (const [id, history] of versions) {
      if (db.prepare("SELECT 1 FROM definition WHERE id=?").get(id)) continue;
      const ordered = [...history.keys()].sort((a, b) => a - b);
      const latest = ordered.at(-1);
      const base = String(JSON.parse(history.get(latest)).name || "프로필").slice(0, 200);
      let name = live.has(id) ? base : `${base} · 삭제됨 ${id.slice(0, 8)}`;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
      taken.add(name);
      db.prepare("INSERT INTO definition(id,scope,project,team,kind,name,version) VALUES (?,?,?,?,?,?,?)")
        .run(id, "personal", null, null, "profile", name, latest);
      const insert = db.prepare("INSERT INTO definition_version VALUES (?,?,?)");
      for (const version of ordered) insert.run(id, version, history.get(version));
      if (!live.has(id)) db.prepare("INSERT INTO definition_retired VALUES (?,?)").run(id, Date.now());
      count++;
    }
    db.prepare("INSERT INTO profile_import VALUES (?,?,?)").run(SOURCE, Date.now(), count);
    event(db, "profiles.imported", { source: SOURCE, profiles: count });
    return count;
  });
}

module.exports = { profileDefinitions, importLegacyProfiles };
