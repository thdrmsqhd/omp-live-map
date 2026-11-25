/* omp-live-map · core · 가변 상태 단일 소유자 (렌더 간 유지되는 값) */

let FX = 1390;

let DATA = { sessions: [] };

// 서버가 알려 주는 환경 기본값(홈, 새 로컬 카드 기본 폴더).
let ENV = { home: "", localCwd: "" };

let INFRA = { distros: [], containers: [], projects: [], error: null };
// 진행 중인 인프라 조작: nodeId -> kind. 렌더가 다시 그려져도 버튼이 잠긴 채로 남는다.
const PENDING = new Map();

let FILTER = "live";

const openIds = new Set();

let view = { x: 40, y: 40, k: 1 };

let geo = new Map();

let NODES = [];
let RENDERED_NODES = new Map();
let GRAPH_NODES = new Map();
let GRAPH_SESSIONS = new Map();

let CLUSTERS = [];

let SATS = new Map();

// 지도에 올라간 세션 잡 카드(열린 큰 카드 아래). 렌더마다 sessionJobs()가 다시 만든다.
let JOBS = [];

// 열린 큰 카드의 절대 위치·크기. 열 때 한 번 자동 배치한 뒤 카드별로 유지한다.
const BIGPOS = new Map();

let BGS = new Map();

let MANUAL = {};

let SYS = null;

const ELS = new Map();

const TERM = new Map();

// 대화 + VS Code형 편집기를 나란히 놓아도 답답하지 않은 기본 크기.
const BIG_W = 3200, BIG_H = 1920;

const CARD_BLOCKS = new Map();   // nodeId -> {add, remove} (기본 블록 대비 차이)
const BURL = new Map();          // nodeId -> { url } (browser 블록 상태)
const TOK_SCOPE = new Map();     // nodeId -> "1h" (토큰 바 범위. 없으면 세션 누적)
const CHAT_TOOL = new Map();     // nodeId -> 툴 이름 (대화를 그 툴 사용 턴으로 거른다)
const CTX = new Map();           // nodeId -> { data, error, draft, omit, busy, msg, loading, at } (컨텍스트 블록)
const ALIAS = new Map();         // nodeId -> 사용자가 붙인 카드 이름

let LOCALS = [];

let localSeq = 1;

let renamingId = null;

// 하네스 전환 중에는 새 기록이 스냅샷에 오기 전까지 카드를 닫지 않는다.
const SWITCH_HOLD = new Set();

let HIDDEN = new Set();

let PINNED = new Set();
// 완료된 서브에이전트는 기본적으로 접어 세션 카드 공간을 비운다.
let HIDE_DONE_SUBS = true;

const AG = { W: 232, H: 138, GAPX: 40, GAPY: 12, ROWMAX: 3 };

const IF = { W: 200, H: 112, GAPX: 56, GAPY: 20, COLS: 4 };

const JOB = { W: 232, H: 56, OPENH: 190, GAPX: 16, GAPY: 10, COLS: 2, MAX: 6 };

// 블록 고정 높이 범위. 저장값을 읽을 때(persist.js)와 끌어서 조절할 때(block-controls.js) 같은 값을 쓴다.
const BLOCK_H_MIN = 80, BLOCK_H_MAX = 1080;

const HOST = { W: 196, H: 92, GAPX: 14, HEAD: 20 };

let saveT = 0;

let MM = { k: 1, ox: 0, oy: 0 };

let suppressClickUntil = 0;

let DEFER = false, pendingRender = false;

// 열 수 히스테리시스: 블록 수가 ±1 흔들려도 열 구성이 바뀌지 않게 한다.
let LAYOUT = { cols: 0, n: 0 };

const SELECTED = new Set();   // 다중 선택된 클러스터 키 (kind:key)
let HISTORY = [];             // 배치(MANUAL·BIGPOS) 스냅샷 되돌리기 스택
const HIST_MAX = 40;

let LOCRES = new Map();

const TREES = new Map();

const DBUI = new Map();          // nodeId -> { form, profiles, sel, password, sql, hist, busy, res }

let CHAT = new Map();

let BGALL = new Map();

let spaceDown = false;

let velocity = { x: 0, y: 0, t: 0, raf: 0 };
