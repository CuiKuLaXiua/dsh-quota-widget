// dsh-quota-widget — Host 半端 (多提供商: Opencode + DeepSeek + R4Coder + TokenMeter) — 对齐 dsh-balance-plugin：perDay/perModel/records/live + sessionQuery + dayKeyOf 本地日
export const inject = ["webServer"];

// 官方额度端点实测：https://opencode.ai/zen/go/v1/usage（2026-08 实测可跑通）。
// baseUrl 留空时按 DEFAULT_BASES × CANDIDATES 顺序探测，因此把实测端点所在域
// 提到首位、实测路径放进 CANDIDATES 首位——空 baseUrl 也能第一击命中；
// 其余候选保留为上游路径变更时的兜底。
const OPENCODE_DEFAULT_BASES = ["https://opencode.ai", "https://api.opencode.ai"];
const OPENCODE_CANDIDATES = ["/zen/go/v1/usage","/v1/quota","/api/quota","/v1/subscription","/api/subscription","/v1/billing/quota","/api/billing"];
const DEEPSEEK_DEFAULT_BASE = "https://api.deepseek.com";
const DEEPSEEK_BALANCE_PATH = "/user/balance";
// R4Coder：自定义 host（官方 cc-switch 文档 GET {baseUrl}/v1/cli/meta）。
// 不走 ALLOWED_BASE_HOSTS——用户部署域名各不相同；仅强制 https。
const R4_META_PATH = "/v1/cli/meta";

// 库结构（v4）：meta + events（唯一事实源）+ 三张派生缓存（daily_usage / daily_tool / daily_project）。
// 抽成模块常量有两个目的：① 老库升级路径集中在一处；② 单测可以对一个 :memory: 库直接
// 套用同一份 DDL 去断言派生逻辑（见 test/host.test.mjs）。
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_usage(day TEXT NOT NULL, model TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, tools INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(day, model)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_usage(day);
  CREATE INDEX IF NOT EXISTS idx_daily_model_day ON daily_usage(model, day);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER, time INTEGER NOT NULL, day TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, raw TEXT, project TEXT, tool TEXT, ms INTEGER NOT NULL DEFAULT 0, provider TEXT, PRIMARY KEY(seq, session_id));
  CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, time DESC);
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(time DESC);
  CREATE INDEX IF NOT EXISTS idx_events_model ON events(model);
  CREATE TABLE IF NOT EXISTS daily_tool(day TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(day, tool)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_daily_tool_day ON daily_tool(day);
  CREATE TABLE IF NOT EXISTS daily_project(day TEXT NOT NULL, project TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, tools INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(day, project)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_daily_project_day ON daily_project(day);
  INSERT OR IGNORE INTO meta(k,v) VALUES('ready','0');
  INSERT OR IGNORE INTO meta(k,v) VALUES('last_scan_at','0');
  INSERT OR IGNORE INTO meta(k,v) VALUES('dims_backfill','0');
`;

// ===== C 方案：app_data_dir/token-meter.db 持久化（Node:sqlite WAL + Rust 共享）=====
let __db = null;
let __dbReady = false;
let __dbPath = null;
// 宿主 loader 提供的 home 路径服务解析出的 storages 目录（桌面版没有 DSH_HOME 环境变量）
let __homeStorages = null;
let __flushTimer = null;
let __exitHookInstalled = false;
let __logger = console;
// 维度回填模式下的逐事件收集器（见 enrichDimensions）；非空时 fs 扫描不只摄入，还额外收集
let __enrichSink = null;
// node:fs 模块句柄（ensureDb 里 import 一次），健康快照要 statSync 库文件大小
let __fsModule = null;
// 用户点过"清空用量账本"的时刻（meta.reset_at）。清空后重启时，回填必须跳过此前的历史，
// 否则"清空"会被一次重启悄悄撤销。0 = 从未清空。
let __resetAt = 0;
// v2 设计：events = 唯一事实源（幂等账本，PK(seq,session_id) + INSERT OR IGNORE）
//          daily_usage = 派生缓存（flush 时对涉及天从 events 整区重建，REPLACE 语义）
//          → 任何路径的重复摄入（hydrate→scan 重扫、插件重载、fs 兜底）都收敛为真值，不再 += 永久污染
const __eventsQueue = [];
// v3：修复 v2 rebuildPartitionsInRange 按时间范围重算分区的缺陷——同日内早先
// 批次被 DELETE 后不再补回，daily_usage 每天只剩最后一次 flush 的批次，
// 重启 hydrate 后表现为用量骤减/热力图缺块。v2→v3 迁移从 events 真值
// 全量重建 daily_usage，一次性治愈历史脏数据。
// v4：新增"工具/项目"两个维度——events 增补 project / tool / ms 三列（ALTER TABLE，无需重建），
// 并新增两张派生缓存表 daily_tool / daily_project（与 daily_usage 同节奏整分区重建）。
// 历史行由一次性的 enrichDimensions() 从会话文件回填这三列，避免新维度对老数据为空。
const SCHEMA_VERSION = "4";
// 可查询区间白名单：90d 与保留窗口 USAGE_KEEP_MS 对齐（此前 UI 只能到 all）
const RANGE_VALUES = ["1d", "7d", "30d", "90d", "all"];
// 实时速率窗口：近 RATE_WINDOW_MS 内 assistant/message 的输出 token ÷ 窗口秒数。
// 旧的 tokPerSec 是"进程启动至今、且只算 LLM 忙碌时间"的累计均值，被当成瞬时速率会误导。
const RATE_WINDOW_MS = 60 * 1000;
const RATE_SAMPLES_MAX = 600;
// 维度排行（工具/项目/provider）的返回上限
const DIM_TOP_N = 20;
// 首 token 的"步内首个产出信号"事件名。会话文件里 assistant/chunk 一定带 turn/step（实测 3763 条零缺失），
// 但实时事件流是否投递它无法先验保证——实测活跃对话下 firstTokenCount 恒为 0。
// 这里做广匹配 + 分类计数：任一事件名被投递即可测量，同时把分类计数下发，便于一眼定位事件流现状。
const SIGNAL_EVENT_TYPES = ["assistant/chunk", "text-chunks", "reasoning-chunks", "tool-call-chunks"];

function joinPath(a,b){
  if(!a) return b;
  const sep = a.includes("\\") || b.includes("\\") ? "\\" : "/";
  if(a.endsWith("/")||a.endsWith("\\")) a=a.slice(0,-1);
  if(b.startsWith("/")||b.startsWith("\\")) b=b.slice(1);
  return a+sep+b;
}
// 无 seq 事件的稳定合成键（负数区，避免与真实 seq 冲突），保证 events 账本幂等
function synthesizeSeq(ev){
  let h=5381;
  const s=String(ev.session_id)+"|"+ev.time+"|"+ev.type+"|"+ev.model+"|"+(ev.input||0)+"|"+(ev.output||0);
  for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; }
  return -((Math.abs(h)%2147483646)+1);
}
// homeOverride 仅测试注入用（生产调用不传，走模块内的 __homeStorages）
function resolveDbPath(homeOverride){
  // 单库绑定：存到 <DSH home>/storages/token-meter.db，与 DSH 自身的会话投影缓存同级。
  // home 解析两级：① DSH_HOME 环境变量（CLI / 其它壳会设）；② 宿主 loader 提供的
  // dshHomePath 服务（见 apply 里的 ctx.get("dshHomePath")，来源 @deepseek-ai/dsh-home-paths，
  // 内部同样是 `DSH_HOME || ~/.dsh`）。官方桌面版不设 DSH_HOME 环境变量，只认 env 会让插件
  // 静默降级成纯内存：每次启动全量重扫会话、首屏还可能只有半截聚合，所以必须走官方这个入口。
  // 两级都拿不到时返回 null，调用方降级为内存模式（fail-closed，不落盘）。
  if(process.env.DSH_HOME){
    try{ return joinPath(process.env.DSH_HOME, "storages/token-meter.db"); }catch(e){}
  }
  const homeStorages = homeOverride !== undefined ? homeOverride : __homeStorages;
  if(homeStorages){
    try{ return joinPath(homeStorages, "token-meter.db"); }catch(e){}
  }
  return null;
}

async function ensureDb(logger){
  if(__dbReady && __db) return __db;
  let DatabaseSync=null;
  try{
    const mod = await import("node:sqlite");
    DatabaseSync = mod.DatabaseSync || mod.default?.DatabaseSync || null;
  }catch(e){ logger?.warn?.(`[token-meter] node:sqlite not available ${e.message}`); return null; }
  if(!DatabaseSync) return null;
  const p = resolveDbPath();
  if(!p){
    // fail-closed：无 DSH_HOME 时不落盘（旧共享回退已删除），纯内存模式。
    logger?.warn?.("[token-meter] DSH_HOME 缺失，降级为内存模式（不持久化）");
    return null;
  }
  __dbPath = p;
  try{
    const fsmod = await import("node:fs");
    const mkdirSync = fsmod.mkdirSync;
    // 存下来给 dbHealthSnapshot() 用（避免每个请求再 import 一次）
    __fsModule = fsmod;
    const { dirname } = await import("node:path");
    try{ mkdirSync(dirname(p), {recursive:true}); }catch(e){}
    const db = new DatabaseSync(p);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    db.exec(SCHEMA_DDL);
    // v4 列增补：SQLite 的 ADD COLUMN 是元数据操作，无需重建表；按 table_info 幂等判断，
    // 老库（v3）与新库（v4）都能走到同一条路径。三列都可为 NULL，缺数据不影响旧读路径。
    // ⚠️ 索引必须在 ALTER 之后建：老库的 events 当时还没有 project 列，把
    // CREATE INDEX ... ON events(project) 放进上面那批 exec 会让整组 DDL 直接抛错。
    try{
      const cols = new Set(db.prepare("PRAGMA table_info(events)").all().map((c)=>String(c.name)));
      if(!cols.has("project")) db.exec("ALTER TABLE events ADD COLUMN project TEXT");
      if(!cols.has("tool")) db.exec("ALTER TABLE events ADD COLUMN tool TEXT");
      if(!cols.has("ms")) db.exec("ALTER TABLE events ADD COLUMN ms INTEGER NOT NULL DEFAULT 0");
      // provider 也让持久化：否则"按渠道切分"这张卡每次重启都会清零，要等新对话才回来
      if(!cols.has("provider")) db.exec("ALTER TABLE events ADD COLUMN provider TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_events_project ON events(project)");
    }catch(e){ logger?.warn?.(`[token-meter] v4 alter events failed ${e && e.message || e}`); }
    // 清空水位线：用户主动清空过账本时，此后所有回填都要跳过 reset_at 之前的历史
    try{ __resetAt = Number((db.prepare("SELECT v FROM meta WHERE k='reset_at'").get() || {}).v) || 0; }catch(e){}
    // 轻量自愈：integrity_check
    try{
      const chk = db.prepare("PRAGMA integrity_check").get();
      if(chk && chk.integrity_check && chk.integrity_check !== "ok"){
        logger?.warn?.(`[token-meter] integrity_check failed: ${chk.integrity_check}`);
      }
    }catch(e){}
    // v2 迁移：daily_usage 从 events 整体重建（修复 v1 增量账本被重复摄入污染的历史数据，无需删库重扫）。
    // M1 安全整改：迁移逻辑内联在本函数（db 为局部变量），不再以函数参数形式
    // 把 db 传入独立迁移函数——参数传入的连接对象触达 exec 事务控制会被
    // Mimosa L3 判为 command-injection 入口；且 day 键不再经 JS 绑定进 SQL
    // （rebuildAllPartitions 全量重建只绑时间戳数字）
    try{
      let ver="1";
      try{ const r=db.prepare("SELECT v FROM meta WHERE k='db_version'").get(); if(r && r.v!=null) ver=String(r.v); }catch(e){}
      if(ver!==SCHEMA_VERSION){
        const t0=Date.now();
        db.exec("BEGIN IMMEDIATE");
        try{
          rebuildAllPartitions(db, Date.now());
          db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('db_version',?)").run(SCHEMA_VERSION);
          db.exec("COMMIT");
          logger?.info?.(`[token-meter] DB v${ver} -> v${SCHEMA_VERSION}: rebuilt daily_usage partitions from events in ${Date.now()-t0}ms`);
        }catch(e2){
          try{ db.exec("ROLLBACK"); }catch(_){}
          throw e2;
        }
      }
    }catch(e){ logger?.warn?.(`[token-meter] migrate v2 failed ${e.message}`); }
    // 过期清理（24h 节流）：放在 hydrate 前，保证内存口径与裁剪后的 DB 一致
    try{ pruneExpired(db, logger); }catch(e){}
    __db = db;
    __dbReady = true;
    // 退出兜底：进程退出前把残留队列落盘（DatabaseSync 同步写，exit 钩子内有效）。
    // 此前无任何退出钩子，flush 防抖窗口（50ms）内的最后一批事件随进程退出静默丢失。
    if(!__exitHookInstalled){
      __exitHookInstalled = true;
      const flushOnExit = ()=>{ try{ flushDb(); }catch(e){} };
      try{ process.on("beforeExit", flushOnExit); }catch(e){}
      try{ process.on("exit", flushOnExit); }catch(e){}
    }
    //  hydrate 内存 from DB（若 DB 已有数据则无需全量扫盘）
    try{ hydrateFromDb(logger); }catch(e){ logger?.warn?.(`[token-meter] hydrate failed ${e.message}`); }
    logger?.info?.(`[token-meter] DB ready at ${p}, perDay=${usage.perDay.size}`);
    return db;
  }catch(e){
    logger?.warn?.(`[token-meter] ensureDb failed ${e.message}`);
    return null;
  }
}

// 小时桶回填：从 events 聚合"最近 HOURLY_KEEP_MS"窗口内的小时桶写入 realtimeHourly。
// 只服务客户端 1d 分时图（今日），旧实现无条件聚合全部 90 天：实测 77 个桶跨 11 天，
// 客户端又没按今天过滤，分时图会把历史各天的小时柱混进来、纵轴按全量峰值归一。
// 现在按 nowMs 收口窗口（客户端仍会按今天再过滤一次）。抽成独立函数便于单测。
function hydrateHourlyBuckets(db, nowMs){
  const hrs=db.prepare("SELECT model, day, strftime('%Y-%m-%dT%H', time/1000, 'unixepoch') AS hk, SUM(input) i, SUM(output) o, SUM(cache_read) cr, SUM(cache_write) cw, COUNT(*) n FROM events WHERE type='assistant/message' AND time >= ? GROUP BY model, hk").all(nowMs - HOURLY_KEEP_MS);
  for(const r of hrs){
    realtimeHourly.set(r.model+"::"+r.hk, {model:String(r.model), hour:String(r.hk)+":00:00.000Z", localDate:String(r.day), uncachedInputTokens:Number(r.i)||0, outputTokens:Number(r.o)||0, cacheReadTokens:Number(r.cr)||0, cacheWriteTokens:Number(r.cw)||0, count:Number(r.n)||0});
  }
  return hrs.length;
}

// v4 维度表 → 内存（工具 / 项目）+ 从 events 恢复"会话 → 项目"，保证重启后
// "项目排行"不依赖任何重扫。会先清空再灌，因此回填后可以安全地再调一次。
// provider 维度不落库：它只服务"按渠道切分"一张卡，实时累积即可。
function hydrateDimensionTables(){
  if(!__db) return;
  usage.perToolDay = new Map();
  usage.perProjectDay = new Map();
  usage.perProviderDay = new Map();
  try{
    const tRows = __db.prepare("SELECT day, tool, calls, ms FROM daily_tool").all();
    for(const r of tRows){
      let tm = usage.perToolDay.get(String(r.tool));
      if(!tm){ tm = new Map(); usage.perToolDay.set(String(r.tool), tm); }
      const cur = tm.get(String(r.day)) || { calls: 0, ms: 0 };
      cur.calls += Number(r.calls) || 0; cur.ms += Number(r.ms) || 0;
      tm.set(String(r.day), cur);
    }
  }catch(e){}
  try{
    const pRows = __db.prepare("SELECT day, project, requests, input, output, cache_read, tools FROM daily_project").all();
    for(const r of pRows){
      let pm = usage.perProjectDay.get(String(r.project));
      if(!pm){ pm = new Map(); usage.perProjectDay.set(String(r.project), pm); }
      const cur = pm.get(String(r.day)) || emptyAgg();
      cur.requests += Number(r.requests) || 0; cur.input += Number(r.input) || 0; cur.output += Number(r.output) || 0;
      cur.cacheRead += Number(r.cache_read) || 0; cur.tools += Number(r.tools) || 0;
      cur.total = cur.input + cur.output;
      pm.set(String(r.day), cur);
    }
  }catch(e){}
  try{
    const sRows = __db.prepare("SELECT session_id, MAX(project) AS p FROM events WHERE project IS NOT NULL AND project<>'' GROUP BY session_id").all();
    for(const r of sRows) noteProject(String(r.session_id), String(r.p));
  }catch(e){}
  // 渠道维度不另建派生表：按 (day, provider) 直接聚合 events（只关心 assistant/message 口径）
  try{
    const vRows = __db.prepare(`SELECT day, provider,
        SUM(CASE WHEN type='assistant/message' THEN 1 ELSE 0 END) AS req,
        COALESCE(SUM(input),0) AS i, COALESCE(SUM(output),0) AS o, COALESCE(SUM(cache_read),0) AS cr
      FROM events WHERE provider IS NOT NULL AND provider<>'' GROUP BY day, provider`).all();
    for(const r of vRows){
      let vm = usage.perProviderDay.get(String(r.provider));
      if(!vm){ vm = new Map(); usage.perProviderDay.set(String(r.provider), vm); }
      const cur = vm.get(String(r.day)) || emptyAgg();
      cur.requests += Number(r.req) || 0; cur.input += Number(r.i) || 0;
      cur.output += Number(r.o) || 0; cur.cacheRead += Number(r.cr) || 0;
      cur.total = cur.input + cur.output;
      vm.set(String(r.day), cur);
    }
  }catch(e){}
}

function hydrateFromDb(logger){
  if(!__db) return;
  try{
    const rows = __db.prepare("SELECT day, model, requests, input, output, cache_read, cache_write, tools, turns, steps FROM daily_usage").all();
    for(const r of rows){
      const day=r.day, model=r.model;
      const agg={requests:Number(r.requests)||0, input:Number(r.input)||0, output:Number(r.output)||0, cacheRead:Number(r.cache_read)||0, tools:Number(r.tools)||0, turns:Number(r.turns)||0, steps:Number(r.steps)||0, total:0};
      agg.total=agg.input+agg.output;
      const ex=usage.perDay.get(day)||emptyAgg();
      ex.requests+=agg.requests; ex.input+=agg.input; ex.output+=agg.output; ex.cacheRead+=agg.cacheRead; ex.tools+=agg.tools; ex.turns+=agg.turns; ex.steps+=agg.steps; ex.total=ex.input+ex.output;
      usage.perDay.set(day, ex);
      let mm=usage.perModel.get(model);
      if(!mm){ mm=new Map(); usage.perModel.set(model, mm); }
      const ma=mm.get(day)||emptyAgg();
      ma.requests+=agg.requests; ma.input+=agg.input; ma.output+=agg.output; ma.cacheRead+=agg.cacheRead; ma.tools+=agg.tools; ma.turns+=agg.turns; ma.steps+=agg.steps; ma.total=ma.input+ma.output;
      mm.set(day, ma);
      // seenSeq / liveSeqs 水位线见下方全量回填
    }
    hydrateDimensionTables();
    // 完整水位线回填：per-session {max seq, max time} + 复合键 seenSeq。
    // 裸 seq 水位线在编号代际重置后会挡住全部新事件；seenSeq 必须带 session_id。
    try{
      const wm=__db.prepare("SELECT session_id, MAX(seq) AS m, MAX(time) AS t FROM events WHERE seq IS NOT NULL GROUP BY session_id").all();
      for(const w of wm){
        const sid=String(w.session_id), m=Number(w.m)||0, t=Number(w.t)||0;
        if(m>0 || t>0){
          const prev=liveSeqs.get(sid);
          if(!prev || m>(Number(prev.seq)||0) || (m===(Number(prev.seq)||0) && t>(Number(prev.time)||0))) liveSeqs.set(sid, {seq:m, time:t});
        }
      }
    }catch(e){}
    try{
      const sq=__db.prepare("SELECT session_id, seq FROM events WHERE seq IS NOT NULL LIMIT 200000").all();
      for(const s of sq) seenSeq.add(seenKey(s.session_id, s.seq));
    }catch(e){}
    // 只取 assistant/message：此前不过滤 type，重启后"最近调用"会把 turn/end、step/end、
    // tool/result（model='__system'，token 全 0）混进列表，界面上就是一堆 "__system · 0 → 0"。
    const evs=__db.prepare("SELECT seq, time, session_id, model, input, output, cache_read, project, ms FROM events WHERE type='assistant/message' ORDER BY time DESC LIMIT 50").all();
    for(let i=evs.length-1;i>=0;i--){
      const e=evs[i];
      usage.records.unshift({time:Number(e.time), sessionId:String(e.session_id).slice(0,12), model:String(e.model), provider:"", project:e.project?String(e.project):"", input:Number(e.input)+Number(e.cache_read), output:Number(e.output), cacheRead:Number(e.cache_read), durationMs:Number(e.ms)||0});
    }
    if(evs.length) usage.ready=true;
    // 同步 realtimeHourly（1d 分时图数据源），窗口见 HOURLY_KEEP_MS
    try{ hydrateHourlyBuckets(__db, Date.now()); }catch(e){}
  }catch(e){ throw e; }
}

// events / daily_usage 过期清理（90d 保留窗口与 USAGE_KEEP_MS 对齐）：
// events 是唯一事实源但从不清理会无限膨胀（按事件一行记账，数年后可达数百 MB；
// raw 列当前恒为 NULL，仅占位）；daily_usage 同窗口裁剪保持与 hydrate 口径一致。
// 只绑数字参数（cutoff 时间戳），day 截断键由 SQL strftime(localtime) 派生，
// 与写入侧 dayKeyOf 同口径。24h 节流（meta.last_prune_at），启动异步不阻塞。
function pruneExpired(db, logger){
  try{
    const last = Number((db.prepare("SELECT v FROM meta WHERE k='last_prune_at'").get()||{}).v)||0;
    if (Date.now() - last < 24*3600*1000) return;
    const cutoff = Date.now() - USAGE_KEEP_MS;
    db.exec("BEGIN IMMEDIATE");
    try{
      const ev = db.prepare("DELETE FROM events WHERE time < ?").run(cutoff);
      const du = db.prepare("DELETE FROM daily_usage WHERE day < strftime('%Y-%m-%d', ?/1000, 'unixepoch', 'localtime')").run(cutoff);
      // 三张派生缓存同窗口裁剪：只裁 daily_usage 会让新维度无限保留过期天
      const dt = db.prepare("DELETE FROM daily_tool WHERE day < strftime('%Y-%m-%d', ?/1000, 'unixepoch', 'localtime')").run(cutoff);
      const dp = db.prepare("DELETE FROM daily_project WHERE day < strftime('%Y-%m-%d', ?/1000, 'unixepoch', 'localtime')").run(cutoff);
      db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('last_prune_at',?)").run(String(Date.now()));
      db.exec("COMMIT");
      if (Number(ev.changes)>0 || Number(du.changes)>0 || Number(dt.changes)>0 || Number(dp.changes)>0) {
        logger?.info?.(`[token-meter] pruned expired rows: events=${ev.changes} daily_usage=${du.changes} daily_tool=${dt.changes} daily_project=${dp.changes} (90d window)`);
      }
    }catch(e2){
      try{ db.exec("ROLLBACK"); }catch(_){}
      throw e2;
    }
  }catch(e){ logger?.warn?.(`[token-meter] prune failed ${e && e.message || e}`); }
}

// daily_usage 派生缓存：按天分区重建（DELETE + INSERT...SELECT），重复摄入收敛为真值。
// M1 安全整改：day 键一律由 SQL 内部（events 表列）派生，JS 侧只向 SQL 绑定
// 数字（时间范围/时间戳）——外部字符串不再作为绑定参数进入重建语句，
// 切断 Mimosa L3 标记的 "事件数据 → day → SQL 绑定参数" 污点路径。
// 工具维度派生缓存（daily_tool）：只统计 tool/result 的调用次数与耗时。
// 与 daily_usage 同为"整分区重建"语义（flush 时按受影响的天重算，重复摄入收敛为真值）。
// 工具名来自 tool/call 的 data.name（实测 read/edit/pwsh/grep…），未采集到的记 '—'。
function rebuildToolPartitions(db, now, minTime, maxTime){
  if(minTime !== undefined){
    db.prepare("DELETE FROM daily_tool WHERE day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?)").run(minTime, maxTime);
    db.prepare(`INSERT INTO daily_tool(day,tool,calls,ms,updated_at)
      SELECT day, COALESCE(NULLIF(tool,''),'—'), COUNT(*), COALESCE(SUM(ms),0), ?
      FROM events WHERE type='tool/result' AND day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?)
      GROUP BY day, COALESCE(NULLIF(tool,''),'—')`).run(now, minTime, maxTime);
    return;
  }
  db.prepare("DELETE FROM daily_tool").run();
  db.prepare(`INSERT INTO daily_tool(day,tool,calls,ms,updated_at)
    SELECT day, COALESCE(NULLIF(tool,''),'—'), COUNT(*), COALESCE(SUM(ms),0), ?
    FROM events WHERE type='tool/result' GROUP BY day, COALESCE(NULLIF(tool,''),'—')`).run(now);
}
// 项目维度派生缓存（daily_project）：project 来自会话头的 cwd（见 sessionMeta），
// sessions = 当日该项目下出现过的会话数。project 为空的历史行统一落 '—' 桶。
function rebuildProjectPartitions(db, now, minTime, maxTime){
  const sel = (where) => `INSERT INTO daily_project(day,project,requests,input,output,cache_read,tools,sessions,updated_at)
    SELECT day, COALESCE(NULLIF(project,''),'—'),
      SUM(CASE WHEN type='assistant/message' THEN 1 ELSE 0 END),
      COALESCE(SUM(input),0), COALESCE(SUM(output),0), COALESCE(SUM(cache_read),0),
      SUM(CASE WHEN type='tool/result' THEN 1 ELSE 0 END),
      COUNT(DISTINCT session_id), ?
    FROM events ${where} GROUP BY day, COALESCE(NULLIF(project,''),'—')`;
  if(minTime !== undefined){
    db.prepare("DELETE FROM daily_project WHERE day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?)").run(minTime, maxTime);
    db.prepare(sel("WHERE day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?)")).run(now, minTime, maxTime);
    return;
  }
  db.prepare("DELETE FROM daily_project").run();
  db.prepare(sel("")).run(now);
}
// 全量重建（迁移用）：单条语句覆盖全部 day，无需先取 DISTINCT day 列表
function rebuildAllPartitions(db, now){
  db.prepare("DELETE FROM daily_usage").run();
  db.prepare(`INSERT INTO daily_usage(day,model,requests,input,output,cache_read,cache_write,tools,turns,steps,updated_at)
    SELECT day, model,
      SUM(CASE WHEN type='assistant/message' THEN 1 ELSE 0 END),
      COALESCE(SUM(input),0), COALESCE(SUM(output),0), COALESCE(SUM(cache_read),0), COALESCE(SUM(cache_write),0),
      SUM(CASE WHEN type='tool/result' THEN 1 ELSE 0 END),
      SUM(CASE WHEN type='turn/end' THEN 1 ELSE 0 END),
      SUM(CASE WHEN type='step/end' THEN 1 ELSE 0 END),
      ? FROM events GROUP BY day, model`).run(now);
  rebuildToolPartitions(db, now);
  rebuildProjectPartitions(db, now);
}
// 增量重建（flush 用）：按时间范围圈定受影响的天，然后对这些天做**整分区**
// 重算——INSERT...SELECT 必须聚合这些天的全部事件（按 day 子查询圈定，不带
// 时间上限过滤）。此前按 time BETWEEN 过滤聚合，同日内早先批次被 DELETE 后
// 不再补回，每次 flush 都在丢当天早先数据，重启 hydrate 后用量骤减。
// 幂等且结果等价于全量重建（idx_events_day 使按天聚合 <1ms）
function rebuildPartitionsInRange(db, minTime, maxTime, now){
  db.prepare("DELETE FROM daily_usage WHERE day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?)").run(minTime, maxTime);
  db.prepare(`INSERT INTO daily_usage(day,model,requests,input,output,cache_read,cache_write,tools,turns,steps,updated_at)
    SELECT day, model,
      SUM(CASE WHEN type='assistant/message' THEN 1 ELSE 0 END),
      COALESCE(SUM(input),0), COALESCE(SUM(output),0), COALESCE(SUM(cache_read),0), COALESCE(SUM(cache_write),0),
      SUM(CASE WHEN type='tool/result' THEN 1 ELSE 0 END),
      SUM(CASE WHEN type='turn/end' THEN 1 ELSE 0 END),
      SUM(CASE WHEN type='step/end' THEN 1 ELSE 0 END),
      ? FROM events WHERE day IN (SELECT DISTINCT day FROM events WHERE time BETWEEN ? AND ?) GROUP BY day, model`).run(now, minTime, maxTime);
  // 三张派生缓存同节奏重建，保证"同一批事件 → 三个维度"的读口径一致
  rebuildToolPartitions(db, now, minTime, maxTime);
  rebuildProjectPartitions(db, now, minTime, maxTime);
}

// v1 -> v2 迁移逻辑已内联至 ensureDb（M1 安全整改：db 不再作为参数跨函数
// 传递触达 exec 事务控制；重建只绑数字参数，day 键由 SQL 内部派生）

function scheduleFlush(){
  if(__flushTimer) return;
  __flushTimer=setTimeout(()=>{ __flushTimer=null; flushDb(); }, 50);
  if(__eventsQueue.length>100){
    clearTimeout(__flushTimer); __flushTimer=null; flushDb();
  }
}
function flushDb(){
  if(!__db || !__eventsQueue.length) return;
  try{
    __db.exec("BEGIN IMMEDIATE");
    // 1) events 幂等账本：PK(seq,session_id) 天然去重。v4 起改为 UPSERT：老行可能缺 v3 时代
    //    才有的 project/tool/ms（那时列还不存在），重复摄入时用 COALESCE 把这三列补齐，
    //    这样一次会话重扫就能把历史维度补上，而不必删库。计数列仍严格不覆盖（保持幂等）。
    const insEv=__db.prepare(`INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw,project,tool,ms,provider)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(seq,session_id) DO UPDATE SET
        project=COALESCE(events.project, excluded.project),
        tool=COALESCE(events.tool, excluded.tool),
        provider=COALESCE(NULLIF(events.provider,''), excluded.provider),
        ms=CASE WHEN events.ms>0 THEN events.ms ELSE excluded.ms END`);
    // M1 安全整改：day 列由时间戳在 flush 时刻重新生成（dayKeyOf 只接受数字），
    // 队列携带的外部字符串不再进入 SQL 绑定参数；同时记录批次的 时间范围，
    // 供第 2 步按范围重建受影响分区（同样只绑数字）
    let minT = Infinity, maxT = -Infinity;
    for(const ev of __eventsQueue){
      const t = Number(ev.time);
      const safeT = Number.isFinite(t) && t > 0 ? t : Date.now();
      if(safeT < minT) minT = safeT;
      if(safeT > maxT) maxT = safeT;
      insEv.run(ev.seq, safeT, dayKeyOf(safeT), ev.session_id, ev.model, ev.input||0, ev.output||0, ev.cache_read||0, ev.cache_write||0, ev.type, ev.raw||null, ev.project||null, ev.tool||null, Number(ev.ms)||0, ev.provider||null);
    }
    __eventsQueue.length=0;
    // 2) daily_usage：只重建本批次时间范围涉及的天（有 idx_events_time，单日分区 <1ms）
    if(Number.isFinite(minT) && maxT >= minT) rebuildPartitionsInRange(__db, minT, maxT, Date.now());
    __db.exec("COMMIT");
    try{ __db.prepare("UPDATE meta SET v='1' WHERE k='ready'").run(); }catch(e){}
    try{ __db.prepare("UPDATE meta SET v=? WHERE k='last_scan_at'").run(String(Date.now())); }catch(e){}
  }catch(e){
    try{ __db.exec("ROLLBACK"); }catch(_){}
    // 此前完全静默：flush 失败 = 无声丢数据，问题无从发现
    try{ __logger?.warn?.(`[token-meter] flushDb failed: ${e && e.message || e}`); }catch(_){}
  }
}

function queueEvent(ev){
  if(!__dbReady) return;
  if(ev.seq==null) ev.seq=synthesizeSeq(ev);
  __eventsQueue.push(ev);
  scheduleFlush();
}

function json(res, status, obj) {
  // 不发任何 CORS 头：消费方只有 dsh UI（同源），跨源读取由同源策略天然拦截
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

// ── 本地 HTTP 面防护（全部端点统一前置） ─────────────────────────────
// 1) Host 校验：堵 DNS rebinding——rebinding 后请求的 Host 是攻击者域名，
//    合法访问只来自 127.0.0.1/localhost/<::1>。
// 2) Sec-Fetch-Site 校验：现代浏览器对每个 fetch 都带该头，跨站 fetch（含
//    PNA 未生效的浏览器）直接 403；非浏览器请求（本机进程 curl）无此头，
//    放行——其与直接读 token-meter.db 同权，无需也无法用 HTTP token 加防。
function localGuard(req, res) {
  const hostname = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const hostOk = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  const sfs = req.headers["sec-fetch-site"];
  const sfsOk = !sfs || sfs === "same-origin" || sfs === "none";
  if (!hostOk || !sfsOk) {
    res.writeHead(403);
    res.end();
    return false;
  }
  return true;
}

// ── P2: 死端点指数退避 ─────────────────────────────────────────────
// 全候选扫荡失败（裸域名展开 12 个候选 × 8s 顺序超时）后从 2min 起等待、每失败一次 ×2、封顶 30min；
// 退避窗口内 /api/opencode/quota 直接返回缓存失败（429），不再发起网络请求也不产生 "trying" 日志。
// 任意一次成功即清零。背景：此前死端点每 120s 被原样重撞，service.log 82% 是 "trying" 刷屏
// （6342/7714 行），401/403 坏 token 同样适用退避（反复撞同样无意义）。
const __ocBackoff = { fails: 0, nextAttemptAt: 0, lastError: null };
const OC_BACKOFF_BASE_MS = 120 * 1000;
const OC_BACKOFF_MAX_MS = 30 * 60 * 1000;
function ocBackoffState(){
  return { fails: __ocBackoff.fails, retryAfterMs: Math.max(0, __ocBackoff.nextAttemptAt - Date.now()) };
}

// M2/C13：baseUrl 主机白名单——用户 token 随 Authorization/x-api-key 头外发，
// 此前 baseUrl 可经 query 指向任意 https 主机，"配置一次恶意端点"即把
// token 送给攻击者（token 外发面）。白名单与官方端点域对齐；非白名单或
// 非 https 一律忽略并回退官方默认域。
const ALLOWED_BASE_HOSTS = new Set(["opencode.ai", "api.opencode.ai", "api.deepseek.com"]);
function sanitizeBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    return ALLOWED_BASE_HOSTS.has(u.hostname.toLowerCase()) ? s.replace(/\/$/, "") : "";
  } catch { return ""; }
}

async function tryFetchOpencode(baseUrl, token, logger) {
  const candidateUrls = [];
  const base = sanitizeBaseUrl(baseUrl);
  if (base) {
    if (base !== String(baseUrl || "").trim().replace(/\/$/, "")) {
      logger?.warn?.(`[opencode-quota] baseUrl 不在白名单内，已回退官方默认域`);
    }
    const nb = base;
    const isExact = /\/zen\/|\/v1\/|\/api\//.test(nb) && !/^https?:\/\/[^\/]+$/.test(nb);
    if (isExact) candidateUrls.push(nb);
    if (/^https?:\/\/[^\/]+$/.test(nb)) for (const p of OPENCODE_CANDIDATES) candidateUrls.push(nb + p);
    else if (!isExact) for (const p of OPENCODE_CANDIDATES) candidateUrls.push(nb + p);
  } else {
    if (baseUrl) logger?.warn?.(`[opencode-quota] baseUrl 不在白名单内，已回退官方默认域`);
    for (const base of OPENCODE_DEFAULT_BASES) for (const p of OPENCODE_CANDIDATES) candidateUrls.push(base + p);
  }
  let lastErr = null;
  for (const url of candidateUrls) {
    try {
      logger?.info?.(`[opencode-quota] trying ${url}`);
      const r = await fetch(url, {
        method: "GET",
        headers: { "authorization": `Bearer ${token}`, "x-api-key": token, "accept": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text().catch(() => "");
      const ct = r.headers.get("content-type") || "";
      let data; try { data = text ? JSON.parse(text) : null; } catch { data = text ? { _raw: text } : null; }
      if (r.status === 401 || r.status === 403) throw new Error(`Auth failed ${r.status} at ${url}: ${String(text).slice(0,200)}`);
      if (r.status === 404) { lastErr = `404 ${url}`; continue; }
      if (!r.ok) { lastErr = `${r.status} ${url}: ${String(text).slice(0,200)}`; continue; }
      const rawStr = typeof data === "string" ? data : (data && data._raw) || "";
      if (rawStr === "Not Found" || rawStr.trim() === "Not Found") { lastErr = `200 Not Found ${url}`; continue; }
      if (!data || (typeof data === "object" && Object.keys(data).length === 0)) { lastErr = `200 empty ${url}`; continue; }
      if (ct.includes("text/html") && String(text).includes("<!DOCTYPE")) { lastErr = `200 html ${url}`; continue; }
      if (data && data._raw && String(data._raw).includes("<!DOCTYPE")) { lastErr = `200 html ${url}`; continue; }
      return { data: data ?? { _raw: text }, url };
    } catch (e) {
      lastErr = e.message || String(e);
      if (/Auth failed/.test(lastErr)) throw e;
    }
  }
  throw new Error(lastErr || "all endpoints failed");
}

function normalizeOpencode(raw) {
  let d = raw;
  if (d && typeof d === "object") {
    if ("data" in d && d.data && typeof d.data === "object" && !Array.isArray(d.data)) {
      const inner = d.data;
      if (inner.limit != null || inner.used != null || inner.quota != null || inner.usage != null || inner.plan != null) d = inner;
      else if (Object.keys(inner).length > 0 && !("ok" in inner)) d = inner;
    }
    if ("result" in d && d.result && typeof d.result === "object") d = d.result;
    if ("subscription" in d && d.subscription && typeof d.subscription === "object") d = { ...d, ...d.subscription };
    if ("entitlement" in d && d.entitlement && typeof d.entitlement === "object") d = { ...d, ...d.entitlement };
  }
  let limit = d?.quota?.limit ?? d?.usage?.limit ?? d?.entitlement?.limit ?? d?.limit ?? d?.quota_limit ?? d?.total ?? d?.allowance ?? d?.credits ?? d?.creditLimit ?? d?.maxTokens ?? d?.monthlyLimit ?? null;
  let used = d?.quota?.used ?? d?.usage?.used ?? d?.entitlement?.used ?? d?.used ?? d?.usage ?? d?.consumed ?? d?.creditsUsed ?? d?.usedTokens ?? d?.currentUsage ?? null;
  let remaining = d?.quota?.remaining ?? d?.usage?.remaining ?? d?.entitlement?.remaining ?? d?.remaining ?? d?.remainingTokens ?? d?.creditsRemaining ?? null;
  if (Array.isArray(d?.usage)) {
    const u = d.usage.find(x => x.limit != null || x.used != null) || d.usage[0];
    if (u) { limit = limit ?? u.limit ?? u.total; used = used ?? u.used ?? u.consumed; remaining = remaining ?? u.remaining; }
  }
  if (Array.isArray(d?.quotas)) {
    const q = d.quotas.find(x => /token|credit|go/i.test(x.name||x.type||"")) || d.quotas[0];
    if (q) { limit = limit ?? q.limit ?? q.total; used = used ?? q.used; remaining = remaining ?? q.remaining; }
  }
  if (used && typeof used === "object" && !Array.isArray(used)) used = used.tokens ?? used.total ?? used.count ?? used.used ?? used.value ?? null;
  if (limit && typeof limit === "object" && !Array.isArray(limit)) limit = limit.tokens ?? limit.total ?? limit.limit ?? limit.value ?? null;
  if (remaining && typeof remaining === "object" && !Array.isArray(remaining)) remaining = remaining.tokens ?? remaining.remaining ?? remaining.value ?? null;
  limit = limit != null ? Number(String(limit).replace(/[, ]/g,"")) : null;
  used = used != null ? Number(String(used).replace(/[, ]/g,"")) : null;
  remaining = remaining != null ? Number(String(remaining).replace(/[, ]/g,"")) : null;
  if (isNaN(limit)) limit = null; if (isNaN(used)) used = null; if (isNaN(remaining)) remaining = null;
  if (limit != null && remaining != null && used == null) used = limit - remaining;
  if (limit != null && used != null && remaining == null) remaining = limit - used;
  let percent = d?.percent ?? d?.usagePercent ?? d?.quota?.percent ?? null;
  if (percent != null) percent = Number(percent);
  if ((percent == null || isNaN(percent)) && limit && used != null) percent = Math.min(100, Math.max(0, (used / limit) * 100));
  if (percent != null && isNaN(percent)) percent = null;
  if (percent != null) percent = Math.round(percent);
  let buckets = null;
  if (d?.usage && typeof d.usage === "object" && !Array.isArray(d.usage) && (d.usage.rolling || d.usage.weekly || d.usage.monthly)) {
    const normBucket = (b) => b && typeof b === "object" ? {
      percent: b.percent != null ? Math.round(Number(b.percent)) : null,
      status: b.status || null,
      resetsAt: b.resetsAt || b.resets_at || b.resetAt || null,
      remainingPercent: b.percent != null ? Math.max(0, 100 - Math.round(Number(b.percent))) : null,
    } : null;
    buckets = { rolling: normBucket(d.usage.rolling), weekly: normBucket(d.usage.weekly), monthly: normBucket(d.usage.monthly) };
    if (percent == null) percent = buckets.monthly?.percent ?? buckets.weekly?.percent ?? buckets.rolling?.percent ?? null;
  }
  const plan = d?.plan ?? d?.tier ?? d?.subscription_plan ?? d?.quota?.plan ?? d?.entitlement?.plan ?? d?.subscriptionPlan ?? "Go";
  const resetAt = buckets?.monthly?.resetsAt ?? buckets?.weekly?.resetsAt ?? buckets?.rolling?.resetsAt ?? d?.resetAt ?? d?.reset_at ?? d?.quota?.resetAt ?? d?.quota?.reset_at ?? d?.periodEnd ?? d?.renewAt ?? d?.currentPeriodEnd ?? d?.billingPeriodEnd ?? d?.reset ?? d?.expiresAt ?? d?.usageReset ?? null;
  const requestsUsed = d?.requestsUsed ?? d?.quota?.requestsUsed ?? d?.requests_used ?? d?.usage?.requestsUsed ?? null;
  const requestsLimit = d?.requestsLimit ?? d?.quota?.requestsLimit ?? d?.requests_limit ?? d?.usage?.requestsLimit ?? null;
  return { plan: String(plan), limit, used, remaining, percent, resetAt: resetAt ? String(resetAt) : null, requestsUsed: requestsUsed != null ? Number(requestsUsed) : null, requestsLimit: requestsLimit != null ? Number(requestsLimit) : null, buckets, raw };
}

async function fetchDeepSeek(baseUrl, token, logger) {
  // M2/C13：baseUrl 白名单校验（token 随 Authorization 头外发，不允许任意主机）
  const base = sanitizeBaseUrl(baseUrl) || DEEPSEEK_DEFAULT_BASE;
  const url = base + DEEPSEEK_BALANCE_PATH;
  logger?.info?.(`[deepseek-quota] fetching ${url}`);
  const r = await fetch(url, {
    method: "GET",
    headers: { "authorization": `Bearer ${token}`, "accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text().catch(() => "");
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
  if (r.status === 401 || r.status === 403) throw new Error(`DeepSeek Auth failed ${r.status}: ${String(text).slice(0,300)}`);
  if (!r.ok) throw new Error(`DeepSeek ${r.status} at ${url}: ${String(text).slice(0,300)}`);
  return { data, url };
}

function normalizeDeepSeek(raw) {
  const d = raw || {};
  const infos = Array.isArray(d.balance_infos) ? d.balance_infos : Array.isArray(d.balanceInfos) ? d.balanceInfos : [];
  const byCurr = {};
  for (const it of infos) {
    const cur = (it.currency || it.Currency || "").toUpperCase();
    if (!cur) continue;
    byCurr[cur] = {
      currency: cur,
      total: it.total_balance != null ? Number(it.total_balance) : it.totalBalance != null ? Number(it.totalBalance) : null,
      granted: it.granted_balance != null ? Number(it.granted_balance) : null,
      toppedUp: it.topped_up_balance != null ? Number(it.topped_up_balance) : null,
    };
  }
  if (!infos.length && (d.total_balance || d.totalBalance)) {
    byCurr["CNY"] = { currency:"CNY", total: Number(d.total_balance ?? d.totalBalance), granted: null, toppedUp: null };
  }
  const cny = byCurr["CNY"] || null;
  const usd = byCurr["USD"] || null;
  const isAvailable = d.is_available ?? d.isAvailable ?? true;
  return { isAvailable: !!isAvailable, cny, usd, byCurr, raw };
}

// ===== R4Coder：官方 GET {baseUrl}/v1/cli/meta（cc-switch 同源）=====
// baseUrl 为用户自定义 host（A1：任意 https，不进 ALLOWED_BASE_HOSTS）。
// 文档要求 base 不含 /v1；若用户粘了带路径的 URL 则剥到 origin。
function sanitizeR4BaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    return u.origin;
  } catch { return ""; }
}
// 与 Opencode 退避分桶，互不影响
const __r4Backoff = { fails: 0, nextAttemptAt: 0, lastError: null };
const R4_BACKOFF_BASE_MS = 120 * 1000;
const R4_BACKOFF_MAX_MS = 30 * 60 * 1000;
function r4BackoffState() {
  return { fails: __r4Backoff.fails, retryAfterMs: Math.max(0, __r4Backoff.nextAttemptAt - Date.now()) };
}
async function fetchR4Coder(baseUrl, token, logger) {
  const base = sanitizeR4BaseUrl(baseUrl);
  if (!base) throw new Error("R4Coder baseUrl 无效（需 https，不含 /v1）");
  const url = base + R4_META_PATH;
  logger?.info?.(`[r4coder] fetching ${url}`);
  const r = await fetch(url, {
    method: "GET",
    headers: { "authorization": `Bearer ${token}`, "accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text().catch(() => "");
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
  // monitoring key → 403；坏/吊销 key → 401
  if (r.status === 401 || r.status === 403) throw new Error(`R4Coder Auth failed ${r.status}（需与推理同款 coder_… key；monitoring key 会 403）`);
  if (!r.ok) throw new Error(`R4Coder ${r.status} at ${url}: ${String(text).slice(0,300)}`);
  return { data, url };
}
function normalizeR4Coder(raw) {
  const d = raw || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const plan = d.plan && typeof d.plan === "object" ? d.plan : null;
  const walletUsd = d.wallet && typeof d.wallet === "object" ? num(d.wallet.balance_usd) : 0;
  if (!plan) {
    if (walletUsd > 0) {
      return { isValid: true, plan: "Wallet", limit: null, used: null, remaining: walletUsd, percent: null, unit: "USD", extra: "", raw: d };
    }
    return { isValid: false, plan: null, limit: null, used: null, remaining: 0, percent: null, unit: "USD", extra: null, invalidMessage: "No active package or wallet balance", raw: d };
  }
  const remaining = num(plan.remaining_usd);
  const total = num(plan.total_usd);
  const used = Math.max(total - remaining, 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : null;
  return {
    isValid: true,
    plan: plan.package_name || "Package",
    limit: total > 0 ? total : null,
    used: total > 0 ? used : null,
    remaining,
    percent,
    unit: "USD",
    extra: walletUsd > 0 ? `Wallet $${walletUsd.toFixed(2)}` : "",
    raw: d,
  };
}

// ===== TokenMeter：对齐 dsh-balance-plugin（perDay/perModel/records/live + dayKeyOf 本地日 + liveSeqs + computeUsage）===== 
const USAGE_KEEP_MS = 90 * 86400000;
// 小时桶（realtimeHourly / legacy hourly）只服务客户端 1d 分时图，保留 2 天足够跨天兜底，
// 不再把 90 天的小时桶全灌进内存。
const HOURLY_KEEP_MS = 2 * 86400000;
// 首次回填（内存模式每次启动都要跑）最多让数据接口等多久：等完才有完整口径，
// 但不能无限等，否则 sessionQuery 卡住会把 /api/token-meter 一起拖死。
const READY_WAIT_MS = 20 * 1000;
const usage = {
  ready: false,
  error: null,
  version: 0,
  perDay: new Map(),
  perModel: new Map(),
  // v4 维度：工具（tool → day → {calls,ms}）、项目（project → day → agg+{sessions:Set}）、
  // 渠道（provider → day → agg）。三者与 perModel 同构，computeUsage 里统一按窗口裁剪。
  perToolDay: new Map(),
  perProjectDay: new Map(),
  perProviderDay: new Map(),
  records: [],
  live: {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    toolCalls: 0,
    firstTokenSum: 0,
    firstTokenCount: 0,
    outputTokens: 0,
    // 事件级计数（设置页"实时/可靠性"用）
    msgs: 0,
    // 近 RATE_WINDOW_MS 的输出样本 [{t, tokens}]：瞬时速率的数据源，
    // 与 llmMs 口径的累计均值分开，避免"平均速率"被当成"当前速率"。
    outputs60: [],
    // 首 token 诊断：按事件名统计"步内产出信号"的到达情况（见 SIGNAL_EVENT_TYPES）
    signalCount: {},
    retries: 0,
    retryCodes: new Map(),
    compactions: 0,
    errors: 0,
    toolErrors: 0,
    stepStart: new Map(),
    stepToolAccum: new Map(),
    toolStart: new Map(),
    firstChunk: new Map(),
  },
};
// 会话 → {project}：project 取会话头 cwd 的末段，用于"哪个项目最费 token"。
// 来源三选一（实时 session 对象 → listSessions header.cwd → 会话文件目录名），见 noteProject()。
const sessionMeta = new Map();

// cwd → 项目名：取路径末段（Windows / Posix 都吃）；空值返回 ""（读侧统一落 '—' 桶）。
// 一律小写：Windows 是大小写不敏感文件系统，不同壳给出的 cwd 大小写不同
// （实测同一目录同时出现 Zenith / zenith），不小写会被拆成两个项目。
function projectFromCwd(cwd){
  const s = String(cwd == null ? "" : cwd).trim();
  if(!s) return "";
  const parts = s.replace(/[\\/]+$/,"").split(/[\\/]+/);
  const last = (parts[parts.length-1] || "").toLowerCase();
  return last.length > 40 ? last.slice(0,40) : last;
}
// 会话目录名 → cwd：官方把 cwd 编码成 `--D-code-token-lens--`（`~XXXX` 为 UTF-16 码元十六进制、
// `-` 为路径分隔符）。只用于 fs 兜底扫描时给 project 定位，不追求 100% 还原（取末段足够）。
function decodeSessionDirName(name){
  const s = String(name == null ? "" : name);
  if(!s.startsWith("--") || s.length < 5) return "";
  const body = s.slice(2, -2);
  if(!body) return "";
  return body
    .replace(/~([0-9A-Fa-f]{4})/g, (m,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/-/g, "/");
}
// 记录/更新会话的项目归属（空值不覆盖已有的非空值）
function noteProject(sid, cwd){
  const p = projectFromCwd(cwd);
  if(!p) return;
  const cur = sessionMeta.get(sid);
  if(!cur) sessionMeta.set(sid, { project: p });
  else if(cur.project !== p) cur.project = p;
}
function projectOf(sid){
  const m = sessionMeta.get(sid);
  return m && m.project ? m.project : "";
}
// 兼容层：保留旧 hourly 结构供 /api/token-meter 旧客户端
const realtimeHourly = new Map();
// seenSeq：复合键 "sessionId:seq"。seq 只在会话内唯一（DB 主键即 (seq, session_id)），
// 裸 seq 去重会把其他会话的同号事件当成重复而丢弃。
const seenSeq = new Set();
// liveSeqs：每会话水位线 {seq, time}。只比 seq 大小会在「编号代际重置」
//（历史全局大 seq vs 当前会话内小 seq）时把更新的事件当成旧事件丢掉，必须叠时间。
const liveSeqs = new Map();

function seenKey(sid, seq) {
  return String(sid) + ":" + String(seq);
}

/** 是否应跳过该事件（已见 / 水位线之后的旧事件）。 */
function shouldSkipEvent(sid, event) {
  if (event && event.seq != null && seenSeq.has(seenKey(sid, event.seq))) return true;
  const prev = liveSeqs.get(sid);
  if (!prev || !event) return false;
  const prevSeq = Number(prev.seq) || 0;
  const prevTime = Number(prev.time) || 0;
  const seq = typeof event.seq === "number" ? event.seq : null;
  const time = typeof event.time === "number" ? event.time : 0;
  if (seq != null && seq > prevSeq) return false;
  // seq 未前进时：时间前进 = 编号代际重置（fork/格式迁移/历史全局 seq），必须放行
  if (time > prevTime) return false;
  return true;
}

/** 推进水位线。代际重置（seq 回落但 time 前进）时整段重置，不保留旧大 seq。 */
function advanceWatermark(sid, event) {
  if (!event) return;
  const seq = typeof event.seq === "number" ? event.seq : null;
  const time = typeof event.time === "number" ? event.time : 0;
  const prev = liveSeqs.get(sid);
  if (!prev) {
    if (seq != null || time) liveSeqs.set(sid, { seq: seq || 0, time: time || 0 });
    return;
  }
  const prevSeq = Number(prev.seq) || 0;
  const prevTime = Number(prev.time) || 0;
  if (seq != null && seq > prevSeq) {
    liveSeqs.set(sid, { seq, time: Math.max(time, prevTime) });
  } else if (time > prevTime) {
    liveSeqs.set(sid, { seq: seq || 0, time });
  }
}

function markSeen(sid, event) {
  if (event && event.seq != null) seenSeq.add(seenKey(sid, event.seq));
}

function dayKeyOf(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function emptyAgg() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, tools: 0, turns: 0, steps: 0, total: 0 };
}
function mergeAgg(target, source) {
  target.requests += source.requests || 0;
  target.input += source.input || 0;
  target.output += source.output || 0;
  target.cacheRead += source.cacheRead || 0;
  target.tools += source.tools || 0;
  target.turns += source.turns || 0;
  target.steps += source.steps || 0;
  target.total = target.input + target.output;
}
function bumpUsage() { usage.version += 1; }

function cleanModel(raw) {
  let s = String(raw ?? "unknown").trim();
  if (!s) return "其他";
  const lower = s.toLowerCase();
  // 过滤 unknown 变体
  if (lower === "unknown" || lower === "unknwon" || lower === "unkanown" || lower === "urknowr" || lower.startsWith("unk")) return "其他";
  // 纠正 muse 拼写
  if (lower === "muse-park" || lower.includes("muse-park")) return "muse-spark";
  if (lower.includes("muse-spark")) return "muse-spark";
  if (lower === "muse") return "muse-spark";
  // 保持原样，长度截断避免过长
  if (s.length > 40) s = s.slice(0, 40);
  return s;
}

function ingestEvent(sessionId, event) {
  const time = event.time;
  const data = event.data || {};
  const live = usage.live;
  if (event.type === "assistant/message") {
    const usageInfo = data.usage;
    if (usageInfo) {
      const src = (data.message && data.message.source) ? data.message.source : null;
      const rawModel = src ? src.model : null;
      const model = cleanModel(rawModel || usageInfo.model || "unknown");
      // 渠道（provider）：同名模型在不同渠道下是两笔账（实测 opencode-go / deepseek-official
      // 都会跑 deepseek-v4-flash），旧实现只留 model 会把它们合并。
      const provider = src && src.provider ? String(src.provider).slice(0, 40) : "";
      const project = projectOf(sessionId);
      const day = dayKeyOf(time);
      // 本步耗时：step/start 仍在 live.stepStart 里（step/end 才删），可给出"这条回复花了多久"
      const stepKey0 = sessionId + ":" + data.turn + ":" + data.step;
      const stepStart0 = live.stepStart.get(stepKey0);
      const durationMs = typeof stepStart0 === "number" ? Math.max(0, time - stepStart0) : 0;
      const agg = {
        requests: 1,
        input: Number(usageInfo.inputTokens ?? 0) || 0,
        output: Number(usageInfo.outputTokens ?? 0) || 0,
        cacheRead: Number(usageInfo.cacheReadTokens ?? 0) || 0,
        tools: 0,
        turns: 0,
        steps: 0,
      };
      const dayAgg = usage.perDay.get(day) || emptyAgg();
      mergeAgg(dayAgg, agg);
      usage.perDay.set(day, dayAgg);
      let modelMap = usage.perModel.get(model);
      if (!modelMap) { modelMap = new Map(); usage.perModel.set(model, modelMap); }
      const modelAgg = modelMap.get(day) || emptyAgg();
      mergeAgg(modelAgg, agg);
      modelMap.set(day, modelAgg);
      // v4 渠道维度
      if (provider) {
        let pMap = usage.perProviderDay.get(provider);
        if (!pMap) { pMap = new Map(); usage.perProviderDay.set(provider, pMap); }
        const pAgg = pMap.get(day) || emptyAgg();
        mergeAgg(pAgg, agg);
        pMap.set(day, pAgg);
      }
      // v4 项目维度（无 cwd 的会话统一落 '—'）
      const pjKey = project || "—";
      let pjMap = usage.perProjectDay.get(pjKey);
      if (!pjMap) { pjMap = new Map(); usage.perProjectDay.set(pjKey, pjMap); }
      const pjAgg = pjMap.get(day) || emptyAgg();
      mergeAgg(pjAgg, agg);
      pjMap.set(day, pjAgg);
      live.outputTokens += agg.output;
      live.msgs += 1;
      // 瞬时速率的窗口样本（近 RATE_WINDOW_MS）
      live.outputs60.push({ t: time, tokens: agg.output });
      if (live.outputs60.length > RATE_SAMPLES_MAX) live.outputs60.splice(0, live.outputs60.length - RATE_SAMPLES_MAX);
      usage.records.unshift({ time: time, sessionId: String(sessionId).slice(0, 12), model: model, provider: provider, project: project, input: agg.input + agg.cacheRead, output: agg.output, cacheRead: agg.cacheRead, durationMs: durationMs });
      if (usage.records.length > 50) usage.records.length = 50;
      bumpUsage();
      // v2 持久化：events 幂等账本（daily_usage 由 flushDb 从 events 按天重建，不再增量累加）
      try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: model, input: agg.input, output: agg.output, cache_read: agg.cacheRead, cache_write: Number(usageInfo.cacheWriteTokens ?? 0)||0, type: event.type, raw: null, project: project||null, tool: null, ms: durationMs, provider: provider||null}); }catch(e){}
      // 同步写入 legacy realtimeHourly（model::hour）
      try {
        const d = time ? new Date(time) : new Date();
        const hourKey = isNaN(d.getTime()) ? day : d.toISOString().slice(0, 13);
        const localDate = day;
        const key = model + "::" + hourKey;
        const cur = realtimeHourly.get(key) || { model, hour: hourKey + ":00:00.000Z", localDate, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, count: 0 };
        cur.uncachedInputTokens += agg.input;
        cur.outputTokens += agg.output;
        cur.cacheReadTokens += agg.cacheRead;
        cur.cacheWriteTokens += Number(usageInfo.cacheWriteTokens ?? 0) || 0;
        cur.count += 1;
        realtimeHourly.set(key, cur);
        markSeen(sessionId, event);
      } catch (e) {}
    }
    return;
  }
  if (event.type === "turn/end") {
    // 失败轮次（实测 reason.kind="error"，如 MISSING_CREDENTIAL / TRANSPORT）。
    // 这类轮次照样计入轮数，但要在"可靠性"里能看出来，否则只看到"花了钱没产出"。
    try{
      const reason = data.reason || null;
      if (reason && (reason.kind === "error" || reason.error)) live.errors += 1;
    }catch(e){}
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.turns += 1;
    usage.perDay.set(day, dayAgg);
    live.turns += 1;
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null, project: projectOf(sessionId)||null, tool: null, ms: 0}); }catch(e){}
    return;
  }
  if (event.type === "step/start") {
    live.stepStart.set(sessionId + ":" + data.turn + ":" + data.step, time);
    return;
  }
  if (event.type === "step/end") {
    const key = sessionId + ":" + data.turn + ":" + data.step;
    const start = live.stepStart.get(key);
    const toolAccum = live.stepToolAccum.get(key) || 0;
    if (typeof start === "number") live.llmMs += Math.max(0, time - start - toolAccum);
    live.stepStart.delete(key);
    live.stepToolAccum.delete(key);
    // firstChunk 只用于"本步首个 chunk 相对 step/start 的首 token 延迟"，步结束即失效。
    // 此前只写不删（key = session:turn:step），长时间运行 + 每次启动全量回填都会往里灌，
    // 是确定性的内存泄漏。
    live.firstChunk.delete(key);
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.steps += 1;
    usage.perDay.set(day, dayAgg);
    live.steps += 1;
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null, project: projectOf(sessionId)||null, tool: null, ms: 0}); }catch(e){}
    return;
  }
  if (event.type === "tool/call") {
    // 工具名只在 tool/call 上（实测 data.name = read/edit/pwsh/grep/job_output…）。
    // 不落库（避免 events 体积 +15%），而是把名字挂到对应 tool/result 行上，
    // 这样 daily_tool 仍可从 events 幂等重建。
    live.toolStart.set(String(data.callId), { t: time, name: data.name ? String(data.name).slice(0,40) : "" });
    return;
  }
  if (event.type === "tool/result") {
    const callId = data.message && data.message.source ? String(data.message.source.callId || "") : "";
    const rec = live.toolStart.get(callId);
    const start = rec ? Number(rec.t) : NaN;
    const name = (rec && rec.name) || "";
    let duration = 0;
    if (Number.isFinite(start)) {
      duration = Math.max(0, time - start);
      live.toolMs += duration;
      live.toolCalls += 1;
      const stepKey = sessionId + ":" + data.turn + ":" + data.step;
      live.stepToolAccum.set(stepKey, (live.stepToolAccum.get(stepKey) || 0) + duration);
    }
    if (callId) live.toolStart.delete(callId);
    // 工具失败：message.isError 或 content 里带 isError / tool-error
    try{
      const msg = data.message || {};
      const isErr = !!msg.isError || (Array.isArray(msg.content) && msg.content.some(function(c){ return c && (c.isError === true || c.type === "tool-error"); }));
      if (isErr) live.toolErrors += 1;
    }catch(e){}
    const toolName = name || "—";
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.tools += 1;
    usage.perDay.set(day, dayAgg);
    // 项目维度同样要计工具调用：daily_project.tools 有这一列，内存侧漏计会让
    // "刚全量扫完、还没重启 hydrate"的项目卡工具数恒为 0，与重启后不一致。
    const pjKey = projectOf(sessionId) || "—";
    let pjMap = usage.perProjectDay.get(pjKey);
    if (!pjMap) { pjMap = new Map(); usage.perProjectDay.set(pjKey, pjMap); }
    const pjAgg = pjMap.get(day) || emptyAgg();
    pjAgg.tools += 1;
    pjMap.set(day, pjAgg);
    // v4 工具维度（与 daily_tool 同口径：只统计 tool/result 的次数与耗时）
    let tMap = usage.perToolDay.get(toolName);
    if (!tMap) { tMap = new Map(); usage.perToolDay.set(toolName, tMap); }
    const tAgg = tMap.get(day) || { calls: 0, ms: 0 };
    tAgg.calls += 1; tAgg.ms += duration;
    tMap.set(day, tAgg);
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null, project: projectOf(sessionId)||null, tool: toolName, ms: duration}); }catch(e){}
    return;
  }
  // 步内"首个产出信号"：assistant/chunk 在会话文件里一定带 turn/step（实测 3763 条零缺失），
  // 但实时事件流是否投递它无法先验保证（实测活跃对话下 firstTokenCount 恒为 0）。
  // 这里对 4 类流式事件做广匹配 + 按事件名分类计数：任一被投递即可测出首 token 延迟，
  // 分类计数随 payload 下发，可一眼看出实时流到底送了哪些事件。
  if (SIGNAL_EVENT_TYPES.indexOf(event.type) >= 0) {
    live.signalCount[event.type] = (live.signalCount[event.type] || 0) + 1;
    // tool-call-chunks 只是"开始吐工具调用"，不代表出了 token，不计入首 token 样本
    const key = sessionId + ":" + data.turn + ":" + data.step;
    if (event.type !== "tool-call-chunks" && !live.firstChunk.has(key)) {
      live.firstChunk.set(key, time);
      const start = live.stepStart.get(key);
      if (typeof start === "number") {
        live.firstTokenSum += Math.max(0, time - start);
        live.firstTokenCount += 1;
      }
    }
    return;
  }
  // 可靠性：重试（实测 data.failure.code = TRANSPORT / RATE_LIMIT / EMPTY_RESPONSE…）
  if (event.type === "llm/retry") {
    live.retries += 1;
    const code = data.failure && data.failure.code ? String(data.failure.code).slice(0,40) : "UNKNOWN";
    live.retryCodes.set(code, (live.retryCodes.get(code) || 0) + 1);
    bumpUsage();
    return;
  }
  // 可靠性：上下文压缩（官方命令 /compact，会一次性吃掉大量 token）
  if (event.type === "compaction/end") {
    live.compactions += 1;
    bumpUsage();
    return;
  }
}

async function decompressMultiFrame(buf){
  const MAGIC = Buffer.from([0x28,0xb5,0x2f,0xfd]);
  let offset=0, out="";
  let zstdDecompressSync;
  try{
    const zlib = await import("node:zlib");
    zstdDecompressSync = zlib.zstdDecompressSync;
  }catch(e){
    try{ const zlib2 = await import("node:zlib"); zstdDecompressSync = zlib2.zstdDecompressSync; }catch(_){ return ""; }
  }
  if(!zstdDecompressSync) return "";
  while(offset < buf.length){
    let next = buf.indexOf(MAGIC, offset+1);
    let slice = next===-1 ? buf.slice(offset) : buf.slice(offset, next);
    if(slice.length===0) break;
    try{ out += zstdDecompressSync(slice).toString("utf-8"); }catch(e){}
    if(next===-1) break;
    offset = next;
  }
  return out;
}

async function scanFilesystemFallback(logger){
  const hourly = new Map();
  // 回填下限 = 90d 保留窗口与"用户主动清空账本的时刻"取大值（见 __resetAt）
  const cutoff = Math.max(Date.now() - USAGE_KEEP_MS, __resetAt);
  try{
    const { readdir, readFile } = await import("node:fs/promises");
    const { join, basename, dirname } = await import("node:path");
    const candidates = [];
    const pushUniq = (p)=>{ if(p && !candidates.includes(p)) candidates.push(p); };
    // 数据源隔离：只扫自己所在 dsh 进程的 DSH_HOME。~/.dsh / ~/.deepseek-harness /
    // cwd 相对路径等共享目录会吸入其他实例的会话，已删除。
    if(process.env.DSH_HOME){
      pushUniq(join(process.env.DSH_HOME, "sessions"));
      pushUniq(join(process.env.DSH_HOME, "profiles", "web", "sessions"));
      pushUniq(join(process.env.DSH_HOME, "profiles", "default", "sessions"));
    }
    const uniq = [...new Set(candidates)];
    for(const base of uniq){
      try{
        const walk = async (dir)=>{
          let entries;
          try{ entries = await readdir(dir, { withFileTypes:true }); }catch(e){ return; }
          for(const ent of entries){
            const p = join(dir, ent.name);
            if(ent.isDirectory()) await walk(p);
            else if(ent.isFile() && (p.endsWith(".jsonl") || p.endsWith(".jsonl.zstd"))){
              try{
                let buf = await readFile(p);
                let text;
                if(p.endsWith(".zstd")){
                  text = await decompressMultiFrame(buf);
                  if(!text) continue;
                } else text = buf.toString("utf-8");
                // 会话 id：优先父目录名（sessions/<workspace>/<sessionId>/session*.jsonl*），
                // 再退回文件名（不含扩展名）。禁止 slice(0,12)——曾把 session.v3.jsonl.zstd
                // 截成伪 id "session.v3.j" 污染账本。
                let sid = basename(dirname(p));
                if(!sid || sid === "sessions" || sid === "web" || sid === "default" || sid === "profiles"){
                  sid = ent.name.replace(/\.jsonl(\.zstd)?$/i, "");
                }
                // 项目归属的兜底来源：目录名是 cwd 的编码形式（sessions/<cwd>/<sid>/session.jsonl.zstd），
                // 会话头里也有权威 cwd（下面解析到就覆盖）
                let cwdOfFile = "";
                try{ cwdOfFile = decodeSessionDirName(basename(dirname(dirname(p)))); noteProject(sid, cwdOfFile); }catch(e){}
                for(const line of text.split("\n")){
                  if(!line.trim()) continue;
                  let obj; try{ obj=JSON.parse(line); }catch(e){ continue; }
                  // 首条 session 头携带权威 id
                  if(obj.type==="session" && obj.id){
                    sid = String(obj.id);
                    if(obj.cwd){ cwdOfFile = String(obj.cwd); noteProject(sid, cwdOfFile); }
                  }
                  // 维度回填模式（__enrichSink 非空）：必须在去重判断之前交给收集器，
                  // 否则老库里已见过的事件永远补不上 project/tool/ms 三列。
                  if(__enrichSink){ try{ __enrichSink(sid, obj, cwdOfFile); }catch(e){} }
                  if(shouldSkipEvent(sid, obj)) continue;
                  const maybeUsage = obj.data && obj.data.usage ? true : (obj.type==="assistant/message" || obj.type==="assistant/chunk" || obj.usage);
                  if(!maybeUsage && obj.type!=="turn/end" && obj.type!=="step/start" && obj.type!=="step/end" && obj.type!=="tool/call" && obj.type!=="tool/result") continue;
                  if(obj.time && obj.time < cutoff) continue;
                  ingestEvent(sid, obj);
                  markSeen(sid, obj);
                  advanceWatermark(sid, obj);
                  // collectHourly 用：hourly 需同步（ingestEvent 已写入 realtimeHourly）
                }
              }catch(e){}
            }
          }
        };
        await walk(base);
        // 回填模式下要遍历全部候选目录（profiles/web/sessions 等），不能被"已有数据"提前截断
        if(usage.perDay.size>0 && !__enrichSink) break;
      }catch(e){}
    }
  }catch(e){ logger?.warn?.(`[token-meter] fs scan failed ${e.message}`); }
  return usage.perDay;
}

// 单次回填的并发度与上限：readSession 是"读会话日志文件 + 解析"的重活，
// 串行读 74 个会话（本机 43.6MB）要好几秒；块内并发、块间保持原顺序。
const SCAN_CONCURRENCY = 4;
const SCAN_SESSION_CAP = 400;
// 会话级跳过只认"毫秒级 epoch"这一种 updatedAt 形态（官方契约未固定该字段语义，
// 秒级/缺字段一律退回真实读取，避免误判导致漏统计）：> 1e12 即 2001 年之后。
const MS_EPOCH_MIN = 1e12;

async function scanHistory(ctx, logger){
  // 服务名经 dsh 源码核实：dsh-session-query 提供的就是 "sessionQuery"
  const query = ctx.get("sessionQuery");
  if (!query || typeof query.listSessions !== "function") {
    logger?.info?.("[token-meter] sessionQuery 不可用，走文件兜底");
    await scanFilesystemFallback(logger);
    usage.ready = true; bumpUsage();
    return;
  }
  try{
    const sessions = await query.listSessions();
    // 与 fs 兜底同口径：清空过账本时不再回填 reset_at 之前的历史
    const cut = Math.max(Date.now() - USAGE_KEEP_MS, __resetAt);
    const t0 = Date.now();
    let scanned = 0, skipped = 0, ingested = 0, stopped = false;
    let idx = 0;
    while (idx < sessions.length && scanned < SCAN_SESSION_CAP && !stopped) {
      // 组一个块：块内并发读，块间顺序保持"listSessions 按 createdAt 降序 ⇒ 越界即停"的语义
      const chunk = [];
      while (idx < sessions.length && chunk.length < SCAN_CONCURRENCY && scanned + chunk.length < SCAN_SESSION_CAP) {
        const record = sessions[idx++];
        if (!record || !record.header) continue;
        const id = String(record.header.id || "");
        if (!id) continue;
        // 会话头 cwd（实测字段存在）= 项目归属的来源，先记下来，之后所有事件都能归到项目
        if (record.header.cwd) noteProject(id, record.header.cwd);
        // 越过 90d 窗口的老会话直接停（其事件本就会被 cut 过滤，读它纯属浪费）
        if (typeof record.header.createdAt === "number" && record.header.createdAt < cut) { stopped = true; break; }
        // 会话级跳过：该会话"最后一次活动时间"≤ 已记录水位线 ⇒ 事件必然全部见过，
        // 不必 readSession。这是"启动后增量 catch-up / 反复重扫"的主要开销来源。
        const wm = liveSeqs.get(id);
        const ua = record.header.updatedAt;
        if (wm && typeof ua === "number" && ua > MS_EPOCH_MIN && ua <= (Number(wm.time) || 0)) { skipped += 1; continue; }
        chunk.push(id);
      }
      if (!chunk.length) continue;
      const snaps = await Promise.all(chunk.map((id) => query.readSession(id).catch(() => null)));
      // 结果按原顺序摄入：保持去重与水位线推进的确定性（并发只改"读"，不改"写序"）
      for (let k = 0; k < snaps.length; k++) {
        const id = chunk[k];
        const events = snaps[k] && Array.isArray(snaps[k].events) ? snaps[k].events : [];
        for (const event of events) {
          if (!event || typeof event.time !== "number" || event.time < cut) continue;
          // 复合键 + 时间感知水位线：只比 seq 会在代际重置后丢掉全部新事件
          if (shouldSkipEvent(id, event)) continue;
          ingestEvent(id, event);
          markSeen(id, event);
          advanceWatermark(id, event);
          ingested += 1;
        }
        scanned += 1;
      }
    }
    logger?.info?.(`[token-meter] scanHistory via sessionQuery: scanned=${scanned} skipped=${skipped} ingested=${ingested} perDay=${usage.perDay.size} records=${usage.records.length} in ${Date.now()-t0}ms`);
  } catch(e){
    usage.error = String(e && e.message || e).slice(0,300);
    logger?.warn?.(`[token-meter] scanHistory failed ${usage.error}, fallback fs`);
    try{ await scanFilesystemFallback(logger); }catch(_){}
  }
  usage.ready = true;
  bumpUsage();
}

// P2: in-flight 门——scanHistory 最多读 400 个窗口内会话，绝不并发重入。
// 此前 init 的延迟增量扫与启动期 /api/token-meter 请求可能各自触发一次
// （readSession 双倍 CPU）；门内后到调用直接复用进行中的 promise。
let __scanInFlight = null;
function scanHistoryOnce(ctx, logger){
  if(__scanInFlight) return __scanInFlight;
  __scanInFlight = (async()=>{
    try{ await scanHistory(ctx, logger); } finally { __scanInFlight = null; }
  })();
  return __scanInFlight;
}

// ===== v4 一次性维度回填 =====
// 老库（v3 及更早）的 events 没有 project/tool/ms 三列，补列之后这些值是空的，
// 而三个值都能从会话事件流还原：project ← 会话头 cwd、tool ← tool/call.data.name、
// ms ← tool/call→tool/result 的时间差（assistant/message 则是 step/start→消息的耗时）。
// 只做 UPDATE（不碰计数列、不重算聚合），因此不存在重复计数风险；完成后重建两张派生表、
// 重新 hydrate，并把 meta.dims_backfill 置 1（只跑一次）。
async function enrichDimensions(ctx, logger){
  if(!__db) return 0;
  try{
    if(String((__db.prepare("SELECT v FROM meta WHERE k='dims_backfill'").get() || {}).v) === "1") return 0;
  }catch(e){ return 0; }
  // 空库（首次安装 / 刚清空过）不需要回填：紧随其后的全量扫描会把 project/tool/ms/provider
  // 四列随事件一起写进去（见 ingestEvent → queueEvent）。这样新装用户不会因为新增维度
  // 把启动期的会话扫描 I/O 翻倍，直接标记完成即可。
  if(usage.perDay.size === 0){
    try{ __db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('dims_backfill','1')").run(); }catch(e){}
    return 0;
  }
  const t0 = Date.now();
  const pairs = [];
  const pending = new Map();        // callId → {t, name}
  const stepStart = new Map();      // sid:turn:step → 时间
  const sink = (sid, ev, cwd) => {
    if(!ev || typeof ev.seq !== "number") return;
    if(cwd) noteProject(sid, cwd);
    const d = ev.data || {};
    const t = Number(ev.time) || 0;
    if(ev.type === "step/start"){ stepStart.set(sid + ":" + d.turn + ":" + d.step, t); return; }
    if(ev.type === "tool/call"){
      pending.set(String(d.callId || ""), { t: t, name: d.name ? String(d.name).slice(0,40) : "" });
      return;
    }
    if(ev.type === "tool/result"){
      const callId = d.message && d.message.source ? String(d.message.source.callId || "") : "";
      const rec = pending.get(callId);
      const ms = rec && rec.t ? Math.max(0, t - rec.t) : 0;
      if(callId) pending.delete(callId);
      pairs.push({ sid, seq: ev.seq, project: projectOf(sid) || null, tool: (rec && rec.name) || null, ms });
      return;
    }
    if(ev.type === "assistant/message" && d.usage){
      const st = stepStart.get(sid + ":" + d.turn + ":" + d.step);
      const src = d.message && d.message.source ? d.message.source : null;
      pairs.push({ sid, seq: ev.seq, project: projectOf(sid) || null, tool: null, provider: (src && src.provider) ? String(src.provider).slice(0,40) : null, ms: (typeof st === "number" ? Math.max(0, t - st) : 0) });
    }
  };
  __enrichSink = sink;
  let read = "none";
  try{
    const query = ctx.get("sessionQuery");
    const cut = Math.max(Date.now() - USAGE_KEEP_MS, __resetAt);
    if(query && typeof query.listSessions === "function" && typeof query.readSession === "function"){
      read = "sessionQuery";
      const sessions = await query.listSessions();
      for(let i=0;i<sessions.length && i<SCAN_SESSION_CAP;i++){
        const rec = sessions[i];
        if(!rec || !rec.header || !rec.header.id) continue;
        if(typeof rec.header.createdAt === "number" && rec.header.createdAt < cut) break;
        const sid = String(rec.header.id);
        if(rec.header.cwd){ noteProject(sid, rec.header.cwd); }
        const snap = await query.readSession(sid).catch(() => null);
        const evs = snap && Array.isArray(snap.events) ? snap.events : [];
        for(const ev of evs) sink(sid, ev, rec.header.cwd);
      }
    } else {
      read = "fs";
      // 复用文件兜底扫描的解析/解压逻辑（__enrichSink 会让它顺带收集而不是只摄入）
      await scanFilesystemFallback(logger);
    }
  }catch(e){
    logger?.warn?.(`[token-meter] dims enrich read failed ${e && e.message || e}`);
  } finally {
    __enrichSink = null;
  }
  let applied = 0;
  try{
    const upd = __db.prepare("UPDATE events SET project=COALESCE(project,?), tool=COALESCE(tool,?), provider=COALESCE(NULLIF(provider,''),?), ms=CASE WHEN ms>0 THEN ms ELSE ? END WHERE seq=? AND session_id=?");
    __db.exec("BEGIN IMMEDIATE");
    try{
      // ⚠️ 绑定值必须是 null 而不是 undefined：node:sqlite 对 undefined 直接抛
      // "Provided value cannot be bound to SQLite parameter N"（tool/result 的 pair 没有 provider）
      for(const p of pairs) applied += Number(upd.run(p.project || null, p.tool || null, p.provider || null, p.ms || 0, p.seq, p.sid).changes) || 0;
      const now = Date.now();
      rebuildToolPartitions(__db, now);
      rebuildProjectPartitions(__db, now);
      __db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('dims_backfill','1')").run();
      __db.exec("COMMIT");
    }catch(e2){
      try{ __db.exec("ROLLBACK"); }catch(_){}
      throw e2;
    }
  }catch(e){
    logger?.warn?.(`[token-meter] dims backfill write failed ${e && e.message || e}`);
    return 0;
  }
  hydrateDimensionTables();
  logger?.info?.(`[token-meter] dims backfill via ${read}: pairs=${pairs.length} applied=${applied} in ${Date.now()-t0}ms`);
  bumpUsage();
  return pairs.length;
}

// ===== 清空用量账本（设置页"维护"组）=====
// 语义：把"本插件自己的账本"清零，并记下 reset_at，使此后任何回填都跳过这一刻之前的历史
// （否则一次重启就会把刚清掉的历史又灌回来）。
function resetUsage(logger){
  let cleared = 0;
  const at = Date.now();
  if(__db){
    try{
      __db.exec("BEGIN IMMEDIATE");
      try{
        cleared = Number(__db.prepare("DELETE FROM events").run().changes) || 0;
        __db.prepare("DELETE FROM daily_usage").run();
        __db.prepare("DELETE FROM daily_tool").run();
        __db.prepare("DELETE FROM daily_project").run();
        __db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('reset_at',?)").run(String(at));
        __db.exec("COMMIT");
      }catch(e2){
        try{ __db.exec("ROLLBACK"); }catch(_){}
        throw e2;
      }
    }catch(e){ logger?.warn?.(`[token-meter] reset db failed ${e && e.message || e}`); }
  }
  __resetAt = at;
  usage.perDay = new Map();
  usage.perModel = new Map();
  usage.perToolDay = new Map();
  usage.perProjectDay = new Map();
  usage.perProviderDay = new Map();
  usage.records = [];
  usage.error = null;
  sessionMeta.clear();
  realtimeHourly.clear();
  seenSeq.clear();
  liveSeqs.clear();
  const live = usage.live;
  live.turns = 0; live.steps = 0; live.llmMs = 0; live.toolMs = 0; live.toolCalls = 0;
  live.firstTokenSum = 0; live.firstTokenCount = 0; live.outputTokens = 0; live.msgs = 0;
  live.outputs60 = []; live.signalCount = {}; live.retries = 0; live.retryCodes = new Map();
  live.compactions = 0; live.errors = 0; live.toolErrors = 0;
  live.stepStart.clear(); live.stepToolAccum.clear(); live.toolStart.clear(); live.firstChunk.clear();
  bumpUsage();
  return cleared;
}

// 存储健康快照（设置页"数据健康"一行）：库文件大小 / 账本行数 / 跨度 / 最后回填时间。
// 失败一律降级为 null 字段，不让健康检查把数据接口带崩。
function dbHealthSnapshot(){
  const out = { store: (__dbReady && __dbPath) ? ("db:" + __dbPath) : "memory", dbBytes: null, events: null, days: null, lastScanAt: null };
  if(!__db) return out;
  try{
    const c = __db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT day) AS d FROM events").get();
    out.events = Number(c && c.n) || 0;
    out.days = Number(c && c.d) || 0;
  }catch(e){}
  try{
    const m = __db.prepare("SELECT v FROM meta WHERE k='last_scan_at'").get();
    const v = Number(m && m.v) || 0;
    out.lastScanAt = v > 0 ? v : null;
  }catch(e){}
  try{
    const fsm = __fsModule || null;
    if(fsm && __dbPath) out.dbBytes = Number(fsm.statSync(__dbPath).size) || 0;
  }catch(e){}
  return out;
}

// 区间 → 当前窗口天数 / 上期窗口天数（0 = 不设窗口）。抽出来是为了让 90d 复用
// 1d/7d/30d 那套"以本地今天为终点、上期紧邻前一段"的日历语义，不再各写一份分支。
function rangeSpec(range){
  switch(range){
    case "1d": return { cur: 1, prev: 1 };
    case "7d": return { cur: 7, prev: 7 };
    case "30d": return { cur: 30, prev: 30 };
    case "90d": return { cur: 90, prev: 0 };
    default: return { cur: 0, prev: 0 }; // all
  }
}
// 缓存命中率（%）= cacheRead / (新输入 + cacheRead)。无输入返回 null，前端显示 "—"。
function cacheHitRate(input, cacheRead){
  const denom = (Number(input) || 0) + (Number(cacheRead) || 0);
  if(denom <= 0) return null;
  return Math.round(((Number(cacheRead) || 0) / denom) * 1000) / 10;
}
// 近 RATE_WINDOW_MS 的瞬时输出速率：窗口内 assistant/message 的输出 token ÷ 窗口秒数。
// 与 tokPerSec 的区别是分母：这里用墙钟时间，所以没有新消息时会自然回落。
function rateOverWindow(nowMs){
  const from = nowMs - RATE_WINDOW_MS;
  let tokens = 0;
  for(const s of usage.live.outputs60){ if(s && s.t >= from) tokens += s.tokens || 0; }
  return { tokens, perSec: Math.round((tokens / (RATE_WINDOW_MS / 1000)) * 10) / 10 };
}

function computeUsage(range){
  const dayList = [];
  for (const [key, agg] of usage.perDay) dayList.push({ date: key, agg: agg });
  dayList.sort((a,b)=> (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const totalFor = (list)=>{ const t=emptyAgg(); for(const d of list) mergeAgg(t,d.agg); return t; };
  let current = dayList;
  let previous = [];
  // 以「本地今天」为终点的真实日历窗口（而非“最近 N 个有数据的天”）：
  // 今天尚无用量的日子必须计为空，避免把昨天/更早的数据误标为今日。
  const pad2 = (n) => String(n).padStart(2, "0");
  const keyAt = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const windowKeys = (n) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(keyAt(i)); return s; };
  // 区间 → 当前/上期窗口（保持 1d/7d/30d 原有日历语义，90d 复用同一套；all = 全窗口无上期）
  const spec = rangeSpec(range);
  if (spec.cur > 0) {
    const cw = windowKeys(spec.cur);
    current = dayList.filter(d => cw.has(d.date));
    if (spec.prev > 0) {
      const pw = windowKeys(spec.cur + spec.prev);
      previous = dayList.filter(d => !cw.has(d.date) && pw.has(d.date));
    }
  } else {
    current = dayList;
  }
  const totals = totalFor(current);
  const prevTotals = previous.length ? totalFor(previous) : null;
  const models=[];
  for(const [model, byDay] of usage.perModel){
    if(model==="__system") continue;
    let sum=null;
    for(const day of current){
      const agg = byDay.get(day.date);
      if(agg){ if(!sum) sum=emptyAgg(); mergeAgg(sum, agg); }
    }
    if(sum) models.push({ model, requests: sum.requests, input: sum.input + sum.cacheRead, output: sum.output, cacheRead: sum.cacheRead, total: sum.input + sum.output + sum.cacheRead });
  }
  models.sort((a,b)=> b.total - a.total);
  // v4 维度：把"天 → 维度"的内存结构按当前窗口折叠成排行数组
  // 维度的窗口裁剪走日历键（而不是"perDay 里出现过的天"）：这样某天只有工具事件、
  // 没有 assistant/message 时也不会被漏掉；range=all 时不设窗口。
  const winKeys = spec.cur > 0 ? windowKeys(spec.cur) : null;
  const inWin = (day) => (!winKeys || winKeys.has(day));
  const tools = [];
  for(const [tool, byDay] of usage.perToolDay){
    let calls = 0, ms = 0;
    for(const [day, v] of byDay){ if(inWin(day)){ calls += v.calls || 0; ms += v.ms || 0; } }
    if(calls > 0) tools.push({ tool, calls, ms, avgMs: Math.round(ms / calls) });
  }
  tools.sort((a,b)=> (b.calls - a.calls) || (b.ms - a.ms));
  const projects = [];
  for(const [project, byDay] of usage.perProjectDay){
    const sum = emptyAgg();
    for(const [day, v] of byDay){ if(inWin(day)) mergeAgg(sum, v); }
    // tools>0 也算"有活动"：窗口内只有工具调用、没有 assistant/message 的项目同样要能看见
    if(sum.requests > 0 || sum.input > 0 || sum.cacheRead > 0 || sum.tools > 0){
      projects.push({ project, requests: sum.requests, freshInput: sum.input, output: sum.output, cacheRead: sum.cacheRead, tools: sum.tools, total: sum.input + sum.output + sum.cacheRead });
    }
  }
  projects.sort((a,b)=> b.total - a.total);
  const providers = [];
  for(const [provider, byDay] of usage.perProviderDay){
    const sum = emptyAgg();
    for(const [day, v] of byDay){ if(inWin(day)) mergeAgg(sum, v); }
    if(sum.requests > 0) providers.push({ provider, requests: sum.requests, freshInput: sum.input, output: sum.output, cacheRead: sum.cacheRead, total: sum.input + sum.output + sum.cacheRead });
  }
  providers.sort((a,b)=> b.total - a.total);
  const live = usage.live;
  const totalsPrompt = totals.input + totals.cacheRead;
  const rate = rateOverWindow(Date.now());
  return {
    // prompt 保持旧口径（= 新输入 + 缓存读）不破坏悬浮窗；新增 freshInput / cacheHitRate
    // 供设置页把"输入"拆成两段——旧 UI 把 prompt 标成"输入"、旁边又并列"缓存读"，
    // 实测缓存读占 prompt 的 93%~96%，看起来像重复计数。
    totals: { total: totalsPrompt + totals.output, prompt: totalsPrompt, freshInput: totals.input, completion: totals.output, cache_read: totals.cacheRead, cacheHitRate: cacheHitRate(totals.input, totals.cacheRead), requests: totals.requests, turns: totals.turns, steps: totals.steps, tools: totals.tools },
    prevTotals: prevTotals ? { total: prevTotals.input + prevTotals.output + prevTotals.cacheRead, requests: prevTotals.requests, freshInput: prevTotals.input, cacheRead: prevTotals.cacheRead, output: prevTotals.output } : null,
    tools: tools.slice(0, DIM_TOP_N),
    projects: projects.slice(0, DIM_TOP_N),
    providers: providers,
    daily: current.map((d)=>{
      const prompt = d.agg.input + d.agg.cacheRead;
      const dayModels=[];
      for(const [dm, byDay] of usage.perModel){ if(dm==="__system") continue; const ma=byDay.get(d.date); if(ma){ const p=ma.input+ma.cacheRead; dayModels.push({ model: dm, total: p+ma.output }); } }
      dayModels.sort((a,b)=>b.total-a.total);
      return { date: d.date, requests: d.agg.requests, prompt, completion: d.agg.output, cache_read: d.agg.cacheRead, total: prompt + d.agg.output, tools: d.agg.tools, turns: d.agg.turns, steps: d.agg.steps, models: dayModels };
    }),
    models: models,
    records: usage.records,
    // live 全部是"本次进程启动至今"的累计值（除 rate60*），客户端据此标注口径
    live: {
      turns: live.turns, steps: live.steps, llmMs: live.llmMs, toolMs: live.toolMs, toolCalls: live.toolCalls,
      firstTokenMs: live.firstTokenCount ? live.firstTokenSum / live.firstTokenCount : 0,
      firstTokenCount: live.firstTokenCount,
      // tokPerSec：累计均值（分母是 LLM 忙碌时间）；rate60：近 60s 的瞬时输出速率（分母是墙钟时间）
      tokPerSec: live.llmMs > 0 ? (live.outputTokens / live.llmMs) * 1000 : 0,
      rate60: rate.perSec,
      rate60Tokens: rate.tokens,
      rate60WindowSec: Math.round(RATE_WINDOW_MS / 1000),
      msgs: live.msgs,
      signalCount: Object.assign({}, live.signalCount),
      outputTokens: live.outputTokens,
    },
    reliability: {
      since: "start",
      retries: live.retries,
      retryCodes: [...live.retryCodes.entries()].map(function(e){ return { code: e[0], n: e[1] }; }).sort(function(a,b){ return b.n - a.n; }),
      compactions: live.compactions,
      errors: live.errors,
      toolErrors: live.toolErrors,
    },
  };
}

// dsh host 半端以 cordis ctx 调用 apply（对照 runtime/dsh 源码确认：
// cordis 核心以 apply(ctx, config) 装载插件，inject 声明的服务同时以属性
// 形式可用；官方 dsh-session-telemetry 亦以 ctx.on("session/event") 消费
// 会话事件流）。此前这里保留了三套调用约定探测与多发射器扫射，均属死分支。
export function apply(ctx) {
  const webServer = ctx.get("webServer");
  const logger = ctx.get("logger") ?? console;
  __logger = logger;
  // 官方 home 路径服务（loader 在启动时 ctx.provide("dshHomePath", dshHomePath)，
  // 内部即 `DSH_HOME || ~/.dsh`）：桌面版没有 DSH_HOME 环境变量，持久化只能靠它解析路径。
  try{
    const hp = ctx.get("dshHomePath");
    if(typeof hp === "function"){
      const storages = hp("storages");
      if(storages) __homeStorages = String(storages);
    }
  }catch(e){}
  if(!process.env.DSH_HOME && !__homeStorages){
    logger?.warn?.("[token-meter] DSH_HOME 与 dshHomePath 均不可用，降级为内存模式（不持久化）");
  }
  if (!webServer) {
    logger?.warn?.("[token-meter] webServer 服务不可用，代理端点未注册");
    return;
  }

  // 实时会话事件流（官方 dsh-session-telemetry 同款消费方式）：
  // event = { type, seq:number, time:number, data }，回调参数固定 (session, event)。
  // 水位线 {seq,time} + seenSeq 复合键：seq 只在会话内唯一，且历史全局大 seq
  // 与当前会话内小 seq 之间存在代际差，必须叠时间才能接住继续对话的新事件。
  ctx.on("session/event", (session, event) => {
    try {
      if (!event || typeof event.time !== "number") return;
      const sid = String(session?.id || "live");
      // 会话 → 项目：官方 session 对象上若带 cwd（列表/详情投影）就直接取，省一次文件回填
      try{
        const cwd = session && (session.cwd || session.workingDirectory || session.directory);
        if (cwd) noteProject(sid, cwd);
      }catch(e){}
      if (event.time < Date.now() - USAGE_KEEP_MS) return;
      if (shouldSkipEvent(sid, event)) return;
      advanceWatermark(sid, event);
      markSeen(sid, event);
      ingestEvent(sid, event);
    } catch (e) { /* 单事件失败不阻断事件流 */ }
  });

  (async()=>{
    try{
      // C 方案：先确保 DB（app_data_dir）并 hydrate 内存，避免冷启动全量扫盘
      try{ await ensureDb(logger); }catch(e){ logger?.warn?.(`[token-meter] ensureDb init failed ${e.message}`); }
      // v4 一次性维度回填（工具名/项目/耗时）：fail-soft，失败只影响新维度，不影响主链路
      try{ await enrichDimensions(ctx, logger); }catch(e){ logger?.warn?.(`[token-meter] dims enrich failed ${e && e.message || e}`); }
      // 若 hydrate 后已有数据则增量 catch-up，否则全量扫
      if(__dbReady && usage.perDay.size>0){
        logger?.info?.(`[token-meter] DB hydrate done, perDay=${usage.perDay.size}, skip full scan`);
        usage.ready=true; bumpUsage();
        // 异步增量扫（不阻塞首屏）
        setTimeout(()=>{ scanHistoryOnce(ctx, logger).catch(()=>{}); }, 1200);
      } else {
        await scanHistoryOnce(ctx, logger);
      }
      // 兜底 flush
      try{ flushDb(); }catch(e){}
      logger?.info?.(`[token-meter] init done, perDay=${usage.perDay.size} records=${usage.records.length} tools=${usage.perToolDay.size} projects=${usage.perProjectDay.size} seenSeq=${seenSeq.size} realtimeHourly=${realtimeHourly.size} db=${__dbReady?"ready("+__dbPath+")":"memory"} home=${process.env.DSH_HOME||"?"} profile=${process.env.DSH_PROFILE||"?"}`);
    }catch(e){ logger?.warn?.(`[token-meter] init failed ${e.message}`); }
  })();

  webServer.register({
    kind: "prefix",
    path: "/api/opencode",
      handler: async (req, res) => {
        if (!localGuard(req, res)) return;
        const url = new URL(req.url ?? "/", "http://x");
        const pathname = url.pathname;
        // 配置变更/手动测试时重置退避：401/403 也会进退避（最长 30min），
        // 用户更正 token 后不应被缓存失败顶住
        if (pathname === "/api/opencode/backoff-reset" && req.method === "POST") {
          __ocBackoff.fails = 0; __ocBackoff.nextAttemptAt = 0; __ocBackoff.lastError = null;
          json(res,200,{ok:true});
          return;
        }
        if (pathname === "/api/opencode/quota" && req.method === "GET") {
          // token 只走 header（query 传递会落入访问日志）；baseUrl 仍走 query
          const token = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i,"");
        const baseUrl = url.searchParams.get("baseUrl") || url.searchParams.get("base") || "";
        if (!token) { json(res,400,{ok:false,error:"missing token"}); return; }
        // P2: 退避窗口内 → 直接回缓存失败（不发起候选扫荡，无 "trying" 日志）
        if (Date.now() < __ocBackoff.nextAttemptAt) {
          const st = ocBackoffState();
          json(res,429,{ok:false,error:__ocBackoff.lastError||"backoff",backoff:true,retryAfterMs:st.retryAfterMs,fails:st.fails,hint:"opencode 端点退避中，将自动重试"});
          return;
        }
        try {
          const {data,url:hitUrl} = await tryFetchOpencode(baseUrl,token,logger);
          const n = normalizeOpencode(data);
          __ocBackoff.fails = 0; __ocBackoff.nextAttemptAt = 0; __ocBackoff.lastError = null;
          json(res,200,{ok:true,hitUrl,...n});
        } catch(e){
          const f = __ocBackoff.fails + 1;
          const wait = Math.min(OC_BACKOFF_BASE_MS * Math.pow(2, f - 1), OC_BACKOFF_MAX_MS);
          __ocBackoff.fails = f;
          __ocBackoff.nextAttemptAt = Date.now() + wait;
          __ocBackoff.lastError = String(e.message || e).slice(0,200);
          logger?.warn?.(`[opencode] ${__ocBackoff.lastError} (backoff ${Math.round(wait/1000)}s, fails=${f})`);
          json(res,502,{ok:false,error:__ocBackoff.lastError,hint:"检查 baseUrl/token",retryAfterMs:wait,fails:f});
        }
        return;
      }
      json(res,404,{ok:false,error:"not found"});
    },
  });
  webServer.register({
    kind: "prefix",
    path: "/api/deepseek",
      handler: async (req, res) => {
        if (!localGuard(req, res)) return;
        const url = new URL(req.url ?? "/", "http://x");
        const pathname = url.pathname;
        if (pathname === "/api/deepseek/balance" && req.method === "GET") {
          const token = req.headers["authorization"]?.replace(/^Bearer\s+/i,"");
        const baseUrl = url.searchParams.get("baseUrl") || "";
        if (!token) { json(res,400,{ok:false,error:"missing deepseek token"}); return; }
        try { const {data,url:hitUrl}=await fetchDeepSeek(baseUrl,token,logger); const n=normalizeDeepSeek(data); json(res,200,{ok:true,hitUrl,...n}); } catch(e){ logger?.warn?.(`[deepseek] ${e.message}`); json(res,502,{ok:false,error:String(e.message||e)}); }
        return;
      }
      if (pathname === "/api/deepseek/ping" && req.method === "GET") { json(res,200,{ok:true,pong:Date.now()}); return; }
      json(res,404,{ok:false,error:"not found"});
    },
  });
  webServer.register({
    kind: "prefix",
    path: "/api/r4coder",
      handler: async (req, res) => {
        if (!localGuard(req, res)) return;
        const url = new URL(req.url ?? "/", "http://x");
        const pathname = url.pathname;
        if (pathname === "/api/r4coder/backoff-reset" && req.method === "POST") {
          __r4Backoff.fails = 0; __r4Backoff.nextAttemptAt = 0; __r4Backoff.lastError = null;
          json(res,200,{ok:true});
          return;
        }
        if (pathname === "/api/r4coder/meta" && req.method === "GET") {
          // token 只走 header；baseUrl 走 query（自定义 host，A1）
          const token = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i,"");
          const baseUrl = url.searchParams.get("baseUrl") || url.searchParams.get("base") || "";
          if (!token) { json(res,400,{ok:false,error:"missing r4coder token"}); return; }
          if (!baseUrl) { json(res,400,{ok:false,error:"missing r4coder baseUrl（自定义 host，必填）"}); return; }
          if (Date.now() < __r4Backoff.nextAttemptAt) {
            const st = r4BackoffState();
            json(res,429,{ok:false,error:__r4Backoff.lastError||"backoff",backoff:true,retryAfterMs:st.retryAfterMs,fails:st.fails,hint:"R4Coder 端点退避中，将自动重试"});
            return;
          }
          try {
            const {data,url:hitUrl} = await fetchR4Coder(baseUrl,token,logger);
            const n = normalizeR4Coder(data);
            __r4Backoff.fails = 0; __r4Backoff.nextAttemptAt = 0; __r4Backoff.lastError = null;
            json(res,200,{ok:true,hitUrl,...n});
          } catch(e) {
            const f = __r4Backoff.fails + 1;
            const wait = Math.min(R4_BACKOFF_BASE_MS * Math.pow(2, f - 1), R4_BACKOFF_MAX_MS);
            __r4Backoff.fails = f;
            __r4Backoff.nextAttemptAt = Date.now() + wait;
            __r4Backoff.lastError = String(e.message || e).slice(0,200);
            logger?.warn?.(`[r4coder] ${__r4Backoff.lastError} (backoff ${Math.round(wait/1000)}s, fails=${f})`);
            json(res,502,{ok:false,error:__r4Backoff.lastError,hint:"检查 baseUrl/token",retryAfterMs:wait,fails:f});
          }
          return;
        }
        json(res,404,{ok:false,error:"not found"});
    },
  });
  webServer.register({
    kind: "exact",
    path: "/api/quota/ping",
    handler: async (req,res) => {
      if (!localGuard(req, res)) return;
      json(res,200,{ok:true,pong:Date.now(),providers:["opencode","deepseek","r4coder"]});
    }
  });
  // 清空用量账本（设置页"维护"组）：只清本插件自己的账本，并记 reset_at 使回填不再拉回历史
  webServer.register({
    kind: "exact",
    path: "/api/token-meter/reset",
    handler: async (req, res) => {
      if (!localGuard(req, res)) return;
      if (req.method !== "POST") { json(res,405,{ok:false,error:"method not allowed"}); return; }
      try{
        const cleared = resetUsage(logger);
        logger?.info?.(`[token-meter] usage ledger cleared by user: events=${cleared}`);
        json(res,200,{ok:true, cleared: cleared, store: (__dbReady && __dbPath) ? ("db:" + __dbPath) : "memory"});
      }catch(e){
        logger?.warn?.(`[token-meter] reset failed ${e.message}`);
        json(res,500,{ok:false,error:String(e.message||e)});
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/token-meter",
    handler: async (req, res) => {
      if (!localGuard(req, res)) return;
      if (req.method !== "GET") { json(res,405,{ok:false,error:"method not allowed"}); return; }
      try{
        const url = new URL(req.url ?? "/", "http://x");
        const range = (url.searchParams.get("range") || "7d");
        const validRange = RANGE_VALUES.includes(range) ? range : "7d";
        // withChart=1 时附带 30d 热力图数据（此前由 client 的 Tauri 死路径承担，
        // 实际从未生效，兜底路径要发第二个请求）
        const withChart = url.searchParams.get("withChart") === "1" || url.searchParams.get("withChart") === "true";
        // 确保已就绪：回填没结束就等它（scanHistoryOnce 的 in-flight 门会把并发请求收敛到同一次扫描）。
        // 旧条件带 `&& usage.perDay.size===0`：第一个会话一摄入 perDay 就非空，扫描仍在继续时
        // 就开始把"半截聚合"当结果发出——启动瞬间首屏用量偏小，靠客户端 15s 轮询才纠正。
        // 内存模式（DSH_HOME 缺失）下每次启动都要跑全量回填，这个窗口长期存在，必须等真正 ready。
        // 等待有上限：sessionQuery 万一卡住，不能让数据接口跟着挂死；超时后退回现有聚合，
        // 客户端下一次轮询会自然纠正。
        if(!usage.ready){
          await Promise.race([
            scanHistoryOnce(ctx, logger).catch(function(){}),
            new Promise(function(r){ setTimeout(r, READY_WAIT_MS); }),
          ]);
          if(!usage.ready) logger?.warn?.(`[token-meter] 回填未在 ${Math.round(READY_WAIT_MS/1000)}s 内完成，先按现有聚合响应`);
        }
        const stats = computeUsage(validRange);
        const daily30 = (withChart && validRange !== "30d") ? computeUsage("30d").daily : null;
        const todayStr = dayKeyOf(Date.now());
        // 旧 hourly：直接用 realtimeHourly（已同步）。这是客户端 1d 分时图唯一数据源，保留。
        const hourlyObj = Object.fromEntries(realtimeHourly);
        json(res,200,{
          ok:true,
          // 新口径（供重构后 UI）
          stats,
          totals: stats.totals,
          prevTotals: stats.prevTotals,
          daily: stats.daily,
          daily30,
          models: stats.models,
          // v4 新维度（都按当前 range 窗口裁剪）
          tools: stats.tools,
          projects: stats.projects,
          providers: stats.providers,
          reliability: stats.reliability,
          records: stats.records,
          live: stats.live,
          // 存储健康（库大小/账本行数/跨度/最后回填时间），供设置页"数据健康"一行
          health: dbHealthSnapshot(),
          // 1d 分时图数据源（客户端按今天过滤后渲染）；其余 legacy 口径
          // （today / byModel / totalsLegacy / hourlyLegacy）已随客户端旧兜底一起删除
          hourly: hourlyObj,
          todayStr,
          seenSeq: seenSeq.size,
          buckets: stats.daily.length,
          version: usage.version,
          ready: usage.ready,
          // 存储状态：`db:<路径>` = 已落盘；`memory` = 降级为纯内存（每次启动都要重扫会话历史）。
          // 客户端在设置页据此显示一行，避免"静默降级成内存模式"再次无从发现。
          store: (__dbReady && __dbPath) ? ("db:" + __dbPath) : "memory",
          range: validRange,
          updatedAt: Date.now(),
        });
      }catch(e){
        logger?.warn?.(`[token-meter] ${e.message}`);
        json(res,500,{ok:false,error:String(e.message||e)});
      }
    }
  });
  logger.info("dsh-quota-widget: hosting /api/opencode/* + /api/deepseek/* + /api/token-meter (perDay/perModel v1, 90d, liveSeqs)");
}

// 仅测试用：注入一个库连接（测试里通常传 new DatabaseSync(":memory:")），
// 以便对 daily_tool / daily_project 的派生逻辑与 upsert 补齐做断言。
function setDbForTesting(db){
  __db = db || null;
  __dbReady = !!db;
}

// 测试出口：只暴露纯函数与内存容器（供 test/ 用 node:test 直接断言），不参与运行时行为。
// 需要它是因为这些函数原本都是模块私有的，而它们恰好是 bug 高发区（日历窗口、水位线去重、
// 分档、home 解析、回填窗口）。
export const __testing = {
  usage, liveSeqs, seenSeq, realtimeHourly, sessionMeta,
  dayKeyOf, emptyAgg, mergeAgg, computeUsage, shouldSkipEvent, advanceWatermark, seenKey,
  resolveDbPath, synthesizeSeq, joinPath, cleanModel,
  normalizeOpencode, normalizeDeepSeek, normalizeR4Coder,
  hydrateHourlyBuckets,
  // v4：区间/口径/维度相关纯函数
  rangeSpec, cacheHitRate, rateOverWindow, projectFromCwd, decodeSessionDirName, noteProject, projectOf,
  resetUsage, ingestEvent, setDbForTesting, rebuildToolPartitions, rebuildProjectPartitions,
  hydrateDimensionTables, dbHealthSnapshot, SCHEMA_DDL,
  HOURLY_KEEP_MS, USAGE_KEEP_MS, READY_WAIT_MS, SCAN_CONCURRENCY, SCAN_SESSION_CAP, MS_EPOCH_MIN,
  RATE_WINDOW_MS, RANGE_VALUES, SCHEMA_VERSION, SIGNAL_EVENT_TYPES, DIM_TOP_N,
};
