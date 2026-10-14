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

// ===== C 方案：app_data_dir/token-meter.db 持久化（Node:sqlite WAL + Rust 共享）=====
let __db = null;
let __dbReady = false;
let __dbPath = null;
let __flushTimer = null;
let __exitHookInstalled = false;
let __logger = console;
// v2 设计：events = 唯一事实源（幂等账本，PK(seq,session_id) + INSERT OR IGNORE）
//          daily_usage = 派生缓存（flush 时对涉及天从 events 整区重建，REPLACE 语义）
//          → 任何路径的重复摄入（hydrate→scan 重扫、插件重载、fs 兜底）都收敛为真值，不再 += 永久污染
const __eventsQueue = [];
// v3：修复 v2 rebuildPartitionsInRange 按时间范围重算分区的缺陷——同日内早先
// 批次被 DELETE 后不再补回，daily_usage 每天只剩最后一次 flush 的批次，
// 重启 hydrate 后表现为用量骤减/热力图缺块。v2→v3 迁移从 events 真值
// 全量重建 daily_usage，一次性治愈历史脏数据。
const SCHEMA_VERSION = "3";

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
function resolveDbPath(){
  // 单库绑定：优先使用 DSH_HOME（所有 DSH 用户都有该环境变量），
  // 存到 $DSH_HOME/storages/token-meter.db，与 DSH 自身的会话投影缓存同级。
  // 缺失时返回 null，调用方降级为内存模式（不持久化）。
  if(process.env.DSH_HOME){
    try{ return joinPath(process.env.DSH_HOME, "storages/token-meter.db"); }catch(e){}
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
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    try{ mkdirSync(dirname(p), {recursive:true}); }catch(e){}
    const db = new DatabaseSync(p);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_usage(day TEXT NOT NULL, model TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, tools INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(day, model)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_usage(day);
      CREATE INDEX IF NOT EXISTS idx_daily_model_day ON daily_usage(model, day);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER, time INTEGER NOT NULL, day TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, raw TEXT, PRIMARY KEY(seq, session_id));
      CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, time DESC);
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(time DESC);
      CREATE INDEX IF NOT EXISTS idx_events_model ON events(model);
      INSERT OR IGNORE INTO meta(k,v) VALUES('ready','0');
      INSERT OR IGNORE INTO meta(k,v) VALUES('last_seen_seq','0');
      INSERT OR IGNORE INTO meta(k,v) VALUES('last_scan_at','0');
    `);
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
    const evs=__db.prepare("SELECT seq, time, session_id, model, input, output, cache_read, type FROM events ORDER BY time DESC LIMIT 50").all();
    for(let i=evs.length-1;i>=0;i--){
      const e=evs[i];
      usage.records.unshift({time:Number(e.time), sessionId:String(e.session_id).slice(0,8), model:String(e.model), input:Number(e.input)+Number(e.cache_read), output:Number(e.output), cacheRead:Number(e.cache_read)});
    }
    if(evs.length) usage.ready=true;
    // 同步 realtimeHourly：按 hour 聚合事件——从 events 全量 SQL 聚合。
    // 此前只回填最近 50 条，重启后旧小时桶全部丢失（legacy hourly 仅旧客户端
    // 消费，但口径应与 live 写入一致：只含 assistant/message）
    try{
      const hrs=__db.prepare("SELECT model, day, strftime('%Y-%m-%dT%H', time/1000, 'unixepoch') AS hk, SUM(input) i, SUM(output) o, SUM(cache_read) cr, SUM(cache_write) cw, COUNT(*) n FROM events WHERE type='assistant/message' GROUP BY model, hk").all();
      for(const r of hrs){
        realtimeHourly.set(r.model+"::"+r.hk, {model:String(r.model), hour:String(r.hk)+":00:00.000Z", localDate:String(r.day), uncachedInputTokens:Number(r.i)||0, outputTokens:Number(r.o)||0, cacheReadTokens:Number(r.cr)||0, cacheWriteTokens:Number(r.cw)||0, count:Number(r.n)||0});
      }
    }catch(e){}
  }catch(e){ throw e; }
}

// events / daily_usage 过期清理（90d 保留窗口与 USAGE_KEEP_MS 对齐）：
// events 是唯一事实源但从不清理会无限膨胀（raw 全量账本，50 条记录/天量级
// 数年后可达数百 MB）；daily_usage 同窗口裁剪保持与 hydrate 口径一致。
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
      db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('last_prune_at',?)").run(String(Date.now()));
      db.exec("COMMIT");
      if (Number(ev.changes)>0 || Number(du.changes)>0) {
        logger?.info?.(`[token-meter] pruned expired rows: events=${ev.changes} daily_usage=${du.changes} (90d window)`);
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
    // 1) events 幂等账本：INSERT OR IGNORE（PK: seq+session_id），重复事件被天然去重
    const insEv=__db.prepare("INSERT OR IGNORE INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    // M1 安全整改：day 列由时间戳在 flush 时刻重新生成（dayKeyOf 只接受数字），
    // 队列携带的外部字符串不再进入 SQL 绑定参数；同时记录批次的 时间范围，
    // 供第 2 步按范围重建受影响分区（同样只绑数字）
    let minT = Infinity, maxT = -Infinity;
    for(const ev of __eventsQueue){
      const t = Number(ev.time);
      const safeT = Number.isFinite(t) && t > 0 ? t : Date.now();
      if(safeT < minT) minT = safeT;
      if(safeT > maxT) maxT = safeT;
      insEv.run(ev.seq, safeT, dayKeyOf(safeT), ev.session_id, ev.model, ev.input||0, ev.output||0, ev.cache_read||0, ev.cache_write||0, ev.type, ev.raw||null);
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
const usage = {
  ready: false,
  error: null,
  version: 0,
  perDay: new Map(),
  perModel: new Map(),
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
    stepStart: new Map(),
    stepToolAccum: new Map(),
    toolStart: new Map(),
    firstChunk: new Map(),
  },
};
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
      const rawModel = data.message && data.message.source ? data.message.source.model : null;
      const model = cleanModel(rawModel || usageInfo.model || "unknown");
      if (model === "其他") {
        // 仍然记录到 perDay，但按 “其他” 聚合，避免 unknown 单独成类
      }
      const day = dayKeyOf(time);
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
      live.outputTokens += agg.output;
      usage.records.unshift({ time: time, sessionId: String(sessionId).slice(0, 8), model: model, input: agg.input + agg.cacheRead, output: agg.output, cacheRead: agg.cacheRead });
      if (usage.records.length > 50) usage.records.length = 50;
      bumpUsage();
      // v2 持久化：events 幂等账本（daily_usage 由 flushDb 从 events 按天重建，不再增量累加）
      try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: model, input: agg.input, output: agg.output, cache_read: agg.cacheRead, cache_write: Number(usageInfo.cacheWriteTokens ?? 0)||0, type: event.type, raw: null}); }catch(e){}
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
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.turns += 1;
    usage.perDay.set(day, dayAgg);
    live.turns += 1;
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null}); }catch(e){}
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
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.steps += 1;
    usage.perDay.set(day, dayAgg);
    live.steps += 1;
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null}); }catch(e){}
    return;
  }
  if (event.type === "tool/call") {
    live.toolStart.set(String(data.callId), time);
    return;
  }
  if (event.type === "tool/result") {
    const callId = data.message && data.message.source ? String(data.message.source.callId || "") : "";
    const start = live.toolStart.get(callId);
    if (typeof start === "number") {
      const duration = Math.max(0, time - start);
      live.toolMs += duration;
      live.toolCalls += 1;
      const stepKey = sessionId + ":" + data.turn + ":" + data.step;
      live.stepToolAccum.set(stepKey, (live.stepToolAccum.get(stepKey) || 0) + duration);
    }
    if (callId) live.toolStart.delete(callId);
    const day = dayKeyOf(time);
    const dayAgg = usage.perDay.get(day) || emptyAgg();
    dayAgg.tools += 1;
    usage.perDay.set(day, dayAgg);
    bumpUsage();
    try{ queueEvent({seq: event.seq!=null?Number(event.seq):null, time: time, day: day, session_id: String(sessionId), model: "__system", input: 0, output: 0, cache_read: 0, cache_write: 0, type: event.type, raw: null}); }catch(e){}
    return;
  }
  if (event.type === "assistant/chunk") {
    const key = sessionId + ":" + data.turn + ":" + data.step;
    if (!live.firstChunk.has(key)) {
      live.firstChunk.set(key, time);
      const start = live.stepStart.get(key);
      if (typeof start === "number") {
        live.firstTokenSum += Math.max(0, time - start);
        live.firstTokenCount += 1;
      }
    }
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
  const cutoff = Date.now() - USAGE_KEEP_MS;
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
                for(const line of text.split("\n")){
                  if(!line.trim()) continue;
                  let obj; try{ obj=JSON.parse(line); }catch(e){ continue; }
                  // 首条 session 头携带权威 id
                  if(obj.type==="session" && obj.id){ sid = String(obj.id); }
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
        if(usage.perDay.size>0) break;
      }catch(e){}
    }
  }catch(e){ logger?.warn?.(`[token-meter] fs scan failed ${e.message}`); }
  return usage.perDay;
}

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
    const cut = Date.now() - USAGE_KEEP_MS;
    let scanned = 0;
    for (const record of sessions) {
      if (!record || !record.header) continue;
      const id = String(record.header.id || "");
      if (!id) continue;
      // listSessions 按 createdAt 降序：越过 90d 窗口的老会话直接 break（其
      // 事件本就会被 cut 过滤，readSession 的全量读取是纯浪费）。会话数超出
      // 上限时窗口内的老会话仍可能漏扫（靠 DB 既有数据与实时事件弥补）
      if (typeof record.header.createdAt === "number" && record.header.createdAt < cut) break;
      try{
        const snapshot = await query.readSession(id);
        const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : [];
        for (const event of events) {
          if (!event || typeof event.time !== "number" || event.time < cut) continue;
          // 复合键 + 时间感知水位线：只比 seq 会在代际重置后丢掉全部新事件
          if (shouldSkipEvent(id, event)) continue;
          ingestEvent(id, event);
          markSeen(id, event);
          advanceWatermark(id, event);
        }
        scanned += 1;
      } catch(e){}
      if (scanned >= 400) break;
    }
    logger?.info?.(`[token-meter] scanHistory via sessionQuery: ${scanned} sessions, perDay=${usage.perDay.size} records=${usage.records.length}`);
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
  if (range === "1d") {
    current = dayList.filter(d => d.date === keyAt(0));
    previous = dayList.filter(d => d.date === keyAt(1));
  } else if (range === "7d") {
    const cw = windowKeys(7), pw = windowKeys(14);
    current = dayList.filter(d => cw.has(d.date));
    previous = dayList.filter(d => !cw.has(d.date) && pw.has(d.date));
  } else if (range === "30d") {
    const cw = windowKeys(30), pw = windowKeys(60);
    current = dayList.filter(d => cw.has(d.date));
    previous = dayList.filter(d => !cw.has(d.date) && pw.has(d.date));
  } else if (range === "all") { current = dayList; previous = []; }
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
  const live = usage.live;
  const totalsPrompt = totals.input + totals.cacheRead;
  return {
    totals: { total: totalsPrompt + totals.output, prompt: totalsPrompt, completion: totals.output, cache_read: totals.cacheRead, requests: totals.requests, turns: totals.turns, steps: totals.steps, tools: totals.tools },
    prevTotals: prevTotals ? { total: prevTotals.input + prevTotals.output + prevTotals.cacheRead, requests: prevTotals.requests } : null,
    daily: current.map((d)=>{
      const prompt = d.agg.input + d.agg.cacheRead;
      const dayModels=[];
      for(const [dm, byDay] of usage.perModel){ if(dm==="__system") continue; const ma=byDay.get(d.date); if(ma){ const p=ma.input+ma.cacheRead; dayModels.push({ model: dm, total: p+ma.output }); } }
      dayModels.sort((a,b)=>b.total-a.total);
      return { date: d.date, requests: d.agg.requests, prompt, completion: d.agg.output, cache_read: d.agg.cacheRead, total: prompt + d.agg.output, tools: d.agg.tools, turns: d.agg.turns, steps: d.agg.steps, models: dayModels };
    }),
    models: models,
    records: usage.records,
    live: { turns: live.turns, steps: live.steps, llmMs: live.llmMs, toolMs: live.toolMs, toolCalls: live.toolCalls, firstTokenMs: live.firstTokenCount ? live.firstTokenSum / live.firstTokenCount : 0, firstTokenCount: live.firstTokenCount, tokPerSec: live.llmMs>0 ? (live.outputTokens / live.llmMs)*1000 : 0 },
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
      logger?.info?.(`[token-meter] init done, perDay=${usage.perDay.size} records=${usage.records.length} seenSeq=${seenSeq.size} realtimeHourly=${realtimeHourly.size} db=${__dbReady?"ready("+__dbPath+")":"memory"} home=${process.env.DSH_HOME||"?"} profile=${process.env.DSH_PROFILE||"?"}`);
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
  webServer.register({
    kind: "exact",
    path: "/api/token-meter",
    handler: async (req, res) => {
      if (!localGuard(req, res)) return;
      if (req.method !== "GET") { json(res,405,{ok:false,error:"method not allowed"}); return; }
      try{
        const url = new URL(req.url ?? "/", "http://x");
        const range = (url.searchParams.get("range") || "7d");
        const validRange = ["1d","7d","30d","all"].includes(range) ? range : "7d";
        // withChart=1 时附带 30d 热力图数据（此前由 client 的 Tauri 死路径承担，
        // 实际从未生效，兜底路径要发第二个请求）
        const withChart = url.searchParams.get("withChart") === "1" || url.searchParams.get("withChart") === "true";
        // 轻量 live 指标（首token/速度）：供 Rust 快路径合并，瓦片区无需等待全量 payload
        if(url.searchParams.get("meta")==="live"){
          const s0=computeUsage(validRange);
          json(res,200,{ok:true, live:s0.live, todayStr:dayKeyOf(Date.now()), updatedAt:Date.now(), version:usage.version, ready:usage.ready});
          return;
        }
        // 确保已就绪（in-flight 门防启动期并发重扫）
        if(!usage.ready && usage.perDay.size===0){
          try{ await scanHistoryOnce(ctx, logger); }catch(e){}
        }
        const stats = computeUsage(validRange);
        const daily30 = (withChart && validRange !== "30d") ? computeUsage("30d").daily : null;
        // legacy today / byModel / hourly（保持向后兼容，且与 stats 同口径）
        const now = new Date();
        const todayStr = dayKeyOf(Date.now());
        const utcToday = new Date().toISOString().slice(0,10);
        // 旧 hourly：直接用 realtimeHourly（已同步）
        const hourlyObj = Object.fromEntries(realtimeHourly);
        // 旧 byModel：由 stats.models 转为 legacy 四桶（含 total/count）
        const byModelLegacy = {};
        for(const m of stats.models){
          const key = m.model;
          byModelLegacy[key] = { uncachedInputTokens: (m.input - (m.cacheRead||0)), outputTokens: m.output, cacheReadTokens: m.cacheRead, cacheWriteTokens: 0, total: m.total, count: m.requests, requests: m.requests };
        }
        // 旧 today：由 daily 中 today 构造 legacy
        const todayDaily = stats.daily.find(d=>d.date===todayStr);
        let todayLegacy;
        if(todayDaily){
          const uncached = Math.max(0, (todayDaily.prompt||0) - (todayDaily.cache_read||0));
          const cr = todayDaily.cache_read||0;
          const out = todayDaily.completion||0;
          const total = todayDaily.total||0;
          const hit = (cr + uncached) >0 ? Math.round(cr/(cr+uncached)*100) : 0;
          // today.byModel 同理过滤今日模型
          const todayByModel={};
          for(const [model, byDay] of usage.perModel){
            const agg = byDay.get(todayStr);
            if(agg){
              const prompt = agg.input + agg.cacheRead;
              const totalM = prompt + agg.output;
              todayByModel[model]={ uncachedInputTokens: agg.input, outputTokens: agg.output, cacheReadTokens: agg.cacheRead, cacheWriteTokens: 0, total: totalM, count: agg.requests };
            }
          }
          todayLegacy = { uncachedInputTokens: uncached, outputTokens: out, cacheReadTokens: cr, cacheWriteTokens: 0, total, cacheHitRate: hit, byModel: todayByModel, requests: todayDaily.requests, tools: todayDaily.tools, turns: todayDaily.turns, steps: todayDaily.steps };
        } else {
          todayLegacy = { uncachedInputTokens:0, outputTokens:0, cacheReadTokens:0, cacheWriteTokens:0, total:0, cacheHitRate:0, byModel:{}, requests:0, tools:0, turns:0, steps:0 };
        }
        // 兼容字段 totals 旧四桶（由 stats.totals 映射）
        const totalsLegacy = { uncachedInputTokens: Math.max(0, (stats.totals.prompt||0) - (stats.totals.cache_read||0)), outputTokens: stats.totals.completion||0, cacheReadTokens: stats.totals.cache_read||0, cacheWriteTokens: 0, total: stats.totals.total||0, requests: stats.totals.requests||0, turns: stats.totals.turns||0, steps: stats.totals.steps||0, tools: stats.totals.tools||0 };
        json(res,200,{
          ok:true,
          // 新口径（供重构后 UI）
          stats,
          totals: stats.totals,
          prevTotals: stats.prevTotals,
          daily: stats.daily,
          daily30,
          models: stats.models,
          records: stats.records,
          live: stats.live,
          // 兼容口径（旧 UI / 设置页旧图）
          today: todayLegacy,
          byModel: byModelLegacy,
          hourly: hourlyObj,
          todayStr,
          seenSeq: seenSeq.size,
          buckets: stats.daily.length,
          version: usage.version,
          ready: usage.ready,
          range: validRange,
          updatedAt: Date.now(),
          // 额外兼容：旧 totalsLegacy 合并到顶层便于直接取
          totalsLegacy,
          hourlyLegacy: hourlyObj,
        });
      }catch(e){
        logger?.warn?.(`[token-meter] ${e.message}`);
        json(res,500,{ok:false,error:String(e.message||e)});
      }
    }
  });
  logger.info("dsh-quota-widget: hosting /api/opencode/* + /api/deepseek/* + /api/token-meter (perDay/perModel v1, 90d, liveSeqs)");
}
