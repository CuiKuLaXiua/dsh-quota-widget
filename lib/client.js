// dsh-quota-widget — 浏览器半端 (官方 ctx.tokenMeter + 轮播 + 按模型×小时堆叠)
window.__ModuleLoader__.load({
  id: "dsh-quota-widget",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var jsx_runtime = require("react/jsx-runtime");

    var LS_KEY = "opencode_quota_config";
    // 默认 baseUrl 为实测可跑通的官方端点（host 端 isExact 判定：含路径的
    // baseUrl 只试这一个 URL，单请求直达）；该路径也已补进 host 端
    // CANDIDATES 首位，用户清空 baseUrl 时自动探测同样能命中，作为上游
    // 路径变更时的可用兜底配置
    function defaultProviders(){
      return { opencode:{enabled:true,token:"",baseUrl:"https://opencode.ai/zen/go/v1/usage"}, deepseek:{enabled:true,token:"",baseUrl:"https://api.deepseek.com"}, r4coder:{enabled:true,token:"",baseUrl:"https://api.r4.codes/v1/cli/meta"} };
    }
    // ⚠️ sources 与 providers 是**两类不同的东西**，不要合并：
    //   providers = 出站凭据源（有 token/baseUrl，会渲染凭据表单、"测试连接"）
    //   sources   = 入站只读数据源（这里是 dsh-providers-hub 的网关账本，没有凭据可填）
    // 放进 providers 会渲染出一个空的「••••」chip 和一个点不动的「测试连接」（死控件）。
    // default true：没装对方插件时读不到文件、叠加量为 0，与旧行为完全一致；
    // 而默认关闭会让大多数人永远看不到"已经少报一半"的那部分总量。
    function defaultSources(){
      return { gateway:{ enabled:true } };
    }
    function loadConfig(){
      try{ var raw=localStorage.getItem(LS_KEY); if(raw){ var c=JSON.parse(raw);
        if(c.providers && typeof c.providers==="object"){
          if(!c.providers.opencode) c.providers.opencode=defaultProviders().opencode;
          if(!c.providers.deepseek) c.providers.deepseek=defaultProviders().deepseek;
          if(!c.providers.r4coder) c.providers.r4coder=defaultProviders().r4coder;
          else if(!c.providers.r4coder.baseUrl) c.providers.r4coder.baseUrl=defaultProviders().r4coder.baseUrl;
          if(c.intervalSec==null) c.intervalSec=120;
          if(!c.sources || typeof c.sources!=="object") c.sources=defaultSources();
          else if(!c.sources.gateway) c.sources.gateway=defaultSources().gateway;
          return c;
        }
        if(c.token!=null||c.baseUrl!=null){
          return {intervalSec:c.intervalSec||120,providers:{opencode:{enabled:true,token:c.token||"",baseUrl:c.baseUrl||"https://opencode.ai/zen/go/v1/usage"},deepseek:defaultProviders().deepseek,r4coder:defaultProviders().r4coder},sources:defaultSources()};
        }
        return c;
      }}catch(e){}
      return {intervalSec:120,providers:defaultProviders(),sources:defaultSources()};
    }
    // 网关监测开关（纯读取，供取数入口拼 gw 参数）
    function gatewayEnabled(c){
      try{
        var cfg=c||loadConfig();
        var g=cfg && cfg.sources && cfg.sources.gateway;
        if(!g) return true;              // 老配置没这个字段 = 默认开
        return g.enabled!==false;
      }catch(e){ return true; }
    }
    // 拼给宿主的口径参数：gw=0 时宿主**真的不读文件、不合并**（不是只改显示）
    function gwQueryParam(c){ return gatewayEnabled(c) ? "1" : "0"; }
    // 设置页当前标签（白名单校验，防止脏值把面板渲染成空白）
    var LS_TAB = "oq_settings_tab";
    var TAB_KEYS = ["usage","conf","data","gen","maint","gateway"];
    function loadSettingsTab(){ try{ var v=localStorage.getItem(LS_TAB); if(v && TAB_KEYS.indexOf(v)>=0) return v; }catch(e){} return "usage"; }
    function saveSettingsTab(v){ try{ if(TAB_KEYS.indexOf(v)>=0) localStorage.setItem(LS_TAB, v); }catch(e){} }

    var LS_POS = "opencode_quota_pos";
    var LS_CAR = "opencode_quota_caridx";
    var LS_WIDGET = "opencode_quota_widget_enabled";
    function loadWidgetEnabled(){ try{ var v=localStorage.getItem(LS_WIDGET); if(v===null) return true; return v!=="0" && v!=="false"; }catch(e){ return true; } }
    function saveWidgetEnabled(v){ try{ localStorage.setItem(LS_WIDGET, v?"1":"0"); window.dispatchEvent(new Event("opencode:widget-toggled")); }catch(e){} }

    function saveConfig(c){ try{localStorage.setItem(LS_KEY,JSON.stringify(c));}catch(e){} }
    function loadPos(){ try{var r=localStorage.getItem(LS_POS); if(r) return JSON.parse(r);}catch(e){} return null; }
    function savePos(p){ try{localStorage.setItem(LS_POS,JSON.stringify(p));}catch(e){} }
    function loadCarIdx(){ try{var v=parseInt(localStorage.getItem(LS_CAR),10); if(!isNaN(v)) return v;}catch(e){} return 0; }
    function saveCarIdx(i){ try{localStorage.setItem(LS_CAR,String(i));}catch(e){} }
    var LS_RANGE="opencode_quota_range";
    // 区间白名单与 host 的 RANGE_VALUES 对齐：新增 90d（= 与 90 天保留窗口一致的"能看到的最早历史"）
    var RANGE_KEYS=["1d","7d","30d","90d","all","custom"];
    var RANGES=[["1d","今日"],["7d","7天"],["30d","30天"],["90d","90天"],["all","全部"]];
    // 自定义区间的偏好（只给设置页/全局面板用，悬浮窗不参与——260px 放不下日期控件，
    // 且"配置类交互只在设置侧"是既有约束，见 CHANGELOG 里两次记录过的教训）。
    var LS_CUSTOM_RANGE="oq_custom_range";
    function loadRange(){ try{ var v=localStorage.getItem(LS_RANGE); if(v && RANGE_KEYS.indexOf(v)>=0) return v; }catch(e){} return "1d"; }
    // 范围是"看哪个时间段"的偏好：设置页与悬浮窗共用同一份，变更时广播出去（见 opencode:range-changed）
    function saveRange(v){ try{localStorage.setItem(LS_RANGE,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:range-changed"));}catch(e){} }
    // 自定义区间的起止（YYYY-MM-DD）。默认近 7 天；解析失败或 from>to 时回落到默认值，
    // 真正的裁剪（未来日、超出 90 天保留窗口、reset_at 之后）由 host 的 resolveCustomWindow 做。
    function localDayStrOf(ms){
      var d=new Date(ms);
      if(isNaN(d.getTime())) return "";
      return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    }
    function defaultCustomRange(){
      var now=Date.now();
      return { from: localDayStrOf(now-6*86400000), to: localDayStrOf(now) };
    }
    function loadCustomRange(){
      try{
        var raw=localStorage.getItem(LS_CUSTOM_RANGE);
        if(raw){
          var o=JSON.parse(raw);
          if(o && /^\d{4}-\d{2}-\d{2}$/.test(o.from||"") && /^\d{4}-\d{2}-\d{2}$/.test(o.to||"")) return { from:o.from, to:o.to };
        }
      }catch(e){}
      return defaultCustomRange();
    }
    function saveCustomRange(v){
      try{ localStorage.setItem(LS_CUSTOM_RANGE, JSON.stringify({from:v.from,to:v.to})); }catch(e){}
    }
    // 区间 + 自定义起止 → 请求查询串（custom 时带 from/to，其余档位不带）
    function rangeQuery(rangeKey, custom){
      var q="range="+encodeURIComponent(rangeKey);
      if(rangeKey==="custom" && custom) q+="&from="+encodeURIComponent(custom.from)+"&to="+encodeURIComponent(custom.to);
      return q;
    }
    // 逐日明细表的列定义与取值（纯函数，供表格渲染与单测共用）。
    // 注意 prompt 是"新输入 + 缓存读"的旧口径，新输入必须减掉 cache_read。
    var DETAIL_COLS=[
      ["date","日期"],["total","总量"],["requests","回复"],
      ["freshInput","新输入"],["cacheRead","缓存读"],["output","输出"],
      ["topProject","项目"],["avgMs","耗时"],
    ];
    function detailVal(row,k){
      if(!row) return 0;
      if(k==="freshInput") return Math.max(0, Number(row.prompt||0)-Number(row.cache_read||0));
      if(k==="avgMs") return row.avgMs==null?null:row.avgMs;
      if(k==="topProject") return row.topProject||"";
      if(k==="date") return row.date||"";
      if(k==="cacheRead") return Number(row.cache_read||0);
      if(k==="output") return Number(row.completion||0);
      return Number(row[k]||0);
    }
    var LS_TM_LAYOUT="opencode_quota_tm_layout";
    function loadTmLayout(){ try{ var v=localStorage.getItem(LS_TM_LAYOUT); if(v==="classic"||v==="compact") return v; }catch(e){} return "compact"; }
    function saveTmLayout(v){ try{localStorage.setItem(LS_TM_LAYOUT,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:tm-layout-changed"));}catch(e){} }
    var LS_TM_CHART="opencode_quota_tm_chart";
    function loadTmChart(){ try{ var v=localStorage.getItem(LS_TM_CHART); if(v==="heat"||v==="bar") return v; }catch(e){} return "bar"; }
    // 保存小窗口图表形态，并广播：设置页与悬浮窗是两个组件，靠事件即时联动
    // （跨标签页另由 storage 事件兜底，见 onStorage）。
    function saveTmChart(v){ try{localStorage.setItem(LS_TM_CHART,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:tm-chart-changed"));}catch(e){} }
    // 设置页的图表形态多一个"折线"。悬浮窗的迷你图只认 柱状/热力 两态（loadTmChart），
    // 继续共用同一个 key 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
    // 所以设置页单开一个 key；首次使用沿用旧的共享值，避免用户已选的热力图被静默重置。
    var LS_SETTINGS_CHART="oq_settings_chart";
    var SETTINGS_CHART_MODES=["bar","line","heat","hour"];
    function loadSettingsChart(){
      try{
        var v=localStorage.getItem(LS_SETTINGS_CHART); if(SETTINGS_CHART_MODES.indexOf(v)>=0) return v;
        var legacy=localStorage.getItem(LS_TM_CHART); if(legacy==="heat") return "heat";
      }catch(e){}
      return "bar";
    }
    function saveSettingsChart(v){ try{localStorage.setItem(LS_SETTINGS_CHART,v);}catch(e){} }
    // ── 用量统计的"三风格"外观（每个模块 A/B/C 独立可切）──
    // 目的：同一条数据，不同用户偏好不同密度/气质；预设只是把五个模块一次性设好。
    var LS_USAGE_STYLE="oq_usage_style";
    var USAGE_MODULES=["overview","chart","rank","live","rec"];
    var USAGE_STYLE_DEFAULTS={ overview:"A", chart:"A", rank:"C", live:"B", rec:"A" };
    var USAGE_STYLE_PRESETS={
      pro:  { label:"专业监控", overview:"A", chart:"A", rank:"B", live:"B", rec:"B" },
      lite: { label:"轻卡片",   overview:"A", chart:"A", rank:"C", live:"B", rec:"A" },
      mini: { label:"极简",     overview:"C", chart:"C", rank:"C", live:"C", rec:"C" },
    };
    function loadUsageStyle(){
      var out=Object.assign({},USAGE_STYLE_DEFAULTS);
      try{
        var o=JSON.parse(localStorage.getItem(LS_USAGE_STYLE)||"{}");
        for(var i=0;i<USAGE_MODULES.length;i++){
          var k=USAGE_MODULES[i];
          if(o && ["A","B","C"].indexOf(o[k])>=0) out[k]=o[k];
        }
      }catch(e){}
      return out;
    }
    function saveUsageStyle(o){ try{ localStorage.setItem(LS_USAGE_STYLE, JSON.stringify(o)); }catch(e){} }
    function stylePresetOf(o){
      var keys=Object.keys(USAGE_STYLE_PRESETS);
      for(var i=0;i<keys.length;i++){
        var p=USAGE_STYLE_PRESETS[keys[i]], hit=true;
        for(var j=0;j<USAGE_MODULES.length;j++){ if(p[USAGE_MODULES[j]]!==o[USAGE_MODULES[j]]){ hit=false; break; } }
        if(hit) return keys[i];
      }
      return "custom";
    }
    // R4Coder 悬浮样式：ring=环形（对齐 Opencode） / bar=额度横条
    var LS_R4_LAYOUT="opencode_quota_r4_layout";
    function loadR4Layout(){ try{ var v=localStorage.getItem(LS_R4_LAYOUT); if(v==="ring"||v==="bar") return v; }catch(e){} return "ring"; }
    function saveR4Layout(v){ try{localStorage.setItem(LS_R4_LAYOUT,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:r4-layout-changed"));}catch(e){} }

    // ── 悬浮面板材质 ──
    // 四款在 docs/mockups/panel-materials.html 里做过对照（经典 / 液态玻璃 / 亚克力 / 哑光纸）。
    // 只换"外壳"的底色/边框/阴影，内部文字与进度条仍走 --dsw-alias-*，所以明暗主题各自适配。
    // 默认 classic：就是材质层引入之前的那套外观（--dsw-alias-bg-layer-2 + lv3 阴影 + blur(10px)），
    // 老用户升级后观感不变；另外三款必须由用户在设置里主动选。
    // 材质是纯外观偏好，与额度配置无关，因此只存 localStorage，不写插件配置。
    var LS_PANEL_MATERIAL="oq_panel_material";
    var PANEL_MATERIALS=["classic","liquid","acrylic","paper"];
    function loadPanelMaterial(){
      try{ var v=localStorage.getItem(LS_PANEL_MATERIAL); if(PANEL_MATERIALS.indexOf(v)>=0) return v; }catch(e){}
      return "classic";
    }
    function savePanelMaterial(v){
      try{ localStorage.setItem(LS_PANEL_MATERIAL, PANEL_MATERIALS.indexOf(v)>=0?v:"classic"); }catch(e){}
      // 悬浮窗在另一个 React 树里（甚至另一个 slot），只能靠事件通知它重渲染
      try{ window.dispatchEvent(new Event("opencode:material-changed")); }catch(e){}
    }

    // 悬浮窗贴边（视口/窗口边缘）留白，单位 px。拖拽硬边界、松手贴边吸附、初始位置
    // 三处共用同一个值：旧实现硬边界写 6、吸附写 12（左侧还去对齐 DSH 会话列表左边缘，
    // 而侧栏自身有 12px 内边距），结果是贴边后离窗口边缘 12px、松手瞬间还会"弹"一下。
    //
    // 6 → 3：用户反馈"贴边后离边缘的间距偏宽"，要求缩小 50%。
    // 这个值同时决定四处，必须一起变（分散写会重现上面的"弹一下"）：
    //   ① 拖拽硬边界  ② 松手吸附目标  ③ 收起位移的补偿量  ④ 把手挂在卡片外侧的偏移
    // 联动关系：位移 = -(100% + EDGE_GAP)、把手偏移 = -(HIT_W - EDGE_GAP)，
    // 两个公式都是相对 EDGE_GAP 推导的，改这一个数即可，不要在 CSS 里再写死 px。
    var EDGE_GAP=3;

    // ── 贴边吸附收起（方案 A：把手条）──────────────────────────────────────
    // 开关默认关（老用户升级观感不变）。存放分两层：
    //   LS_EDGE_COLLAPSE：用户开关（"1"/"0"）
    //   LS_EDGE_STATE：当前是否收起 + 收在哪一侧（{edge:"left"|"right"} | null）
    // 收起用 transform 位移，**绝不用 display:none**：卡片高度由 .oq-carousel 按
    // active.scrollHeight 写入，元素不可见时会量到 0，恢复后没人重测就会塌
    // （这个坑在"面板打开时隐藏悬浮窗"那两版实现里已经踩过，见 QuotaWidget hidden 注释）。
    var LS_EDGE_COLLAPSE="oq_edge_collapse";
    var LS_EDGE_STATE="oq_edge_state";
    // 卡片收起时的位移比例（100% = 整体移出视口）。
    // 旧实现留 10~14px 在视口内，那几 px 里除了紫色胶囊还有卡片深色背景 + 1px 描边 +
    // 圆角，视觉上就是"深色竖条 + 紫色胶囊"两层（用户截图指出）。现在外壳整体出去，
    // 把手由 .oq-edge-handle 挂在卡片外侧，是视口内唯一可见的元素。
    var EDGE_CARD_OUT_PCT=100;
    // 把手视觉胶囊尺寸（px）与可触区宽度（px）。两者分开：视觉要细，热区要好点。
    // 高度统一用 EDGE_CAPSULE_H：热区高度 == 胶囊高度，命中区正好包住看得见的东西。
    // 旧实现热区是 top:0;bottom:0（撑满整张卡片 ~200px），鼠标在胶囊上方/下方很远
    // 也会触发悬停展开——这也是用户觉得"触发范围大"的一部分。
    var EDGE_CAPSULE_W=8;
    var EDGE_CAPSULE_H=44;
    var EDGE_HANDLE_HIT_W=22;
    // 卡片边框宽度（px）。收起态只把 border-color 设成 transparent，**宽度仍占 1px**。
    // 这点很关键：把手是 position:absolute，包含块是卡片的 padding box（不含 border），
    // 而位移是按 border box 宽度算的，两者差 1px —— 漏掉它胶囊就会贴死在视口边缘。
    var CARD_BORDER_W = 1;
    // 把手相对卡片边界（padding box）的偏移量，让**胶囊左边缘**距视口边缘正好 EDGE_GAP。
    // 推导（左停靠；卡片收起后 border box 右边界在视口 x=0）：
    //   padding box 右边界 = -CARD_BORDER_W
    //   把手右偏移 = X → 把手右边缘 = -CARD_BORDER_W + X
    //   把手中心 = -CARD_BORDER_W + X - HIT_W/2，胶囊与把手同心
    //   胶囊左边缘 = -CARD_BORDER_W + X - HIT_W/2 - CAPSULE_W/2 ≡ EDGE_GAP
    //   ⇒ X = EDGE_GAP + CARD_BORDER_W + (CAPSULE_W + HIT_W)/2
    // 旧式 -(HIT_W - EDGE_GAP) 少算了胶囊半个宽度，再漏掉 border，实测差到 2px。
    var EDGE_HANDLE_OFF = EDGE_GAP + CARD_BORDER_W + (EDGE_CAPSULE_W + EDGE_HANDLE_HIT_W) / 2;
    // "再往边缘拽一下"的触发阈值：吸附态下继续朝边缘拖动超过该距离即吸入。
    var EDGE_PULL_TRIGGER=18;
    // 悬停展开后移开多久收回（ms）。太短会在边缘附近抖动，太长显得迟钝。
    var EDGE_HOVER_OUT_MS=420;
    // 收起态的 class 计算（纯函数，供渲染与单测共用）。
    // ⚠️ 最重要的不变量：oq-edge-open（transform:none）与 oq-edge-{side}（translateX）
    // 在 CSS 里特异性相同、后者写在前面，所以**只有展开态才允许挂 oq-edge-open**。
    // 旧实现给所有 edgeActive 都挂了 open，导致 transform 被永久压成 none，
    // 表现为"开关打开了、也拽了，但卡片纹丝不动"。这条不变量由单测锁住。
    function edgeCardClass(baseClass, { on, state, open, locked }){
      var active = !!on && !!state;
      if(!active) return baseClass;
      var collapsed = !open && !locked;
      return baseClass + " oq-edge oq-edge-" + state.edge + (collapsed ? "" : " oq-edge-open");
    }
    // 拖拽中的"再拽一下"判定（纯函数）。
    // 输入：当前自由位置 left / 卡片宽 / 视口宽 / 鼠标 x / 上一次记录的状态。
    // 输出：{ armEdge, armAt, collapse }。
    //
    // ⚠️ 两条不变量（都踩过）：
    //  1. armAt **只在刚进入贴边的那一帧**记录。旧实现在每个 mousemove 都写
    //     armAt = 当前鼠标 x，于是 pushed 恒为 0，永远吸不进去。
    //  2. 判定必须基于"已贴边"，不是"接近边缘"。否则斜着拖过边缘就误吸。
    function edgePullVerdict(prev, m){
      var atLeft = m.left <= m.gap + 0.5;
      var atRight = m.left + m.width >= m.viewport - m.gap - 0.5;
      var side = atLeft ? "left" : (atRight ? "right" : null);
      var armEdge = side;
      var armAt = m.x;
      if(prev && prev.armEdge === side && prev.armAt != null){
        // 同一侧继续：沿用原来的锚点（这是 1 的关键）
        armAt = prev.armAt;
        armEdge = side;
      }
      var collapse = false;
      if(armEdge && armAt != null){
        var pushed = armEdge === "left" ? (armAt - m.x) : (m.x - armAt);
        collapse = pushed >= m.trigger;
      }
      return { armEdge: armEdge, armAt: armEdge ? armAt : null, collapse: collapse };
    }
    function loadEdgeCollapse(){ try{ return localStorage.getItem(LS_EDGE_COLLAPSE)==="1"; }catch(e){ return false; } }
    function saveEdgeCollapse(v){
      try{ localStorage.setItem(LS_EDGE_COLLAPSE, v?"1":"0"); }catch(e){}
      // 关闭功能时必须把"已收起"状态一并清掉，否则窗口会停在收起态且无法展开
      // （用户关掉开关的预期是"恢复到普通悬浮窗"）。
      if(!v){ try{ localStorage.removeItem(LS_EDGE_STATE); }catch(e){} }
      try{ window.dispatchEvent(new Event("opencode:edge-collapse-changed")); }catch(e){}
    }
    function loadEdgeState(){
      try{
        var raw=localStorage.getItem(LS_EDGE_STATE);
        if(!raw) return null;
        var o=JSON.parse(raw);
        if(o && (o.edge==="left"||o.edge==="right")) return { edge:o.edge };
      }catch(e){}
      return null;
    }
    function saveEdgeState(s){
      try{
        if(s && (s.edge==="left"||s.edge==="right")) localStorage.setItem(LS_EDGE_STATE, JSON.stringify({edge:s.edge}));
        else localStorage.removeItem(LS_EDGE_STATE);
      }catch(e){}
    }

    // 设置弹窗左导航的入口文案与图标。宿主的设置外壳（ui-settings-general）按分区 id 决定
    // 图标：navIcon(id) 只认 account / models / agent-presets / plugins / archived-sessions，
    // 其余 id 一律兜底成"齿轮"；而 settings.section 的注册项只有 id/order/label，没有 icon
    // 字段（见宿主契约 packages/client/ui-settings/src/client/contract/slots.ts）。也就是说
    // 第三方分区拿不到自己的图标。于是改为：注册文案与"打标记的匹配键"共用同一个常量，再给
    // 匹配到的导航按钮加一个标记属性（只加属性，不替换/不改写 React 拥有的节点），由下面的
    // CSS 隐藏兜底齿轮、用 mask 自绘一个半圆仪表盘（额度的语义，和 icon.svg 的环+指针同族）。
    // 文案即匹配键：改文案必须同步改这里，否则图标不会生效。
    var SETTINGS_SECTION_LABEL="用量与额度";
    var NAV_ROW_MARK="data-dsh-quota-widget-nav";
    // 24×24 / 2.1px 描边（16px 渲染下约 1.4px，对齐宿主图标 1.3px 的观感），已做 URL 编码
    var NAV_MASK_SVG="%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2.1'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpath%20d%3D'M2%2016a10%2010%200%200%201%2020%200'%2F%3E%3Cpath%20d%3D'M12%2016l5-6.5'%2F%3E%3Ccircle%20cx%3D'12'%20cy%3D'16'%20r%3D'1.4'%20fill%3D'black'%2F%3E%3C%2Fsvg%3E";

    // ── 左侧栏「用量与额度」全局面板（DSH v0.2.1-rc.3 新增能力）──
    // v0.2.1 起左侧栏开放「全局面板」席位：sidebar.panellist（root list，图标行）+
    // main（root keyed，面板本体），id 与 key 同值配对，ctx.layout.selectPanel(id) 选中；
    // 官方「插件」页（ui-plugin-manager）就是这样注册的。id 避开官方保留值（目前只有
    // "plugins" / "schedules"，见 ui-sidebar 的 officialEntry；「更多」菜单的 Pin 逻辑对
    // "plugins" 有硬编码），第三方用自带命名空间的 id，落在官方面板之后。
    var PANEL_ID="dsh-quota-widget/panel";
    // 侧栏入口开关（设置 → 通用）：只影响侧栏图标行与全局面板，悬浮窗与设置页不受影响。
    // 默认显示（老用户升级无感）；关闭后两条注册一并撤销，正在面板上时布局会自动
    // 回到会话视图（宿主 retainMainPanels 的行为）。存 localStorage，广播事件让
    // 已挂载的设置页实例同步文案。
    var LS_SIDEBAR_ENTRY="oq_sidebar_entry_enabled";
    function loadSidebarEntry(){ try{ var v=localStorage.getItem(LS_SIDEBAR_ENTRY); if(v===null) return true; return v!=="0" && v!=="false"; }catch(e){ return true; } }
    function saveSidebarEntry(v){ try{ localStorage.setItem(LS_SIDEBAR_ENTRY, v?"1":"0"); }catch(e){} try{ window.dispatchEvent(new Event("opencode:sidebar-entry-changed")); }catch(e){} }

    var STYLE_ID="dsh-quota-widget-style-v3";
    var CSS=[
      // 热力梯度：h0=无数据（最空的底色），h1..h6 = 用量由少到多、颜色由浅到深。
      // 方向不能反过来：界面说明写的是"颜色越深代表当天 Token 消耗越多"，而暗色底上
      // "越多越亮"会让用量最多的一天看着最淡（历史实现就是 #82a1ea 那种泛白）。
      // 6 档色相统一收在品牌紫（#8b7bff）一族，与悬浮窗强调色、模型排行的紫→青渐变
      // 同属一套语言；明度按感知均匀取值，保证相邻档在深色底上分得开。
      ":root{--bmon-c1:#6b87d9;--bmon-c2:#b08427;--bmon-c3:#c65f7f;--bmon-c4:#8d7ce4;--bmon-h0:#252831;--bmon-h1:#c8c6ee;--bmon-h2:#a9a4e6;--bmon-h3:#8b83dd;--bmon-h4:#7066cf;--bmon-h5:#5749ba;--bmon-h6:#443699}",
      "@media (prefers-color-scheme: light){:root{--bmon-c1:#5d6cc4;--bmon-c2:#8f6b1e;--bmon-c3:#c2426e;--bmon-c4:#6d51c4;--bmon-h0:#ece4d1;--bmon-h1:#d9d4f0;--bmon-h2:#c1b8e6;--bmon-h3:#a699d8;--bmon-h4:#8a79c6;--bmon-h5:#7059b0;--bmon-h6:#574194}}",
      // 固定宽度 260px：三模式（Opencode/DeepSeek/TokenMeter）统一。260 是
      // 三者内容需求的包络——TokenMeter 的 7 日柱状图最宽（7×30px 列 + 6px×6
      // gap = 246px），260 时无横向滚动；Opencode/DeepSeek 留白更舒适。
      // 不再跟随侧边栏会话列表宽度（旧 syncWidth 让悬浮窗随侧栏折叠/拖拽
      // 不断变形，热力格与柱状图视觉不稳定）。
      // left 用 EDGE_GAP 推导（不写死 6px）：这个值是"首屏默认位置"，必须与松手吸附
      // 的落点一致，否则第一次打开时会看到卡片离边缘比吸附后远一点。
      ".oq-overlay{position:fixed;left:"+EDGE_GAP+"px;bottom:80px;width:260px;max-width:min(260px,calc(100vw - 24px));z-index:999;pointer-events:auto;font-family:inherit;box-sizing:border-box;overflow:visible}",
      // card 是 position:fixed（拖拽依赖），脱离文档流后宽度按 shrink-to-fit
      // 由内容决定——热力图档位切换（今日 1 列 ↔ 近7天 7 列）会直接改变卡片
      // 宽度。必须与 overlay 同步钉死 260px（旧 syncWidth 时代靠 JS 每次写
      // card.style.width 掩盖了这一点）。
      ".oq-card{width:260px;max-width:min(260px,calc(100vw - 24px));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1a1a1f);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));box-shadow:var(--dsw-shadow-lv3,0 10px 30px rgba(0,0,0,0.35));overflow:hidden;backdrop-filter:blur(10px);display:flex;flex-direction:column;box-sizing:border-box;min-height:auto;transition:height 0.22s cubic-bezier(0.22,1,0.36,1);cursor:grab}",
      ".oq-card:active{cursor:grabbing}",
      // ── 贴边吸附收起（方案 A：把手条）──
      // 用 transform 位移把卡片推出视口，只留 EDGE_HANDLE_W(14px) 宽的可触区。
      // 绝不用 display:none / width:0：卡片高度是 JS 量 scrollHeight 写进去的，
      // 不可见时会量到 0，恢复后没有 deps 变化触发重测 → 塌成一条线。
      // 位移量用 calc(100% - 14px)：百分比相对卡片自身宽度，不依赖硬编码的 260px。
      //
      // ── 动效设计（这一版重做）──
      // 原则：**只有 transform 在动**。旧实现同时给 left/bottom 和 transform 加过渡，
      // 两套动画各自计时、缓动不同，看起来就是"抖一下再滑"。
      // 现在 left/bottom 由 JS 瞬间写好（无过渡），动画全部交给 transform：
      //   · 收起：0.42s expo-in-out，有"退进抽屉"的收束感
      //   · 展开：0.40s expo-out（0.16,1,0.3,1），前段快后段缓，像抽屉被拉出
      // 卡片升起合成层（will-change）避免逐帧重绘模糊层。
      // transition 属性整条覆盖（不是追加）：.oq-card 自带 `transition:height 0.22s`，
      // 若不覆盖，收起时 height 也会跟着过渡，卡片被推到边缘的同时高度还在抖。
      // 这里只保留 transform 一条，高度变化仍由基类规则在非收起态生效。
      // overflow:visible 是必需的：把手的 22px 热区有 12px 伸到卡片外侧（视口外），
      // 而 .oq-card 基类是 overflow:hidden（用于裁圆角与材质伪元素），会把热区裁掉一半。
      // 收起态内容已 opacity:0，不需要裁；圆角由 border-radius 自身保证。
      // 位移过渡与合成层提升：**收起态和展开态共用**，不加任何"隐形"样式。
      ".oq-card.oq-edge{will-change:transform;transition:transform 0.42s cubic-bezier(0.32,0.72,0,1)}",
      //
      // ── 只有"真收起"才隐形 ────────────────────────────────────────────────
      // ⚠️ 必须用 :not(.oq-edge-open) 限定。上一版把 background:transparent!important
      // 写在 .oq-card.oq-edge 上，于是**展开态也命中**：卡片没有背景色，只剩基类的
      // `backdrop-filter:blur(10px)` 在起作用 —— 用户看到的"毛玻璃质感、要再点一下
      // 才恢复"就是这个（点击/重渲染后展开态类名变化才短暂恢复）。
      //
      // 收起态要隐形的四件套：
      //   · background / border / box-shadow：卡片外壳的底色、1px 描边、投影
      //   · backdrop-filter：否则卡片移出后仍在视口边缘留一条模糊带
      //   · overflow:visible：把手挂在卡片外侧（负偏移），hidden 会裁掉
      //   · pointer-events:none：卡片虽已移出视口，但它仍占据原 260px 的命中区域，
      //     会挡住宿主界面（点不到下面的聊天内容）。事件全部交给把手。
      ".oq-card.oq-edge:not(.oq-edge-open){overflow:visible;pointer-events:none;background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}",
      // 把手要显式收回 pointer-events（父级 none 会被子级 auto 覆盖回来）
      ".oq-card.oq-edge:not(.oq-edge-open) .oq-edge-handle{pointer-events:auto}",
      //
      // ⚠️ 光关掉卡片的 pointer-events 还不够：**overlay 才是那个 260px 的命中盒**。
      // `.oq-overlay{position:fixed;width:260px;pointer-events:auto}` 是卡片的父级，
      // 它自己不随卡片位移，收起后仍完整盖在面板原区域上。之前只给卡片加
      // pointer-events:none，鼠标依旧打在 overlay 上 —— 表现为"离胶囊很远也会弹出"。
      // 这里让 overlay 只在**展开态**接收事件：
      //   · 收起态：none（事件穿透给宿主界面；把手自己用 auto 覆盖回来，仍可命中）
      //   · 展开态：auto
      // 用 JS 加类而不是 :has()：宿主 Chromium 版本不保证，加类更稳。
      ".oq-overlay.oq-overlay--collapsed{pointer-events:none!important}",
      // 材质伪元素（液态玻璃的高光/描边、亚克力的噪点、纸面的噪点）同样要关掉：
      // 它们画在卡片四边，卡片移出后仍会有一条留在视口里。
      ".oq-card.oq-edge:not(.oq-edge-open)::before,.oq-card.oq-edge:not(.oq-edge-open)::after{opacity:0!important;background:none!important}",
      // 展开态要恢复高度过渡（用户可能正在切轮播页，卡片高度会变）。
      // 这里**不写 background/border/shadow**：让规则不匹配，自然回落到基类材质。
      ".oq-card.oq-edge-open{transition:transform 0.40s cubic-bezier(0.16,1,0.3,1),height 0.22s cubic-bezier(0.22,1,0.36,1)}",
      // ⚠️ 位移必须"完整出去 + 额外一段"，不能只 -100%：
      // 卡片收起前的 left 是 EDGE_GAP(6px)（为了展开时离视口边缘有呼吸），
      // 只平移 -100% 时卡片右边界会停在 x=6px —— 那 6px 就是用户看到的"残留侧边"。
      // 减去同样的 EDGE_GAP 后右边界正好落在 x=0，一点不剩。
      ".oq-card.oq-edge-left{transform:translateX(calc(-100% - "+EDGE_GAP+"px))}",
      ".oq-card.oq-edge-right{transform:translateX(calc(100% + "+EDGE_GAP+"px))}",
      // 内容先淡出、把手后独留：层次来自"内容退场"，而不是整卡淡出
      // （整卡 opacity 会连把手一起变淡，把手就没法提示了）。
      // 收起：内容 0.12s 就淡掉（比位移快很多），视觉上"内容先退、空壳再滑出去"。
      ".oq-card.oq-edge .oq-body{opacity:0;transition:opacity 0.12s ease}",
      // 把手是**真实 DOM**（不是 ::after）：它要独立承接 click / mouseenter，
      // 伪元素的事件会冒泡到卡片本身，无法与"拖拽卡片"区分。
      //
      // 关键几何：卡片位移是「整卡宽 + EDGE_GAP」，收起后卡片外边界恰好落在视口边缘 x=0。
      // 所以把手要挂在卡片**外侧**（负偏移），让 22px 热区尽量落在视口内。
      //
      // 偏移量的推导（左停靠；右停靠镜像）：
      //   设把手右偏移为 X（即 right:-Xpx），卡片右边界在视口 0，则
      //     把手右边界 = X，把手左边界 = X - HIT_W，把手中心 = X - HIT_W/2
      //   胶囊与把手同心，要求胶囊左边缘距视口边缘 = EDGE_GAP：
      //     胶囊中心 = EDGE_GAP + CAPSULE_W/2
      //   两式相等 → X = EDGE_GAP + (CAPSULE_W + HIT_W) / 2
      // 用 EDGE_GAP 的旧式 -(HIT_W - EDGE_GAP) 会差 1px（实测胶囊落在 4px 而非 3px），
      // 因为那个公式没考虑胶囊自身宽度的一半。
      // 纵向不再 top:0;bottom:0（那会撑满整张卡片高度 ~200px，鼠标在胶囊上下很远也会命中）。
      // 现在高度 = 胶囊高度，且整体居中——命中区正好包住可见的胶囊。
      ".oq-edge-handle{position:absolute;top:50%;transform:translateY(-50%);height:"+EDGE_CAPSULE_H+"px;width:"+EDGE_HANDLE_HIT_W+"px;z-index:5;cursor:pointer;display:flex;align-items:center;justify-content:center;border:0;padding:0;background:transparent}",
      // 左停靠：卡片整体移出到视口左侧，把手挂在卡片**右边界外**（即视口内）。
      ".oq-edge-handle[data-side=left]{right:-"+EDGE_HANDLE_OFF+"px}",
      ".oq-edge-handle[data-side=right]{left:-"+EDGE_HANDLE_OFF+"px}",
      // 胶囊本体：竖向渐变 + 描边 + 外发光。
      // 颜色经过两轮调整：
      //   0.10→0.42→0.10  用户："颜色淡了一点"（两端只有 10%，像半截）
      //   0.72→0.92→0.72  用户："紫色太深了"
      // 现在取中间值：两端 0.46、中部 0.74。两端不再"消失"，中部也不至于压成实心深紫。
      // 描边 0.55→0.42，外发光回落到 10px，整体更轻透但轮廓仍清楚。
      // 热区 22px、胶囊 8px 居中；按上面的偏移公式，胶囊居中后左边缘恰好距视口 EDGE_GAP。
      // 代价是热区有 (HIT_W - CAPSULE_W)/2 - EDGE_GAP = 4px 落在视口外，实际可点区仍是 18px，
      // 远大于触控最小命中区，不影响使用。
      ".oq-edge-handle::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:"+EDGE_CAPSULE_W+"px;height:"+EDGE_CAPSULE_H+"px;border-radius:999px;"+
        "background:linear-gradient(180deg,rgba(152,140,255,0.46),rgba(133,118,244,0.74) 50%,rgba(152,140,255,0.46));"+
        "box-shadow:0 0 0 1px rgba(164,152,255,0.42),0 2px 10px -2px rgba(133,118,244,0.45);"+
        "transition:width 0.18s ease,height 0.18s ease,background 0.18s ease,box-shadow 0.18s ease}",
      // 中间三道短线：与胶囊同心（50%/50%），零额外 DOM。
      // 白色 0.92 + 0.6 不透明度在提亮后的紫底上仍能看清；悬停/张开时再提亮。
      ".oq-edge-handle::after{content:'';position:absolute;top:50%;left:50%;width:2px;height:16px;border-radius:2px;"+
        "background:repeating-linear-gradient(180deg,rgba(255,255,255,0.96) 0 2px,transparent 2px 5px);"+
        "opacity:0.62;transform:translate(-50%,-50%);transition:opacity 0.18s ease}",
      // 悬停：胶囊变高变亮（明确的可交互反馈），短线更实。宽度保持 8px 不动，
      // 避免露出区里胶囊一变宽就贴到视口边、看起来像"卡片又滑出来了"。
      // 悬停态：在常态基础上整体提亮一档（不是回到最深的那个版本）。
      // ⚠️ 高度保持一致（= EDGE_CAPSULE_H），不再"变高到 52px"：
      // 热区高度就是胶囊高度，胶囊一变高指针就可能落到热区外 → mouseleave →
      // 收回 → 又进热区，形成抖动。提亮 + 外发光已足够表达 hover。
      ".oq-edge-handle:hover::before{background:linear-gradient(180deg,rgba(160,148,255,0.62),rgba(140,124,250,0.86) 50%,rgba(160,148,255,0.62));box-shadow:0 0 0 1px rgba(172,160,255,0.58),0 3px 14px -2px rgba(140,124,250,0.58)}",
      ".oq-edge-handle:hover::after{opacity:0.95}",
      // 展开态：拉出时用 expo-out（前快后缓）
      // ⚠️ 本规则与 .oq-edge-left/.oq-edge-right 特异性相同，只靠"写在后面"生效，
      // 所以 JS 侧必须保证 oq-edge-open 与 oq-edge-{side} 的**语义**是"展开覆盖收起"，
      // 而不是两者无条件并存（并存会导致永远收不起来，见 cardCls 注释）。
      ".oq-card.oq-edge-open{transform:none;z-index:1002}",
      // 内容淡入**不加延迟**：卡片已经在滑出，再等 100ms 会先露出一片空白，
      // 像"卡了一下"。让内容与位移同时开始，位移本身前快后缓就够形成次序感。
      ".oq-card.oq-edge-open .oq-body{opacity:1;transition:opacity 0.21s ease}",
      // 展开态把手淡出（它此刻会压在卡片内容上）。0.10s 比位移快，先让开。
      ".oq-card.oq-edge-open .oq-edge-handle{opacity:0;pointer-events:none;transition:opacity 0.10s ease}",
      // ── 常驻动效：呼吸光晕 + 短线张开（方案 4）────────────────────────────
      // 旧实现只让 opacity 在 0.86↔1 之间变化——幅度太小，视觉上等于静止。
      // 现在两条动画同相位（2.4s）联动：
      //   ① 胶囊：描边与外发光的**强度和半径**一起呼吸（改 box-shadow，比改
      //      background 便宜，也不会触发重绘渐变的中间帧）
      //   ② 三道短线：高度 14↔20、透明度 0.55↔1，周期性"向外张开"，
      //      主动暗示"可以拉出来"（这是方案 4 相比纯呼吸的核心增补）
      // 只在**真收起态**跑：展开态卡片已经出来，不需要再提示。
      // 呼吸幅度按新的常态基线重新标定：0% 约等于常态（0.42/0.45），
      // 50% 只提升到 0.66/0.62——旧版 0.72/0.78 在提亮后会更显深紫。
      "@keyframes oqEdgePulse{0%,100%{box-shadow:0 0 0 1px rgba(164,152,255,0.34),0 2px 9px -2px rgba(133,118,244,0.38)}50%{box-shadow:0 0 0 1px rgba(182,170,255,0.66),0 2px 17px -1px rgba(133,118,244,0.62)}}",
      "@keyframes oqEdgeGrip{0%,100%{height:14px;opacity:0.55}50%{height:20px;opacity:1}}",
      ".oq-card.oq-edge:not(.oq-edge-open) .oq-edge-handle::before{animation:oqEdgePulse 2.4s ease-in-out infinite}",
      ".oq-card.oq-edge:not(.oq-edge-open) .oq-edge-handle::after{animation:oqEdgeGrip 2.4s ease-in-out infinite}",
      // 悬停时暂停常驻动效：手指/指针已经在交互，继续呼吸反而干扰；
      // 悬停态的静态样式（见上面的 :hover 规则）本身已经足够醒目。
      ".oq-edge-handle:hover::before,.oq-edge-handle:hover::after{animation-play-state:paused}",
      // ── 一次性反馈：吸入瞬间向外扩散一圈光晕（方案 5）─────────────────────
      // 由 JS 在 collapseToEdge() 后给 handle 加 oq-edge-snap 类，700ms 后移除。
      // 关键：用 box-shadow 的**扩散**（spread）而不是缩放/位移，
      // 这样它不会影响已经调好的 3px 间距对齐。
      "@keyframes oqEdgeSnapRing{0%{box-shadow:0 0 0 1px rgba(182,170,255,0.78),0 0 0 0 rgba(152,140,255,0.48)}100%{box-shadow:0 0 0 1px rgba(182,170,255,0),0 0 0 14px rgba(152,140,255,0)}}",
      // 类挂在 .oq-edge-handle 上（不是卡片）：只让胶囊脉动，卡片外壳不参与。
      ".oq-edge-handle.oq-edge-snap::before{animation:oqEdgeSnapRing 0.65s cubic-bezier(0.16,1,0.3,1) 1!important}",
      // 触屏/减少动效：位移仍生效，但去掉过渡与全部循环动画（尊重系统偏好，也避免低端机掉帧）
      "@media (prefers-reduced-motion:reduce){.oq-card.oq-edge,.oq-card.oq-edge-open,.oq-card.oq-edge .oq-body{transition:none}.oq-card.oq-edge .oq-edge-handle::before,.oq-card.oq-edge .oq-edge-handle::after{animation:none}}",
      // ── 悬浮面板材质（见 loadPanelMaterial / docs/mockups/panel-materials.html）──
      // 材质层只改"外壳"：底色 / 边框 / 阴影 / 装饰伪元素。文字与进度条仍走
      // --dsw-alias-*，所以明暗主题各自适配；内部卡片的实心底色改半透明，
      // 否则玻璃后面那层永远被 .oq-provider 的不透明背景挡住，等于白做。
      // 伪元素一律 pointer-events:none + z-index 低于内容，不抢拖拽的 mousedown。
      ".oq-card{isolation:isolate}",
      ".oq-card>.oq-body{position:relative;z-index:1}",
      ".oq-card::before,.oq-card::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0}",
      // 经典：完全等于材质层引入之前的外观——底色/边框/阴影/模糊全由上面那条基础 .oq-card 决定，
      // 这里只把材质层借用的两个装饰伪元素关掉（否则空伪元素也会占一个合成层，且 ::after 的
      // content:'' 会让孤立的 backdrop-filter 在某些 Chrome 版本上多一次离屏合成）。
      ".oq-card.m-classic::before,.oq-card.m-classic::after{content:none;display:none}",
      // 材质化后内部面片统一"薄一层"。这里连 --dsw-alias-bg-layer-* 一起就地覆盖：
      // renderTmCompact 的瓦片 / DeepSeek 余额行是*内联* background（内联优先级高于任何
      // 选择器），只写类选择器盖不住，必须让它们引用的变量在材质作用域内变成半透明，
      // 否则玻璃面板里会嵌着几块不透明的深色砖。
      // 变量挂在 .oq-overlay 上（不是 .oq-card）：右键菜单与卡片是兄弟节点，
      // 只有提到共同父级才能一起换肤，否则纸面面板会弹出一个深色玻璃菜单。
      ".oq-overlay.m-liquid,.oq-overlay.m-acrylic{--dsw-alias-bg-layer-1:rgba(255,255,255,0.08);--dsw-alias-bg-layer-2:rgba(255,255,255,0.045);--dsw-alias-border-l1:rgba(255,255,255,0.10);--dsw-alias-border-l2:rgba(255,255,255,0.16)}",
      ".oq-card.m-liquid .oq-provider,.oq-card.m-liquid .oq-detail,.oq-card.m-liquid .oq-stat,.oq-card.m-liquid .oq-tm-tile,.oq-card.m-acrylic .oq-provider,.oq-card.m-acrylic .oq-detail,.oq-card.m-acrylic .oq-stat,.oq-card.m-acrylic .oq-tm-tile{background:rgba(255,255,255,0.055);border-color:rgba(255,255,255,0.09)}",
      ".oq-card.m-liquid .oq-provider,.oq-card.m-acrylic .oq-provider{box-shadow:inset 0 1px 0 rgba(255,255,255,0.06)}",
      // 环形进度中心（数字背后的那圈内孔）在半透明材质上要压一层深色，
      // 否则数字会叠在透光的玻璃上、对比度不足。
      // 旧实现是给 ::after 上色（挖空圆），现在圆环换成 SVG，中心是透明的，
      // 所以改成给容器加一层背景——但**只加内侧**（border-radius:50% + 小内缩），
      // 避免把 SVG 的环也一起盖住。
      ".oq-card.m-liquid .oq-tm-ring b,.oq-card.m-acrylic .oq-tm-ring b{text-shadow:0 1px 3px rgba(0,0,0,0.55)}",
      // 液态玻璃：低半径模糊换高饱和，靠"镜面高光 + 渐变描边"出体积感
      ".oq-card.m-liquid{background:radial-gradient(150% 95% at 14% -14%,rgba(255,255,255,0.20),rgba(255,255,255,0) 54%),radial-gradient(120% 85% at 92% 118%,rgba(139,123,255,0.26),rgba(139,123,255,0) 62%),rgba(19,20,28,0.46);-webkit-backdrop-filter:blur(7px) saturate(210%) brightness(1.06);backdrop-filter:blur(7px) saturate(210%) brightness(1.06);border-color:rgba(255,255,255,0.10);box-shadow:0 22px 48px -18px rgba(0,0,0,0.72),0 0 0 1px rgba(255,255,255,0.05),inset 0 1px 1px rgba(255,255,255,0.40),inset 0 -18px 28px -20px rgba(139,123,255,0.50)}",
      // 指针跟随的镜面斑（--oq-mx/--oq-my 由 QuotaWidget 的 pointermove 写入）
      ".oq-card.m-liquid::before{background:radial-gradient(120px 90px at var(--oq-mx,18%) var(--oq-my,0%),rgba(255,255,255,0.22),rgba(255,255,255,0.06) 38%,rgba(255,255,255,0) 66%);mix-blend-mode:screen;opacity:0.85}",
      // 渐变描边：padding + mask 挖空，只留 1px 环，避免圆角处出现方角
      ".oq-card.m-liquid::after{padding:1px;background:linear-gradient(142deg,rgba(255,255,255,0.68),rgba(255,255,255,0.10) 32%,rgba(255,255,255,0.02) 56%,rgba(255,255,255,0.38));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}",
      // 亚克力：大半径模糊 + 噪点（Win11 那套材质语言）
      ".oq-card.m-acrylic{background:linear-gradient(180deg,rgba(38,40,52,0.66),rgba(24,26,34,0.80));-webkit-backdrop-filter:blur(38px) saturate(155%) brightness(1.10);backdrop-filter:blur(38px) saturate(155%) brightness(1.10);border-color:rgba(255,255,255,0.12);box-shadow:0 26px 52px -22px rgba(0,0,0,0.85),inset 0 0 0 1px rgba(255,255,255,0.03),inset 0 1px 0 rgba(255,255,255,0.13)}",
      // 噪点用内联 feTurbulence（约 300 字节，比 base64 位图省一个请求且无分辨率损失）
      ".oq-card.m-acrylic::after{background:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\");opacity:0.075;mix-blend-mode:overlay}",
      // 哑光纸：不透明暖白，零背景模糊（低端机也稳）。它自带一套"浅色"变量，因此
      // 在深色主题下也不会出现白底白字——--dsw-alias-label-* 与热力色阶在此作用域内就地覆盖。
      ".oq-overlay.m-paper{--dsw-alias-label-primary:#2a2318;--dsw-alias-label-secondary:#6b6152;--dsw-alias-label-caption:#96897a;--dsw-alias-label-tertiary:#a89b8a;--dsw-alias-bg-layer-1:rgba(120,100,70,0.05);--dsw-alias-bg-layer-2:rgba(120,100,70,0.09);--dsw-alias-border-l1:rgba(120,100,70,0.20);--dsw-alias-border-l2:rgba(120,100,70,0.30);--dsw-alias-interactive-bg-hover:rgba(120,100,70,0.10);--bmon-c1:#5d6cc4;--bmon-c2:#8f6b1e;--bmon-c3:#c2426e;--bmon-c4:#6d51c4;--bmon-h0:#ece4d1;--bmon-h1:#d9d4f0;--bmon-h2:#c1b8e6;--bmon-h3:#a699d8;--bmon-h4:#8a79c6;--bmon-h5:#7059b0;--bmon-h6:#574194}",
      ".oq-card.m-paper{background:linear-gradient(170deg,#fdfaf3 0%,#f7f2e6 55%,#f1ebdd 100%);border-color:rgba(120,100,70,0.20);box-shadow:inset 0 1px 0 rgba(255,255,255,0.90),0 16px 30px -16px rgba(61,50,30,0.38),0 2px 6px -2px rgba(61,50,30,0.16);-webkit-backdrop-filter:none;backdrop-filter:none}",
      // 右键菜单跟随材质（纸面用暖白，玻璃系保持深色磨砂）
      ".oq-overlay.m-paper .oq-menu{background:#fbf7ee;border-color:rgba(120,100,70,0.22);box-shadow:0 10px 28px rgba(61,50,30,0.28);-webkit-backdrop-filter:none;backdrop-filter:none}",
      // active 项原来是"淡紫底 + 紫字"，纸面上对比不足；换成暖棕字并加深底色
      ".oq-overlay.m-paper .oq-menu-item.active{background:rgba(138,106,58,0.16);color:#6b4f22}",
      ".oq-overlay.m-liquid .oq-menu,.oq-overlay.m-acrylic .oq-menu{background:rgba(20,21,29,0.82);border-color:rgba(255,255,255,0.13);box-shadow:0 14px 32px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.10);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}",
      ".oq-card.m-paper::after{background:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\");opacity:0.05;mix-blend-mode:multiply}",
      ".oq-card.m-paper .oq-provider,.oq-card.m-paper .oq-detail,.oq-card.m-paper .oq-stat,.oq-card.m-paper .oq-tm-tile{background:rgba(255,255,255,0.55);border-color:rgba(120,100,70,0.16);box-shadow:inset 0 1px 0 rgba(255,255,255,0.85)}",
      // 纸面上热力格原有的白色玻璃高光会发灰，改为纯色 + 细描边。
      // 必须排除 oh-future / oh-empty：它们是 background 简写画的斜纹，被这条
      // （特异性更高的）background-image:none 盖掉后未来日期会变成一块实色。
      ".oq-card.m-paper .oq-heat-cell:not(.oh-future):not(.oh-empty){background-image:none;box-shadow:inset 0 0 0 1px rgba(120,100,70,0.12)}",
      ".oq-card.m-paper .oq-heat-cell:not(.oh-future):not(.oh-empty):hover{box-shadow:inset 0 0 0 1px rgba(120,100,70,0.45),0 1px 4px rgba(61,50,30,0.25)}",
      // 纸面是暖白底：圆环中心不需要压暗，数字本来就是深色，去掉阴影即可
      ".oq-card.m-paper .oq-tm-ring b{text-shadow:none}",
      ".oq-card.m-paper .oq-tm-hbar{background:rgba(120,100,70,0.14);border-color:rgba(120,100,70,0.16);box-shadow:inset 0 1px 2px rgba(61,50,30,0.12)}",
      // 纸面是暖白底：白色的柱槽/网格线/进度槽会直接消失，统一换成暖棕淡色
      ".oq-card.m-paper .oq-chart-bar{background:rgba(120,100,70,0.10);border-color:rgba(120,100,70,0.14)}",
      ".oq-card.m-paper .oq-chart-grid{background-image:repeating-linear-gradient(to top,rgba(120,100,70,0.16) 0 1px,transparent 1px 44px)}",
      ".oq-card.m-paper .oq-stack,.oq-card.m-paper .oq-podium .bar,.oq-card.m-paper .oq-r2 .bar,.oq-card.m-paper .oq-tl .tok,.oq-card.m-paper .oq-recbar .b,.oq-card.m-paper .oq-tinybar{background:rgba(120,100,70,0.14)}",
      ".oq-card.m-paper .oq-tl::before{background:rgba(120,100,70,0.22)}",
      ".oq-card.m-paper .oq-tl .it::before{box-shadow:0 0 0 2px rgba(247,242,230,1)}",
      // 环形进度的背景轨道是内联 SVG 的 stroke 属性（白色/灰白），浅底上等于隐形。
      // 用属性选择器覆盖 presentation attribute——CSS 声明的优先级高于 SVG 属性值。
      ".oq-card.m-paper .oq-provider-icon svg circle[stroke='rgba(255,255,255,0.08)']{stroke:rgba(120,100,70,0.20)}",
      ".oq-card.m-paper .oq-provider-icon svg circle[stroke='rgba(127,127,127,0.28)']{stroke:rgba(120,100,70,0.22)}",
      // 低端机/省电/关闭动画：模糊是每帧重算的开销，直接退回实色（仍是同一配色）
      "@media (prefers-reduced-motion:reduce){.oq-card.m-liquid,.oq-card.m-acrylic{-webkit-backdrop-filter:none;backdrop-filter:none}.oq-card.m-liquid{background:linear-gradient(170deg,rgba(32,32,44,0.94),rgba(20,20,28,0.96))}.oq-card.m-acrylic{background:linear-gradient(180deg,rgba(38,40,52,0.94),rgba(24,26,34,0.96))}}",
      // 亮色主题：玻璃必须换成"亮底 + 深色描边"，否则深色玻璃底叠深色文字直接看不清。
      // 宿主没有给 data-theme 钩子，沿用热力色阶同一条判据（prefers-color-scheme）。
      "@media (prefers-color-scheme: light){.oq-card.m-liquid{background:radial-gradient(150% 95% at 14% -14%,rgba(255,255,255,0.95),rgba(255,255,255,0.20) 58%),radial-gradient(120% 85% at 92% 118%,rgba(139,123,255,0.22),rgba(139,123,255,0) 62%),rgba(255,255,255,0.42);border-color:rgba(255,255,255,0.70);box-shadow:0 22px 48px -18px rgba(30,36,60,0.30),inset 0 1px 1px rgba(255,255,255,0.95),inset 0 -18px 28px -20px rgba(139,123,255,0.30)}.oq-card.m-liquid::before{opacity:0.45}.oq-card.m-liquid::after{background:linear-gradient(142deg,rgba(255,255,255,0.95),rgba(255,255,255,0.35) 32%,rgba(120,130,180,0.10) 56%,rgba(255,255,255,0.85))}.oq-card.m-acrylic{background:linear-gradient(180deg,rgba(252,253,255,0.80),rgba(244,246,252,0.88));border-color:rgba(255,255,255,0.90);box-shadow:0 22px 44px -22px rgba(30,36,60,0.28),inset 0 1px 0 #fff}.oq-card.m-acrylic::after{opacity:0.05}.oq-card.m-liquid .oq-provider,.oq-card.m-liquid .oq-detail,.oq-card.m-liquid .oq-stat,.oq-card.m-liquid .oq-tm-tile,.oq-card.m-acrylic .oq-provider,.oq-card.m-acrylic .oq-detail,.oq-card.m-acrylic .oq-stat,.oq-card.m-acrylic .oq-tm-tile{background:rgba(16,20,40,0.035);border-color:rgba(16,20,40,0.08)}.oq-overlay.m-liquid,.oq-overlay.m-acrylic{--dsw-alias-bg-layer-1:rgba(16,20,40,0.05);--dsw-alias-bg-layer-2:rgba(16,20,40,0.04);--dsw-alias-border-l1:rgba(16,20,40,0.10);--dsw-alias-border-l2:rgba(16,20,40,0.16)}.oq-overlay.m-liquid .oq-menu,.oq-overlay.m-acrylic .oq-menu{background:rgba(255,255,255,0.92);border-color:rgba(16,20,40,0.10);box-shadow:0 14px 32px rgba(30,36,60,0.18)}.oq-card.m-liquid .oq-tm-ring b,.oq-card.m-acrylic .oq-tm-ring b{text-shadow:0 1px 2px rgba(0,0,0,0.28)}.oq-card.m-liquid .oq-tm-hbar,.oq-card.m-acrylic .oq-tm-hbar,.oq-card.m-liquid .oq-tinybar,.oq-card.m-acrylic .oq-tinybar{background:rgba(16,20,40,0.10);border-color:rgba(16,20,40,0.12);box-shadow:inset 0 1px 2px rgba(16,20,40,0.10)}}",
      ".oq-body{padding:2px 5px 4px;display:flex;flex-direction:column;gap:4px;position:relative;overflow:hidden}",
      ".oq-carousel{position:relative;overflow:hidden;touch-action:pan-y;min-height:auto;transition:height 0.22s cubic-bezier(0.22,1,0.36,1)}",
      ".oq-provider{width:100%;min-width:0;max-width:100%;overflow:hidden}",
      ".oq-track{display:flex;align-items:flex-start;transition:transform 0.32s cubic-bezier(0.22,1,0.36,1);will-change:transform}",
      ".oq-slide{flex:0 0 100%;min-width:0;box-sizing:border-box;padding:1px}",
      ".oq-provider{padding:5px 7px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#242433);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06));display:flex;gap:8px;align-items:center;box-sizing:border-box}",
      ".oq-menu{position:fixed;min-width:140px;max-width:220px;background:var(--dsw-alias-bg-layer-2,#1e1e28);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:1001;overflow:hidden;overflow-y:auto;max-height:min(70vh,360px);padding:4px;backdrop-filter:blur(12px);overscroll-behavior:contain}",
      ".oq-menu-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#a0a0b0);transition:background 0.12s}",
      ".oq-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.06));color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-menu-item.active{background:rgba(109,91,255,0.15);color:#8b7bff}",
      ".oq-menu-dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:0.6;flex:none}",
      ".oq-menu-item.active .oq-menu-dot{opacity:1}",
      ".oq-menu-check{margin-left:auto;font-size:11px;opacity:0.9}",
      ".oq-menu-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,0.06));margin:4px 0}",
      ".oq-provider-icon{width:28px;height:28px;border-radius:8px;flex:none;position:relative;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}",
      ".oq-provider-icon svg{transform:rotate(-90deg)}",
      ".oq-provider-icon-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:750;color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-provider-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
      ".oq-provider-title{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary,#fff);line-height:1.2;display:flex;gap:4px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".oq-provider-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#a0a0b0);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".oq-badge{font-size:9px;padding:1px 5px;border-radius:999px;background:rgba(109,91,255,0.12);color:#8b7bff;border:1px solid rgba(109,91,255,0.18);line-height:1.4}",
      ".oq-badge.live{background:rgba(52,211,153,0.12);color:#10b981;border-color:rgba(52,211,153,0.2)}",
      ".oq-badge.warn{background:rgba(245,158,11,0.14);color:#d97706;border-color:rgba(245,158,11,0.2)}",
      ".oq-badge.err{background:rgba(239,68,68,0.12);color:#ef4444;border-color:rgba(239,68,68,0.2)}",
      ".oq-tinybar{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1a1a1f);overflow:hidden;margin-top:3px;display:flex;gap:1px}",
      ".oq-tinybar-seg{height:100%;border-radius:999px;transition:width 0.3s ease}",
      ".oq-detail{padding:8px 8px 6px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#242433);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06));display:flex;flex-direction:column;gap:6px}",
      ".oq-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
      ".oq-stat{padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#1a1a1f);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))}",
      ".oq-stat b{font-size:13px;font-weight:750;color:var(--dsw-alias-label-primary,#fff);display:block;line-height:1.1}",
      ".oq-stat span{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      "@keyframes oq-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}",
      ".oq-spin{width:12px;height:12px;border:2px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.15));border-top-color:var(--dsw-alias-state-business-primary,#6d5bff);border-radius:50%;animation:oq-spin 0.8s linear infinite;display:inline-block}",
      ".oq-chart{overflow-x:auto;overflow-y:hidden;padding:6px 2px}",
      ".oq-chart-cols{display:flex;align-items:flex-end;gap:6px;min-height:110px}",
      ".oq-chart-col{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:34px}",
      ".oq-chart-bar{width:30px;border-radius:6px 6px 3px 3px;overflow:hidden;display:flex;flex-direction:column-reverse;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.06)}",
      ".oq-chart-seg{width:100%;transition:height 0.25s ease}",
      ".oq-chart-label{font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);white-space:nowrap}",
      // 柱状图的横向参考线：每 44px 一条（约等于 110px 绘图区的 0/1/3、2/3 高度），
      // 让"柱子多高"有个可比的量纲（此前只能靠悬停才知道数值）
      ".oq-chart-grid{background-image:repeating-linear-gradient(to top,rgba(255,255,255,0.09) 0 1px,transparent 1px 44px);background-repeat:no-repeat}",
      ".oq-chart-foot{display:flex;justify-content:flex-end;margin-top:2px}",
      ".oq-line-x{display:flex;gap:2px;font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-top:2px}",
      ".oq-line-x span{flex:1;min-width:0;text-align:center;overflow:hidden;white-space:nowrap}",
      ".oq-rec-dur{flex:none;min-width:44px;text-align:right;color:var(--dsw-alias-label-caption,#9a9aaa);font-variant-numeric:tabular-nums}",
      // ── 用量统计"三风格"外观层（设置页可切换，见 loadUsageStyle）──
      ".oq-num{font-variant-numeric:tabular-nums}",
      ".oq-cap{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      // 总览 A：仪表盘
      ".oq-ov-top{display:flex;align-items:center;gap:14px}",
      ".oq-ov-big{font-size:30px;font-weight:750;letter-spacing:-.5px;line-height:1.1;font-variant-numeric:tabular-nums}",
      ".oq-ov-big em{font-style:normal;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,#a0a0b0);margin-left:2px}",
      ".oq-ov-lbl{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-top:2px}",
      ".oq-ov-sub{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:11px;color:var(--dsw-alias-label-secondary,#a0a0b0);font-variant-numeric:tabular-nums}",
      ".oq-ring{position:relative;display:inline-block;flex:none}",
      ".oq-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-variant-numeric:tabular-nums}",
      ".oq-stack{display:flex;height:12px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.06);margin:13px 0 4px}",
      ".oq-stack span{height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}",
      ".oq-stack span i{font-style:normal;font-size:9px;font-weight:700;color:rgba(255,255,255,0.92)}",
      ".oq-stack-lbl{display:flex;justify-content:space-between;font-size:10px;font-variant-numeric:tabular-nums}",
      ".oq-kpis{display:grid;grid-template-columns:repeat(4,1fr);margin-top:11px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))}",
      ".oq-kpis>div{text-align:center;position:relative}",
      ".oq-kpis>div+div::before{content:'';position:absolute;left:0;top:2px;bottom:2px;width:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,0.08))}",
      ".oq-kpis b{display:block;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}",
      ".oq-kpis i{font-style:normal;font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      // 总览 B：三色卡
      ".oq-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}",
      ".oq-tile{background:var(--dsw-alias-bg-layer-2,#1e1e26);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));border-radius:10px;padding:9px 10px;min-width:0}",
      ".oq-tile .k{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      ".oq-tile .v{font-size:19px;font-weight:750;margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".oq-tile .p{font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-top:3px}",
      // 总览 C：一行摘要
      ".oq-ov-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}",
      ".oq-ov-row .big{font-size:22px;font-weight:750;font-variant-numeric:tabular-nums}",
      // 图表：坐标系 / 摘要条 / 聚焦
      ".oq-ax text{font-size:8px;fill:var(--dsw-alias-label-caption,#9a9aaa)}",
      ".oq-ax line{stroke:var(--dsw-alias-border-l1,rgba(255,255,255,0.08));stroke-width:.6}",
      ".oq-bar-hit{cursor:pointer}",
      ".oq-bar-hit.dim{opacity:.28}",
      ".oq-chart-sum{display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-bottom:8px}",
      ".oq-chart-sum b{color:var(--dsw-alias-label-primary,#fff);font-size:12px;font-variant-numeric:tabular-nums}",
      // 排行 A：颁奖台
      ".oq-podium{background:var(--dsw-alias-bg-layer-2,#1e1e26);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));border-radius:10px;padding:10px 12px;margin-bottom:5px}",
      ".oq-podium .nm{font-size:14px;font-weight:700}",
      ".oq-podium .v{font-size:18px;font-weight:750;float:right;font-variant-numeric:tabular-nums}",
      ".oq-podium .bar{height:8px;border-radius:4px;background:rgba(255,255,255,0.06);margin:8px 0 6px;overflow:hidden}",
      ".oq-podium .bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#8b7bff,#2ec5ff)}",
      ".oq-podium .meta{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      // 排行 B：数据表
      ".oq-tbl{font-size:10px}",
      ".oq-tbl .th,.oq-tbl .tr{display:grid;grid-template-columns:20px minmax(0,1fr) 116px 62px 44px;gap:8px;align-items:center}",
      ".oq-tbl .th{color:var(--dsw-alias-label-caption,#9a9aaa);font-size:9px;padding:3px 0 5px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))}",
      ".oq-tbl .tr{padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)}",
      ".oq-tbl .tr:nth-child(even){background:rgba(255,255,255,0.015)}",
      ".oq-tbl .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}",
      ".oq-tbl .n{text-align:right;font-variant-numeric:tabular-nums}",
      ".oq-tbl .n.strong{font-weight:700;color:var(--dsw-alias-label-primary,#fff)}",
      // 排行 C：两行制
      ".oq-r2{padding:6px 0;cursor:pointer;border-radius:6px}",
      ".oq-r2:hover{background:rgba(139,123,255,0.06)}",
      ".oq-r2 .r1{display:flex;align-items:baseline;gap:8px;min-width:0}",
      ".oq-r2 .idx{width:16px;flex:none;font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);font-variant-numeric:tabular-nums;text-align:right}",
      ".oq-r2 .idx.top{color:#8b7bff;font-weight:700}",
      ".oq-r2 .nm{flex:1;min-width:0;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".oq-r2 .pc{font-size:10px;color:var(--dsw-alias-label-secondary,#a0a0b0);font-variant-numeric:tabular-nums}",
      ".oq-r2 .vv{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}",
      ".oq-r2 .bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.06);margin-top:4px;overflow:hidden}",
      ".oq-r2 .bar i{display:block;height:100%;border-radius:3px}",
      ".oq-r2 .meta{font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-top:3px}",
      // 实时 A：半环
      ".oq-gauge{display:flex;align-items:center;gap:16px;flex-wrap:wrap}",
      ".oq-gauge .side{font-size:11px;color:var(--dsw-alias-label-secondary,#a0a0b0);line-height:1.9;font-variant-numeric:tabular-nums}",
      ".oq-gauge .side b{color:var(--dsw-alias-label-primary,#fff)}",
      // 实时 B：sparkline + KPI
      ".oq-live-big{font-size:19px;font-weight:750;font-variant-numeric:tabular-nums}",
      ".oq-live-big span{font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa);font-weight:500;margin-left:4px}",
      ".oq-kpi5{display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));margin-top:10px;padding-top:9px}",
      ".oq-kpi5>div{text-align:center;position:relative;min-width:0}",
      ".oq-kpi5>div+div::before{content:'';position:absolute;left:0;top:2px;bottom:2px;width:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,0.08))}",
      ".oq-kpi5 b{display:block;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".oq-kpi5 i{font-style:normal;font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);display:block;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      // 实时 C：状态条
      ".oq-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      // 最近调用 A：时间线
      ".oq-tl{position:relative;padding-left:14px}",
      ".oq-tl::before{content:'';position:absolute;left:3.5px;top:6px;bottom:6px;width:1px;background:rgba(255,255,255,0.12)}",
      ".oq-tl .it{position:relative;padding:5px 0;cursor:pointer}",
      ".oq-tl .it::before{content:'';position:absolute;left:-14px;top:9px;width:7px;height:7px;border-radius:50%;background:#8b7bff;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,#1a1b22)}",
      ".oq-tl .l1{display:flex;align-items:baseline;gap:8px;font-size:11px;min-width:0}",
      ".oq-tl .t{color:var(--dsw-alias-label-caption,#9a9aaa);font-size:10px;width:56px;flex:none;font-variant-numeric:tabular-nums}",
      ".oq-tl .m{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".oq-tl .d{color:var(--dsw-alias-label-caption,#9a9aaa);font-size:10px;font-variant-numeric:tabular-nums}",
      ".oq-tl .l2{display:flex;align-items:center;gap:8px;font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-left:64px;margin-top:1px}",
      ".oq-tl .tok{display:flex;height:5px;width:110px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,0.06);flex:none}",
      ".oq-tl .tok i{height:100%}",
      // 最近调用 C：Token 条
      ".oq-recbar{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:10px;cursor:pointer}",
      ".oq-recbar .w{width:44px;color:var(--dsw-alias-label-caption,#9a9aaa);font-variant-numeric:tabular-nums;flex:none}",
      ".oq-recbar .m{width:104px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".oq-recbar .b{flex:1;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,0.06);display:flex}",
      ".oq-recbar .b i{height:100%}",
      // 外观设置行
      ".oq-style-row{display:flex;align-items:center;gap:10px;padding:4px 0;flex-wrap:wrap}",
      ".oq-style-row .nm{width:64px;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#a0a0b0)}",
      ".oq-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}",
      ".oq-legend-item{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa)}",
      ".oq-legend-dot{width:8px;height:8px;border-radius:2px;flex:none}",
      ".oq-tm-head{display:flex;align-items:center;gap:6px;width:100%}",
      ".oq-tm-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,#fff);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}",
      ".oq-tm-total{font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#fff);white-space:nowrap;flex:none}",
      ".oq-tm-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%;box-sizing:border-box}",
      ".oq-tm-tile{background:var(--dsw-alias-bg-layer-2,#1a1a1f);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06));border-radius:8px;padding:6px 7px;display:flex;flex-direction:column;gap:2px;min-width:0;box-sizing:border-box}",
      ".oq-tm-tile-label{font-size:10px;line-height:1.2;color:var(--dsw-alias-label-primary,#f0f0f5);font-weight:700;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".oq-tm-tile-value{font-size:13px;font-weight:760;line-height:1.15;color:var(--dsw-alias-label-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".oq-tm-tile-value small{font-size:10px;font-weight:500;color:var(--dsw-alias-label-caption,#9a9aaa);margin-left:3px}",
      ".oq-tm-tile-sub{font-size:10px;line-height:1.25;color:var(--dsw-alias-label-secondary,#a0a0b0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      // 圆环容器：尺寸由 JS 常量决定（见 RING_SIZE），这里只保证不被压缩。
      // 旧的 ::after 内孔挖空已删除——现在内孔是 SVG 底槽自然露出来的，
      // 不需要再用一个同色圆盖住中心（那个做法在半透明材质上会发白，见下面
      // .m-liquid/.m-acrylic 的覆盖规则）。
      ".oq-tm-ring{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center}",
      ".oq-tm-ring svg{display:block}",
      // 数字层：等宽数字，避免 99%→100% 时文字抖动
      // 环宽 6→4.2 后内孔从 22px 扩到 25.6px，数字可以略放大到 12px 而不贴边。
      ".oq-tm-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;letter-spacing:-0.4px;font-variant-numeric:tabular-nums;line-height:1;pointer-events:none}",
      ".oq-tm-empty{font-size:11px;color:var(--dsw-alias-label-caption,#9a9aaa);padding:6px 2px;line-height:1.5}",
      ".oq-tm-foot{margin-top:1px;font-size:10px;color:var(--dsw-alias-label-caption,#9a9aaa);display:flex;justify-content:space-between;gap:8px}",
      ".oq-tm-hbar{height:8px;border-radius:999px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.06);box-shadow:inset 0 1px 2px rgba(0,0,0,0.2);overflow:hidden;position:relative;padding:1px;box-sizing:border-box;flex:1}",
      ".oq-tm-hbar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#c65f7f 0%,#ff8fab 100%);box-shadow:0 0 8px rgba(198,95,127,0.4);position:relative;overflow:hidden;width:0%}",
      ".oq-tm-hbar-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.28),transparent);transform:translateX(-100%);animation:oq-shimmer 2s infinite}",
      "@keyframes oq-shimmer{100%{transform:translateX(100%)}}",
      "@keyframes oq-pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.45)}70%{box-shadow:0 0 0 6px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}",
      ".oq-heat{display:flex;flex-direction:column;gap:2px;margin:0 -5px;padding:0 5px}",
      ".oq-heat-week{display:flex;gap:2px}",
      ".oq-heat-cell{flex:1;min-width:3px;height:8px;border-radius:4px;background-color:var(--bmon-h0,#252831);background-image:linear-gradient(180deg,rgba(255,255,255,0.22) 0%,rgba(255,255,255,0.05) 45%,rgba(0,0,0,0.20) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40);cursor:default;position:relative}",
      ".oq-heat-cell:hover{z-index:1;box-shadow:inset 0 1px 0 rgba(255,255,255,0.30),inset 0 -1px 1px rgba(0,0,0,0.30),0 0 0 1px rgba(255,255,255,0.55),0 2px 8px rgba(0,0,0,0.50)}",
      ".oq-heat-cell.oh1{background-color:var(--bmon-h1,#c8c6ee)}.oq-heat-cell.oh2{background-color:var(--bmon-h2,#a9a4e6)}.oq-heat-cell.oh3{background-color:var(--bmon-h3,#8b83dd)}.oq-heat-cell.oh4{background-color:var(--bmon-h4,#7066cf)}.oq-heat-cell.oh5{background-color:var(--bmon-h5,#5749ba)}.oq-heat-cell.oh6{background-color:var(--bmon-h6,#443699)}",
      ".oq-heat-cell.oh-empty{background:none;box-shadow:none;visibility:hidden}",
      // 点击选中的那天（下钻明细的锚点）
      ".oq-heat-cell.oh-sel{outline:2px solid #8b7bff;outline-offset:1px}",
      // 只有"有数据"的格子可点：给个手型，否则用户不知道热力图能点
      ".oq-heat-cell.oh-clickable{cursor:pointer}",
      ".oq-heat-cell.oh-clickable:hover{filter:brightness(1.12)}",
      ".oq-heat-cell.oh-future{background:repeating-linear-gradient(45deg,rgba(154,154,170,0.30) 0 2px,rgba(154,154,170,0.06) 2px 5px)}",
      // 今日格静态兜底（reduced-motion/动画未启动瞬间）：带全 base 内高光，别只剩光秃秃的环
      ".oq-heat-cell.oh-today{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),0 0 0 1.5px rgba(139,123,255,0.85)}",
      // 边缘列锚定：.oq-heat 经 -5px 外扩与卡片边缘齐平，上层 overflow:hidden 链会裁掉
      // 边缘格的悬停环/果冻溢出 → 边缘格只向内侧生长，环改画进格子内部
      ".oq-heat-cell.oh-el{transform-origin:left center}",
      ".oq-heat-cell.oh-er{transform-origin:right center}",
      ".oq-heat-cell.oh-el:hover,.oq-heat-cell.oh-er:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,0.30),inset 0 -1px 1px rgba(0,0,0,0.30),inset 0 0 0 1px rgba(255,255,255,0.55),0 2px 8px rgba(0,0,0,0.50)}",
      ".oq-heat-cell.oh-el.oh-today,.oq-heat-cell.oh-er.oh-today{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),inset 0 0 0 1.5px rgba(139,123,255,0.85)}",
      // 今日呼吸走纯 CSS：原 GSAP 版被数据刷新的 420ms 防抖反复 kill/重启（流式会话期间
      // 永远到不了峰值，视觉上卡住）、被 hover 果冻的 killTweensOf 误杀，且依赖 CDN GSAP。
      // CSS 动画与刷新节奏/悬停完全解耦，重渲染换节点也自动续上；box-shadow 列表长度
      // 两侧一致（第 5 层用透明 0 扩散占位）保证插值平滑。边缘列用 inset 变体防裁剪。
      "@keyframes oq-breathe{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),0 0 0 1px rgba(139,123,255,0.45),0 0 0 0 rgba(139,123,255,0)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),0 0 0 2.5px rgba(139,123,255,0.95),0 0 10px 1px rgba(139,123,255,0.30)}}",
      "@keyframes oq-breathe-in{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),inset 0 0 0 1px rgba(139,123,255,0.45),inset 0 0 0 0 rgba(139,123,255,0)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 1px rgba(0,0,0,0.35),0 1px 2px rgba(0,0,0,0.40),inset 0 0 0 2.5px rgba(139,123,255,0.95),inset 0 0 7px 1px rgba(139,123,255,0.35)}}",
      ".oq-heat-cell.oh-today{animation:oq-breathe 2.4s ease-in-out infinite}",
      ".oq-heat-cell.oh-el.oh-today,.oq-heat-cell.oh-er.oh-today{animation-name:oq-breathe-in}",
      "@media (prefers-reduced-motion:reduce){.oq-heat-cell.oh-today{animation:none}}",
      ".oq-heat-tip{position:fixed;z-index:1002;pointer-events:none;opacity:0;background:var(--dsw-alias-bg-layer-2,#1e1e28);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);padding:8px 10px;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-primary,#fff);min-width:132px}",
      ".oq-heat-tip .tt-head{font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-bottom:2px;white-space:nowrap}",
      ".oq-heat-tip .tt-main{font-size:14px;font-weight:750;margin-bottom:4px;white-space:nowrap}",
      ".oq-heat-tip .tt-row{display:flex;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-secondary,#a0a0b0);white-space:nowrap}",
      ".oq-heat-tip .tt-row b{color:var(--dsw-alias-label-primary,#fff);fontWeight:600}",
      ".oq-heat-tip .tt-lv{display:flex;gap:3px;margin-top:5px;align-items:center}",
      ".oq-heat-tip .tt-lv i{width:7px;height:7px;border-radius:2px;display:inline-block}",
      ".oq-heat-days{display:flex;gap:2px;margin-top:1px}",
      ".oq-heat-days span{flex:1;font-size:8px;color:var(--dsw-alias-label-caption,#9a9aaa);text-align:center;line-height:1.2;overflow:hidden;white-space:nowrap}",
      ".oq-heat-foot{font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa);margin-top:2px;line-height:1.3}",
      ".oq-tabs{display:flex;align-items:flex-end;gap:22px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.12));margin-top:2px}",
      ".oq-tab{position:relative;color:var(--dsw-alias-label-tertiary,#7a7a8a);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;background:none;border:none;padding:7px 1px 9px}",
      ".oq-tab:hover,.oq-tab[data-active='1']{color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-tab[data-active='1']::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-state-business-primary,#8b7bff)}",
      ".oq-hm-lg .oq-heat-cell{height:20px;border-radius:6px;min-width:3px}",
      ".oq-rank-row{display:flex;align-items:center;gap:10px;font-size:11px;line-height:1.7}",
      ".oq-rank-name{width:34%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#a0a0b0)}",
      ".oq-rank-track{flex:1;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1e1e26);overflow:hidden}",
      ".oq-rank-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6d5bff,#2ec5ff)}",
      ".oq-rank-val{flex:none;min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary,#a0a0b0);font-variant-numeric:tabular-nums}",
      ".oq-rec-row{display:flex;align-items:center;gap:10px;font-size:11px;line-height:2;color:var(--dsw-alias-label-secondary,#a0a0b0)}",
      ".oq-rec-time{flex:none;color:var(--dsw-alias-label-caption,#9a9aaa);font-variant-numeric:tabular-nums}",
      ".oq-rec-model{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-rec-tok{flex:none;font-variant-numeric:tabular-nums}",
      // 设置弹窗左导航入口图标（宿主只按 id 兜底成齿轮，见文件上方 SETTINGS_SECTION_LABEL
      // 注释）：标记到本分区那一行后隐藏宿主图标，用 mask 自绘仪表盘字形。::before 作为
      // 首个 flex 项参与宿主自己的 gap:8px 布局，与相邻条目对齐。
      "["+NAV_ROW_MARK+"]>svg{display:none}",
      "["+NAV_ROW_MARK+"]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:url(\"data:image/svg+xml,"+NAV_MASK_SVG+"\") center/contain no-repeat;mask:url(\"data:image/svg+xml,"+NAV_MASK_SVG+"\") center/contain no-repeat}",
      // ── 左侧栏全局面板（对齐 ui-plugin-manager 的页壳几何，见其 page/pageHead 样式）──
      ".oq-page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;gap:20px;overflow-y:auto;overscroll-behavior:contain;padding:28px clamp(24px,4vw,48px) 48px}",
      "[data-platform=darwin] .oq-page{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}",
      ".oq-page>*{width:100%;max-width:960px}",
      ".oq-page-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px}",
      ".oq-page-title{margin:0;font-size:20px;font-weight:500;line-height:28px;color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-page-sub{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#a0a0b0)}",
      // 标题右侧的悬浮窗显隐切换：与官方页头操作按钮同款紧凑 ghost 形态
      ".oq-page-toggle{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));background:none;color:var(--dsw-alias-label-secondary,#a0a0b0);font-family:inherit;font-size:12px;cursor:pointer}",
      ".oq-page-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.06));color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-page-toggle .oq-page-toggle-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-caption,#9a9aaa);flex:none}",
      ".oq-page-toggle[data-on='1']{color:var(--dsw-alias-label-primary,#fff)}",
      ".oq-page-toggle[data-on='1'] .oq-page-toggle-dot{background:#34d399}",
    ].join("\n");
    function ensureStyle(){ if(typeof document==="undefined") return; var cssText = Array.isArray(CSS) ? CSS.join("\n") : CSS; var ex=document.getElementById(STYLE_ID); if(ex){ ex.textContent=cssText; return; }
      try{ var old=document.getElementById("dsh-quota-widget-style"); if(old) old.remove(); var old2=document.getElementById("dsh-quota-widget-style-v2"); if(old2) old2.remove(); }catch(e){}
      var t=document.createElement("style"); t.id=STYLE_ID; t.textContent=cssText; document.head.appendChild(t); }
    // 给设置弹窗左导航里"属于本插件"的那一行打标记（宿主没有 id/data-* 钩子，只能按行文案
    // 精确匹配）。只增删自己那个标记属性，不替换也不改写宿主/React 拥有的节点，所以重渲染
    // 最多是标记丢失、下一帧被补回，不会破坏宿主自己的协调。返回值仅用于自检。
    function markSettingsNavRow(){
      if(typeof document==="undefined") return false;
      var rows=null;
      try{ rows=document.querySelectorAll('[role="dialog"] nav button'); }catch(e){ return false; }
      if(!rows || !rows.length) return false;
      var matched=false;
      for(var i=0;i<rows.length;i++){
        var el=rows[i];
        var on=false;
        try{ on=((el.textContent||"").trim()===SETTINGS_SECTION_LABEL) && !!el.querySelector("svg"); }catch(e){ on=false; }
        if(on){ matched=true; if(!el.hasAttribute(NAV_ROW_MARK)) el.setAttribute(NAV_ROW_MARK,""); }
        else if(el.hasAttribute(NAV_ROW_MARK)) el.removeAttribute(NAV_ROW_MARK);
      }
      return matched;
    }
    function installSettingsNavIcon(){
      if(typeof document==="undefined" || !document.body) return;
      // 样式表本来只在悬浮窗渲染时才建；悬浮窗关掉时设置导航也得能贴上图标，所以这里先确保它存在
      try{ ensureStyle(); }catch(e){}
      var KEY="__DSH_QUOTA_WIDGET_NAV_ICON__";
      var st=null;
      try{ st=window[KEY]; }catch(e){ st=null; }
      // 重复 apply（热更新/重新加载）只重刷标记，不叠第二个观察器
      if(st && typeof st.mark==="function"){ try{ st.mark(); }catch(e){} return; }
      markSettingsNavRow();
      var pending=false;
      function wake(records){
        // 流式会话每秒会改很多次 DOM：先看这批变更有没有碰到设置弹窗，没碰到直接跳过，
        // 且一帧最多扫一次
        var relevant=false;
        for(var i=0;i<records.length && !relevant;i++){
          var t=records[i].target;
          if(!t || t.nodeType!==1) continue;
          try{
            relevant=!!(t.closest && t.closest('[role="dialog"]')) || !!(t.querySelector && t.querySelector('[role="dialog"]'));
          }catch(e){ relevant=false; }
        }
        if(!relevant || pending) return;
        pending=true;
        var run=function(){ pending=false; markSettingsNavRow(); };
        try{ window.requestAnimationFrame(run); }catch(e){ setTimeout(run,120); }
      }
      try{
        var mo=new MutationObserver(wake);
        mo.observe(document.body,{childList:true,subtree:true});
        try{ Object.defineProperty(window,KEY,{value:{mark:markSettingsNavRow,observer:mo},enumerable:false,configurable:true,writable:true}); }
        catch(e){ window[KEY]={mark:markSettingsNavRow,observer:mo}; }
      }catch(e){ /* 观察器不可用时至少留下首帧那一次标记 */ }
    }
    var GSAP_URL="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";
    // 加载状态机：idle → loading（共享等待者队列）→ ready / failed（冷却）。
    // 旧实现没有"在飞"记忆：只要 window.gsap 还不存在，每次调用都 append 一个 <script>。
    // 而调用点里有三个在轮询/渲染路径上（额度条、命中率条、热力图高亮），离线或 CSP
    // 拦截时会随 5s 轮询不断堆积脚本节点。现在全局只发一次请求，失败后进入冷却窗口，
    // 冷却期内直接回调 null（调用方本来就都有纯 CSS 降级分支）。
    var GSAP_FAIL_COOLDOWN_MS=5*60*1000;
    var gsapState="idle", gsapWaiters=[], gsapFailedAt=0;
    function fireGsapWaiters(g){
      var list=gsapWaiters; gsapWaiters=[];
      for(var i=0;i<list.length;i++){ try{ list[i](g); }catch(e){} }
    }
    function ensureGSAP(cb){
      try{
        if(typeof window!=="undefined" && window.gsap) return cb(window.gsap);
        if(typeof window!=="undefined" && window.GSAP) return cb(window.GSAP);
        // 冷却期内不再发请求：直接降级，避免反复撞同一个不可达的 CDN
        if(gsapState==="failed" && (Date.now()-gsapFailedAt)<GSAP_FAIL_COOLDOWN_MS) return cb(null);
        if(gsapState==="loading"){ gsapWaiters.push(cb); return; }
        gsapState="loading";
        gsapWaiters.push(cb);
        var s=document.createElement("script");
        s.src=GSAP_URL; s.async=true;
        s.onload=function(){
          var g=null; try{ g=window.gsap||window.GSAP||null; }catch(e){}
          if(g){ gsapState="ready"; } else { gsapState="failed"; gsapFailedAt=Date.now(); }
          fireGsapWaiters(g);
        };
        s.onerror=function(){ gsapState="failed"; gsapFailedAt=Date.now(); fireGsapWaiters(null); };
        document.head.appendChild(s);
      }catch(e){ cb(null); }
    }
    function fmtNum(n){ if(n==null||isNaN(n)) return "—"; var v=Number(n); if(v>=1000000000) return (v/1000000000).toFixed(2)+"B"; if(v>=1000000) return (v/1000000).toFixed(2)+"M"; if(v>=1000) return (v/1000).toFixed(1)+"K"; return String(Math.round(v)); }
    // 热力图分档（紧凑悬浮窗 / 设置页共用，避免两处阈值各写一份后跑偏）：
    // 返回 0（无数据）或 1..HEAT_LV（用量越大档位越高 = 颜色越深）。
    // 当月样本 ≥4 天时按排名分位映射（避免单日超大值把所有日子压成最低档）；
    // 样本不足时退化为 sqrt(v/max) 连续映射，2-3 个数据点也能拉开档位。
    var HEAT_LV=6;
    function heatLvOf(v, monthVals, useQuantile, max){
      if(!(v>0)) return 0;
      if(useQuantile){
        // rank = 严格小于 v 的样本数（0..n-1），同值样本落在同一档
        var rank=0;
        for(var i=0;i<monthVals.length;i++){ if(monthVals[i]<v) rank=i+1; else break; }
        var pct=rank/Math.max(1,monthVals.length-1);
        return Math.min(HEAT_LV, 1+Math.floor(pct*HEAT_LV));
      }
      var ratio = max>0 ? Math.sqrt(v/max) : 0;
      return Math.min(HEAT_LV, 1+Math.floor(ratio*(HEAT_LV-0.01)));
    }
    // 热力档位色块序列（i=0 为"无数据"档），供设置页图例使用
    function heatSwatchEls(size,radius){
      var out=[];
      for(var i=0;i<=HEAT_LV;i++){ out.push(jsx_runtime.jsx("i",{style:{width:size,height:size,borderRadius:radius,background:"var(--bmon-h"+i+")"}},i)); }
      return out;
    }
    // 1d 分时图的数据整理：把 legacy hourly（键 = model::YYYY-MM-DDTHH，**本地**小时）
    // 折叠成 { 小时键: [各模型桶] }，且只保留 dayStr（本地日，YYYY-MM-DD）当天。
    // 不过滤会把历史各天的小时柱混进"今日分时"、纵轴按全量峰值归一（实测 59 列跨 11 天）。
    // 日期口径：优先用服务端给的 localDate（本地日），缺失时才退回键里的日期段——
    // 旧 host 用 UTC 打键，UTC+8 下本地 00:00–07:59 会被截成前一天而整段丢失。
    // 第三个参数是按模型筛选（来自点击模型排行）。
    function groupTodayHourBuckets(hourly, dayStr, modelFilter){
      var byHour={};
      var entries=Object.entries(hourly||{});
      for(var i=0;i<entries.length;i++){
        var key=entries[i][0], v=entries[i][1];
        if(!v) continue;
        var hour=v.hour || key.split("::")[1] || "";
        if(!hour) hour=key;
        var bucketDate=v.localDate || String(hour).slice(0,10);
        if(String(bucketDate)!==dayStr) continue;
        if(modelFilter && String(v.model||"")!==modelFilter) continue;
        if(!byHour[hour]) byHour[hour]=[];
        byHour[hour].push(v);
      }
      return byHour;
    }
    function fmtTokens(n){
      if(n==null||isNaN(n)) return "—";
      var v=Number(n);
      // M 单位（1e6 ≤ v < 1e9）最多显示一位小数（去掉尾随 .0）：1.25M→1.3M、1.0M→1M。
      // 其余单位（B/K/千以内）沿用 fmtNum 现状。
      if(v>=1000000 && v<1000000000) return String(Math.round(v/1000000*10)/10)+"M";
      return fmtNum(v);
    }
    // 图表柱体几何（模块级纯函数，供设置页与单测共用）：
    // 高度按当前视图峰值归一；0/极小值只留 2px 基线。
    // 旧实现用 Math.max(8, …) 给 0 值也画 8px，空白日看起来"有消耗"，是本次修掉的失真点。
    var CHART_H=88, CHART_MIN_H=2;
    function barHeightFor(value, max){
      var v=Number(value)||0;
      if(!(v>0)) return CHART_MIN_H;
      return Math.max(3, Math.round(v/Math.max(1,max)*CHART_H));
    }
    // 区间 → 天数（0 = "全部"，不设窗口）。环比要按日均比较，必须先知道窗口长度。
    var RANGE_DAYS={ "1d":1, "7d":7, "30d":30, "90d":90, "all":0 };
    // custom 的天数不固定，由 host 回传的 window.days 提供（rangeDays 对它可以返回 0，
    // 调用方需用 Number(payload.window.days) 兜底，见 overviewBlock 的 winDays）。
    function rangeDays(k){ return RANGE_DAYS[k]||0; }
    // 分位数（P50/P90）：只用于"每步耗时"这类小样本（records 最多 50 条）
    function percentile(values, p){
      var arr=(values||[]).filter(function(v){ return typeof v==="number" && isFinite(v) && v>0; }).sort(function(a,b){ return a-b; });
      if(!arr.length) return null;
      var idx=Math.min(arr.length-1, Math.max(0, Math.ceil(arr.length*p)-1));
      return Math.round(arr[idx]);
    }
    // 日均环比：本期日均 vs 上期日均（绝对量比较在"上期覆盖不足"时会给出 +700% 的假信号）
    function avgDelta(curTotal, curDays, prevTotal, prevDays){
      var c=Number(curTotal)||0, p=Number(prevTotal)||0;
      var cd=Number(curDays)||0, pd=Number(prevDays)||0;
      if(!(cd>0) || !(pd>0) || !(p>0)) return null;
      var a=c/cd, b=p/pd;
      if(!(b>0)) return null;
      return (a-b)/b*100;
    }
    // 时长（ms）→ 人类可读：<1s 用 ms、<60s 用 s、其余用 m+s（"最近调用"用）
    function fmtDur(ms){
      var v=Number(ms)||0;
      if(v<=0) return "—";
      if(v<1000) return Math.round(v)+"ms";
      if(v<60000) return (v/1000).toFixed(v<10000?1:0)+"s";
      return Math.floor(v/60000)+"m"+Math.round((v%60000)/1000)+"s";
    }
    // 相对时间（"3 分钟前"）：用于"更新于"与"最后回填"。传入 nowMs 便于单测。
    function fmtAgo(ts, nowMs){
      var t=Number(ts)||0; if(!t) return "—";
      var d=(Number(nowMs)||Date.now())-t;
      if(d<0) d=0;
      if(d<60000) return Math.round(d/1000)+" 秒前";
      if(d<3600000) return Math.round(d/60000)+" 分钟前";
      if(d<86400000) return Math.round(d/3600000)+" 小时前";
      return Math.round(d/86400000)+" 天前";
    }
    // 复制到剪贴板：navigator.clipboard 在非安全上下文/无权限时会失败，退回 textarea+execCommand
    function copyText(text){
      try{
        if(navigator && navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).catch(function(){});
          return true;
        }
      }catch(e){}
      try{
        var ta=document.createElement("textarea");
        ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
        document.body.appendChild(ta); ta.select();
        var ok=document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      }catch(e){ return false; }
    }
    // 下载文本（导出 CSV 用）：Blob + a[download]，不依赖宿主提供保存对话框
    function downloadText(filename, text){
      try{
        var blob=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"});
        var url=URL.createObjectURL(blob);
        var a=document.createElement("a");
        a.href=url; a.download=filename;
        document.body.appendChild(a); a.click();
        setTimeout(function(){ try{ URL.revokeObjectURL(url); a.remove(); }catch(e){} }, 0);
        return true;
      }catch(e){ return false; }
    }
    // HTML 转义：热力图 tooltip 以 innerHTML 渲染，models[].model 来自会话事件
    // 的 source.model（外部可影响），必须转义——该页面可向壳 SPA postMessage
    // dsh:cmd，XSS 在此 origin 的后果会被桥放大
    function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(ch){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]; }); }
    function _pill(label,value,color){ if(value==null) return null; return jsx_runtime.jsx("span",{title:label+" "+String(value),style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,minWidth:0,overflow:"hidden",padding:"1px 4px",borderRadius:"999px",background:"var(--dsw-alias-bg-layer-1,#242433)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",fontSize:"10px",lineHeight:1.2,whiteSpace:"nowrap"},children:[jsx_runtime.jsx("span",{style:{flex:"none",color:"var(--dsw-alias-label-secondary,#a0a0b0)",fontWeight:500},children:label}),jsx_runtime.jsx("b",{style:{color:color,fontWeight:700,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"},children:String(value)})]}); }

    // ── "正在对话"判定 ─────────────────────────────────────────────────────
    // 旧判据是 tokPerSec>0，而 tokPerSec 的分母 llmMs 只在 step/end 累加：
    // 首条回复跑完之前它恒为 0，于是悬浮窗右上角的 Live 徽标要等十几秒才亮。
    // 现在按"有迹象"判定，任一成立即为活跃（三者都来自 host 下发的 live.*）：
    //   1) activeSteps > 0          —— 还有 step 没结束（回复正在跑），最快，step/start 就有了
    //   2) lastActiveAt 在窗口内     —— 近 ACTIVE_TTL_MS 内收到过任意实时事件
    //   3) rate60 > 0               —— 近 60s 有输出（兜底，旧 host 没有前两个字段）
    // freshness 只用于过滤"上一次打开就再没动过"的陈旧快照，窗口必须明显大于轮询周期，
    // 否则亮灭会跟着 15s 空闲轮询抖动（旧实现两者都是 15000，正好踩在这个边界上）。
    var ACTIVE_TTL_MS = 20000;      // "近期有活动"的时间窗
    var SNAPSHOT_TTL_MS = 45000;    // payload 本身的陈旧上限（> IDLE_MS，避免抖动）
    // 对话活动的 DOM 锚点：旧实现找 `[data-role="assistant"]` / `.assistant`，而 DSH 0.2.1
    // 的聊天行既没有 data-role（只有 data-role-icon/-kind）也没有裸 class="assistant"
    // （类是 CSS Modules 哈希，如 xeixwq_assistantContent）。实测两个选择器命中 0 次，
    // 于是 armFast() 从不触发，轮询永远停在空闲 15s —— 与"Live 要等十几秒"叠加。
    // 现在改用宿主真实标记（conversation.chat.node 的 flow 行）：
    //   data-chat-flow-key / data-chat-flow-kind（user | turn-process | steering | turn-trigger）
    // 另外保留旧的 assistant 选择器，兼容其它宿主/旧版。
    var ACTIVITY_SEL='[data-chat-flow-key],[data-chat-flow-kind],[data-slot="conversation.chat.node"],[data-role="assistant"],.assistant';
    // ── 缓存命中率圆环（SVG）──────────────────────────────────────────────
    // 旧实现是 28px 的 conic-gradient 圆环：环宽仅 4px、数字 8px、硬切端点、
    // 单一平色、无底槽——缩影里看着像"一个点框"，缺少仪表感。
    // 现在改成 SVG：
    //   · 尺寸 34px、环宽 6px（视觉重量明显提升）
    //   · stroke-linecap:round 让两端是圆头（精致感的主要来源）
    //   · 进度用线性渐变 #c65f7f → #ff8fab（与下方 .oq-tm-hbar-fill 同一套话术）
    //   · 底槽单独一层（rgba(255,255,255,0.10)），细环不再"漂浮"
    //   · 数字 11px + tabular-nums（等宽，百分比变化时不左右跳动）
    //
    // 满环处理：只有真正 100% 才画整圈。99% 必须留可见缺口，
    // 否则"几乎满分"与"满分"在视觉上无法区分（用户明确要求）。
    var RING_SIZE = 34;         // 直径
    // 环宽 6 → 4.2：34px 直径下 6px 环的内孔只剩 22px，环占面积近 40%，视觉上"太粗"。
    // 4.2 时内孔 25.6px，环占面积约 26%，与常见仪表环（material/antd 多为 12~15%）更接近，
    // 同时仍明显粗于旧版的 4px（那版的问题不是细，是直径只有 28px + 数字 8px）。
    var RING_STROKE = 4.2;
    // 缺口宽度独立于环宽：旧实现直接复用 stroke 当缺口，改细环会导致缺口一起变窄、
    // 99% 又和 100% 分不清。固定 5.5px（≈ 圆周的 6%），与环宽解耦。
    var RING_GAP = 5.5;
    function ringGeom(){
      var r = (RING_SIZE - RING_STROKE) / 2;      // 半径（stroke 居中在 r 上）
      return { r: r, c: 2 * Math.PI * r };
    }
    // pct: 0~100 或 null（无数据）；返回可直接放进 render 的元素。
    function ringEl(pct, opts){
      opts = opts || {};
      var size = opts.size || RING_SIZE;
      var sw = opts.stroke || RING_STROKE;
      var r = (size - sw) / 2;
      var c = 2 * Math.PI * r;
      var has = pct != null && isFinite(pct);
      var v = has ? Math.max(0, Math.min(100, Number(pct))) : 0;
      // round linecap 会在两端各多出 stroke/2 的长度；100% 时若直接用整圈，
      // 两个圆头会重叠成一个小鼓包，所以满环单独画（不加 dasharray）。
      var full = has && v >= 100;
      // 非满环：起止各留一点，保证"99% 有明显缺口"而不是差一点点就闭合。
      // 缺口按弧长换算（不是角度），这样不同半径下观感一致。
      // 缺口用独立常量 RING_GAP（不再复用 stroke）：环改细后若沿用 stroke，
      // 缺口会跟着变窄到看不出，99% 又跟 100% 混为一谈。
      var gapLen = full ? 0 : Math.min(RING_GAP, c * 0.5);
      var dash = full ? 0 : Math.max(0, (c * v / 100) - gapLen);
      var uid = "oqring" + (opts.id || Math.random().toString(36).slice(2, 8));
      return jsx_runtime.jsxs("svg", {
        className: "oq-tm-ring-svg",
        width: size, height: size,
        viewBox: "0 0 " + size + " " + size,
        role: "img",
        "aria-label": has ? ("缓存命中率 " + v + "%") : "缓存命中率无数据",
        style: { flex: "none", display: "block", overflow: "visible" },
        children: [
          jsx_runtime.jsxs("defs", { children: [
            jsx_runtime.jsxs("linearGradient", {
              id: uid, x1: "0", y1: "0", x2: "1", y2: "1",
              children: [
                jsx_runtime.jsx("stop", { offset: "0%", "stop-color": "#c65f7f" }),
                jsx_runtime.jsx("stop", { offset: "100%", "stop-color": "#ff8fab" }),
              ],
            }),
          ]}),
          // 底槽：整圈淡白，给细环一个"轨道"。比进度弧略细（0.8×），
          // 这样看起来是"环压着轨道走"，而不是两条同宽的线叠在一起显粗。
          jsx_runtime.jsx("circle", {
            cx: size / 2, cy: size / 2, r: r, fill: "none",
            stroke: "rgba(255,255,255,0.12)", "stroke-width": sw * 0.8,
          }),
          // 进度弧：满环画整圈，否则按 dasharray 画带缺口的弧
          has ? jsx_runtime.jsx("circle", {
            cx: size / 2, cy: size / 2, r: r, fill: "none",
            stroke: "url(#" + uid + ")",
            "stroke-width": sw,
            "stroke-linecap": "round",
            "stroke-dasharray": full ? (c + " " + c) : (dash + " " + (c - dash)),
            // 起点转到 12 点方向（SVG 默认 3 点方向）
            transform: "rotate(-90 " + (size / 2) + " " + (size / 2) + ")",
            // 外发光半径也要随环宽收：6px 环配 3px 光晕，4.2px 环配 2.2px 才不显糊
            style: { filter: "drop-shadow(0 0 2.2px rgba(198,95,127,0.40))" },
          }) : null,
        ],
      });
    }
    /**
     * 「Live 态属于哪条通道」——决定徽标的颜色与文案。
     *
     * | 返回 | 含义 | 颜色 | 文案 |
     * |---|---|---|---|
     * | `both`  | 直连与本机网关**同时**在跑 | 青绿→紫 双色渐变 | `Live`  |
     * | `direct`| 只有 DSH 本机会话在跑 | 绿 `#10b981` | `Live` |
     * | `gateway`| 只有网关在被外部客户端使用 | 紫 `#8b7bff` | `网关` |
     * | `null`  | 没在跑 | — | 不渲染 |
     *
     * 为什么是"颜色 + 文案"两个维度而不是只换颜色：绿/紫在**色弱**用户眼里很接近，
     * 而"网关"两个字在任何配色下都读得出来。单靠颜色编码状态是不合格的可用性。
     *
     * 判据与 LIVE_JUDGE 保持**同一套窗口**（ACTIVE_TTL_MS），否则会出现
     * "徽标亮着但说不清是哪条通道"的矛盾：直接从各通道的原始时刻分别判活，
     * 不用 LIVE_JUDGE 的汇总结果（它已经 or 在一起，信息丢了）。
     */
    function LIVE_CHANNEL(d3, live){
      try{
        if(!d3) return null;
        var now = Date.now();
        // 快照陈旧时两条腿都算灭（与 LIVE_JUDGE 的第一条守卫一致）
        var snapAt = Number(d3.updatedAt) || 0;
        var stale = snapAt && now - snapAt > SNAPSHOT_TTL_MS;
        if(stale) return null;
        var direct=false, gw=false;
        if(live){
          if(Number(live.activeSteps) > 0 || Number(live.activeTurns) > 0) direct = true;
          var la = Number(live.lastActiveAt) || 0;
          if(la && now - la <= ACTIVE_TTL_MS) direct = true;
          if(Number(live.rate60) > 0) direct = true;
          if(Number(live.tokPerSec) > 0 && la === 0) direct = true;
        }
        var g = d3.sources && d3.sources.gateway;
        var ga = Number(g && g.lastActiveAt) || 0;
        if(g && g.enabled !== false && ga && now - ga <= ACTIVE_TTL_MS) gw = true;
        if(direct && gw) return "both";
        if(gw) return "gateway";
        if(direct) return "direct";
        return null;
      }catch(e){ return null; }
    }
    // 三种态的视觉参数（颜色集中在这里，便于日后调；不要在渲染处散写十六进制）
    //
    // ⚠️ 三态的**文字统一为 `Live`**（用户要求）：Live 是一个"是否在活跃"的状态，
    // 换字会让它看起来像两种不同的东西（"网关"读起来像标签/入口，不像状态）。
    // 通道归属完全交给颜色 + tooltip：
    //   绿  = 只有 DSH 本机会话在跑
    //   橙  = 只有网关在被外部客户端使用（刻意避开紫色：紫色是网关的"量"用色，
    //         状态点再用紫会与角标撞色，扫一眼分不清哪个在 pulse）
    //   青→紫渐变 = 两条通道同时在热
    // 颜色之外还有 tooltip 与脉冲点，色弱用户悬停即可确认（不单靠颜色编码）。
    var LIVE_STYLE = {
      direct:  { color:"#10b981", dot:"#10b981", text:"Live" },
      gateway: { color:"#f59e0b", dot:"#f59e0b", text:"Live" },
      both:    { color:"#22d3ee", dot:"#22d3ee", text:"Live" },
    };
    // Live 徽标：三种通道态**共用同一套字形 `● Live`**，只换颜色。
    // 文字固定为 Live（见 LIVE_STYLE 的注释：换字会让状态看起来像两种东西）。
    function LIVE_BADGE(kind){
      if(!kind) return null;
      var st = LIVE_STYLE[kind] || LIVE_STYLE.direct;
      var isBoth = kind === "both";
      // tooltip 是颜色之外的**唯一**无障碍通道：色弱用户靠它区分三态
      var title = isBoth
        ? "Live · 直连与本机网关同时在处理请求（双色 = 两条通道都活跃）"
        : (kind === "gateway"
          ? "Live · 只有本机网关在被外部客户端使用（本机会话空闲）"
          : "Live · 只有 DSH 本机会话在生成回复");
      var wrap = {display:"inline-flex",alignItems:"center",gap:3,fontSize:"9px",fontWeight:600,whiteSpace:"nowrap",color:st.color};
      if(isBoth){
        // 渐变文字：不改 color（作为不支持 background-clip 时的回退色）
        wrap.backgroundImage = "linear-gradient(90deg,#22d3ee,#8b7bff)";
        wrap.WebkitBackgroundClip = "text";
        wrap.backgroundClip = "text";
        wrap.WebkitTextFillColor = "transparent";
      }
      return jsx_runtime.jsxs("span",{
        title:title,
        style:wrap,
        children:[
          jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",flex:"none",display:"inline-block",
            background:isBoth?"linear-gradient(135deg,#22d3ee,#8b7bff)":st.dot,
            animation:"oq-pulse 1.6s infinite"}}),
          st.text,
        ]});
    }
    function LIVE_JUDGE(d3, live){
      try{
        if(!live || !d3) return false;
        var now = Date.now();
        var snapAt = Number(d3.updatedAt) || 0;
        if(snapAt && now - snapAt > SNAPSHOT_TTL_MS) return false;   // 数据本身已陈旧
        if(Number(live.activeSteps) > 0) return true;                 // 回复正在跑（step 级）
        // 轮次级：**当前 DSH 上唯一可靠的"回复还没结束"信号**。
        // step/start 实测从不投递（2026-10-28 查库：16 次回复 / 18 条 step/end，
        // step/start 零条），所以 activeSteps 恒 0；只靠它在对话中永远不亮。
        if(Number(live.activeTurns) > 0) return true;
        var la = Number(live.lastActiveAt) || 0;
        if(la && now - la <= ACTIVE_TTL_MS) return true;               // 近期有事件
        if(Number(live.rate60) > 0) return true;                      // 近 60s 有输出
        // 网关侧活动：外部客户端经网关发请求时本机会话一个事件都没有，
        // 但对方的账本会被改写（宿主把文件 mtime 当作 lastActiveAt 下发）。
        // 窗口与本地一致（ACTIVE_TTL_MS）：网关请求之间通常只隔几秒，
        // 20s 足以让"持续在用网关"的时段 Live 保持常亮。
        var gsrc = d3.sources && d3.sources.gateway;
        var ga = Number(gsrc && gsrc.lastActiveAt) || 0;
        if(ga && gsrc.enabled !== false && now - ga <= ACTIVE_TTL_MS) return true;
        if(Number(live.tokPerSec) > 0 && la === 0) return true;        // 旧 host 兜底
        return false;
      }catch(e){ return false; }
    }
    function fmtMoney(n,cur){ if(n==null||isNaN(n)) return "—"; var v=Number(n); if(cur==="CNY") return "¥"+v.toFixed(2); if(cur==="USD") return "$"+v.toFixed(2); return v.toFixed(2); }
    function fmtDate(s){ if(!s) return null; try{var d=new Date(s); if(isNaN(d.getTime())) return s; return d.toLocaleDateString()+" "+d.toLocaleTimeString().slice(0,5);}catch(e){return s;}}
    function countdown(s){ if(!s) return null; var d=new Date(s); if(isNaN(d.getTime())) return null; var diff=d-Date.now(); if(diff<=0) return "已重置"; var days=Math.floor(diff/86400000); var hrs=Math.floor((diff%86400000)/3600000); var mins=Math.floor((diff%3600000)/60000); if(days>0) return days+"天"+hrs+"时后"; if(hrs>0) return mins>0 ? hrs+"时"+mins+"分后" : hrs+"时后"; return mins+"分后"; }

    // token 只走 header（x-api-key / authorization），不进 URL query——
    // query 会落入 webserver 访问日志；baseUrl 无敏感信息，仍走 query
    async function fetchOpencode(cfg){
      var p=cfg.providers.opencode; if(!p||!p.enabled) return {disabled:true};
      if(!p.token) return {ok:false,error:"未配置 token"};
      var qs=new URLSearchParams(); if(p.baseUrl) qs.set("baseUrl",p.baseUrl);
      var q=qs.toString();
      try{ var r=await fetch("/api/opencode/quota"+(q?"?"+q:""),{headers:{"x-api-key":p.token}}); var j=await r.json().catch(function(){return {ok:false,error:"bad json"};}); if(!r.ok||!j.ok){ var err=j.error||("HTTP "+r.status); return {ok:false,error:err,_raw:j}; } return j; }catch(e){ return {ok:false,error:String(e.message||e)}; }
    }
    async function fetchDeepSeek(cfg){
      var p=cfg.providers.deepseek; if(!p||!p.enabled) return {ok:false,error:"未配置 API Key"};
      if(!p.token) return {ok:false,error:"未配置 API Key"};
      var qs=new URLSearchParams(); if(p.baseUrl) qs.set("baseUrl",p.baseUrl);
      var q=qs.toString();
      try{ var r=await fetch("/api/deepseek/balance"+(q?"?"+q:""),{headers:{authorization:"Bearer "+p.token}}); var j=await r.json().catch(function(){return {ok:false,error:"bad json"};}); if(!r.ok||!j.ok) return {ok:false,error:j.error||("HTTP "+r.status),_raw:j}; return j; }catch(e){ return {ok:false,error:String(e.message||e)}; }
    }
    async function fetchR4Coder(cfg){
      var p=cfg.providers.r4coder; if(!p||!p.enabled) return {disabled:true};
      if(!p.token) return {ok:false,error:"未配置 API Key"};
      if(!p.baseUrl) return {ok:false,error:"未配置 Base URL（自定义 host，必填）"};
      var qs=new URLSearchParams(); qs.set("baseUrl",p.baseUrl);
      try{ var r=await fetch("/api/r4coder/meta?"+qs.toString(),{headers:{"x-api-key":p.token,"authorization":"Bearer "+p.token}}); var j=await r.json().catch(function(){return {ok:false,error:"bad json"};}); if(!r.ok||!j.ok){ var err=j.error||("HTTP "+r.status); return {ok:false,error:err,_raw:j}; } return j; }catch(e){ return {ok:false,error:String(e.message||e)}; }
    }
    // token-meter 拉取统一超时：host 侧首屏回填最多等 20s（READY_WAIT_MS），
    // 客户端超时必须留出余量，否则会把"携带完整口径"的那次响应掐掉，退回半截数据。
    var TM_FETCH_TIMEOUT_MS=30000;
    // 上一次 token-meter 拉取是否还在飞：轮询（空闲 15s / 活跃 5s）与手动刷新可能叠加，
    // 叠加时只跳过轮询，手动刷新用 force 放行。
    var tmPullInFlight=false;
    function tmFetchInit(extra){
      var init=extra||{};
      try{ if(typeof AbortSignal!=="undefined" && AbortSignal.timeout) init.signal=AbortSignal.timeout(TM_FETCH_TIMEOUT_MS); }catch(e){}
      return init;
    }
    async function fetchTokenMeter(range, opts){
      if(!range) range=loadRange();
      opts=opts||{};
      // 数据链路只有一条：dsh webserver 的 /api/token-meter（host 半端）。
      // withChart=1 时 host 端单请求附带 30d 热力图数据，无需二次拉取。
      try{
        var q="/api/token-meter?range="+encodeURIComponent(range);
        if(opts.withChart) q+="&withChart=1";
        // gw=0 ⇒ 宿主真的不读对方账本、不合并（关掉监测后文件必须不再被读，
        // 否则"关了隐私开关却仍在读"就是对用户的欺骗）。
        q+="&gw="+gwQueryParam();
        var r=await fetch(q,tmFetchInit({headers:{accept:"application/json"}})); var j=await r.json().catch(function(){return {ok:false};}); if(!r.ok||!j.ok) return {ok:false,error:j.error||("HTTP "+r.status)};
        return {ok:true, range:(j.range!=null? j.range : range), totals:j.totals, hourly:j.hourly, stats:j.stats, daily:j.daily, daily30:(j.daily30&&j.daily30.length)?j.daily30:null, models:j.models, records:j.records, live:j.live,
          // v4 维度和健康快照：悬浮窗暂时不用，但保持透传，避免"设置页有、解析层丢"
          tools:j.tools, projects:j.projects, providers:j.providers, sessions:j.sessions, hours:j.hours,
          prevDaily:j.prevDaily, reliability:j.reliability, health:j.health,
          // 分源拆解（本机 / 网关）：悬浮窗角标与总览"其中网关"用它
          sources:j.sources,
          todayStr:j.todayStr, updatedAt:j.updatedAt, version:j.version, store:j.store, raw:j};
      }catch(e){ return {ok:false,error:String(e.message||e)}; }
    }
    // 网关账本诊断（设置页「网关」tab 专用）。force=1 = 跳过节流重读。
    async function fetchGateway(opts){
      opts=opts||{};
      try{
        var q="/api/token-meter/gateway?gw="+gwQueryParam()+(opts.force?"&force=1":"");
        var r=await fetch(q,tmFetchInit({headers:{accept:"application/json"}}));
        var j=await r.json().catch(function(){return {ok:false,error:"bad json"};});
        if(!r.ok||!j||!j.ok) return {ok:false,error:(j&&j.error)||("HTTP "+r.status)};
        return j;
      }catch(e){ return {ok:false,error:String(e.message||e)}; }
    }

    function apply(ctx){
      var slots=ctx.get("slots");
      if(slots===undefined) return;
      ensureStyle();

      function QuotaWidget(){
        var cfgRef=react.useRef(loadConfig());
        var carIdx=react.useState(loadCarIdx());
        var menuPos=react.useState(null);
        var widgetOn=react.useState(loadWidgetEnabled());
        // 面板材质：只影响外壳观感（见 loadPanelMaterial），与额度配置无关
        var material=react.useState(loadPanelMaterial());
        var opData=react.useState(null);
        var dsData=react.useState(null);
        var r4Data=react.useState(null);
        var tmData=react.useState(null);
        var loading=react.useState(true);
        var tick=react.useState(0);
        var range=react.useState(loadRange());
        var rangeRef=react.useRef(loadRange());
        // intervalSec 入 state：变更时重建固定周期刷新（见下方专用 effect）
        var intervalSecState=react.useState(loadConfig().intervalSec||120);
        var chartTm=react.useState(null);
        var cardRef=react.useRef(null);
        var dragging=react.useRef(null);
        var touchStartX=react.useRef(null);
        // 贴边收起：edgeOn=功能开关（设置→外观），edgeState=当前收起在哪一侧（null=展开）。
        // edgeOpen=本次是否因悬停临时展开；edgeLocked=点击锁定展开（触屏必需）。
        var edgeOn=react.useState(loadEdgeCollapse());
        var edgeState=react.useState(loadEdgeCollapse()?loadEdgeState():null);
        var edgeOpen=react.useState(false);
        var edgeLocked=react.useState(false);
        var edgeHoverTimer=react.useRef(null);
        // 最近一次"吸入"的时刻：用于抑制紧随其后的 mouseenter 把卡片弹回展开态
        var edgeCollapseAtRef=react.useRef(0);
        // 吸入瞬间的一次性脉动：true 时给 handle 挂 oq-edge-snap，700ms 后自动摘掉。
        // 用 state 而不是直接改 DOM class（React 会重渲染并覆盖手写的 className）。
        var edgeSnap=react.useState(false);
        var edgeSnapTimer=react.useRef(null);
        // 拖拽中的"继续往边缘拽"判定：记录本次拖拽是否已触发吸入，避免一次拖拽重复触发
        var edgePullRef=react.useRef(false);
        // 拖拽 effect 的依赖是 [hidden]，闭包里读 state 会读到首帧的旧值。
        // 所有"拖拽/悬停回调里需要读的 edge 状态"都必须走 ref（每次渲染同步）。
        var edgeOnRef=react.useRef(edgeOn[0]);
        var edgeStateRef=react.useRef(edgeState[0]);
        edgeOnRef.current=edgeOn[0];
        edgeStateRef.current=edgeState[0];
        // 收起 / 展开的唯一入口：同时写 ref + state，避免两者短暂不一致导致动画期间读到旧值。
        // 收起前先把卡片摆到对应边缘（吸附位），这样 translateX 出去后把手正好贴边；
        // 否则用户可能停在"离边缘 30px"的位置就被吸入，展开时会在半空中。
        function collapseToEdge(side){
          var s=(side==="left"||side==="right")?{edge:side}:null;
          if(!s) return;
          var el=cardRef.current;
          if(el){
            var bottom=parseFloat(el.style.bottom);
            if(isNaN(bottom)) bottom=Math.max(EDGE_GAP, window.innerHeight - el.getBoundingClientRect().bottom);
            bottom=Math.max(EDGE_GAP, Math.min(window.innerHeight - el.offsetHeight - EDGE_GAP, bottom));
            var left = side==="left"
              ? EDGE_GAP
              : Math.max(EDGE_GAP, window.innerWidth - el.offsetWidth - EDGE_GAP);
            // ⚠️ left/bottom **不加过渡**，瞬间写到位。
            // 动画只交给 CSS 的 transform：两套同时过渡会各自计时、缓动不同，
            // 视觉上是"先抖一下再滑出去"（用户实测反馈"动画设计很差"的直接原因）。
            // 贴边位移通常只有几个像素（用户已经停在边缘附近），瞬间到位不可感知。
            el.style.left=left+"px"; el.style.bottom=bottom+"px";
            el.style.right="auto"; el.style.top="auto";
            savePos({left:left, bottom:bottom});
          }
          edgeCollapseAtRef.current=Date.now();
          edgeStateRef.current=s; edgeState[1](s);
          edgeOpen[1](false); edgeLocked[1](false);
          saveEdgeState(s);
          // 一次性吸附脉动：先清再置，确保"连续两次吸入"也能重新播放
          //（animation 在同名类一直存在时不会重跑，必须真的摘掉再加回）。
          if(edgeSnapTimer.current){ clearTimeout(edgeSnapTimer.current); edgeSnapTimer.current=null; }
          edgeSnap[1](false);
          edgeSnapTimer.current=setTimeout(function(){
            edgeSnap[1](true);
            edgeSnapTimer.current=setTimeout(function(){
              edgeSnapTimer.current=null;
              edgeSnap[1](false);
            }, 700);
          }, 20);
        }
        function revealEdge(){
          if(!edgeStateRef.current && !edgeOpen[0] && !edgeLocked[0]) return;
          edgeStateRef.current=null; edgeState[1](null);
          edgeOpen[1](false); edgeLocked[1](false);
          saveEdgeState(null);
        }
        var hitBarRef=react.useRef(null);
        var opBucketsRef=react.useRef(null);
        // 已应用的 payload 版本/区间：用于跳过"数据没变"的整树重渲染。
        // 不能用 payload.updatedAt —— host 每次响应都现取 Date.now()，永远在变。
        var tmAppliedVersionRef=react.useRef(null);
        var tmAppliedRangeRef=react.useRef(null);
        // 网关开关也是"数据内容"的一部分，必须进缓存判据：
        // 切开关**不会**改变 host 的 usage.version（网关数据不参与事件级自增），
        // 只比 version+range 就会出现"点了开关界面毫无反应，直到下一次有对话"。
        var tmAppliedGwRef=react.useRef(null);
        var prevOpPctsRef=react.useRef({});
        // host 侧活跃信号（payload 的 live.activeSteps / live.lastActiveAt）驱动快拍的截止时刻。
        // 用 ref 而不是 effect 内局部变量：pullMeter 在组件作用域，轮询定时器在 effect 内，
        // 两边必须共享同一个值。DOM 锚点会随宿主改版失效，这条链路是插件自有契约，更可靠。
        var hostActiveUntilRef=react.useRef(0);
        function noteHostActivity(j){
          try{
            var lv=j && j.live;
            if(!lv) return;
            var now=Date.now();
            var la=Number(lv.lastActiveAt)||0;
            if(Number(lv.activeSteps)>0 || (la && now-la<=20000)) hostActiveUntilRef.current=now+12000;
          }catch(e){}
        }

        function pullMeter(r, withChart, done, force){
          // 上一次还在飞就跳过本次轮询（手动刷新/切区间传 force=true 放行），
          // 否则 host 首屏回填的那 20s 等待窗口里会叠出多个请求。
          if(tmPullInFlight && !force){ if(done) done(); return; }
          tmPullInFlight=true;
          var settle=function(){ tmPullInFlight=false; if(done) done(); };
          fetchTokenMeter(r, {withChart:!!withChart}).then(function(j){
            if(j&&j.ok){
              // 先喂活跃信号：host 报"有 step 在跑/刚有事件"就进快拍，不等 DOM 锚点
              noteHostActivity(j);
              if(withChart){
                if(j.daily30){
                  // 单次 invoke 同时取当前 range + 30d 热力图数据
                  var chartPay={ok:true, range:"30d", todayStr:j.todayStr||null, stats:{daily:j.daily30}, via:"host"};
                  if(isHeatHovering){ pendingChartTm={data:chartPay,_setter:chartTm[1]}; } else chartTm[1](chartPay);
                } else if(j.range==="30d"){
                  if(isHeatHovering){ pendingChartTm={data:j,_setter:chartTm[1]}; } else chartTm[1](j);
                } else {
                  // 兜底（如走 Node 路径）：单独取 30d
                  fetchTokenMeter("30d").then(function(c){
                    if(c&&c.ok){ if(isHeatHovering){ pendingChartTm={data:c,_setter:chartTm[1]}; } else chartTm[1](c); }
                  }).catch(function(){});
                }
              }
              if(j.range===rangeRef.current){
                // version（host 的 usage.version，事件级自增）没变且区间没变 → 数据无变化，
                // 跳过 setState：流式期间 5s 一次的轮询不再把热力图/柱状图/donut 整棵树重渲染。
                // 旧 host 不带 version 时（undefined !== null）恒为"有变化"，行为与改前一致。
                var jGw=gatewayEnabled();
                var tmChanged = tmAppliedVersionRef.current!==j.version || tmAppliedRangeRef.current!==j.range || tmAppliedGwRef.current!==jGw;
                if(isHeatHovering){ pendingTmData={data:j,_setter:tmData[1]}; }
                else if(tmChanged){
                  tmAppliedVersionRef.current=j.version; tmAppliedRangeRef.current=j.range; tmAppliedGwRef.current=jGw;
                  tmData[1](j);
                }
              }
            }
            settle();
          }).catch(function(){ settle(); });
        }
        function reload(silent, force){
          if(!silent) loading[1](true);
          var cfg=cfgRef.current;
          var rNow=rangeRef.current||loadRange();
          // tm 数据与外部 quota API 解耦：互不阻塞，瓦片区不再等外网 8s 超时
          var pend=2;
          var fin=function(){ if(--pend===0) loading[1](false); };
          Promise.all([fetchOpencode(cfg),fetchDeepSeek(cfg),fetchR4Coder(cfg)]).then(function(vals){
            if(vals[0]!==undefined) opData[1](vals[0]);
            if(vals[1]!==undefined) dsData[1](vals[1]);
            if(vals[2]!==undefined) r4Data[1](vals[2]);
          }).catch(function(){}).then(fin);
          pullMeter(rNow, true, fin, !!force);
        }

        react.useEffect(function(){
          reload(false, true);   // 首屏：不等轮询节奏，直接拉一次
          // 自适应轮询：空闲 15s；检测到对话活动后 12s 窗口内改 5s 快拍（方案B守卫已防串数据）。
          // 快拍 3s→5s（卡死分析 P1）：流式期间 MutationObserver 高频触发会把快拍
          // 压成准连续全量 chart invoke，热力图重渲染叠加渲染进程负载（偶发卡死根因 A）
          var FAST_MS=5000, IDLE_MS=15000, ACTIVE_WIN=12000;
          var pollTimer=null, activeUntil=0;
          function armFast(){ activeUntil=Date.now()+ACTIVE_WIN; }
          function pollTick(){
            try{ pullMeter(loadRange(), true); }catch(e){}
            var now=Date.now();
            schedulePoll((now<activeUntil || now<hostActiveUntilRef.current) ? FAST_MS : IDLE_MS);
          }
          function schedulePoll(d){ if(pollTimer) clearTimeout(pollTimer); pollTimer=setTimeout(pollTick, d); }
          schedulePoll(IDLE_MS);
          var onVis=function(){ if(document.visibilityState==="visible"){ armFast(); pullMeter(loadRange(), true); } };
          document.addEventListener("visibilitychange", onVis);
          var onFocus=function(){ armFast(); pullMeter(loadRange(), true); };
          window.addEventListener("focus", onFocus);
          window.addEventListener("online", onFocus);
          var onTokenRefresh=function(){ armFast(); pullMeter(loadRange(), true); };
          window.addEventListener("opencode:token-meter-refresh", onTokenRefresh);
          var bc=null; try{ if(typeof BroadcastChannel!=='undefined'){ bc=new BroadcastChannel('opencode:token-meter'); bc.onmessage=function(){ onTokenRefresh(); }; } }catch(e){}
          var mo=null; var moTimer=null;
          try{
            var target=document.body;
            if(target && typeof MutationObserver!=='undefined'){
              mo=new MutationObserver(function(muts){
                var hit=false;
                for(var i=0;i<muts.length;i++){
                  var m=muts[i];
                  var added=m.addedNodes;
                  if(added && added.length){
                    for(var k=0;k<added.length;k++){
                      var n=added[k]; if(!n || n.nodeType!==1) continue;
                      try{
                        if(n.matches && n.matches(ACTIVITY_SEL)){ hit=true; break; }
                        if(n.querySelector && n.querySelector(ACTIVITY_SEL)){ hit=true; break; }
                      }catch(e){}
                    }
                  }
                  if(hit) break;
                }
                // 5000→800ms：用户按下发送后的第一帧就要快拍一次，否则只能等 15s 定时器。
                // 防抖仍然保留（流式期间 DOM 高频变动，不能每次都发全量请求）。
                if(hit){ armFast(); if(moTimer) clearTimeout(moTimer); moTimer=setTimeout(function(){ onTokenRefresh(); }, 800); }
              });
              // 不观察 characterData：悬浮窗自己的重渲染也改文本，会把自己判成"对话活动"
              // 而形成自激（每 800ms 一次全量请求）。只看"新行插入"这一个信号。
              mo.observe(target, {childList:true, subtree:true});
            }
          }catch(e){}
          var onStorage=function(e){ if(e.key===LS_KEY){ cfgRef.current=loadConfig(); intervalSecState[1](cfgRef.current.intervalSec||120); reload(true, true);} if(e.key===LS_WIDGET){ widgetOn[1](loadWidgetEnabled()); } if(e.key===LS_PANEL_MATERIAL){ material[1](loadPanelMaterial()); } if(e.key===LS_TM_CHART){ tick[1](function(v){return v+1;}); } };
          window.addEventListener("storage",onStorage);
          var onCfg=function(){ cfgRef.current=loadConfig(); intervalSecState[1](cfgRef.current.intervalSec||120); reload(true, true); };
          window.addEventListener("opencode:config-changed",onCfg);
          var onWidgetToggle=function(){ widgetOn[1](loadWidgetEnabled()); };
          window.addEventListener("opencode:widget-toggled", onWidgetToggle);
          var onTmLayout=function(){ tick[1](function(v){return v+1;}); };
          window.addEventListener("opencode:tm-layout-changed", onTmLayout);
          var onR4Layout=function(){ tick[1](function(v){return v+1;}); };
          window.addEventListener("opencode:r4-layout-changed", onR4Layout);
          // 设置页切换"小窗口图表"（柱状/热力图）后，悬浮窗即时重渲染
          var onTmChart=function(){ tick[1](function(v){return v+1;}); };
          window.addEventListener("opencode:tm-chart-changed", onTmChart);
          // 设置页切换材质后即时生效（同一 window 事件；跨标签页靠 storage 兜底）
          var onMaterial=function(){ material[1](loadPanelMaterial()); };
          window.addEventListener("opencode:material-changed", onMaterial);
          // 区间偏好与设置页共用（LS_RANGE）：设置页改成 30 天，悬浮窗也要跟着切，
          // 否则同一份数据在两个界面上是两个时间段。仅在值真的变了时才重载，避免自触发循环。
          var onRange=function(){ var r=loadRange(); if(r!==rangeRef.current){ rangeRef.current=r; range[1](r); reload(true,true); } };
          window.addEventListener("opencode:range-changed", onRange);
          // 贴边收起：开关变更 / 强制恢复 / 位置重置 三条事件
          var onEdgeCollapse=function(){
            var on=loadEdgeCollapse();
            edgeOn[1](on);
            if(!on){ edgeStateRef.current=null; edgeState[1](null); edgeOpen[1](false); edgeLocked[1](false); saveEdgeState(null); }
            else { var s=loadEdgeState(); edgeStateRef.current=s; edgeState[1](s); }
          };
          window.addEventListener("opencode:edge-collapse-changed", onEdgeCollapse);
          var onEdgeReveal=function(){ revealEdge(); };
          window.addEventListener("opencode:edge-reveal", onEdgeReveal);
          var onPosResetEdge=function(){ edgeStateRef.current=null; edgeState[1](null); edgeOpen[1](false); edgeLocked[1](false); saveEdgeState(null); };
          window.addEventListener("opencode:pos-reset", onPosResetEdge);
          var t2=setInterval(function(){tick[1](function(v){return v+1;});},60000);
          return function(){
            if(pollTimer) clearTimeout(pollTimer);clearInterval(t2);
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus);
            window.removeEventListener("opencode:token-meter-refresh", onTokenRefresh);
            try{ if(bc) bc.close(); }catch(e){}
            try{ if(mo) mo.disconnect(); }catch(e){}
            if(moTimer) clearTimeout(moTimer);
            window.removeEventListener("storage",onStorage);window.removeEventListener("opencode:config-changed",onCfg);window.removeEventListener("opencode:widget-toggled", onWidgetToggle);
            window.removeEventListener("opencode:tm-layout-changed", onTmLayout);
            window.removeEventListener("opencode:r4-layout-changed", onR4Layout);
            window.removeEventListener("opencode:tm-chart-changed", onTmChart);
            window.removeEventListener("opencode:material-changed", onMaterial);
            window.removeEventListener("opencode:edge-collapse-changed", onEdgeCollapse);
            window.removeEventListener("opencode:edge-reveal", onEdgeReveal);
            window.removeEventListener("opencode:pos-reset", onPosResetEdge);
            if(edgeHoverTimer.current){ clearTimeout(edgeHoverTimer.current); edgeHoverTimer.current=null; }
            if(edgeSnapTimer.current){ clearTimeout(edgeSnapTimer.current); edgeSnapTimer.current=null; }
            window.removeEventListener("opencode:range-changed", onRange);
          };
        },[]);

        // 固定周期全量刷新：intervalSec 变更时重建 interval（旧实现挂在 deps=[]
        // 的主 effect 里，改周期要到组件重挂载才生效）
        react.useEffect(function(){
          var intv=setInterval(function(){ cfgRef.current=loadConfig(); reload(true); tick[1](function(v){return v+1;}); }, (intervalSecState[0]||120)*1000);
          return function(){ clearInterval(intv); };
        },[intervalSecState[0]]);

        react.useEffect(function(){
          var d=tmData[0];
          if(!d) return;
          var stats=d.stats||null;
          var hit=null;
          if(stats && stats.totals){
            var prompt=Number(stats.totals.prompt||0);
            var cr=Number(stats.totals.cache_read||0);
            hit=prompt>0? Math.round(cr/prompt*100):null;
          }
          if(hit==null) return;
          ensureGSAP(function(gsap){
            var el=hitBarRef.current;
            if(!el) return;
            try{
              if(gsap){
                gsap.fromTo(el, {width:"0%"}, {width:hit+"%", duration:1.0, ease:"power3.out", overwrite:"auto"});
                gsap.fromTo(el, {opacity:0.7}, {opacity:1, duration:0.6, ease:"power2.out", delay:0.2});
              } else {
                el.style.width=hit+"%";
                el.style.transition="width 0.6s cubic-bezier(0.22,1,0.36,1)";
              }
            }catch(e){ el.style.width=hit+"%"; }
          });
        },[tmData[0]]);

        react.useEffect(function(){
          var d=opData[0];
          if(!d || !d.buckets) return;
          ensureGSAP(function(gsap){
            if(!gsap) return;
            try{
              var root=opBucketsRef.current;
              var bars=root ? root.querySelectorAll(".oq-op-fill") : document.querySelectorAll(".oq-op-fill");
              if(!bars.length) return;
              // 方案A：增量补间 prev→next，避免每次 0→pct 闪回
              var ordered=[];
              if(d.buckets.rolling && d.buckets.rolling.percent!=null) ordered.push({key:"rolling", pct:Number(d.buckets.rolling.percent)});
              else if(d.buckets.rolling) ordered.push({key:"rolling", pct:0});
              if(d.buckets.weekly && d.buckets.weekly.percent!=null) ordered.push({key:"weekly", pct:Number(d.buckets.weekly.percent)});
              else if(d.buckets.weekly) ordered.push({key:"weekly", pct:0});
              if(d.buckets.monthly && d.buckets.monthly.percent!=null) ordered.push({key:"monthly", pct:Number(d.buckets.monthly.percent)});
              else if(d.buckets.monthly) ordered.push({key:"monthly", pct:0});
              // 方案A：按条独立处理，首现用 scaleX 入场，已有则增量 width 补间
              for(var j=0;j<bars.length && j<ordered.length;j++){
                var o=ordered[j];
                var bar=bars[j];
                var prev=prevOpPctsRef.current[o.key];
                var next=o.pct;
                if(prev==null){
                  // 首帧入场：保留错落，scaleX 0→1（width 已是 next%）
                  gsap.set(bar,{scaleX:1, transformOrigin:"left center", width:next+"%"});
                  gsap.fromTo(bar, {scaleX:0, transformOrigin:"left center"}, {scaleX:1, duration:0.8, delay:j*0.07, ease:"power3.out", overwrite:"auto"});
                  prevOpPctsRef.current[o.key]=next;
                  continue;
                }
                if(prev===next) continue;
                var delta=Math.abs(next-prev);
                if(delta<0.3){ // <0.3% 视为噪音，直接落位无动画
                  gsap.set(bar,{scaleX:1, width:next+"%"});
                  prevOpPctsRef.current[o.key]=next;
                  continue;
                }
                var dur=Math.max(0.35, Math.min(0.95, 0.35+delta*0.045));
                gsap.killTweensOf(bar);
                gsap.set(bar,{scaleX:1, transformOrigin:"left center"});
                // React 已把 width 设为 next%，先回拨到 prev 再补到 next
                gsap.fromTo(bar, {width:prev+"%"}, {width:next+"%", duration:dur, ease:"power3.out", overwrite:"auto"});
                if(next>prev){
                  try{
                    var shimmer=document.createElement("div");
                    shimmer.style.cssText="position:absolute;inset:0;width:38%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.32),transparent);transform:translateX(-120%)";
                    bar.style.position="relative"; bar.style.overflow="hidden";
                    bar.appendChild(shimmer);
                    gsap.fromTo(shimmer,{xPercent:-120},{xPercent:320,duration:0.55,ease:"power2.inOut",onComplete:function(){ try{shimmer.remove();}catch(e){}}});
                  }catch(e){}
                }
                prevOpPctsRef.current[o.key]=next;
              }
            }catch(e){}
          });
        },[opData[0]]);

        react.useEffect(function(){
          // 宽度已固定（CSS 260px，见 .oq-overlay），本 effect 只负责：
          // 视口尺寸变化时把悬浮窗位置钳回可视区（不再改写宽度）。
          var overlay=null;
          try{ overlay = cardRef.current ? cardRef.current.closest(".oq-overlay") : null; }catch(e){ overlay=null; }
          if(!overlay) overlay = document.querySelector(".oq-overlay");
          function clampPos(){
            var card=cardRef.current; if(!card) return;
            if(dragging.current) return;
            var w = overlay ? overlay.offsetWidth : card.offsetWidth;
            var curLeft = parseFloat(card.style.left); if(isNaN(curLeft)) curLeft = parseFloat(overlay.style.left);
            var curBottom = parseFloat(card.style.bottom); if(isNaN(curBottom)) curBottom = parseFloat(overlay.style.bottom);
            if(isNaN(curLeft) && isNaN(curBottom)) return;
            var nl = isNaN(curLeft) ? curLeft : Math.max(EDGE_GAP, Math.min(window.innerWidth - w - EDGE_GAP, curLeft));
            var nb = isNaN(curBottom) ? curBottom : Math.max(EDGE_GAP, Math.min(window.innerHeight - card.offsetHeight - EDGE_GAP, curBottom));
            if(nl !== curLeft){ card.style.left = nl+"px"; if(overlay) overlay.style.left = nl+"px"; }
            if(nb !== curBottom){ card.style.bottom = nb+"px"; if(overlay) overlay.style.bottom = nb+"px"; }
          }
          clampPos();
          window.addEventListener("resize", clampPos);
          return function(){ window.removeEventListener("resize", clampPos); };
        },[hidden]);

        react.useEffect(function(){
          var el=cardRef.current; if(!el) return;
          function onDown(e){
            if(e.button!=null && e.button!==0) return;
            try{ e.preventDefault(); }catch(err){}
            var prevUserSelect="", prevWebkitUserSelect="";
            try{ prevUserSelect=document.body.style.userSelect; prevWebkitUserSelect=document.body.style.webkitUserSelect; document.body.style.userSelect="none"; document.body.style.webkitUserSelect="none"; }catch(err){}
            var selClear=function(){ try{ var sel=window.getSelection&&window.getSelection(); if(sel&&sel.removeAllRanges) sel.removeAllRanges(); }catch(err){} };
            selClear();
            var onSelectStart=function(se){ try{ se.preventDefault(); }catch(err){} };
            try{ document.addEventListener("selectstart", onSelectStart); }catch(err){}
            var startX=e.clientX,startY=e.clientY;
            var rect=el.getBoundingClientRect();
            // 收起态被拖拽 = 隐式"拉出来"：先展开再按正常拖拽计算基准，否则
            // getBoundingClientRect 拿到的是被 translateX 推出视口后的位置，拖起来会跳。
            var wasCollapsed = !!edgeStateRef.current;
            if(wasCollapsed){ revealEdge(); }
            edgePullRef.current=false;
            var rect2 = wasCollapsed ? el.getBoundingClientRect() : rect;
            var sl=rect2.left, sb=window.innerHeight-rect2.bottom;
            dragging.current={startX:startX,startY:startY,sl:sl,sb:sb, prevUserSelect:prevUserSelect, prevWebkitUserSelect:prevWebkitUserSelect, onSelectStart:onSelectStart, wasCollapsed:wasCollapsed};
            function onMove(me){
              if(!dragging.current) return;
              selClear();
              var dx=me.clientX-dragging.current.startX, dy=me.clientY-dragging.current.startY;
              var nl=dragging.current.sl + dx, nb=dragging.current.sb - dy;
              nl=Math.max(EDGE_GAP,Math.min(window.innerWidth-el.offsetWidth-EDGE_GAP,nl));
              nb=Math.max(EDGE_GAP,Math.min(window.innerHeight-el.offsetHeight-EDGE_GAP,nb));
              el.style.left=nl+"px"; el.style.bottom=nb+"px"; el.style.right="auto"; el.style.top="auto";
              // ── "再往边缘拽一下"即吸入 ──
              // 条件：功能开启 + 当前自由位置已经贴在左/右边缘（吸附态）+ 本次拖拽还没吸入过。
              // 用户语义是"按钮按下去咔哒一下"，所以只在已经贴边时才算，避免正常拖动路过边缘就误吸。
              if(edgeOnRef.current && !edgePullRef.current && !dragging.current.wasCollapsed && !dragging.current.edgeDone){
                var vd = edgePullVerdict(
                  { armEdge: dragging.current.armEdge, armAt: dragging.current.armAt },
                  { left: nl, width: el.offsetWidth, viewport: window.innerWidth, gap: EDGE_GAP, x: me.clientX, trigger: EDGE_PULL_TRIGGER }
                );
                dragging.current.armEdge = vd.armEdge;
                dragging.current.armAt = vd.armAt;
                if(vd.collapse){
                  edgePullRef.current=true;
                  dragging.current.edgeDone=true;
                  collapseToEdge(vd.armEdge);
                  // 只停掉 mousemove：mouseup 必须留着，否则 onUp 不会跑，
                  // dragging.current 永不清理（clampPos 会永久跳过、拖拽态残留）。
                  try{ window.removeEventListener("mousemove",onMove); }catch(err){}
                  try{ document.removeEventListener("selectstart", onSelectStart); }catch(err){}
                  try{ document.body.style.userSelect=prevUserSelect; document.body.style.webkitUserSelect=prevWebkitUserSelect; }catch(err){}
                }
              }
            }
            function onUp(e){
              if(e && e.button!=null && e.button!==0) return;
              if(!dragging.current) return;
              var edgeDone = !!dragging.current.edgeDone;
              window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp);
              try{ document.removeEventListener("selectstart", dragging.current.onSelectStart); }catch(err){}
              try{ document.body.style.userSelect=dragging.current.prevUserSelect; document.body.style.webkitUserSelect=dragging.current.prevWebkitUserSelect; }catch(err){}
              selClear();
              // 拖拽中已吸入边缘：位置与收起态都已写好，这里只收尾，不再做吸附计算。
              if(edgeDone){ dragging.current=null; return; }
              var rect=el.getBoundingClientRect();
              var centerX=rect.left + el.offsetWidth/2;
              var vpCenter=window.innerWidth/2;
              // 贴左/贴右都按 EDGE_GAP 吸附到窗口边缘。旧实现在左侧会改去对齐 DSH 侧栏
              // 会话列表（.qDHVXG_list）的左边缘——侧栏自身有 12px 内边距，于是贴边后
              // 离窗口边缘看着有 12px，比拖动时的 6px 硬边界还大。若想恢复"与列表左对齐"
              // 的观感，把左侧目标改成 Math.round(list.getBoundingClientRect().left) 即可。
              var targetLeft = (centerX < vpCenter)
                ? EDGE_GAP
                : window.innerWidth - el.offsetWidth - EDGE_GAP;
              targetLeft=Math.max(EDGE_GAP, Math.min(window.innerWidth - el.offsetWidth - EDGE_GAP, targetLeft));
              var targetBottom=parseFloat(el.style.bottom);
              if(isNaN(targetBottom)) targetBottom=window.innerHeight - rect.bottom;
              targetBottom=Math.max(EDGE_GAP, Math.min(window.innerHeight - el.offsetHeight - EDGE_GAP, targetBottom));
              var prevTransition=el.style.transition;
              el.style.transition="left 0.22s cubic-bezier(0.22,1,0.36,1), bottom 0.22s cubic-bezier(0.22,1,0.36,1)";
              el.style.left=targetLeft+"px";
              el.style.bottom=targetBottom+"px";
              el.style.right="auto"; el.style.top="auto";
              savePos({left:targetLeft,bottom:targetBottom});
              var cleaned=false;
              function cleanup(){ if(cleaned) return; cleaned=true; el.removeEventListener("transitionend", onTransEnd); if(!prevTransition) el.style.transition=""; else el.style.transition=prevTransition; dragging.current=null; }
              function onTransEnd(e){ if(e && e.propertyName && e.propertyName!=="left" && e.propertyName!=="bottom") return; clearTimeout(tid); cleanup(); }
              el.addEventListener("transitionend", onTransEnd);
              var tid=setTimeout(cleanup, 260);
            }
            window.addEventListener("mousemove",onMove); window.addEventListener("mouseup",onUp);
          }
          el.removeEventListener("mousedown",onDown);
          el.addEventListener("mousedown",onDown);
          return function(){el.removeEventListener("mousedown",onDown);};
        },[hidden]);
        react.useEffect(function(){
          if(!menuPos[0]) return;
          function onDocClick(e){
            if(e.button===2) return;
            var m=document.querySelector(".oq-menu");
            if(m && !m.contains(e.target) && cardRef.current && !cardRef.current.contains(e.target)) menuPos[1](null);
            else if(m && !m.contains(e.target) && !cardRef.current) menuPos[1](null);
          }
          function onEsc(e){ if(e.key==="Escape") menuPos[1](null); }
          function onScroll(e){
            try{
              var t=e && e.target;
              if(!t){ menuPos[1](null); return; }
              if(t===document || t===window || t===document.documentElement || t===document.body){ menuPos[1](null); return; }
              if(t.closest && t.closest(".oq-overlay, .oq-menu, .oq-heat-tip")){ menuPos[1](null); return; }
              // 聊天区/列表内部滚动（流式输出高频触发）不关闭菜单，避免会话进行中右键菜单秒关
            }catch(_){}
          }
          var raf=requestAnimationFrame(function(){ document.addEventListener("mousedown", onDocClick, true); document.addEventListener("contextmenu", onDocClick, true); document.addEventListener("keydown", onEsc); window.addEventListener("scroll", onScroll, true); document.addEventListener("scroll", onScroll, true); });
          return function(){ cancelAnimationFrame(raf); document.removeEventListener("mousedown", onDocClick, true); document.removeEventListener("contextmenu", onDocClick, true); document.removeEventListener("keydown", onEsc); window.removeEventListener("scroll", onScroll, true); document.removeEventListener("scroll", onScroll, true); };
        },[menuPos[0]]);

        // 液态玻璃的镜面高光跟随指针。只写两个 CSS 变量（不改布局、不触发 React 重渲染），
        // 由 .m-liquid::before 的 radial-gradient 消费；rAF 合帧，避免 pointermove 高频写样式。
        react.useEffect(function(){
          var el=cardRef.current; if(!el) return;
          if(material[0]!=="liquid") return;
          var raf=0, px=0, py=0;
          function flush(){
            raf=0;
            el.style.setProperty("--oq-mx", px.toFixed(1)+"%");
            el.style.setProperty("--oq-my", py.toFixed(1)+"%");
          }
          function onMove(e){
            var r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
            px=(e.clientX-r.left)/r.width*100;
            py=(e.clientY-r.top)/r.height*100;
            if(!raf) raf=requestAnimationFrame(flush);
          }
          function onLeave(){ if(raf){ cancelAnimationFrame(raf); raf=0; } el.style.setProperty("--oq-mx","18%"); el.style.setProperty("--oq-my","0%"); }
          el.addEventListener("pointermove", onMove, {passive:true});
          el.addEventListener("pointerleave", onLeave);
          return function(){
            if(raf) cancelAnimationFrame(raf);
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerleave", onLeave);
          };
        },[material[0]]);

        react.useEffect(function(){
          var el=cardRef.current; if(!el) return;
          function applyPos(){
            var p=loadPos();
            // 收起态的位置必须由停靠侧推导：卡片是 translateX 出去的，left/bottom 仍要
            // 落在对应边缘（左停靠 → left:EDGE_GAP；右停靠 → 右边缘），否则展开时会
            // 从错误的一侧滑出来。存的是用户拖动时的 lastLeft，这里按停靠侧纠正。
            var st=loadEdgeCollapse()?loadEdgeState():null;
            var bottom = p && typeof p.bottom==="number" ? p.bottom : 80;
            if(st && st.edge==="right"){
              el.style.left = Math.max(EDGE_GAP, window.innerWidth - el.offsetWidth - EDGE_GAP)+"px";
              el.style.right = "auto";
              el.style.bottom = bottom+"px";
              return;
            }
            if(p){
              if(typeof p.left==="number"){ el.style.left=p.left+"px"; el.style.right="auto"; el.style.bottom=p.bottom+"px"; }
              else if(typeof p.right==="number"){ el.style.right=p.right+"px"; el.style.left="auto"; el.style.bottom=p.bottom+"px"; }
            } else {
              // 初始位置：左侧贴窗口边缘（EDGE_GAP），底部 80px 让出底部输入区
              el.style.left=EDGE_GAP+"px"; el.style.right="auto"; el.style.bottom="80px";
            }
          }
          applyPos();
          // 设置页「重置悬浮窗位置」即时生效
          window.addEventListener("opencode:pos-reset", applyPos);
          return function(){ window.removeEventListener("opencode:pos-reset", applyPos); };
        },[]);

        // 显隐只由用户开关决定（设置页「通用」或面板页头）。曾试过"面板打开时自动
        // 隐藏悬浮窗"（先 CSS display:none 后事件状态机），实测两案都有问题：
        // display:none 会把轮播高度量成 0 且关掉后无人重测（塌到下次轮询才恢复）；
        // 事件方案则让"点侧栏入口 → 悬浮窗消失"违反直觉。悬浮窗在左下角、面板内容
        // 居中，同屏并不冲突——联动已整体移除。
        var hidden = !widgetOn[0];

        var slides=[];
        var cfg=cfgRef.current;
        var op=opData[0], ds=dsData[0], r4=r4Data[0];
        var hasOP = op && !op.disabled && op!==null;
        var hasDS = ds && !ds.disabled && ds!==null;
        var hasR4 = r4 && !r4.disabled && r4!==null;
        var tokenMeterHas = true;
        if(cfg.providers.opencode.enabled) slides.push({key:"opencode", label:"Opencode", data:op, has:hasOP});
        if(cfg.providers.deepseek.enabled) slides.push({key:"deepseek", label:"DeepSeek", data:ds, has:hasDS});
        if(cfg.providers.r4coder && cfg.providers.r4coder.enabled) slides.push({key:"r4coder", label:"R4Coder", data:r4, has:hasR4});
        slides.push({key:"tokenMeter", label:"Token 用量", data:tmData[0], has:tokenMeterHas});
        if(slides.length===0) slides.push({key:"empty", label:"未配置", data:null, has:false});
        if(carIdx[0]>=slides.length) { carIdx[1](0); saveCarIdx(0); }
        var curIdx = Math.min(carIdx[0], Math.max(0, slides.length-1));
        var curSlide = slides[curIdx] || slides[0];

        // 自适应轮播高度：DeepSeek/Token 单卡不再留白
        react.useEffect(function(){
          try{
            var carousel=document.querySelector(".oq-carousel");
            if(!carousel) return;
            var slidesEls=document.querySelectorAll(".oq-slide");
            var active=slidesEls[curIdx];
            if(active){
              var h=active.scrollHeight;
              carousel.style.height=h+"px";
            }
          }catch(e){}
        },[curIdx, opData[0], dsData[0], r4Data[0], tmData[0], hidden]);

        // 热力图 GSAP 场景：当月峰值扫光仅在新月份首次数据后跑一次
        //（今日呼吸已改为纯 CSS oq-breathe，与数据刷新节奏解耦，见样式表）
        react.useEffect(function(){
          if(hidden) return;
          var t=setTimeout(function(){
            ensureGSAP(function(g){
              if(!g) return;
              try{
                var mk=(chartTm[0]&&chartTm[0].todayStr)?String(chartTm[0].todayStr).slice(0,7):((tmData[0]&&tmData[0].todayStr)?String(tmData[0].todayStr).slice(0,7):"");
                if(mk && mk!==heatFxKey){ heatFxKey=mk; setTimeout(function(){ try{ sweepMaxOnce(g); }catch(e){} },260); }
              }catch(e){}
            });
          },420);
          return function(){ clearTimeout(t); };
        },[tmData[0], chartTm[0], curIdx, hidden]);

        function goIdx(i){
          var n=(i+slides.length)%slides.length;
          carIdx[1](n); saveCarIdx(n);
        }
        function goRange(r){
          rangeRef.current=r; saveRange(r); range[1](r);
          // 走 pullMeter 同一入口：带在飞守卫/超时，且切区间属于用户操作 -> force 放行
          pullMeter(r, false, null, true);
        }
        function onTouchStart(e){ touchStartX.current = e.touches[0].clientX; }
        function onTouchEnd(e){
          if(touchStartX.current==null) return;
          var dx=e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current=null;
          if(Math.abs(dx)>40){ if(dx<0) goIdx(curIdx+1); else goIdx(curIdx-1); }
        }

        var noTokenOP = cfg.providers.opencode && !cfg.providers.opencode.token;

        function renderHeatGrid(daily, anchorStr){
          if(!anchorStr && daily && daily.length) anchorStr=daily[daily.length-1].date;
          if(!daily||!daily.length||!anchorStr) return null;
          var byDate={}; daily.forEach(function(d){ byDate[d.date]=d; });
          var parts=String(anchorStr).split("-").map(Number);
          var y=parts[0], m=parts[1]-1;
          var mm=String(m+1).padStart(2,"0");
          var monthPrefix=y+"-"+mm+"-";
          var firstDay=new Date(y,m,1);
          var lead=(firstDay.getDay()+6)%7;
          var daysInMonth=new Date(y,m+1,0).getDate();
          // 分档基准：当月数据按用量排序取分位（见 heatLvOf），当月样本不足时回落到
          // sqrt(v/max) 连续映射，保证 2-3 个数据点也能拉开档位
          var monthVals=[];
          var maxInMonth=0, maxAll=1;
          daily.forEach(function(d){
            var v=Number(d.total||0);
            if(v>maxAll) maxAll=v;
            if(d.date && d.date.indexOf(monthPrefix)===0){
              if(v>maxInMonth) maxInMonth=v;
              if(v>0) monthVals.push(v);
            }
          });
          var max = maxInMonth>0 ? maxInMonth : maxAll;
          var useQuantile = monthVals.length>=4;
          if(useQuantile) monthVals.sort(function(a,b){return a-b;});
          function lvOf(v){ return heatLvOf(v, monthVals, useQuantile, max); }
          var rowsTotal=Math.ceil((lead+daysInMonth)/7);
          var wdCn=["日","一","二","三","四","五","六"];
          var now=new Date();
          var tStr=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
          var weeks=[];
          for(var r=0;r<rowsTotal;r++){
            var cells=[];
            for(var c=0;c<7;c++){
              var dayNum=r*7+c-lead+1;
              if(dayNum>=1&&dayNum<=daysInMonth){
                var key=y+"-"+mm+"-"+String(dayNum).padStart(2,"0");
                var d2=byDate[key];
                var v2=d2?Number(d2.total||0):0;
                var cls="oq-heat-cell";
                var lv=0;
                if(d2&&v2>0){ lv=lvOf(v2); cls+=" oh"+lv; }
                // 未来日期才打 oh-future，过去日期即便没数据也只是 oh0 默认底色（不应误判为"未来"）
                else if(key>tStr) cls+=" oh-future";
                if(key===tStr) cls+=" oh-today";
                if(v2>0&&v2===max) cls+=" oh-max";
                if(c===0) cls+=" oh-el";
                if(c===6) cls+=" oh-er";
                var dnum=new Date(y,m,dayNum);
                var payload={has:!!d2,total:v2,prompt:d2?Number(d2.prompt||0):0,out:d2?Number(d2.completion||0):0,cacheRead:d2?Number(d2.cache_read||0):0,requests:d2?(d2.requests||0):0,tools:d2?(d2.tools||0):null,models:(d2&&Array.isArray(d2.models))?d2.models:null,lv:lv,isMax:(v2>0&&v2===max),head:(m+1)+"月"+dayNum+"日 · 周"+wdCn[dnum.getDay()]};
                // var 循环闭包陷阱：用 IIFE 固化本格 payload，否则所有回调共享最后一次迭代值
                (function(payload,cls,stableKey){
                  cells.push(jsx_runtime.jsx("div",{key:stableKey,className:cls,
                    onMouseEnter:function(ev){
                      var el=ev.currentTarget;
                      if(heatShowT){ clearTimeout(heatShowT); heatShowT=null; }
                      if(heatHideT){ clearTimeout(heatHideT); heatHideT=null; }
                      heatShowT=setTimeout(function(){ heatTipShow(el,payload); },80);
                      jellyCell(el,true);
                    },
                    onMouseLeave:function(ev){
                      if(heatShowT){ clearTimeout(heatShowT); heatShowT=null; }
                      heatHideT=setTimeout(function(){ heatTipHide(); heatHideT=null; },40);
                      jellyCell(ev.currentTarget,false);
                    }
                  }));
                })(payload,cls,key);
              } else {
                cells.push(jsx_runtime.jsx("div",{key:"empty-"+r+"-"+c,className:"oq-heat-cell oh-empty"}));
              }
            }
            weeks.push(jsx_runtime.jsx("div",{key:"week-"+r,className:"oq-heat-week",children:cells}));
          }
          var wdEls=["一","二","三","四","五","六","日"].map(function(w,i){
            return jsx_runtime.jsx("span",{key:i,style:{flex:1,fontSize:"8px",lineHeight:"8px",textAlign:"center",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:w});
          });
          return jsx_runtime.jsxs("div",{className:"oq-heat",children:[
            jsx_runtime.jsx("div",{style:{display:"flex",gap:2},children:wdEls}),
            jsx_runtime.jsx("div",{style:{display:"flex",flexDirection:"column",gap:2,width:"100%"},children:weeks}),
          ]});
        }

        // totals 总量口径：total = prompt + completion（旧 host 缺 total 时兜底）。
        // prompt 本身就是"新输入 + 缓存读"，所以这里不能再减/加 cache_read——
        // 之前注释里写的"兜底漏掉 cache_read"是误判，prompt 已含它。
        function totalsTotalOf(t){
          t = t || {};
          if (t.total != null) return Number(t.total) || 0;
          var prompt = t.prompt != null ? Number(t.prompt) || 0
            : (Number(t.freshInput || 0) + Number(t.cache_read != null ? t.cache_read : (t.cacheRead || 0)));
          return prompt + (Number(t.completion) || 0);
        }
        // 网关角标：悬浮窗专用（方案 B：胶囊 + 朝上小三角）。
        //
        // 设计依据（真机反馈 + 实测宽度）：
        //   · 原实现是 `网关 97.8%`，与模型名同行、且模型名自带一个 `98%` —— 两个
        //     "标签+百分数"并排，读者会把网关占比读成模型的数据。现在：
        //     ① 改显示**实际 token 数**（用户要求，且宽度几乎不变：61px vs 58px）；
        //     ② 模型名的 98% 移进 tooltip，相邻双百分数消失；
        //     ③ 胶囊顶部加一个朝上的小三角，指向正上方的总量 —— "上为主、下为注"。
        //   · 三角是纯 CSS border（3px），不占布局宽度、不影响 flex 计算。
        //   · 数值用 tabular-nums，与上方总量右对齐时可逐位对比：
        //     102.7M − 100.4M ≈ 2.3M 就是本机量，读者心算即得，不必再显示第三个数。
        //   · 监测关闭时进 `仅本机` 分支：总量会明显变小（实测少一半），不标注会被
        //     当成"数据丢了"或"功能坏了"。
        function gwBadgeEl(sources){
          try{
            var g=sources&&sources.gateway, l=sources&&sources.local;
            if(!g) return null;
            if(g.enabled===false){
              return jsx_runtime.jsx("span",{
                title:"网关监测已关闭：只统计本机会话。可在「设置 → 网关」重新开启。",
                style:{fontSize:"9px",fontWeight:700,padding:"0 5px",borderRadius:999,whiteSpace:"nowrap",flex:"none",
                  border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.12))",color:"var(--dsw-alias-label-caption,#9a9aaa)"},
                children:"仅本机"});
            }
            var gt=Number(g.total||0)||0;
            if(gt<=0) return null;
            var lt=Number(l&&l.total||0)||0;
            var all=lt+gt;
            var pct=all>0?Math.round(gt/all*1000)/10:null;
            return jsx_runtime.jsxs("span",{
              title:"网关占总量 "+(pct!=null?pct+"%":"—")
                +"（本机 "+fmtTokens(lt)+" ＋ 网关 "+fmtTokens(gt)+"）"
                +"\n"+(Number(g.requests||0)||0)+" 次请求 · UTC+8 日界",
              style:{position:"relative",display:"inline-flex",alignItems:"baseline",gap:3,padding:"0 5px",
                borderRadius:999,whiteSpace:"nowrap",flex:"none",
                border:"1px solid rgba(109,91,255,0.42)",background:"rgba(139,123,255,0.13)",
                fontVariantNumeric:"tabular-nums"},
              children:[
                // 朝上小三角：指向正上方，表达"我是它的一部分"。
                //
                // ⚠️ 位置在胶囊**左侧**（用户要求"三角靠左"）：left 定位而非 right。
                // 靠左的意义不只是审美 —— 它让三角落在"网关"二字附近，
                // 读起来是「↑ 网关」而不是挂在整个胶囊右端，跟上方总量的关联
                // 由垂直方向（正上方那一行）承担，不再依赖横向像素级对齐
                // （上一版为对齐右侧的 `Live` 徽标要算 16px 偏移，很脆）。
                // 三角纯 CSS border（宽 3+3=6px），绝对定位，不参与布局计算。
                jsx_runtime.jsx("i",{
                  style:{position:"absolute",top:-4,left:6,width:0,height:0,
                    borderLeft:"3px solid transparent",borderRight:"3px solid transparent",
                    borderBottom:"4px solid rgba(139,123,255,0.42)"}
                }),
                jsx_runtime.jsx("span",{style:{fontSize:"8.5px",fontWeight:600,color:"rgba(139,123,255,0.9)"},children:"网关"}),
                jsx_runtime.jsx("b",{style:{fontSize:"9.5px",fontWeight:750,color:"#b3aaff"},children:fmtTokens(gt)}),
              ]});
          }catch(e){ return null; }
        }
        // 「请求」胶囊：值恒为**合计**（与总量同口径），网关分量放 title。
        // 之前把网关请求单列一行，在 260px 的悬浮窗里既撑高卡片、又与「请求」重复
        // （两者相等时——只有网关流量的日子——看起来像 bug）。
        function gwReqPill(totalReq, sources){
          var g=sources&&sources.gateway;
          var gwReq=(g && g.enabled!==false) ? (Number(g.requests||0)||0) : 0;
          var pill=_pill("请求 ", totalReq, "var(--bmon-c2,#b08427)");
          if(!pill || gwReq<=0) return pill;
          var lt=Math.max(0, (Number(totalReq)||0) - gwReq);
          // 复刻 _pill 的外观，只换成"请求 N"+"含网关 M"的自定义 title
          return jsx_runtime.jsx("span",{
            title:"合计 "+(Number(totalReq)||0)+" 次 ＝ 本机 "+lt+" ＋ 网关 "+gwReq+"（UTC+8 日界）",
            style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,minWidth:0,overflow:"hidden",
              padding:"1px 4px",borderRadius:"999px",background:"var(--dsw-alias-bg-layer-1,#242433)",
              border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",fontSize:"10px",lineHeight:1.2,whiteSpace:"nowrap"},
            children:[
              jsx_runtime.jsx("span",{style:{flex:"none",color:"var(--dsw-alias-label-secondary,#a0a0b0)",fontWeight:500},children:"请求 "}),
              jsx_runtime.jsx("b",{style:{color:"var(--bmon-c2,#b08427)",fontWeight:700,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"},children:String(totalReq)}),
            ]});
        }
        function renderTmCompact(d3, stats, totalsRaw){
          var live = stats ? stats.live : null;
          var prevTotals = stats ? stats.prevTotals : null;
          var ownDaily = stats && Array.isArray(stats.daily) ? stats.daily : [];
          var chartDaily = (chartTm[0] && chartTm[0].ok && chartTm[0].stats && Array.isArray(chartTm[0].stats.daily)) ? chartTm[0].stats.daily : [];
          var daily = chartDaily.length ? chartDaily : ownDaily;
          var totalVal = totalsTotalOf(totalsRaw);
          var promptVal = Number(totalsRaw.prompt||0)||0;
          var completionVal = Number(totalsRaw.completion||0)||0;
          var cacheReadVal = Number(totalsRaw.cache_read!=null?totalsRaw.cache_read:(totalsRaw.cacheRead||0))||0;
          var reqVal = Number(totalsRaw.requests||0)||0;
          var turnsVal = totalsRaw.turns!=null? Number(totalsRaw.turns): null;
          var stepsVal = totalsRaw.steps!=null? Number(totalsRaw.steps): null;
          var toolsVal = totalsRaw.tools!=null? Number(totalsRaw.tools): null;
          var hitRate = promptVal>0 ? (cacheReadVal/promptVal*100) : null;
          var hitPct = hitRate!=null? Math.round(hitRate): null;
          // 圆环已改用 SVG（见 ringEl），不再需要 conic-gradient 背景串。
          var hasData = totalVal>0 || reqVal>0 || (turnsVal!=null && turnsVal>0);
          function _delta(cur, prev){ if(prev==null||!isFinite(prev)||prev===0) return null; var v=((cur/prev)-1)*100; return {text:(v>=0?"▲":"▼")+" "+Math.abs(v).toFixed(0)+"%", up:v>=0}; }
          var totalDelta = prevTotals ? _delta(totalVal, prevTotals.total) : null;
          var reqDelta = prevTotals ? _delta(reqVal, prevTotals.requests) : null;
          var isLive = LIVE_JUDGE(d3, live);
          // 通道归属：直连 / 网关 / 两者。徽标的颜色与文案都由它决定。
          // 保留 isLive 是为了别处（hasData 分支等）继续用它做"要不要显示活动区"的判据。
          var liveKind = LIVE_CHANNEL(d3, live);
          if(liveKind && !isLive) liveKind = null;   // 两套判据必须同源，绝不出现"亮着但说不清"
          var topModel=null, topShare=null;
          if(stats && Array.isArray(stats.models) && stats.models.length){
            var sumAll=0; stats.models.forEach(function(m){ sumAll+=Number(m.total||0); });
            topModel=stats.models[0];
            topShare= sumAll>0 ? Math.round(Number(topModel.total||0)/sumAll*100) : null;
          }
          var miniDays = daily.slice(-7);
          var miniMax=0; miniDays.forEach(function(d){ var v=Number(d.total||0); if(v>miniMax) miniMax=v; });
          if(miniMax<=0) miniMax=1;
          // 悬浮窗的图表形态：柱状（近 7 日迷你柱）/ 热力图（当月日历）。
          // 这里只**读取**形态；切换入口统一收在设置页「数据源与通用 → 小窗口图表」。
          // 悬浮窗是功能展示区，不放配置按钮——形态变更靠 saveTmChart() 广播的
          // tm-chart-changed 事件 + onStorage 双链路推到这里重渲染。
          var chartType=loadTmChart();
          return jsx_runtime.jsxs("div",{style:{padding:"0",display:"flex",flexDirection:"column",gap:6,width:"100%",minWidth:0,boxSizing:"border-box",overflow:"hidden"},children:[
            jsx_runtime.jsxs("div",{className:"oq-tm-head",style:{display:"flex",alignItems:"center",gap:8,padding:"0",height:40},children:[
              // 圆环 + 居中数字：数字叠在 SVG 上（绝对定位），字号 11px，
              // 不再挤在 4px 环宽的内孔里。tabular-nums 避免百分比变化时左右跳。
              jsx_runtime.jsxs("div",{className:"oq-tm-ring",style:{position:"relative",width:RING_SIZE,height:RING_SIZE,flex:"none",display:"inline-flex",alignItems:"center",justifyContent:"center"},children:[
                ringEl(hitPct, { id: "tm" }),
                jsx_runtime.jsx("b",{style:{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:800,letterSpacing:"-0.3px",fontVariantNumeric:"tabular-nums",color:"var(--dsw-alias-label-primary,#fff)",lineHeight:1,pointerEvents:"none"},children:hitPct!=null?hitPct+"%":"—"}),
              ]}),
              jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",justifyContent:"center",gap:3,flex:1,minWidth:0},children:[
                // 第一行：只看「缓存命中率」+ 右侧「总量 Token + Live」。
                // ⚠️ 总量**必须带 ` Token` 单位**（用户要求恢复）：`102.7M` 单看有歧义，
                // 单位是口径的一部分。代价是这一行多占 29px —— 已由第二行的
                // 「模型名去掉 98%」（省 24.5px）与「网关改数值」（省 ~0）抵掉，
                // 实测模型名仍不截断（见 CHANGELOG 的实测数据）。
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,minWidth:0},children:[
                  jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:600,color:"var(--bmon-c3,#c65f7f)",whiteSpace:"nowrap",flex:"none"},children:"缓存命中率"}),
                  jsx_runtime.jsx("span",{style:{flex:1,minWidth:0}}),
                  hasData? jsx_runtime.jsx("span",{className:"oq-tm-total",style:{fontSize:"11px",fontWeight:600,whiteSpace:"nowrap",flex:"none",fontVariantNumeric:"tabular-nums"},children:fmtTokens(totalVal)+" Token"}) : null,
                  // 徽标：三态共用 `● Live`，只靠颜色区分（直连=绿、网关=橙、两者=渐变）
                  LIVE_BADGE(liveKind),
                ].filter(Boolean)}),
                // 第二行：左 = 榜首模型（可省略号收缩），右 = 带朝上三角的网关胶囊
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,minWidth:0},children:[
                  jsx_runtime.jsx("div",{style:{flex:1,minWidth:0,display:"flex",alignItems:"center"},children:
                    // ⚠️ 模型名后**不再**跟 ` 98%`（实测 133.4px → 108.9px，省 24.5px）。
                    // 除了省宽度，更重要的是：那个 98% 与网关占比原本紧挨着，
                    // 两个"标签+百分数"并排是"看起来像同一份数据"的根因（用户实测反馈）。
                    // 现在占比进 title，悬停仍可看全。
                    topModel? jsx_runtime.jsxs("span",{
                      title:topModel.model+(topShare!=null?(" · 占总用量 "+topShare+"%"):"")
                        +"\n"+(stats.models.map(function(m){return m.model+" "+fmtNum(m.total);})).join("\n"),
                      style:{fontSize:"11px",fontWeight:600,color:"var(--dsw-alias-label-primary,#fff)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"inline-flex",alignItems:"center",gap:4,maxWidth:"100%"},children:[
                      jsx_runtime.jsx("span",{style:{width:7,height:7,borderRadius:"50%",background:"#6b87d9",flex:"none",display:"inline-block"}}),
                      topModel.model,
                    ]}) : jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"无模型数据"})
                  }),
                  gwBadgeEl(d3&&d3.sources),
                ]}),
              ]}),
            ]}),
            jsx_runtime.jsxs("div",{style:{display:"flex",gap:4,width:"100%",alignItems:"center"},children:[
              jsx_runtime.jsx("div",{style:{display:"flex",gap:4,flex:1,minWidth:0},children: RANGES.map(function(r){
                var active=range[0]===r[0];
                return jsx_runtime.jsx("button",{onClick:function(){goRange(r[0]);},style:{flex:1,padding:"3px 0",fontSize:"10px",fontWeight:active?700:500,borderRadius:999,border:"1px solid "+(active?"rgba(109,91,255,0.45)":"var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"),background:active?"rgba(109,91,255,0.14)":"transparent",color:active?"#8b7bff":"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:"pointer"},children:r[1]}, r[0]);
              })}),
            ]}),
            hasData ? jsx_runtime.jsxs(jsx_runtime.Fragment,{children:[
              chartType==="heat" ? renderHeatGrid(daily,(chartTm[0]&&chartTm[0].todayStr)||(d3&&d3.todayStr)||null) : null,
              chartType!=="heat" && miniDays.length>=1 ? jsx_runtime.jsx("div",{title:"近"+miniDays.length+"日用量趋势（悬停看明细）",style:{display:"flex",alignItems:"flex-end",gap:3,height:34,padding:"0 2px"},children: miniDays.map(function(d,i){
                var v=Number(d.total||0); var h=Math.max(3,Math.round(v/miniMax*28));
                var tip=d.date+" · 总 "+fmtNum(d.total)+"（输入 "+fmtNum(d.prompt)+" / 输出 "+fmtNum(d.completion)+" / 缓存 "+fmtNum(d.cache_read)+"）· "+(d.requests||0)+" 次";
                return jsx_runtime.jsx("div",{title:tip,style:{flex:1,height:h,minHeight:3,borderRadius:3,background:i===miniDays.length-1?"linear-gradient(180deg,#82a1ea,#5a71c4)":"rgba(109,91,255,0.45)",transition:"height 0.25s ease"}}, d.date+"-"+i);
              })}) : null,
              jsx_runtime.jsxs("div",{className:"oq-tm-tile",style:{padding:"4px 6px"},children:[
                jsx_runtime.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4},children:[
                  jsx_runtime.jsxs("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--bmon-c1,#6b87d9)",whiteSpace:"nowrap"},children:["输入 ",fmtTokens(promptVal)]}),
                  jsx_runtime.jsxs("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--bmon-c2,#b08427)",textAlign:"center",whiteSpace:"nowrap"},children:["输出 ",fmtTokens(completionVal)]}),
                  jsx_runtime.jsxs("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--bmon-c3,#c65f7f)",textAlign:"right",whiteSpace:"nowrap"},children:["缓存 ",fmtTokens(cacheReadVal)]}),
                ]}),
                jsx_runtime.jsx("div",{style:{display:"grid",gridTemplateColumns:"minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.1fr)",gap:4,marginTop:3},children:[_pill("轮次 ",turnsVal,"var(--bmon-c1,#6b87d9)"),_pill("步数 ",stepsVal,"var(--bmon-c2,#b08427)"),_pill("工具 ",toolsVal,"var(--bmon-c3,#c65f7f)")].filter(Boolean)}),
                jsx_runtime.jsx("div",{style:{display:"grid",gridTemplateColumns:"minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.1fr)",gap:4,marginTop:3},children:[
                  // 「请求」显示**合计**（本机 + 网关），与上面的总量同口径。
                  // 网关分量不另占一行（260px 宽的悬浮窗里多一行会把卡片撑高、
                  // 且"请求 216 / 网关请求 216"看起来像重复——两者相等时尤其误导）。
                  // 分开的数字放 title：悬停即可看到"其中网关 N"。
                  gwReqPill(reqVal, d3&&d3.sources),
                  _pill("首tok ",live&&live.firstTokenMs?(live.firstTokenMs/1000).toFixed(1)+"s":null,"var(--bmon-c3,#c65f7f)"),
                  _pill("速度 ",live&&live.tokPerSec?Math.round(live.tokPerSec)+" T/s":null,"var(--bmon-c1,#6b87d9)"),
                ].filter(Boolean)}),
              ]}),
              
            ]}) : jsx_runtime.jsx("div",{className:"oq-tm-empty",children:"暂无用量 · 发起一次对话后自动统计"}),
          ]});
        }

        function renderTmClassic(d3, stats, totalsRaw){
          var live = stats ? stats.live : null;
          var daily = stats && Array.isArray(stats.daily) ? stats.daily : null;
          var prevTotals = stats ? stats.prevTotals : null;
          var totalVal = totalsTotalOf(totalsRaw);
          var promptVal = Number(totalsRaw.prompt||0)||0;
          var completionVal = Number(totalsRaw.completion||0)||0;
          var cacheReadVal = Number(totalsRaw.cache_read!=null?totalsRaw.cache_read:(totalsRaw.cacheRead||0))||0;
          var cacheWriteVal = Number(totalsRaw.cache_write!=null?totalsRaw.cache_write:0)||0;
          var reqVal = Number(totalsRaw.requests||0)||0;
          var turnsVal = totalsRaw.turns!=null? Number(totalsRaw.turns): null;
          var stepsVal = totalsRaw.steps!=null? Number(totalsRaw.steps): null;
          var toolsVal = totalsRaw.tools!=null? Number(totalsRaw.tools): null;
          var freshVal = Math.max(0, promptVal - cacheReadVal);
          var hitRate = promptVal>0 ? (cacheReadVal/promptVal*100) : null;
          var hitPct = hitRate!=null? Math.round(hitRate): null;
          // 圆环已改用 SVG（见 ringEl），不再需要 conic-gradient 背景串。
          var hasData = totalVal>0 || reqVal>0 || (turnsVal!=null && turnsVal>0);
          var dailyAvg = "";
          if(daily && daily.length>1){ dailyAvg=" · 日均 "+(reqVal/Math.max(1,daily.length)).toFixed(1)+" 次"; }
          function _delta(cur, prev){ if(prev==null||!isFinite(prev)||prev===0) return null; var v=((cur/prev)-1)*100; var s=v>=0?"▲":"▼"; return s+" "+Math.abs(v).toFixed(0)+"%"; }
          var totalDelta = prevTotals ? _delta(totalVal, prevTotals.total) : null;
          var reqDelta = prevTotals ? _delta(reqVal, prevTotals.requests) : null;
          var cp2 = (d3 && d3.contextPressure) || (stats && stats.contextPressure) || null;
          var pressureVal2=null;
          if(cp2 && typeof cp2==="object"){ if(typeof cp2.value==='number') pressureVal2=cp2.value; else if(typeof cp2.percent==='number') pressureVal2=cp2.percent/100; else if(typeof cp2.ratio==='number') pressureVal2=cp2.ratio; } else if(typeof cp2==='number') pressureVal2=cp2;
          if(pressureVal2!=null && pressureVal2>1) pressureVal2=pressureVal2/100;
          var pressurePct2 = pressureVal2!=null ? Math.round(pressureVal2*100) : null;
          var pressureColor2 = pressurePct2!=null && pressurePct2>=80 ? "#ef4444" : pressurePct2!=null && pressurePct2>=60 ? "#f59e0b" : "#6d5bff";
          return jsx_runtime.jsxs("div",{style:{padding:"0",display:"flex",flexDirection:"column",gap:6,width:"100%",minWidth:0,boxSizing:"border-box",overflow:"hidden"},children:[
              jsx_runtime.jsxs("div",{className:"oq-tm-head",children:[
                jsx_runtime.jsx("span",{className:"oq-tm-title",children:"Token 用量"}),
                gwBadgeEl(d3&&d3.sources),
                jsx_runtime.jsx("span",{className:"oq-tm-total",children: hasData? fmtTokens(totalVal)+" Token" : "—"}),
              ]}),
              hasData ? jsx_runtime.jsxs("div",{className:"oq-tm-grid",children:[
                jsx_runtime.jsxs("div",{className:"oq-tm-tile",style:{background:"linear-gradient(135deg, rgba(107,135,217,0.08) 0%, rgba(107,135,217,0.02) 100%), var(--dsw-alias-bg-layer-2)",padding:"5px 7px"},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:3,marginTop:1},children:[
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:700},children:"输入"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c1,#6b87d9)",fontSize:"11px"},children:fmtTokens(promptVal)})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"输出"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c2,#b08427)",fontSize:"11px"},children:fmtTokens(completionVal)})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"缓存"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c3,#c65f7f)",fontSize:"11px"},children:fmtTokens(cacheReadVal)})]}),
                  ]}),
                ]}),
                jsx_runtime.jsxs("div",{className:"oq-tm-tile",style:{background:"linear-gradient(135deg, rgba(141,124,228,0.08) 0%, rgba(141,124,228,0.02) 100%), var(--dsw-alias-bg-layer-2)",padding:"5px 7px"},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:3,marginTop:1},children:[
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"轮次"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c4,#8d7ce4)",fontSize:"11px"},children: (turnsVal!=null? String(turnsVal):"—")+" 轮"})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"步数"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c4,#8d7ce4)",fontSize:"11px"},children: (stepsVal!=null? String(stepsVal):"—")+" 步"})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"工具"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c4,#8d7ce4)",fontSize:"11px"},children: toolsVal!=null? toolsVal+" 次" : "—"})]}),
                  ]}),
                ]}),
                jsx_runtime.jsxs("div",{className:"oq-tm-tile",style:{background:"linear-gradient(135deg, rgba(176,132,39,0.07) 0%, rgba(176,132,39,0.02) 100%), var(--dsw-alias-bg-layer-2)",padding:"5px 7px"},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:3,marginTop:1},children:[
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:4,flex:"none"},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#ffffff)",fontWeight:700},children:"请求数"}), reqDelta? jsx_runtime.jsx("span",{style:{fontSize:"8px",color:reqDelta.indexOf("▲")===0?"var(--bmon-c3,#c65f7f)":"var(--bmon-c2,#b08427)",fontWeight:600},children:reqDelta}):null].filter(Boolean)}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c2,#b08427)",fontSize:"11px"},children:String(reqVal||0)+" 次"})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"首 token"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c2,#b08427)",fontSize:"11px"},children:(live && live.firstTokenMs ? (live.firstTokenMs/1000).toFixed(1)+"s" : "—")})]}),
                    jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",lineHeight:1.2},children:[jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-primary,#f5f5f7)",flex:"none",fontWeight:600},children:"速度"}), jsx_runtime.jsx("span",{style:{fontWeight:700,whiteSpace:"nowrap",color:"var(--bmon-c2,#b08427)",fontSize:"11px"},children:(live && live.tokPerSec ? Math.round(live.tokPerSec)+" T/s" : "—")})]}),
                  ]}),
                ]}),
                jsx_runtime.jsxs("div",{className:"oq-tm-tile",style:{background:"linear-gradient(135deg, rgba(198,95,127,0.08) 0%, rgba(198,95,127,0.02) 100%), var(--dsw-alias-bg-layer-2)",padding:"5px 7px"},children:[
                  jsx_runtime.jsx("div",{className:"oq-tm-tile-label",style:{color:"var(--bmon-c3,#c65f7f)",fontWeight:700,justifyContent:"center",textAlign:"center",width:"100%",display:"flex"},children:"缓存命中率"}),
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:4,width:"100%"},children:[
                    jsx_runtime.jsx("div",{className:"oq-tm-hbar",style:{flex:"0 1 90px",width:"90px",maxWidth:"90px"},children: jsx_runtime.jsx("div",{ref:hitBarRef,className:"oq-tm-hbar-fill",style:{width:hitPct!=null? hitPct+"%":"0%",background: hitPct!=null && hitPct>=70 ? "linear-gradient(90deg,#10b981 0%,#34d399 100%)" : hitPct!=null && hitPct>=40 ? "linear-gradient(90deg,#f59e0b 0%,#fbbf24 100%)" : "linear-gradient(90deg,#c65f7f 0%,#ff8fab 100%)"}})}),
                    jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:700,color: hitPct!=null && hitPct>=70 ? "#10b981" : hitPct!=null && hitPct>=40 ? "#f59e0b" : "#c65f7f",whiteSpace:"nowrap"},children: hitPct==null? "—" : hitPct+"%"}),
                  ]}),
                ]}),
              ]}) : jsx_runtime.jsx("div",{className:"oq-tm-empty",children:"暂无用量 · 发起一次对话后自动统计"}),
              pressurePct2!=null ? jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,width:"100%"},children:[
                jsx_runtime.jsx("span",{style:{fontSize:"9px",color:"var(--dsw-alias-label-caption,#9a9aaa)",flex:"none"},children:"上下文"}),
                jsx_runtime.jsx("div",{style:{flex:1,height:4,borderRadius:999,background:"rgba(255,255,255,0.12)",overflow:"hidden"},children: jsx_runtime.jsx("div",{style:{height:"100%",width:pressurePct2+"%",background:pressureColor2,transition:"width 0.3s"}})}),
                jsx_runtime.jsx("span",{style:{fontSize:"9px",fontWeight:700,color:pressureColor2,flex:"none"},children:pressurePct2+"%"}),
              ]}) : null,
            ]});
        }

        function renderSlide(s){
          if(s.key==="opencode"){
            var d=s.data;
            if(d && d.disabled) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.85,borderStyle:"dashed"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(109,91,255,0.12)",border:"1px solid rgba(109,91,255,0.18)",color:"#6d5bff",fontSize:"10px",fontWeight:700},children:"OC"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsx("div",{className:"oq-provider-title",children:["Opencode", jsx_runtime.jsx("span",{className:"oq-badge warn",children:"已禁用"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children:"在设置中启用 Opencode"}),
              ]}),
            ]});
            if(!d){
              if(loading[0]) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.9},children:[
                jsx_runtime.jsx("span",{className:"oq-spin"}),
                jsx_runtime.jsx("span",{style:{marginLeft:8,fontSize:"12px",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:"加载中…"}),
              ]});
              return jsx_runtime.jsx("div",{children:"暂无数据"});
            }
            if(d && d.ok===false) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.06)"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.18)",color:"#ef4444",fontSize:"11px",fontWeight:700},children:"OC"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsxs("div",{className:"oq-provider-title",children:["Opencode", jsx_runtime.jsx("span",{className:"oq-badge err",children:"异常"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children: d.error? String(d.error).slice(0,80): "加载失败"}),
              ]}),
            ]});
            if(d && d.buckets){
              var cards = [
                {key:"rolling", label:"滚动", b: d.buckets.rolling},
                {key:"weekly", label:"每周", b: d.buckets.weekly},
                {key:"monthly", label:"每月", b: d.buckets.monthly},
              ];
              return jsx_runtime.jsxs("div",{ref:opBucketsRef,style:{display:"flex",flexDirection:"column",gap:6},children: cards.map(function(item){
                var b=item.b; if(!b) return null;
                var pct=b.percent; var isWarn=pct!=null&&pct>=80; var isMid=pct!=null&&pct>=60;
                var barColor=isWarn?"#ef4444": isMid?"#f59e0b":"#6d5bff";
                return jsx_runtime.jsxs("div",{className:"oq-provider",style:{padding:"5px 7px",display:"flex",flexDirection:"column",alignItems:"stretch",gap:4},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"},children:[
                    jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)",display:"flex",alignItems:"center",gap:4},children:[item.label, (b.status && b.status!=="ok") ? jsx_runtime.jsx("span",{className:"oq-badge",children: b.status}) : null]}),
                    jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:500,color:"var(--dsw-alias-label-caption,#9a9aaa)",whiteSpace:"nowrap"},children: countdown(b.resetsAt)||fmtDate(b.resetsAt)||""}),
                  ]}),
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,width:"100%"},children:[
                    jsx_runtime.jsx("div",{className:"oq-tm-hbar",style:{flex:1},children: jsx_runtime.jsx("div",{title:pct!=null?"已用 "+pct+"%":"",className:"oq-tm-hbar-fill oq-op-fill",style:{width:(pct!=null?pct:0)+"%",minWidth:pct>0&&pct<2?"2px":undefined,background:"linear-gradient(90deg, #6d5bff 0%, "+barColor+" 100%)",boxShadow: pct>0 ? "0 0 6px "+barColor+"88" : "none"}})}),
                    jsx_runtime.jsx("span",{style:{fontSize:"12px",fontWeight:800,color: isWarn?"#ef4444": isMid?"#f59e0b":"var(--dsw-alias-label-primary,#fff)",flex:"none",minWidth:"30px",textAlign:"right"},children: pct!=null? pct+"%":"—"}),
                  ]}),
                ]});
              }).filter(Boolean)});
            }
            var pct2=d.percent; var isWarn2=pct2!=null&&pct2>=80; var barColor2=isWarn2?"#ef4444": (pct2>=60?"#f59e0b":"#6d5bff");
            return jsx_runtime.jsxs("div",{className:"oq-provider",children:[
              jsx_runtime.jsxs("div",{style:{display:"flex",gap:8,alignItems:"center",width:"100%"},children:[
                jsx_runtime.jsxs("div",{className:"oq-provider-icon",style:{background:"rgba(109,91,255,0.12)",border:"1px solid rgba(109,91,255,0.18)"},children:[
                  jsx_runtime.jsx("svg",{width:28,height:28,viewBox:"0 0 28 28",children: jsx_runtime.jsxs("g",{children:[
                    jsx_runtime.jsx("circle",{cx:14,cy:14,r:10,fill:"none",stroke:"rgba(255,255,255,0.08)",strokeWidth:3}),
                    jsx_runtime.jsx("circle",{cx:14,cy:14,r:10,fill:"none",stroke:barColor2,strokeWidth:3,strokeLinecap:"round",strokeDasharray:(2*Math.PI*10).toFixed(1),strokeDashoffset:(2*Math.PI*10*(1-(pct2||0)/100)).toFixed(1)}),
                  ]})}),
                  jsx_runtime.jsx("span",{className:"oq-provider-icon-center",children: pct2!=null? pct2+"%":"—"}),
                ]}),
                jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                  jsx_runtime.jsxs("div",{className:"oq-provider-title",children:["Opencode", jsx_runtime.jsx("span",{className:"oq-badge"+(noTokenOP?" warn":" live"),children: (d.plan||"Go")})]}),
                  jsx_runtime.jsx("div",{className:"oq-provider-sub",children: (d.used!=null? fmtNum(d.used)+"/"+fmtNum(d.limit): (d.remaining!=null? "剩"+fmtNum(d.remaining): (d.percent!=null? "剩"+(100-d.percent)+"%":"—"))) + (d.resetAt? " · "+(countdown(d.resetAt)||fmtDate(d.resetAt)):"")}),
                  pct2!=null && jsx_runtime.jsx("div",{className:"oq-tinybar",children: jsx_runtime.jsx("div",{className:"oq-tinybar-seg",style:{width:pct2+"%",background:barColor2}})}),
                ]}),
              ]}),
            ]});
          }
          if(s.key==="deepseek"){
            var d2=s.data;
            if(!d2){
              if(loading[0]) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.9},children:[
                jsx_runtime.jsx("span",{className:"oq-spin"}),
                jsx_runtime.jsx("span",{style:{marginLeft:8,fontSize:"12px",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:"加载中…"}),
              ]});
              return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.85,borderStyle:"dashed"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon ds",style:{background:"rgba(14,165,233,0.12)",border:"1px solid rgba(14,165,233,0.18)",color:"#0ea5e9",fontSize:"11px",fontWeight:700},children:"DS"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsx("div",{className:"oq-provider-title",children:["DeepSeek", jsx_runtime.jsx("span",{className:"oq-badge warn",children:"未配置"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children:"在设置中填入 DeepSeek API Key"}),
              ]}),
            ]});
            }
            if(!d2.ok) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.06)"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon ds",style:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.18)",color:"#ef4444",fontSize:"11px",fontWeight:700},children:"DS"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsxs("div",{className:"oq-provider-title",children:["DeepSeek", jsx_runtime.jsx("span",{className:"oq-badge err",children:"异常"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children: d2.error? String(d2.error).slice(0,80): "加载失败"}),
              ]}),
            ]});
            var cny=d2.cny || (d2.byCurr && (d2.byCurr.CNY || d2.byCurr.cny)) || null;
            var usd=(d2.usd!=null?d2.usd:null) || (d2.byCurr && (d2.byCurr.USD || d2.byCurr.usd)) || null;
            if(!cny && d2.raw && d2.raw.balance_infos && d2.raw.balance_infos[0]){ var bi=d2.raw.balance_infos[0]; cny={currency:bi.currency||"CNY",total:Number(bi.total_balance!=null?bi.total_balance:(bi.total!=null?bi.total:0)),granted:Number(bi.granted_balance!=null?bi.granted_balance:(bi.granted!=null?bi.granted:0)),toppedUp:Number(bi.topped_up_balance!=null?bi.topped_up_balance:(bi.toppedUp!=null?bi.toppedUp:0))}; }
            if(usd && usd.total==null && usd.total_balance!=null) usd.total=usd.total_balance;
            var isZero=cny && Number(cny.total)===0 && Number(cny.granted)===0 && Number(cny.toppedUp)===0;
            var low=cny&&cny.total!=null&&Number(cny.total)<5&&!isZero;
            var cnyTotalStr=cny?fmtMoney(cny.total,"CNY"):"—";
            var grantStr=cny?fmtMoney(cny.granted,"CNY"):"—";
            var topStr=cny?fmtMoney(cny.toppedUp,"CNY"):"—";
            return jsx_runtime.jsxs("div",{className:"oq-provider",style:{padding:"7px 8px",display:"flex",flexDirection:"column",alignItems:"stretch",gap:6,width:"100%",minWidth:0,boxSizing:"border-box",overflow:"hidden"},children:[
              jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",gap:8,minWidth:0},children:[
                jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)",display:"flex",alignItems:"center",gap:6,minWidth:0,flex:"1 1 auto",overflow:"hidden"},children:[
                  jsx_runtime.jsx("span",{style:{width:22,height:22,borderRadius:7,background:"linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"9px",fontWeight:800,flex:"none"},children:"DS"}),
                  "DeepSeek",
                  isZero ? null : d2.isAvailable ? jsx_runtime.jsx("span",{style:{width:8,height:8,borderRadius:"50%",background:"#10b981",display:"inline-block",flex:"none"},title:"可用"}) : jsx_runtime.jsx("span",{className:"oq-badge err",children:"受限"}),
                ]}),
              ]}),
              cny && jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",minWidth:0,padding:"5px 8px",borderRadius:8,background:"var(--dsw-alias-bg-layer-2,#1a1a1f)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",boxSizing:"border-box"},children:[
                jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:800,color:"var(--dsw-alias-label-primary,#fff)",display:"inline-flex",alignItems:"center",gap:4,flex:"none",letterSpacing:"-0.2px",whiteSpace:"nowrap"},children:[jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",background:"#8b7bff",display:"inline-block",flex:"none"}}),"赠送 "+grantStr]}),
                jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:800,color:"var(--dsw-alias-label-primary,#fff)",display:"inline-flex",alignItems:"center",gap:6,flex:"none",letterSpacing:"-0.2px",whiteSpace:"nowrap"},children:[
                  jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:4},children:[jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",background:"#06b6d4",display:"inline-block",flex:"none"}}),"充值 "+topStr]}),
                  usd && usd.total!=null ? jsx_runtime.jsx("span",{style:{fontSize:"10px",fontWeight:400,color:"var(--dsw-alias-label-caption,#9a9aaa)",whiteSpace:"nowrap"},children:"· USD "+fmtMoney(usd.total,"USD")}) : null,
                ].filter(Boolean)}),
              ]}),
            ]});
          }
          if(s.key==="r4coder"){
            var dr=s.data;
            if(dr && dr.disabled) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.85,borderStyle:"dashed"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.18)",color:"#f59e0b",fontSize:"10px",fontWeight:700},children:"R4"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsx("div",{className:"oq-provider-title",children:["R4Coder", jsx_runtime.jsx("span",{className:"oq-badge warn",children:"已禁用"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children:"在设置中启用 R4Coder"}),
              ]}),
            ]});
            if(!dr){
              if(loading[0]) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.9},children:[
                jsx_runtime.jsx("span",{className:"oq-spin"}),
                jsx_runtime.jsx("span",{style:{marginLeft:8,fontSize:"12px",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:"加载中…"}),
              ]});
              return jsx_runtime.jsx("div",{className:"oq-provider",style:{opacity:0.85,borderStyle:"dashed"},children:[
                jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.18)",color:"#f59e0b",fontSize:"10px",fontWeight:700},children:"R4"}),
                jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                  jsx_runtime.jsx("div",{className:"oq-provider-title",children:["R4Coder", jsx_runtime.jsx("span",{className:"oq-badge warn",children:"未配置"})]}),
                  jsx_runtime.jsx("div",{className:"oq-provider-sub",children:"在设置中填入 Base URL 与 API Key"}),
                ]}),
              ]});
            }
            if(dr.ok===false) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.06)"},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.18)",color:"#ef4444",fontSize:"11px",fontWeight:700},children:"R4"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsxs("div",{className:"oq-provider-title",children:["R4Coder", jsx_runtime.jsx("span",{className:"oq-badge err",children:"异常"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children: dr.error? String(dr.error).slice(0,80): "加载失败"}),
              ]}),
            ]});
            if(dr.isValid===false) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.9},children:[
              jsx_runtime.jsx("div",{className:"oq-provider-icon",style:{background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.18)",color:"#f59e0b",fontSize:"10px",fontWeight:700},children:"R4"}),
              jsx_runtime.jsxs("div",{className:"oq-provider-meta",children:[
                jsx_runtime.jsx("div",{className:"oq-provider-title",children:["R4Coder", jsx_runtime.jsx("span",{className:"oq-badge warn",children:"无额度"})]}),
                jsx_runtime.jsx("div",{className:"oq-provider-sub",children: dr.invalidMessage || "No active package or wallet balance"}),
              ]}),
            ]});
            var pctR=dr.percent; var isWarnR=pctR!=null&&pctR>=80; var isMidR=pctR!=null&&pctR>=60;
            var barColorR=isWarnR?"#ef4444":"#f59e0b";
            var remStr=dr.remaining!=null? fmtMoney(dr.remaining,"USD") : "—";
            var usedLimitStr=(dr.used!=null&&dr.limit!=null)? (fmtMoney(dr.used,"USD")+"/"+fmtMoney(dr.limit,"USD")) : "";
            var r4Layout=loadR4Layout();
            // 像素风进度条：分段方块。空格用深底+灰描边、实格用实色+暗描边，
            // 深/浅主题（含纯白底）下轮廓都可见。
            function pixelBar(pct, color){
              var segs=18;
              var filled=pct==null?0:Math.max(0,Math.min(segs,Math.round(pct/100*segs)));
              var cells=[];
              for(var i=0;i<segs;i++){
                var on=i<filled;
                cells.push(jsx_runtime.jsx("i",{
                  style:{
                    flex:"1 1 0",height:"8px",borderRadius:"1px",
                    background:on?color:"rgba(127,127,127,0.22)",
                    border:"1px solid "+(on?"rgba(0,0,0,0.28)":"rgba(127,127,127,0.45)"),
                    boxSizing:"border-box"
                  }
                }, "r4p"+i));
              }
              return jsx_runtime.jsx("div",{style:{display:"flex",gap:"2px",width:"100%",alignItems:"stretch",minWidth:0},children:cells});
            }
            if(r4Layout==="ring"){
              // 左环占满高度 + 右侧两行（上：套餐+余额，下：used/total）。
              // 不套内层卡片；used/total 用 secondary 提高浅色底可读性。
              var ringColor=barColorR;
              var ringPx=36;
              var ringR=12;
              return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"row",alignItems:"center",gap:10,width:"100%",padding:"0",boxSizing:"border-box",minWidth:0,overflow:"hidden"},children:[
                jsx_runtime.jsxs("div",{style:{flex:"none",alignSelf:"center",width:ringPx,height:ringPx,borderRadius:10,background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.22)",position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",overflow:"hidden"},children:[
                  jsx_runtime.jsx("svg",{width:ringPx,height:ringPx,viewBox:"0 0 36 36",style:{transform:"rotate(-90deg)"},children: jsx_runtime.jsxs("g",{children:[
                    jsx_runtime.jsx("circle",{cx:18,cy:18,r:ringR,fill:"none",stroke:"rgba(127,127,127,0.28)",strokeWidth:3}),
                    pctR!=null && jsx_runtime.jsx("circle",{cx:18,cy:18,r:ringR,fill:"none",stroke:ringColor,strokeWidth:3,strokeLinecap:"butt",strokeDasharray:(2*Math.PI*ringR).toFixed(1),strokeDashoffset:((2*Math.PI*ringR)*(1-pctR/100)).toFixed(1)}),
                  ]})}),
                  jsx_runtime.jsx("span",{style:{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",fontWeight:750,color:"var(--dsw-alias-label-primary,#fff)"},children: pctR!=null? pctR+"%":"R4"}),
                ]}),
                jsx_runtime.jsxs("div",{style:{flex:1,minWidth:0,display:"flex",flexDirection:"column",justifyContent:"center",gap:4},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,minWidth:0},children:[
                    jsx_runtime.jsx("span",{className:"oq-badge"+(dr.plan==="Wallet"?" warn":" live"),style:{flex:"none"},children: dr.plan||"Package"}),
                    jsx_runtime.jsx("span",{style:{fontSize:"14px",fontWeight:750,color: isWarnR?"#ef4444": (isMidR?"#d97706":"var(--dsw-alias-label-primary,#fff)"),whiteSpace:"nowrap",letterSpacing:"-0.2px"},children: remStr}),
                  ]}),
                  jsx_runtime.jsx("div",{style:{fontSize:"12px",fontWeight:650,color:"var(--dsw-alias-label-primary,#fff)",opacity:0.78,fontFamily:"'Cascadia Code', Consolas, monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},children: usedLimitStr? (usedLimitStr+" USD") : (dr.extra||"")}),
                ]}),
              ]});
            }
            // 横条：无 R4Coder 文案、无底部 unit 说明、无内层卡片。
            // 顶行：R4 图标 + 套餐徽章 + 剩余金额；中行：used / 像素条 / total。
            var metaColor="var(--dsw-alias-label-secondary,#c8c8d0)";
            return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",alignItems:"stretch",gap:5,width:"100%",padding:"0",boxSizing:"border-box",minWidth:0,overflow:"hidden"},children:[
              jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",gap:8,minWidth:0},children:[
                jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:6,minWidth:0,flex:"1 1 auto",overflow:"hidden"},children:[
                  jsx_runtime.jsx("span",{style:{width:20,height:20,borderRadius:6,background:"linear-gradient(135deg,#f59e0b 0%,#f97316 100%)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"9px",fontWeight:800,flex:"none"},children:"R4"}),
                  jsx_runtime.jsx("span",{className:"oq-badge"+(dr.plan==="Wallet"?" warn":" live"),children: dr.plan||"Package"}),
                ]}),
                jsx_runtime.jsx("span",{style:{fontSize:"14px",fontWeight:750,color: isWarnR?"#ef4444": (isMidR?"#d97706":"var(--dsw-alias-label-primary,#fff)"),whiteSpace:"nowrap",flex:"none",letterSpacing:"-0.2px"},children: remStr}),
              ]}),
              pctR!=null ? jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:7,width:"100%",minWidth:0},children:[
                jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:650,color:"var(--dsw-alias-label-primary,#fff)",opacity:0.78,flex:"none",fontFamily:"'Cascadia Code', Consolas, monospace",minWidth:"36px"},children: dr.used!=null? fmtMoney(dr.used,"USD") : ""}),
                jsx_runtime.jsx("div",{style:{flex:1,minWidth:0},children: pixelBar(pctR, barColorR)}),
                jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:650,color:"var(--dsw-alias-label-primary,#fff)",opacity:0.78,flex:"none",fontFamily:"'Cascadia Code', Consolas, monospace",minWidth:"40px",textAlign:"right"},children: dr.limit!=null? fmtMoney(dr.limit,"USD") : ""}),
              ]}) : (dr.extra? jsx_runtime.jsx("div",{style:{fontSize:"11px",fontWeight:650,color:"var(--dsw-alias-label-primary,#fff)",opacity:0.78,textAlign:"right"},children: dr.extra}) : null),
            ]});
          }
          if(s.key==="tokenMeter"){
            var d3=s.data;
            if(!d3){
              if(loading[0]) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{opacity:0.9},children:[
                jsx_runtime.jsx("span",{className:"oq-spin"}),
                jsx_runtime.jsx("span",{style:{marginLeft:8,fontSize:"11px",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:"加载中…"}),
              ]});
              return jsx_runtime.jsx("div",{className:"oq-provider",children: jsx_runtime.jsx("div",{className:"oq-tm-empty",children:"暂无数据 · 发起对话后自动统计"})});
            }
            if(d3.ok===false) return jsx_runtime.jsxs("div",{className:"oq-provider",style:{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.06)"},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"#ef4444"},children: d3.error || "加载失败"}),
            ]});
            var stats = d3.stats || null;
            // totals 只认新口径 stats.totals：host 半端恒发 stats，旧四桶兼容层已删
            var totalsRaw = (stats && stats.totals) ? stats.totals
              : { total:0, prompt:0, completion:0, cache_read:0, cache_write:0, requests:0, turns:null, steps:null, tools:null };
            // 标准化 models：unknown → 其他（避免 donut 单独扇区与截断）
            if(stats && Array.isArray(stats.models)){
              for(var _mi=0; _mi<stats.models.length; _mi++){ var _m=stats.models[_mi]; if(!_m.model || _m.model==="unknown" || _m.model==="unk") _m.model="其他"; }
            }
            var layout=loadTmLayout();
            return layout==="classic" ? renderTmClassic(d3, stats, totalsRaw) : renderTmCompact(d3, stats, totalsRaw);
          }
          return jsx_runtime.jsx("div",{className:"oq-provider",children: jsx_runtime.jsx("div",{className:"oq-provider-sub",children:"未配置"})});
        }

        function handleContextMenu(e){
          try{ e.preventDefault(); e.stopPropagation(); }catch(err){}
          var cx=e.clientX, cy=e.clientY;
          var GAP=8;
          // 更精确的菜单高度估算：item 约 32px（含 padding 7+7 + 行高）+ 分隔线 9px + 容器 padding 8px
          // slides 个 provider 项 + 1 个刷新项 + 1 条分隔线
          var ITEM_H=32, SEP_H=9, PAD_H=8;
          var estH = slides.length * ITEM_H + SEP_H + ITEM_H + PAD_H;
          var mw=160, mh=estH;
          // 若 DSH 容器存在 transform 导致 fixed 相对容器，则 via bounding rect 校正偏移
          // 但先按视口坐标计算，后续 rAF 实测高度二次校正
          var vw=window.innerWidth, vh=window.innerHeight;
          var x=cx, y=cy;
          // 水平：优先贴鼠标左侧/右侧，溢出则钳制
          if(x + mw > vw - GAP) x = vw - mw - GAP;
          if(x < GAP) x = GAP;
          // 垂直：视口感知的 flip 策略
          var spaceBelow = vh - cy - GAP;
          var spaceAbove = cy - GAP;
          if(mh <= spaceBelow){
            y = cy;
            if(y + mh > vh - GAP) y = vh - mh - GAP;
          } else if(mh <= spaceAbove){
            y = cy - mh - 4;
            if(y < GAP) y = GAP;
          } else {
            // 上下皆不足：选更大的一侧并依赖 max-height 滚动兜底
            if(spaceBelow >= spaceAbove){
              y = Math.max(GAP, vh - mh - GAP);
            } else {
              y = GAP;
            }
            // mh 超出视口则由 CSS max-height 限制，y 已钳制到 GAP
          }
          if(y + mh > vh - GAP) y = Math.max(GAP, vh - mh - GAP);
          if(y < GAP) y = GAP;
          if(x + mw > vw - GAP) x = vw - mw - GAP; // 二次水平钳制
          menuPos[1]({x:Math.round(x),y:Math.round(y)});
          // rAF 二次校正：先渲染后测真实高度，再做 flip/钳制
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              try{
                var m=document.querySelector(".oq-menu");
                if(!m) return;
                var r=m.getBoundingClientRect();
                var actualH=r.height;
                if(!actualH || actualH<=0) return;
                var vw2=window.innerWidth, vh2=window.innerHeight;
                var nx=x, ny=y;
                var changed=false;
                if(r.right > vw2 - GAP){ nx = vw2 - r.width - GAP; changed=true; }
                if(r.left < GAP){ nx = GAP; changed=true; }
                if(r.bottom > vh2 - GAP){
                  var flippedY = cy - actualH - 4;
                  if(flippedY >= GAP && (cy - GAP) >= actualH*0.4){
                    ny = flippedY;
                  } else {
                    ny = vh2 - actualH - GAP;
                  }
                  changed=true;
                }
                if(r.top < GAP){ ny = GAP; changed=true; }
                if(changed){
                  if(nx < GAP) nx = GAP;
                  if(ny < GAP) ny = GAP;
                  if(nx + r.width > vw2 - GAP) nx = vw2 - r.width - GAP;
                  if(ny + actualH > vh2 - GAP) ny = vh2 - actualH - GAP;
                  menuPos[1]({x:Math.round(nx), y:Math.round(ny)});
                }
              }catch(e){}
            });
          });
        }
        // ── 贴边收起态的派生值 ──
        // collapsed：真的处于"收起"（把手条）状态；open：因悬停或点击锁定而暂时展开。
        // 注意 collapsed 与 open 同时为真时，CSS 的 .oq-edge-open 会覆盖 transform，
        // 视觉上是"展开的完整卡片"，但收起语义仍保留（移开鼠标后会回到把手条）。
        var edgeActive = edgeOn[0] && !!edgeState[0];
        var collapsed = edgeActive && !edgeOpen[0] && !edgeLocked[0];
        var cardCls = edgeCardClass("oq-card m-"+material[0], {
          on: edgeOn[0], state: edgeState[0], open: edgeOpen[0], locked: edgeLocked[0],
        });
        // ── 悬停展开的触发区 ─────────────────────────────────────────────────
        // 旧实现把 onMouseEnter 绑在 .oq-card 上，而卡片宽 260px。收起时卡片虽然整体
        // 移出视口（translateX ±100%），**它仍然占据视口内 260px 的命中区域**——
        // 只是不可见。于是鼠标扫过整个面板宽度都会展开（用户反馈"触发范围太大"）。
        //
        // 现在分两态：
        //   · 收起态：hover 只挂在**把手（胶囊）**上，命中区就是那 22px 热区
        //   · 展开态：hover 挂在卡身上，移出卡片才收回
        // 两者共用同一套 in/out 逻辑，避免出现"展开后立刻被把手判成 leave"的抖动。
        function edgeHoverIn(e){
          if(!edgeOnRef.current || !edgeStateRef.current) return;
          // 刚吸入的那一帧，鼠标物理位置可能仍落在卡片（即将推出的）区域上，
          // 于是 mouseenter 会立刻把 edgeOpen 置 true → 卡片弹回展开态，
          // 看上去就是"收不进去"。吸入后 500ms 内忽略悬停展开（约等于动画时长+余量）。
          if(Date.now() - (edgeCollapseAtRef.current || 0) < 500) return;
          if(edgeHoverTimer.current){ clearTimeout(edgeHoverTimer.current); edgeHoverTimer.current=null; }
          edgeOpen[1](true);
        }
        function edgeHoverOut(e){
          if(!edgeOnRef.current || !edgeStateRef.current) return;
          if(edgeLocked[0]) return;      // 锁定态不自动收回（触屏/连续操作场景）
          if(edgeHoverTimer.current) clearTimeout(edgeHoverTimer.current);
          edgeHoverTimer.current=setTimeout(function(){
            edgeHoverTimer.current=null;
            if(!edgeLocked[0]) edgeOpen[1](false);
          }, EDGE_HOVER_OUT_MS);
        }
        // 收起态：卡身不参与 hover（否则整个 260px 都会触发）。
        // 注意不能简单传 undefined——React 里留着旧的监听会让命中区缩不回去。
        var cardEvents = collapsed
          ? {}
          : { onMouseEnter: edgeHoverIn, onMouseLeave: edgeHoverOut };
        // overlay 也必须按收起态收紧：它是 260px 的命中盒，卡片收起后 overlay 仍在原位
        // （父级不随卡片 translateX），只关卡片的 pointer-events 根本没用。
        var overlayCls="oq-overlay m-"+material[0]+(collapsed?" oq-overlay--collapsed":"");
        return jsx_runtime.jsxs("div",{className:overlayCls,style: hidden?{display:"none"}:undefined, onContextMenuCapture:handleContextMenu, children: [
          jsx_runtime.jsxs("div",{ref:cardRef,className:cardCls,style:{position:"fixed",boxSizing:"border-box"},onMouseEnter:cardEvents.onMouseEnter,onMouseLeave:cardEvents.onMouseLeave,children:[
            jsx_runtime.jsxs("div",{className:"oq-body",children:[
              jsx_runtime.jsx("div",{className:"oq-carousel",onTouchStart:onTouchStart,onTouchEnd:onTouchEnd,children:
                jsx_runtime.jsx("div",{className:"oq-track",style:{transform:"translateX(-"+(curIdx*100)+"%)",display:"flex",transition:"transform 0.32s cubic-bezier(0.22,1,0.36,1)",willChange:"transform"},children: slides.map(function(s, idx){
                  return jsx_runtime.jsx("div",{className:"oq-slide",style:{flex:"0 0 100%"},children: renderSlide(s)}, s.key);
                })}),
              }),
            ]}),
            // 把手条：收起态必须渲染（否则没法点开）；展开态也保留，但由 CSS 的
            // `.oq-edge-open .oq-edge-handle{opacity:0;pointer-events:none}` 隐藏，
            // 这样"点击把手锁定展开"这条路径不会因为把手消失而中断（再点收回靠键盘/移开鼠标）。
            (edgeActive ? jsx_runtime.jsx("button",{
              type:"button",
              className:"oq-edge-handle"+(edgeSnap[0]?" oq-edge-snap":""),
              "data-side": edgeState[0].edge,
              title: edgeLocked[0] ? "收回把手条" : "固定展开（再点收回）",
              onMouseDown:function(e){ try{ e.stopPropagation(); }catch(err){} },
              // 收起态的"悬停展开"挂在这里：命中区 = 把手的 22px 热区，不是整个面板宽度。
              // 展开后 CSS 给把手 opacity:0 + pointer-events:none，这里自然不再触发；
              // 收回交给卡身的 onMouseLeave。
              onMouseEnter: edgeHoverIn,
              onMouseLeave: edgeHoverOut,
              onClick:function(e){
                try{ e.stopPropagation(); }catch(err){}
                if(edgeLocked[0]){ edgeLocked[1](false); edgeOpen[1](false); }
                else { edgeLocked[1](true); edgeOpen[1](true); }
              },
              children: null,
            }) : null),
          ]}),
          menuPos[0] && jsx_runtime.jsx("div",{className:"oq-menu",style:{left:menuPos[0].x+"px",top:menuPos[0].y+"px"},children: slides.map(function(s,idx){
            var active=idx===curIdx;
            var dotColor=s.key==="opencode"?"#6d5bff": s.key==="deepseek"?"#0ea5e9": s.key==="r4coder"?"#f59e0b":"#10b981";
            return jsx_runtime.jsxs("div",{className:"oq-menu-item"+(active?" active":""),onClick:function(e){ try{e.stopPropagation();}catch(err){} goIdx(idx); menuPos[1](null); },children:[
              jsx_runtime.jsx("span",{className:"oq-menu-dot",style:{background:dotColor}}),
              jsx_runtime.jsx("span",{style:{flex:1},children:s.label}),
              active && jsx_runtime.jsx("span",{className:"oq-menu-check",children:"✓"}),
            ]}, s.key);
          }).concat([
            jsx_runtime.jsx("div",{className:"oq-menu-sep",key:"sep"}),
            jsx_runtime.jsx("div",{className:"oq-menu-item",key:"refresh",onClick:function(){ menuPos[1](null); reload(false, true); },children:[
              jsx_runtime.jsx("span",{children:"↻"}),
              jsx_runtime.jsx("span",{children:"刷新"}),
            ]}),
          ]) }),
        ]});
      }

      function SettingsPanel(){
        var cfg=react.useState(loadConfig());
        var testLoading=react.useState(false);
        var testRes=react.useState({});
        var rawResp=react.useState(null);
        var meterData=react.useState(null);
        var meterLoading=react.useState(false);
        var meterError=react.useState("");
        var meterUpdAt=react.useState(null);
        // 范围与悬浮窗共用同一份偏好（LS_RANGE）；此前设置页另存 oq_settings_range，
        // 导致"设置页看 30 天、悬浮窗看今天"这种自相矛盾的状态长期存在。
        var meterRangeState=react.useState(loadRange());
        var tabState=react.useState(loadSettingsTab());
        var tmLayoutState=react.useState(loadTmLayout());
        var r4LayoutState=react.useState(loadR4Layout());
        // 悬浮面板材质（只存 localStorage，见 loadPanelMaterial）
        var panelMaterialState=react.useState(loadPanelMaterial());
        var tmChartState=react.useState(loadSettingsChart());
        // 小窗口 TokenMeter 页的图表形态（与上面的设置页图表是两个独立偏好）
        var tmWidgetChartState=react.useState(loadTmChart());
        // ── 清空用量账本（独立卡片）──
        // scope: all | before | project；cutDays 只在 scope=before 时有意义
        var clearScopeState=react.useState("all");
        var clearDaysState=react.useState(30);
        var clearProjectState=react.useState("");
        var clearPreviewState=react.useState(null);   // {events,target,remaining,projects,…}
        var clearPreviewBusy=react.useState(false);
        var clearBackupState=react.useState(true);    // 默认先备份（不可逆操作的唯一退路）
        var clearTypedState=react.useState("");       // 需输入「清空」二字才解锁
        var clearBusyState=react.useState(false);
        var backupsState=react.useState(null);        // {dir,items} | null
        var backupsBusy=react.useState(false);
        // 补齐历史维度（project/tool/provider/ms）：旧版本漏读 header.cwd 留下的脏数据
        var enrichBusy=react.useState(false);
        var enrichResult=react.useState(null);        // {applied,projectNull,ms} | null
        // 补录缺失会话（会新增行、改变总量 → 必须先预览再确认）
        var importPreview=react.useState(null);      // {sessions,totalTokens,projectedTotal,items,…}
        var importPreviewBusy=react.useState(false);
        var importBusy=react.useState(false);
        var importResult=react.useState(null);
        var importShowList=react.useState(false);
        var importTyped=react.useState("");
        // 维护列表展开态：同一时间只展开一个功能（手风琴），避免一屏堆多个详情区
        var maintOpen=react.useState("");
        // 维护操作结果（成功横幅，独立于 toast 行）
        var clearResult=react.useState(null);   // {cleared,remaining,backup,vacuum}
        var enrichResultS=react.useState(null); // {updated,resolved,projectNull,ms}
        // 模型排行排序 / 工具排行排序 / 图表模型筛选 / 相对时间节拍
        var tmSortState=react.useState("total");
        var tmToolSort=react.useState("calls");
        var tmModelFilter=react.useState("");
        var nowTick=react.useState(Date.now());
        // 热力图的月份偏移（0 = 本月，-1/-2 = 上一个月/上上个月；保留窗口只有 90 天）
        var tmHeatMonth=react.useState(0);
        // 点击热力格选中的那一天（下钻明细）
        var tmDayFocus=react.useState("");
        // ── 自定义区间 + 逐日明细表 ──
        // customRange：{from,to}（YYYY-MM-DD），只在本地区间为 custom 时参与请求。
        // detailOpen：明细表展开态（默认收起，避免每次打开面板都多一屏表格）。
        // detailSort：明细表排序键（date/total/requests/fresh/cacheRead/output/avgMs）。
        // dayDetail：单日下钻数据（{date,...} | null），行点击与热力图共用。
        var customRange=react.useState(loadCustomRange());
        // 默认展开：收起态太隐蔽（用户实测反馈"我没看到逐日明细"），而且它就是这张卡的
        // 主要新能力。表格本身很轻（一天一行），展开不影响首屏观感。
        var detailOpen=react.useState(true);
        var detailSort=react.useState("date");
        var dayDetail=react.useState(null);
        var dayDetailBusy=react.useState(false);
        var dayDetailErr=react.useState("");
        // 排行卡的分段（模型/会话/工具/项目/渠道）：一屏只显示一个，避免 5 张卡纵向堆叠
        var tmRankTab=react.useState((function(){ try{ var v=localStorage.getItem("oq_rank_tab"); if(["models","sessions","tools","projects","providers"].indexOf(v)>=0) return v; }catch(e){} return "models"; })());
        // 五模块的显示风格（A/B/C，见 loadUsageStyle）；柱状图选中的某天用于"聚焦"
        var tmUsageStyle=react.useState(loadUsageStyle());
        var tmBarFocus=react.useState("");
        // 近 N 次刷新的速率采样（实时 B 的 sparkline 数据源，刷新时追加）
        var tmRateHist=react.useRef([]);
        // 已应用的 version：轮询时数据没变就不 setState（沿用悬浮窗那套判据）
        var meterVerRef=react.useRef(null);
        // 同上：网关开关也要进判据（切开关不改 version，只比 version 会"点了没反应"）
        var meterGwRef=react.useRef(gatewayEnabled());
        // 「网关」tab 的数据（只在切到该 tab 时拉，不参与 15s/5s 常驻轮询）
        // 这是**管理页**，不是常驻看板：用户不在这一页时不该产生任何读取。
        var gwData=react.useState(null);
        var gwLoading=react.useState(false);
        var gwErr=react.useState("");
        // 这一页自己的区间（1d/7d/30d），与全局 meterRange 解耦：
        // 它只回答"监测到什么"，跟着全局区间跑会让人以为"切了 30 天这里却没变"。
        var gwRange=react.useState("1d");
        var toasts=react.useState({});
        var confirmKey=react.useState("");
        var confirmTimerRef=react.useRef(null);
        // 方案A·折叠摘要：单开手风琴 + 凭据明文切换 + 原始响应按需展开
        var expandedSrc=react.useState("");
        var showPw=react.useState(false);
        var rawOpen=react.useState(false);
        var ACCENT="var(--dsw-alias-state-business-primary,#6d5bff)";

        function showToast(key,ok,text){
          toasts[1](function(prev){var n=Object.assign({},prev);n[key]={ok:ok,text:text};return n;});
          setTimeout(function(){toasts[1](function(prev){var n=Object.assign({},prev);delete n[key];return n;});},3000);
        }
        // opencode 401/403 也会进 host 端指数退避（最长 30min）；token/baseUrl
        // 变更或手动测试时显式重置，避免更正后仍被 429 缓存失败顶住
        function resetOpencodeBackoff(){ try{ fetch("/api/opencode/backoff-reset",{method:"POST"}).catch(function(){}); }catch(e){} }
        // 打字期间的写入节流：文本框每个字符都会调用 update()，而 update() 末尾要广播
        // opencode:config-changed → 悬浮窗 onCfg → reload() → 三个上游额度接口。
        // 实测粘贴 40 位 key 会打出 40 轮 × 3 个请求。这里把"广播 + 重置退避"推迟到
        // 输入停顿 QUIET_COMMIT_MS 之后（或失焦时立刻 flush），本地状态与 localStorage
        // 仍然即时更新（不丢字符、刷新也不丢配置），只有副作用被合并。
        var QUIET_COMMIT_MS=600;
        var quietTimer=null;
        function commitConfigNow(){
          if(quietTimer){ clearTimeout(quietTimer); quietTimer=null; }
          try{window.dispatchEvent(new Event("opencode:config-changed"));}catch(e){}
        }
        function scheduleConfigCommit(){
          if(quietTimer) clearTimeout(quietTimer);
          quietTimer=setTimeout(function(){ quietTimer=null; try{window.dispatchEvent(new Event("opencode:config-changed"));}catch(e){} }, QUIET_COMMIT_MS);
        }
        function update(patch, opts){
          var quiet = !!(opts && opts.quiet);
          var next=Object.assign({},cfg[0],patch);
          if(patch.providers){ next.providers=Object.assign({},cfg[0].providers, patch.providers); for(var k in patch.providers) next.providers[k]=Object.assign({}, cfg[0].providers[k], patch.providers[k]); }
          // sources 必须同样深合并：shallow Object.assign 会让
          // update({sources:{gateway:{enabled:false}}}) 整块覆盖掉将来的其它 source 配置。
          if(patch.sources){ next.sources=Object.assign({},cfg[0].sources, patch.sources); for(var sk in patch.sources) next.sources[sk]=Object.assign({}, (cfg[0].sources||{})[sk], patch.sources[sk]); }
          if(patch.providers && patch.providers.opencode && !quiet) resetOpencodeBackoff();
          cfg[1](next); saveConfig(next);
          if(quiet) scheduleConfigCommit(); else commitConfigNow();
        }
        function updateProvider(key, patch, opts){ var np={}; np[key]=patch; update({providers:np}, opts); }
        function updateSource(key, patch, opts){ var ns={}; ns[key]=patch; update({sources:ns}, opts); }

        // 测试结果 → 就近业务摘要（替代原全局 msg + JSON dump 主展示）
        function applyTestOut(out){
          var next={};
          if(out.opencode){ var o=out.opencode;
            var pct=o.buckets&&o.buckets.monthly&&o.buckets.monthly.percent!=null?o.buckets.monthly.percent:(o.percent!=null?o.percent:null);
            next.opencode=o.ok?{ok:true,text:"命中 "+(o.hitUrl||"")+(pct!=null?" · 月用量 "+pct+"%":"")}:{ok:false,text:o.error||"测试失败"};
          }
          if(out.deepseek){ var d=out.deepseek;
            next.deepseek=d.ok?{ok:true,text:"本月消耗 CNY "+fmtMoney(d.cny&&d.cny.total,"CNY")}:{ok:false,text:(d&&d.error)||"测试失败"};
          }
          if(out.r4coder){ var r4=out.r4coder;
            next.r4coder=r4.ok?(r4.isValid===false?{ok:false,text:r4.invalidMessage||"无有效套餐或钱包余额"}:{ok:true,text:(r4.plan||"Package")+" · 剩 "+fmtMoney(r4.remaining,"USD")+(r4.extra?" · "+r4.extra:"")}):{ok:false,text:(r4&&r4.error)||"测试失败"};
          }
          testRes[1](function(prev){return Object.assign({},prev,next);});
        }
        function doTest(provider){
          if(!provider || provider==="opencode") resetOpencodeBackoff();
          testLoading[1](true);
          var c=cfg[0]; var ps=[];
          if(!provider || provider==="opencode") ps.push(fetchOpencode(c).then(function(j){return {k:"opencode",v:j};}));
          if(!provider || provider==="deepseek") ps.push(fetchDeepSeek(c).then(function(j){return {k:"deepseek",v:j};}));
          if(!provider || provider==="r4coder") ps.push(fetchR4Coder(c).then(function(j){return {k:"r4coder",v:j};}));
          Promise.all(ps).then(function(arr){
            testLoading[1](false);
            var out={}; arr.forEach(function(x){out[x.k]=x.v;});
            applyTestOut(out); rawResp[1](out);
          }).catch(function(e){testLoading[1](false);showToast("test",false,String(e.message||e));});
        }
        // 热力图要支持"回看上一个自然月"，所以取 90 天（= 保留窗口），
        // 月份切换只是在同一份数据里换月，不再触发请求。
        function effMeterRange(ov){
          ov=ov||{};
          var cht=ov.chart!=null?ov.chart:tmChartState[0];
          var cur=ov.range||meterRangeState[0]||"1d";
          // ⚠️ custom 优先级最高，且**不受图表形态影响**：
          // 用户显式指定了起止日期，就说明他要看这一段——明细表、排行、总览、图表
          // 必须全部按这个窗口算，否则会出现"控件选了 10-01~10-07、明细表却是 90 天"
          // 这种自相矛盾（旧实现 heat/hour 分支无条件压成 90d，把 custom 吞掉了）。
          // 代价是热力/时段图在 custom 下只显示区间内的天（区间外的格子为空），这是
          // 预期语义：既然选了 7 天，就不该偷偷塞 90 天的数据进图里。
          if(cur==="custom") return "custom";
          // 其余固定档在热力/时段下沿用既有行为：这两个形态需要长窗口
          // （热力图要能回看 3 个月、时段分布要足够样本），固定取近 90 天。
          if(cht==="heat") return "90d";
          if(cht==="hour") return (cur==="1d"||cur==="7d")?"90d":cur;
          return cur;
        }
        // 网关账本读取（设置页「网关」tab 专用）。只在切到该 tab / 手动刷新时调用，
        // **不**并入 15s/5s 常驻轮询：这是管理页，不是看板。
        function refreshGateway(ov){
          ov=ov||{};
          gwLoading[1](true); gwErr[1]("");
          return fetchGateway({force:!!ov.force}).then(function(j){
            gwLoading[1](false);
            if(j && j.ok){ gwData[1](j); }
            else { gwData[1](null); gwErr[1]((j&&j.error)||"加载失败"); }
          }).catch(function(e){ gwLoading[1](false); gwErr[1](String(e.message||e)); });
        }
        // 单日下钻：明细表行点击与热力图点某天共用同一条链路
        function loadDayDetail(day){
          if(!day){ dayDetail[1](null); return; }
          dayDetailBusy[1](true); dayDetailErr[1]("");
          fetch("/api/token-meter/day?date="+encodeURIComponent(day), tmFetchInit())
            .then(function(r){ return r.json(); })
            .then(function(j){
              dayDetailBusy[1](false);
              if(j && j.ok) dayDetail[1](j);
              else { dayDetail[1](null); dayDetailErr[1](j? j.error||"加载失败":"加载失败"); }
            })
            .catch(function(e){ dayDetailBusy[1](false); dayDetail[1](null); dayDetailErr[1](String(e.message||e)); });
        }
        // silent：轮询用（不闪 loading）；skipIfSame：version 没变就不 setState
        function refreshMeter(ov){
          ov=ov||{};
          var rg=effMeterRange(ov);
          var cr=customRange[0]||loadCustomRange();
          if(!ov.silent){ meterLoading[1](true); }
          meterError[1]("");
          // 设置页是显式拉取（手动刷新/切区间/切图/轮询），不参与悬浮窗的在飞守卫，但同样带超时
          return fetch("/api/token-meter?"+rangeQuery(rg, cr)+"&gw="+gwQueryParam(),tmFetchInit()).then(function(r){ return r.json(); }).then(function(j){
            meterLoading[1](false);
            if(j && j.ok){
              // custom 时 host 会回传裁剪后的实际窗口：把它写回控件，用户才知道真正查的是哪一段
              if(rg==="custom" && j.window && j.window.from && j.window.to){
                if(j.window.from!==cr.from || j.window.to!==cr.to){
                  var fixed={from:j.window.from, to:j.window.to};
                  customRange[1](fixed); saveCustomRange(fixed);
                }
              }
              // 网关开关也要进判据：切开关不改 version，只比 version 会"点了没反应"
              if(ov.skipIfSame && j.version===meterVerRef.current && gatewayEnabled()===meterGwRef.current){
                meterUpdAt[1](Number(j.updatedAt)||Date.now()); return;
              }
              meterVerRef.current=j.version; meterGwRef.current=gatewayEnabled();
              meterData[1](j);
              // 用服务端时间做"更新于"：此前用客户端 new Date()，无法判断数据到底多新
              meterUpdAt[1](Number(j.updatedAt)||Date.now());
            } else meterError[1](j? j.error||"加载失败": "加载失败");
          }).catch(function(e){ meterLoading[1](false); meterError[1](String(e.message||e)); });
        }
        react.useEffect(function(){ refreshMeter(); },[]);
        // 「网关」tab 首次进入才拉；切走不清数据（再切回来先用缓存渲染、再补一次）。
        // ⚠️ 依赖里只放 tabState[0]：不要在每次渲染都拉，否则这个管理页会变成轮询源。
        react.useEffect(function(){
          if(tabState[0]==="gateway"){
            // 每次进入都重拉一次：宿主侧有 mtime+size 缓存，未变时不 parse，代价可忽略；
            // 而"切走再切回来还是旧数据"会让排障时怀疑自己改的配置没生效。
            refreshGateway({});
          }
        },[tabState[0]]);
        // 面板可见时的低频轮询：此前设置页只在 mount / 切区间 / 切图 / 手动刷新时拉，
        // 打开面板看到的是"打开那一刻"的快照。这里 20s 拉一次，且 version 未变时不 setState。
        react.useEffect(function(){
          var t=setInterval(function(){
            try{ if(document.visibilityState==="hidden") return; }catch(e){}
            refreshMeter({silent:true, skipIfSame:true});
          }, 20000);
          return function(){ clearInterval(t); };
        },[]);
        // 相对时间需要节拍（15s 足够"x 分钟前"的粒度）
        react.useEffect(function(){
          var t=setInterval(function(){ nowTick[1](Date.now()); },15000);
          return function(){ clearInterval(t); };
        },[]);
        // 速率采样：每次拿到新 payload 就把 rate60 追加进环形缓冲（实时 B 的 sparkline）
        react.useEffect(function(){
          var d=meterData[0];
          var v=d&&d.live?Number(d.live.rate60):0;
          if(!isFinite(v)) v=0;
          var arr=tmRateHist.current;
          arr.push(v);
          if(arr.length>20) arr.splice(0, arr.length-20);
        },[meterData[0]&&meterData[0].version]);
        // 图表模式：设置页用自己的 key（见 loadSettingsChart 注释），不覆盖悬浮窗的偏好
        function setMeterChart(k){
          tmChartState[1](k); saveSettingsChart(k);
          if(k!=="heat"){ tmModelFilter[1](""); tmDayFocus[1](""); }
          // 热力图/时段图需要 90 天数据源；切换时强制重新拉取（range 与当前请求不同）
          refreshMeter({chart:k});
        }
        function setRankTab(k){ tmRankTab[1](k); try{ localStorage.setItem("oq_rank_tab",k); }catch(e){} }
        function setMeterRange(k){ meterRangeState[1](k); saveRange(k); refreshMeter({range:k}); }
        // 自定义起止变更：先落到本地 state + localStorage，再发一次带 from/to 的请求。
        // 不做"输入即时请求"——date input 在选年/月的中间态会给出非法值，等 change 事件即可。
        function setCustomRange(next){
          var v={from:String(next.from||""), to:String(next.to||"")};
          customRange[1](v); saveCustomRange(v);
          meterRangeState[1]("custom"); saveRange("custom");
          refreshMeter({range:"custom"});
        }
        // 明细表排序：点表头切换升降序（同一列再点一次反向）
        function toggleDetailSort(k){
          if(detailSort[0]===k){ detailSort[1](k+"-desc"); }
          else detailSort[1](k);
        }
        // ── 清空用量账本 ──
        // 三个动作分开：预览（只读）、执行（要令牌）、快照列表（只读）。
        // 破坏性动作必须先 POST /reset-token 拿一次性 nonce，再带着它调 /reset——
        // host 侧校验后立即作废，堵住"本机任意进程直连 127.0.0.1 就能清库"。
        var CLEAR_TYPE_KEYWORD="清空";
        function clearScopeQuery(){
          var scope=clearScopeState[0];
          var q="scope="+encodeURIComponent(scope);
          if(scope==="before"){
            var days=Math.max(1,Number(clearDaysState[0])||30);
            q+="&cut="+String(Date.now()-days*86400000);
          } else if(scope==="project"){
            q+="&project="+encodeURIComponent(clearProjectState[0]||"");
          }
          return q;
        }
        function loadClearPreview(){
          clearPreviewBusy[1](true);
          fetch("/api/token-meter/reset-preview?"+clearScopeQuery(),{headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(j){
              clearPreviewBusy[1](false);
              if(j && j.ok){
                clearPreviewState[1](j);
                // 项目下拉的默认值：第一次拿到候选就选行数最多的那个
                if(!clearProjectState[0] && j.projects && j.projects.length) clearProjectState[1](j.projects[0].project);
              } else {
                clearPreviewState[1](null);
                showToast("clr",false,(j&&(j.error||j.hint))||"预览失败");
              }
            })
            .catch(function(e){ clearPreviewBusy[1](false); showToast("clr",false,String(e.message||e)); });
        }
        function loadBackups(){
          backupsBusy[1](true);
          fetch("/api/token-meter/backups",{headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(j){ backupsBusy[1](false); if(j&&j.ok) backupsState[1](j); })
            .catch(function(){ backupsBusy[1](false); });
        }
        // 补齐历史维度：把 events 里缺失的 project/tool/provider/ms 从会话文件重新补上。
        // 只做 UPDATE + COALESCE，可安全重跑；走 nonce 是因为它会重读全部会话文件。
        function runEnrich(){
          enrichBusy[1](true);
          enrichResult[1](null);
          fetch("/api/token-meter/reset-token",{method:"POST",headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(t){
              if(!t||!t.ok||!t.token) throw new Error((t&&t.error)||"取令牌失败");
              return fetch("/api/token-meter/enrich",{method:"POST",headers:{accept:"application/json","x-reset-token":t.token}});
            })
            .then(function(r){ return r.json().then(function(j){ return {status:r.status,body:j}; }); })
            .then(function(res){
              enrichBusy[1](false);
              var j=res.body||{};
              if(res.status===200 && j.ok){
                enrichResult[1](j);
                showToast("enrich",true,"已补齐 "+fmtNum(j.updated||0)+" 行"+(j.projectNull>0?"（仍缺 "+fmtNum(j.projectNull)+" 行）":""));
                meterVerRef.current=null;
                refreshMeter({force:true});
              } else {
                showToast("enrich",false,(j&&(j.error||j.hint))||("补齐失败（HTTP "+res.status+"）"));
              }
            })
            .catch(function(e){ enrichBusy[1](false); showToast("enrich",false,String(e.message||e)); });
        }
        function clearUsage(){
          if(String(clearTypedState[0]).trim()!==CLEAR_TYPE_KEYWORD){
            showToast("clr",false,"请先输入「"+CLEAR_TYPE_KEYWORD+"」确认");
            return;
          }
          clearBusyState[1](true);
          fetch("/api/token-meter/reset-token",{method:"POST",headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(t){
              if(!t||!t.ok||!t.token) throw new Error((t&&t.error)||"取令牌失败");
              return fetch("/api/token-meter/reset?"+clearScopeQuery()+(clearBackupState[0]?"":"&backup=0"),{
                method:"POST",
                headers:{accept:"application/json","x-reset-token":t.token},
              });
            })
            .then(function(r){ return r.json().then(function(j){ return {status:r.status,body:j}; }); })
            .then(function(res){
              clearBusyState[1](false);
              var j=res.body||{};
              // 关键：只有 host 明确说 ok 才报成功。旧实现在 DB 不可用时也回 200，
              // 界面弹"已清空（0 行）"，用户以为清了，重启后数据全回来。
              if(res.status===200 && j.ok){
                var parts=["已清空 "+j.cleared+" 行"];
                if(j.remaining!=null) parts.push("剩余 "+j.remaining+" 行");
                if(j.backup && j.backup.ok) parts.push("已备份");
                if(j.vacuum && j.vacuum.ok && j.vacuum.pagesBefore>j.vacuum.pagesAfter) parts.push("已回收磁盘");
                showToast("clr",true,parts.join(" · "));
                clearResult[1]({cleared:j.cleared,remaining:j.remaining,backup:j.backup,vacuum:j.vacuum});
                clearTypedState[1]("");
                tmModelFilter[1]("");
                meterVerRef.current=null;
                loadClearPreview(); loadBackups();
                refreshMeter({force:true});
              } else {
                showToast("clr",false,(j&&(j.error||j.hint))||("清空失败（HTTP "+res.status+"）"));
              }
            })
            .catch(function(e){ clearBusyState[1](false); showToast("clr",false,String(e.message||e)); });
        }
        // 导出当前视图（按日明细 CSV）：列与图表口径一致，便于外部做透视
        function exportCsv(){
          var d0=meterData[0]||{};
          var st=d0.stats||d0;
          var daily=(st&&Array.isArray(st.daily))?st.daily:[];
          if(!daily.length){ showToast("meter",false,"当前区间没有按日数据"); return; }
          var head=["date","total","freshInput","cacheRead","output","requests","turns","steps","tools","topModel"];
          var lines=[head.join(",")];
          daily.forEach(function(d){
            var fresh=Math.max(0,Number(d.prompt||0)-Number(d.cache_read||0));
            var top=(d.models&&d.models[0])?d.models[0].model:"";
            lines.push([d.date,Number(d.total||0),fresh,Number(d.cache_read||0),Number(d.completion||0),Number(d.requests||0),Number(d.turns||0),Number(d.steps||0),Number(d.tools||0),
              '"'+String(top).replace(/"/g,'""')+'"'].join(","));
          });
          var name="dsh-usage-"+String(d0.range||meterRangeState[0])+"-"+localDayStr()+".csv";
          if(downloadText(name, lines.join("\n"))) showToast("meter",true,"已导出 "+name);
          else showToast("meter",false,"导出失败（浏览器阻止了下载）");
        }
        function copySummary(){
          var d0=meterData[0]||{};
          var t=d0.totals||{};
          var rel=d0.reliability||{};
          var txt=["DSH 用量摘要（"+rangeLabelTxt()+"，"+(meterUpdAt[0]?fmtClock(meterUpdAt[0]):"—")+"）",
            "总量 "+fmtNum(t.total)+"（新输入 "+fmtNum(t.freshInput)+" · 缓存读 "+fmtNum(t.cache_read)+" · 输出 "+fmtNum(t.completion)+"）",
            "缓存命中率 "+(t.cacheHitRate!=null?t.cacheHitRate+"%":"—"),
            "请求 "+fmtNum(t.requests)+" · 轮次 "+fmtNum(t.turns)+" · 步数 "+fmtNum(t.steps)+" · 工具 "+fmtNum(t.tools),
            "模型 Top3: "+(d0.models||[]).slice(0,3).map(function(m){return m.model+" "+fmtNum(m.total);}).join(" / "),
            // 分源：摘要里必须写清"总量里有多少来自网关"，否则这份摘要贴给别人看会被误读
            ((function(){
              var g=d0.sources&&d0.sources.gateway;
              if(!g) return "分源: （本 host 未提供）";
              if(g.enabled===false) return "分源: 仅本机（网关监测已关闭）";
              if(!(Number(g.total||0)>0)) return "分源: 全部本机（无网关流量）";
              return "分源: 本机 "+fmtNum(d0.sources.local&&d0.sources.local.total)+" + 网关 "+fmtNum(g.total)+"（UTC+8 日界，网关无项目/会话/小时维度）";
            })()),
            "工具 Top3: "+(d0.tools||[]).slice(0,3).map(function(x){return x.tool+"×"+x.calls;}).join(" / "),
            "项目 Top3: "+(d0.projects||[]).slice(0,3).map(function(p){return p.project+" "+fmtNum(p.total);}).join(" / "),
            "会话 Top3: "+(d0.sessions||[]).slice(0,3).map(function(s){return (s.title||s.project||s.sessionId)+" "+fmtNum(s.total);}).join(" / "),
            "重试 "+Number(rel.retries||0)+" · 压缩 "+Number(rel.compactions||0)+(rel.compactedTokens?"（吃掉 "+fmtNum(rel.compactedTokens)+" tokens）":"")+" · 失败轮次 "+Number(rel.errors||0)+" · 工具失败 "+Number(rel.toolErrors||0),
          ].join("\n");
          var ok=copyText(txt);
          showToast("meter",ok,ok?"已复制摘要":"复制失败（剪贴板被拦截）");
        }

        // P5 危险操作二次确认（同仙豚设置服务操作模式）
        function askConfirm(k){ confirmKey[1](k); if(confirmTimerRef.current)clearTimeout(confirmTimerRef.current); confirmTimerRef.current=setTimeout(function(){confirmKey[1]("");},3000); }
        function cancelConfirm(){ confirmKey[1](""); if(confirmTimerRef.current)clearTimeout(confirmTimerRef.current); }
        function resetConfig(){
          cancelConfirm();
          // sources 也要还原：否则"重置配置"只重置三家凭据，网关开关还留着旧的关闭状态
          var d={intervalSec:120,providers:defaultProviders(),sources:defaultSources()};
          cfg[1](d); saveConfig(d); try{window.dispatchEvent(new Event("opencode:config-changed"));}catch(e){}
          showToast("maint",true,"已恢复默认配置");
        }
        function resetWindowPos(){
          cancelConfirm();
          try{localStorage.removeItem(LS_POS);localStorage.removeItem("opencode_quota_mini");}catch(e){}
          // 广播给 QuotaWidget 重放定位（合成 storage 事件没有 key，widget 按
          // e.key 过滤收不到；位置恢复又是 mount-only，旧实现需刷新才生效）
          window.dispatchEvent(new Event("opencode:pos-reset"));
          showToast("maint",true,"悬浮窗位置已重置");
        }

        var styles={
          section:{display:"flex",flexDirection:"column",gap:"20px"},
          group:{display:"flex",flexDirection:"column",gap:"8px"},
          head:{display:"flex",alignItems:"center",gap:"10px"},
          headTitle:{fontSize:"12px",color:"var(--dsw-alias-label-secondary,#a0a0b0)",fontWeight:700,letterSpacing:"0.08em",margin:0,flexShrink:0},
          headLine:{flex:1,height:1,background:"var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"},
          card:{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))",background:"var(--dsw-alias-bg-layer-1,#23232a)"},
          cardCol:{display:"flex",flexDirection:"column",gap:10,padding:"12px 14px",borderRadius:10,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))",background:"var(--dsw-alias-bg-layer-1,#23232a)",transition:"opacity 0.2s ease"},
          texts:{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:3},
          titleRow:{display:"flex",alignItems:"center",gap:8,minWidth:0},
          cTitle:{fontSize:"13px",fontWeight:600,color:"var(--dsw-alias-label-primary,#fff)",lineHeight:1.4},
          chip:{fontSize:"11px",fontWeight:600,padding:"1px 8px",borderRadius:999,background:"var(--dsw-alias-bg-layer-2,#1e1e26)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",color:"var(--dsw-alias-label-secondary,#a0a0b0)",whiteSpace:"nowrap",flexShrink:0},
          cDesc:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)",lineHeight:1.45},
          ctrl:{display:"flex",alignItems:"center",gap:8,flexShrink:0},
          btn:{padding:"5px 12px",borderRadius:8,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",background:"transparent",color:"var(--dsw-alias-label-primary,#fff)",cursor:"pointer",fontSize:"12px",lineHeight:1.5,whiteSpace:"nowrap",fontFamily:"inherit"},
          btnAccent:{padding:"5px 12px",borderRadius:8,border:"none",background:ACCENT,color:"#fff",cursor:"pointer",fontSize:"12px",lineHeight:1.5,whiteSpace:"nowrap",fontFamily:"inherit"},
          btnDanger:{padding:"5px 12px",borderRadius:8,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",cursor:"pointer",fontSize:"12px",lineHeight:1.5,whiteSpace:"nowrap",fontFamily:"inherit"},
          btnDangerSolid:{padding:"4px 10px",borderRadius:8,border:"none",background:"#ef4444",color:"#fff",cursor:"pointer",fontSize:"11px",lineHeight:1.5,fontFamily:"inherit"},
          iconBtn:{width:26,height:26,display:"inline-flex",alignItems:"center",justifyContent:"center",borderRadius:7,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",background:"transparent",color:"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:"pointer",fontSize:12,padding:0,lineHeight:1,flexShrink:0,fontFamily:"inherit"},
          input:{width:"100%",boxSizing:"border-box",padding:"6px 10px",borderRadius:8,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",background:"var(--dsw-alias-bg-layer-2,#1e1e26)",color:"var(--dsw-alias-label-primary,#fff)",fontSize:"12px"},
          inputSmall:{width:72,padding:"5px 9px",borderRadius:8,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",background:"var(--dsw-alias-bg-layer-2,#1e1e26)",color:"var(--dsw-alias-label-primary,#fff)",fontSize:"12px"},
          fieldLabel:{display:"block",fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)",marginBottom:4},
          spinner:{width:12,height:12,border:"2px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",borderTopColor:ACCENT,borderRadius:"50%",display:"inline-block",animation:"oq-spin 0.8s linear infinite",flexShrink:0},
          statChip:{display:"inline-flex",alignItems:"center",gap:5,fontSize:"11px",padding:"3px 9px",borderRadius:999,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))",background:"var(--dsw-alias-bg-layer-2,#1e1e26)",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},
          hint:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)",lineHeight:1.5},
          rowDivider:{height:1,background:"var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",margin:"2px 0"},
          code:{fontSize:"11px",padding:"6px 8px",borderRadius:8,marginTop:6,background:"var(--dsw-alias-bg-layer-2,#1e1e26)",color:"var(--dsw-alias-label-secondary,#a0a0b0)",wordBreak:"break-all",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",maxHeight:200,overflow:"auto",whiteSpace:"pre-wrap"},
        };

        function groupHead(title,action){
          return jsx_runtime.jsxs("div",{style:styles.head,children:[
            jsx_runtime.jsx("h4",{style:styles.headTitle,children:title}),
            jsx_runtime.jsx("span",{style:styles.headLine}),
            action?jsx_runtime.jsx("div",{style:styles.ctrl,children:action}):null
          ]});
        }
        // 维护列表内的小节标题（修复数据 / 危险区），比 groupHead 更轻
        function sectionLabel(text){
          return jsx_runtime.jsx("div",{style:{fontSize:"10px",fontWeight:700,letterSpacing:"0.12em",color:"var(--dsw-alias-label-caption,#9a9aaa)",textTransform:"uppercase"},children:text});
        }
        function toastRow(key){
          var t=toasts[0][key]; if(!t)return null;
          return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:5,fontSize:"11px",color:t.ok?"var(--dsw-alias-state-success-primary,#34d399)":"#ef4444"},children:[
            jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",flexShrink:0,background:t.ok?"var(--dsw-alias-state-success-primary,#34d399)":"#ef4444"}}),
            t.text
          ]});
        }
        function switchEl(on,onChange){
          return jsx_runtime.jsxs("button",{role:"switch","aria-checked":!!on,onClick:function(){onChange(!on);},style:{position:"relative",width:38,height:21,borderRadius:999,border:"none",cursor:"pointer",padding:0,flexShrink:0,transition:"background 0.2s ease, box-shadow 0.2s ease",background:on?ACCENT:"var(--dsw-alias-bg-layer-2,#1e1e26)",boxShadow:on?"none":"inset 0 0 0 1px var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"},children:[
            jsx_runtime.jsx("span",{style:{position:"absolute",top:2,left:on?19:2,width:17,height:17,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 3px rgba(0,0,0,0.3)",transition:"left 0.2s cubic-bezier(0.4,0,0.2,1)"}})
          ]});
        }
        function card(opts){
          var texts=[];
          if(opts.title)texts.push(jsx_runtime.jsx("div",{style:styles.titleRow,children:jsx_runtime.jsx("span",{style:styles.cTitle,children:opts.title})}));
          if(opts.desc)texts.push(opts.desc);
          if(opts.toastKey){var t=toastRow(opts.toastKey);if(t)texts.push(t);}
          var kids=[jsx_runtime.jsx("div",{style:styles.texts,children:texts})];
          if(opts.control)kids.push(jsx_runtime.jsx("div",{style:styles.ctrl,children:opts.control}));
          return jsx_runtime.jsxs("div",{style:opts.col?styles.cardCol:styles.card,children:kids});
        }
        function dangerCtl(key,label,onOk){
          if(confirmKey[0]===key)return [
            jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:700,color:"#ef4444"},children:"确认执行？"}),
            jsx_runtime.jsx("button",{style:styles.btnDangerSolid,onClick:onOk,children:"确认"}),
            jsx_runtime.jsx("button",{style:styles.iconBtn,onClick:cancelConfirm,title:"取消（3s 后自动还原）",children:"✕"})
          ];
          return [jsx_runtime.jsx("button",{style:styles.btnDanger,onClick:function(){askConfirm(key);},children:label})];
        }
        // ── 方案A·折叠摘要 ──
        // 摘要行：chevron + 徽标 + 名称 + 状态点 + 掩码凭据 + 开关；点击行展开编辑表单。
        // 状态优先级：已停用 > 未配置 > 待检测 > 最近一次测试结果。
        function srcStatus(key){
          var p=c.providers[key];
          if(!p.enabled) return {tone:"off",text:"已停用"};
          if(!p.token || (key==="r4coder" && !p.baseUrl)) return {tone:"unset",text:"未配置"};
          var r=testRes[0][key];
          if(!r) return {tone:"idle",text:"待检测"};
          return r.ok?{tone:"ok",text:"正常"}:{tone:"err",text:"异常"};
        }
        function statusToneColor(tone){
          return tone==="ok"?"var(--dsw-alias-state-success-primary,#34d399)":tone==="err"?"#ef4444":"var(--dsw-alias-label-caption,#9a9aaa)";
        }
        function maskToken(t){
          if(!t) return "—";
          if(t.length<=8) return "••••";
          return t.slice(0,3)+"…"+t.slice(-4);
        }
        function providerSummary(key,badgeText,badgeBg,name){
          var p=c.providers[key];
          var st=srcStatus(key);
          var open=expandedSrc[0]===key;
          function toggle(){ expandedSrc[1](open?"":key); showPw[1](false); }
          return jsx_runtime.jsxs("div",{role:"button",tabIndex:0,
            style:Object.assign({},styles.card,{cursor:"pointer",opacity:p.enabled?1:0.55,userSelect:"none"}),
            onClick:toggle,
            onKeyDown:function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggle(); } },
            children:[
              jsx_runtime.jsx("span",{style:{display:"inline-block",fontSize:"9px",color:"var(--dsw-alias-label-caption,#9a9aaa)",transform:open?"rotate(90deg)":"none",transition:"transform 0.2s",flexShrink:0},children:"▶"}),
              jsx_runtime.jsx("span",{style:{width:18,height:18,borderRadius:6,background:badgeBg,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"9px",fontWeight:700,flexShrink:0},children:badgeText}),
              jsx_runtime.jsx("span",{style:Object.assign({},styles.cTitle,{minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}),children:name}),
              jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:5,fontSize:"11px",color:st.tone==="err"?"#ef4444":"var(--dsw-alias-label-secondary,#a0a0b0)",flexShrink:0},children:[
                jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",flexShrink:0,background:statusToneColor(st.tone)}}),
                st.text
              ]}),
              jsx_runtime.jsx("span",{style:{flex:1}}),
              jsx_runtime.jsx("span",{style:Object.assign({},styles.chip,{fontFamily:"'Cascadia Code', Consolas, monospace"}),title:p.token?"已保存凭据（展开可修改）":"",children:maskToken(p.token)}),
              // 开关阻断冒泡：切开关不应触发行的展开/收起
              jsx_runtime.jsx("span",{style:{display:"inline-flex",flexShrink:0},onClick:function(e){try{e.stopPropagation();}catch(_){}},children:switchEl(p.enabled,function(v){updateProvider(key,{enabled:v});})})
            ]}, key+"-sum");
        }
        function providerForm(key){
          var p=c.providers[key];
          var res=testRes[0][key];
          return jsx_runtime.jsxs("div",{style:Object.assign({},styles.cardCol,{opacity:p.enabled?1:0.55}),
            // 展开入场：GSAP 可用时轻量下滑淡入，否则直接呈现
            ref:function(el){ if(el && !el.__oqIn){ el.__oqIn=true; ensureGSAP(function(g){ if(g && el && el.isConnected){ try{ g.fromTo(el,{y:-4,opacity:0},{y:0,opacity:1,duration:0.24,ease:"power2.out"}); }catch(_){} } }); } },
            children:[
              jsx_runtime.jsxs("div",{children:[
                jsx_runtime.jsx("label",{style:styles.fieldLabel,children:key==="opencode"?"API Token":"API Key"}),
                jsx_runtime.jsxs("div",{style:{display:"flex",gap:6},children:[
                  jsx_runtime.jsx("input",{style:styles.input,type:showPw[0]?"text":"password",placeholder:key==="opencode"?"opencode token":(key==="r4coder"?"coder_…（与推理同 key）":"sk-..."),value:p.token,disabled:!p.enabled,onInput:function(e){updateProvider(key,{token:e.target.value.trim()},{quiet:true});},onBlur:commitConfigNow}),
                  jsx_runtime.jsx("button",{style:styles.iconBtn,title:showPw[0]?"隐藏凭据":"明文显示凭据",onClick:function(){showPw[1](!showPw[0]);},children:showPw[0]?"隐":"显"})
                ]})
              ]}),
              jsx_runtime.jsxs("div",{children:[
                jsx_runtime.jsx("label",{style:styles.fieldLabel,children:"Base URL"}),
                jsx_runtime.jsx("input",{style:styles.input,placeholder:key==="opencode"?"https://opencode.ai/zen/go/v1/usage":(key==="r4coder"?"https://api.r4.codes/v1/cli/meta":"https://api.deepseek.com"),value:p.baseUrl,disabled:!p.enabled,onInput:function(e){updateProvider(key,{baseUrl:e.target.value.trim()},{quiet:true});},onBlur:commitConfigNow})
              ]}),
              jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
                jsx_runtime.jsx("button",{style:styles.btnAccent,onClick:function(){doTest(key);},disabled:testLoading[0]||!p.enabled,children:testLoading[0]?"检测中…":"测试连接"}),
                res?jsx_runtime.jsxs("span",{style:{fontSize:"11px",display:"inline-flex",alignItems:"center",gap:5,color:res.ok?"var(--dsw-alias-state-success-primary,#34d399)":"#ef4444",wordBreak:"break-all"},children:[
                  jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",flexShrink:0,background:res.ok?"var(--dsw-alias-state-success-primary,#34d399)":"#ef4444"}}),
                  res.text
                ]}):null
              ]})
            ]}, key+"-form");
        }
        // save 传 null = "只读 pills"：照常显示与高亮当前值，但按钮 disabled、点击无效。
        // 用于热力/时段模式（图表固定取 90 天数据源），这样「自定义」入口不会凭空消失。
        function pillGroup(label,opts,state,save){
          var readonly = !save;
          return jsx_runtime.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:6,opacity:readonly?0.55:1},children:[
            label?jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:label}):null,
            opts.map(function(pair){
              var k=pair[0],txt=pair[1],active=state[0]===k;
              return jsx_runtime.jsx("button",{
                type:"button",
                disabled:readonly,
                onClick:function(){ if(readonly) return; save(k);state[1](k); },
                style:{padding:"4px 12px",borderRadius:999,fontSize:"11px",fontWeight:active?700:500,border:"1px solid "+(active?ACCENT:"var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"),background:active?"rgba(109,91,255,0.14)":"var(--dsw-alias-bg-layer-2,#1e1e26)",color:active?"var(--dsw-alias-state-business-primary,#8b7bff)":"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:readonly?"default":"pointer",fontFamily:"inherit"},
                children:txt,
              }, k);
            })
          ]});
        }
        var TM_COLORS={uncachedInputTokens:"#6d5bff",outputTokens:"#10b981",cacheReadTokens:"#f59e0b",cacheWriteTokens:"#0ea5e9"};
        // 三段口径统一配色：新输入 / 缓存读 / 输出（缓存写当前宿主恒为 0，单独用青色）
        var C_FRESH="#6d5bff", C_OUT="#10b981", C_CACHE="#f59e0b", C_WRITE="#0ea5e9";
        function miniChip(k,label,val,extra,tip){
          return jsx_runtime.jsxs("span",{style:styles.statChip,title:tip||undefined,children:[
            label,
            jsx_runtime.jsx("b",{key:"v",style:{color:"var(--dsw-alias-label-primary,#fff)",fontWeight:700,marginLeft:3},children:val}),
            extra||null,
          ]},k);
        }
        // 环比徽标：按**日均**比较，并要求上期覆盖天数足够（否则显示"上期覆盖不足"）。
        // 旧实现直接比绝对量：本机数据只有 12 天、上期 30 天窗口里仅 3 天有数据，
        // 于是"总量 ↑737%"，纯属统计窗口不对齐造成的假信号。
        function deltaBadge(curTotal, curDays, prevTotal, prevDays, winDays){
          var d=avgDelta(curTotal, curDays, prevTotal, prevDays);
          var need=Math.max(2, Math.ceil((Number(winDays)||0)*0.5));
          if(d==null){
            return jsx_runtime.jsx("span",{key:"d",style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)",marginLeft:2},children:"环比 —"});
          }
          if(Number(prevDays)<need){
            return jsx_runtime.jsx("span",{key:"d",title:"上期只有 "+prevDays+" 天有数据（需要 ≥"+need+" 天），绝对量环比会失真，已改为日均比较并标注覆盖度",
              style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)",marginLeft:2},children:"上期覆盖 "+prevDays+"/"+winDays+" 天"});
          }
          if(!isFinite(d)) return null;
          var up=d>=0;
          var txt=(up?"↑":"↓")+Math.abs(d).toFixed(Math.abs(d)>=100?0:1)+"%";
          return jsx_runtime.jsx("span",{key:"d",title:"按日均比较（本期 "+(Number(curTotal)/Math.max(1,Number(curDays))).toFixed(0)+" /日 vs 上期 "+(Number(prevTotal)/Math.max(1,Number(prevDays))).toFixed(0)+" /日）",
            style:{fontSize:"10px",fontWeight:700,color:up?"#ef8b8b":"#34d399",marginLeft:2},children:txt});
        }
        // 总览：把"输入"拆成 新输入/缓存读，并显式给出命中率。
        // 旧实现把 prompt（= 新输入 + 缓存读）标成"输入"，旁边又并列一个"缓存读"，
        // 而实测缓存读占 prompt 的 93%~96%——看上去像重复计数，实际是口径没说清。
        // 迷你趋势（7 天）：总览 A/B 共用。空数据返回 null，调用方跳过。
        function sparkSvg(vals, w, h, color){
          var arr=(vals||[]).filter(function(v){ return typeof v==="number" && isFinite(v); });
          if(arr.length<2) return null;
          var max=Math.max.apply(null,arr), min=Math.min.apply(null,arr), span=(max-min)||1;
          var pts=arr.map(function(v,i){ return [i*(w/(arr.length-1)), h-3-((v-min)/span)*(h-6)]; });
          var d="M"+pts.map(function(p){ return p[0].toFixed(1)+","+p[1].toFixed(1); }).join(" L");
          var last=pts[pts.length-1];
          return jsx_runtime.jsxs("svg",{viewBox:"0 0 "+w+" "+h,preserveAspectRatio:"none",
            style:{width:"100%",height:h+"px",display:"block",overflow:"visible"},children:[
            jsx_runtime.jsx("path",{d:d,fill:"none",stroke:color,strokeWidth:1.6,strokeLinejoin:"round",strokeLinecap:"round"}),
            jsx_runtime.jsx("circle",{cx:last[0].toFixed(1),cy:last[1].toFixed(1),r:2.2,fill:color}),
          ]});
        }
        function ringSvg(pct, size){
          size=size||46;
          var r=(size-7)/2, c=2*Math.PI*r, off=c*(1-Math.max(0,Math.min(100,pct))/100);
          return jsx_runtime.jsxs("span",{className:"oq-ring",style:{width:size+"px",height:size+"px"},children:[
            jsx_runtime.jsxs("svg",{width:size,height:size,viewBox:"0 0 "+size+" "+size,children:[
              jsx_runtime.jsx("circle",{cx:size/2,cy:size/2,r:r,fill:"none",stroke:"rgba(255,255,255,0.14)",strokeWidth:4}),
              jsx_runtime.jsx("circle",{cx:size/2,cy:size/2,r:r,fill:"none",stroke:C_FRESH,strokeWidth:4,strokeLinecap:"round",
                strokeDasharray:c.toFixed(1),strokeDashoffset:off.toFixed(1),transform:"rotate(-90 "+size/2+" "+size/2+")"}),
            ]}),
            jsx_runtime.jsx("b",{children:pct!=null?Math.round(pct)+"%":"—"}),
          ]});
        }
        // ── 总览 A：仪表盘（主数字 + 环形命中率 + 三段构成 + 4 列次级）──
        function ovA(m){
          function seg(v, color, id){
            var w=m.pct(v);
            if(w<1) return null;
            return jsx_runtime.jsxs("span",{style:{width:w+"%",background:color},children:[
              w>=12?jsx_runtime.jsx("i",{children:Math.round(w)+"%" }):null,
            ]},"s"+id);
          }
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsxs("div",{className:"oq-ov-top",children:[
              jsx_runtime.jsxs("div",{children:[
                jsx_runtime.jsxs("div",{className:"oq-ov-big",children:[fmtTokens(m.total),jsx_runtime.jsx("em",{children:"tokens"})]}),
                jsx_runtime.jsx("div",{className:"oq-ov-lbl",children:"总 token"}),
                jsx_runtime.jsxs("div",{className:"oq-ov-sub",children:[
                  jsx_runtime.jsx("span",{children:"日均 "+fmtTokens(m.curDays>0?m.total/m.curDays:0)}),
                  deltaBadge(m.total, m.curDays, m.prev&&m.prev.total, m.prevDays, m.winDays),
                ]}),
              ]}),
              jsx_runtime.jsxs("div",{style:{flex:1,minWidth:"70px"},children:[
                sparkSvg(m.sTotal, 150, 36, C_FRESH),
                jsx_runtime.jsx("div",{className:"oq-cap",style:{textAlign:"center"},children:"近 7 天"}),
              ]}),
              jsx_runtime.jsxs("div",{style:{textAlign:"center",flex:"none"},children:[
                ringSvg(m.hit, 46),
                jsx_runtime.jsx("div",{className:"oq-cap",style:{marginTop:2},children:"缓存命中率"}),
              ]}),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-stack",title:"构成比例：新输入 "+fmtNum(m.fresh)+"（"+m.pct(m.fresh).toFixed(1)+"%） / 缓存读 "+fmtNum(m.cr)+"（"+m.pct(m.cr).toFixed(1)+"%） / 输出 "+fmtNum(m.out),children:[
              seg(m.fresh, C_FRESH, "f"), seg(m.cr, C_CACHE, "c"), seg(m.out, C_OUT, "o"),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-stack-lbl",children:[
              jsx_runtime.jsx("span",{style:{color:C_FRESH},children:"新输入 "+(m.denom>0?m.pct(m.fresh).toFixed(1):"0")+"%"}),
              jsx_runtime.jsx("span",{style:{color:C_CACHE},children:"缓存读 "+(m.denom>0?m.pct(m.cr).toFixed(1):"0")+"%"}),
              jsx_runtime.jsx("span",{style:{color:C_OUT},children:"输出 "+(m.denom>0?m.pct(m.out).toFixed(1):"0")+"%"}),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-kpis",children:[
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.req)}),jsx_runtime.jsx("i",{children:"回复"})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.turns)}),jsx_runtime.jsx("i",{children:"轮次"})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.steps)}),jsx_runtime.jsx("i",{children:"步数"})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.tools)}),jsx_runtime.jsx("i",{children:"工具调用"})]}),
            ]}),
          ]});
        }
        // ── 总览 B：三色卡（新输入 / 缓存读 / 输出 各一张）──
        function ovB(m){
          var tiles=[
            { k:"新输入", v:fmtTokens(m.fresh), c:C_FRESH, s:m.sFresh, d:deltaBadge(m.fresh, m.curDays, m.prev&&m.prev.freshInput, m.prevDays, m.winDays) },
            { k:"缓存读", v:fmtTokens(m.cr), c:C_CACHE, s:m.sCache, d:null },
            { k:"输出", v:fmtTokens(m.out), c:C_OUT, s:m.sOut, d:deltaBadge(m.out, m.curDays, m.prev&&m.prev.output, m.prevDays, m.winDays) },
          ];
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsx("div",{className:"oq-tiles",children: tiles.map(function(t){
              return jsx_runtime.jsxs("div",{className:"oq-tile",children:[
                jsx_runtime.jsx("div",{className:"k",children:t.k}),
                jsx_runtime.jsx("div",{className:"v",children:t.v}),
                jsx_runtime.jsx("div",{style:{margin:"4px 0 2px"},children:sparkSvg(t.s, 92, 24, t.c)}),
                jsx_runtime.jsxs("div",{className:"p",children:["占 "+(m.denom>0?m.pct(t.k==="新输入"?m.fresh:(t.k==="缓存读"?m.cr:m.out)).toFixed(1):"0")+"%", t.d]}),
              ]},t.k);
            })}),
            jsx_runtime.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:6,marginTop:10},children:[
              miniChip("total","总量",fmtTokens(m.total),null,"= 新输入 + 缓存读 + 输出"),
              miniChip("hit","命中率",m.hit!=null?(m.hit+"%"):"—",null,"cacheRead ÷ (新输入 + cacheRead)"),
              miniChip("req","回复",fmtNum(m.req)),
              miniChip("turns","轮次",fmtNum(m.turns)),
              miniChip("steps","步数",fmtNum(m.steps)),
              miniChip("tools","工具",fmtNum(m.tools)),
            ]}),
          ]});
        }
        // ── 总览 C：一行摘要（细项折叠）──
        function ovC(m){
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsxs("div",{className:"oq-ov-row",children:[
              jsx_runtime.jsxs("span",{className:"big",children:[fmtTokens(m.total),jsx_runtime.jsx("span",{className:"oq-cap",style:{marginLeft:4},children:"tokens"})]}),
              miniChip("hit","命中",m.hit!=null?(m.hit+"%"):"—"),
              miniChip("avg","日均",fmtTokens(m.curDays>0?m.total/m.curDays:0)),
              miniChip("req","回复",fmtNum(m.req)),
              deltaBadge(m.total, m.curDays, m.prev&&m.prev.total, m.prevDays, m.winDays),
            ]}),
            jsx_runtime.jsxs("details",{style:{marginTop:8},children:[
              jsx_runtime.jsx("summary",{style:{cursor:"pointer",fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"构成与细项"}),
              jsx_runtime.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:6,marginTop:6},children:[
                miniChip("fresh","新输入",fmtNum(m.fresh)),
                miniChip("cr","缓存读",fmtNum(m.cr)),
                miniChip("out","输出",fmtNum(m.out)),
                miniChip("turns","轮次",fmtNum(m.turns)),
                miniChip("steps","步数",fmtNum(m.steps)),
                miniChip("tools","工具",fmtNum(m.tools)),
              ]}),
            ]}),
          ]});
        }
        // 总览：把"输入"拆成 新输入/缓存读，并显式给出命中率。风格由设置页切换（A 仪表盘 / B 三色卡 / C 一行）。
        function overviewBlock(totals, prev, daily){
          totals=totals||{};
          prev=prev||null;
          var cr=Number(totals.cache_read||0), out=Number(totals.completion||0);
          var fresh=Number(totals.freshInput!=null?totals.freshInput:(Number(totals.prompt||0)-cr))||0;
          var total=Number(totals.total||0);
          var denom=fresh+cr+out;
          var hit=totals.cacheHitRate;
          if(hit==null && (fresh+cr)>0) hit=Math.round(cr/(fresh+cr)*1000)/10;
          var days=(daily||[]).filter(function(d){ return d && d.date; }).slice(-7);
          var m={
            total:total, fresh:fresh, cr:cr, out:out, hit:hit, denom:denom,
            winDays:rangeDays(meterRangeState[0]),
            curDays:Number(totals.days)||0,
            prevDays:prev?Number(prev.days)||0:0,
            prev:prev,
            req:Number(totals.requests||0), turns:Number(totals.turns||0),
            steps:Number(totals.steps||0), tools:Number(totals.tools||0),
            pct:function(v){ return denom>0?(v/denom*100):0; },
            sTotal:days.map(function(d){ return Number(d.total||0); }),
            sFresh:days.map(function(d){ return Math.max(0,Number(d.prompt||0)-Number(d.cache_read||0)); }),
            sCache:days.map(function(d){ return Number(d.cache_read||0); }),
            sOut:days.map(function(d){ return Number(d.completion||0); }),
          };
          var style=tmUsageStyle[0].overview;
          // 三种风格共用的"其中网关"一行：挂在总览下方，避免三种风格各写一遍。
          // 监测关闭时给「仅本机」提示（否则用户会以为总量突然变小是丢了数据）。
          var gwLine=gwOverviewLine(meterData[0]&&meterData[0].sources);
          var body = style==="B" ? ovB(m) : (style==="C" ? ovC(m) : ovA(m));
          if(!gwLine) return body;
          return jsx_runtime.jsxs("div",{children:[body, gwLine]});
        }
        // 总览里的分源说明（悬浮窗的角标是紧凑版，这里是带澄清句的完整版）
        function gwOverviewLine(sources){
          try{
            var g=sources&&sources.gateway, l=sources&&sources.local;
            if(!g) return null;
            if(g.enabled===false){
              return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:"11px",flexWrap:"wrap",color:"#e8b463"},children:[
                jsx_runtime.jsx("span",{style:{fontWeight:700},children:"仅本机口径"}),
                jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"网关监测已关闭，总量只含本机会话。可在「网关」标签页开启。"}),
              ]});
            }
            var gt=Number(g.total||0)||0;
            if(gt<=0) return null;
            var lt=Number(l&&l.total||0)||0;
            var all=lt+gt;
            var pct=all>0?Math.round(gt/all*1000)/10:null;
            return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:"11px",flexWrap:"wrap"},children:[
              jsx_runtime.jsx("span",{style:{fontWeight:700,color:"#8b7bff"},children:"其中网关"}),
              jsx_runtime.jsx("span",{style:{fontFamily:"'Cascadia Code', Consolas, monospace",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:fmtTokens(gt)+(pct!=null?" · 占 "+pct+"%":"")}),
              jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"本机 "+fmtTokens(lt)+" · UTC+8 日界 · 无项目/会话/小时维度"}),
            ]});
          }catch(e){ return null; }
        }

        // 实时卡：全部是"本次启动至今"的累计值（rate60 除外，它是近 60s 滑动窗口）
        // 实时卡：速率是"近 60s 窗口"，其余是"本次启动至今"的累计值。
        // 首 token 不占主位（实时事件流不投递 chunk 类事件）；主指标是"每步耗时 P50/P90"。
        // 三种风格：A 半环仪表 / B Sparkline + 5 列 KPI / C 单行状态条。
        function liveMetrics(live, rel, records){
          var llm=Number(live.llmMs||0), tool=Number(live.toolMs||0), busy=llm+tool;
          var durs=(records||[]).map(function(r){ return Number(r&&r.durationMs)||0; });
          var sig=live.signalCount||{};
          var sigKeys=Object.keys(sig);
          return {
            llm:llm, tool:tool, llmShare:busy>0?Math.round(llm/busy*100):null,
            steps:Number(live.steps||0), avgStep:Number(live.steps||0)>0?Math.round(llm/Number(live.steps)):null,
            p50:percentile(durs,0.5), p90:percentile(durs,0.9), nDur:durs.filter(function(v){ return v>0; }).length,
            rate:Number(live.rate60||0), winSec:Number(live.rate60WindowSec||60),
            rateTokens:Number(live.rate60Tokens||0), accRate:Number(live.tokPerSec)||0,
            ftCount:Number(live.firstTokenCount||0), ftMs:Number(live.firstTokenMs||0),
            sigTxt:sigKeys.length?sigKeys.map(function(k){ return k+"×"+sig[k]; }).join("，"):"尚未收到任何流式产出事件",
            turns:Number(live.turns||0), stepsN:Number(live.steps||0), tools:Number(live.toolCalls||0), msgs:Number(live.msgs||0),
            rel:rel||null,
          };
        }
        function liveRateTip(m){
          return "窗口内输出 "+fmtNum(m.rateTokens)+" tokens ÷ "+m.winSec+" 秒（端到端，含思考与等待）；本次启动累计均值 "+m.accRate.toFixed(1)+" tok/s（分母只算 LLM 忙碌时间）";
        }
        function liveStepTip(m){
          return "最近 "+m.nDur+" 条回复的 step/start→消息耗时；首 token "+(m.ftCount?("≈"+Math.round(m.ftMs)+" ms"):"无样本")+"（样本 "+m.ftCount+" 次，步内产出事件："+m.sigTxt+"）";
        }
        // A：半环仪表 + 右侧文字指标
        function liveA(m){
          var pct=Math.max(0,Math.min(1,m.rate/200));
          var r=52, c=Math.PI*r;
          return jsx_runtime.jsxs("div",{className:"oq-gauge",children:[
            jsx_runtime.jsxs("svg",{width:"146",height:"84",viewBox:"0 0 146 84",style:{flex:"none"},children:[
              jsx_runtime.jsx("path",{d:"M18,70 A55,55 0 0 1 128,70",fill:"none",stroke:"rgba(255,255,255,0.10)",strokeWidth:10,strokeLinecap:"round"}),
              jsx_runtime.jsx("path",{d:"M18,70 A55,55 0 0 1 128,70",fill:"none",stroke:C_FRESH,strokeWidth:10,strokeLinecap:"round",
                strokeDasharray:(c*pct).toFixed(1)+" "+c.toFixed(1)}),
              jsx_runtime.jsx("text",{x:73,y:56,textAnchor:"middle",fill:"var(--dsw-alias-label-primary,#fff)",fontSize:22,fontWeight:750,children:m.rate.toFixed(1)}),
              jsx_runtime.jsx("text",{x:73,y:70,textAnchor:"middle",fill:"var(--dsw-alias-label-caption,#9a9aaa)",fontSize:9,children:"tok/s · 近"+m.winSec+"s"}),
            ]}),
            jsx_runtime.jsxs("div",{className:"side",title:liveRateTip(m),children:[
              jsx_runtime.jsxs("div",{children:["每步 ",jsx_runtime.jsx("b",{children:m.p50!=null?fmtDur(m.p50):"—"})," P50 / ",jsx_runtime.jsx("b",{children:m.p90!=null?fmtDur(m.p90):"—"})," P90"]}),
              jsx_runtime.jsxs("div",{children:["工具 ",jsx_runtime.jsx("b",{children:fmtNum(m.tools)})," · 轮次 ",jsx_runtime.jsx("b",{children:m.turns})," / 步 ",jsx_runtime.jsx("b",{children:fmtNum(m.stepsN)})]}),
              jsx_runtime.jsx("div",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)",fontSize:"10px"},children:relLine(m.rel)}),
            ]}),
          ]});
        }
        function relLine(rel){
          if(!rel) return "可靠性：—";
          return "可靠性 重试 "+Number(rel.retries||0)+" · 压缩 "+Number(rel.compactions||0)
            +(rel.compactedTokens?"（"+fmtNum(rel.compactedTokens)+" tokens）":"")
            +" · 失败 "+Number(rel.errors||0)+" · 工具失败 "+Number(rel.toolErrors||0);
        }
        // B：Sparkline + 5 列 KPI（可靠性折进副值）
        function liveB(m, hist){
          var vals=(hist||[]).slice(-20);
          if(!vals.length) vals=[m.rate];
          var rel=m.rel||{};
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"flex-end",gap:12},children:[
              jsx_runtime.jsxs("div",{title:liveRateTip(m),children:[
                jsx_runtime.jsxs("div",{className:"oq-live-big",children:[m.rate.toFixed(1),jsx_runtime.jsx("span",{children:"tok/s 近"+m.winSec+"s"})]}),
                jsx_runtime.jsxs("div",{className:"oq-cap",style:{marginTop:2},children:["最近 "+vals.length+" 次刷新采样"]}),
              ]}),
              jsx_runtime.jsx("div",{style:{flex:1,minWidth:"80px"},children:sparkSvg(vals, 340, 40, C_FRESH)}),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-kpi5",children:[
              jsx_runtime.jsxs("div",{title:liveStepTip(m),children:[jsx_runtime.jsx("b",{children:m.p50!=null?fmtDur(m.p50):"—"}),jsx_runtime.jsx("i",{children:"每步 P50"+(m.p90!=null?" · P90 "+fmtDur(m.p90):"")})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.tools)}),jsx_runtime.jsx("i",{children:"工具 · 失败 "+Number(rel.toolErrors||0)})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.turns)}),jsx_runtime.jsx("i",{children:"轮次 · 重试 "+Number(rel.retries||0)})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.stepsN)}),jsx_runtime.jsx("i",{children:"步数 · 压缩 "+Number(rel.compactions||0)})]}),
              jsx_runtime.jsxs("div",{children:[jsx_runtime.jsx("b",{children:fmtNum(m.msgs)}),jsx_runtime.jsx("i",{children:"回复"})]}),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsx("span",{className:"oq-legend-item",children:relLine(m.rel)}),
            ]}),
          ]});
        }
        // C：单行状态条
        function liveC(m){
          return jsx_runtime.jsxs("div",{className:"oq-status",children:[
            jsx_runtime.jsx("span",{className:"dot",style:{background:m.rate>0?"#34d399":"#9a9aaa",boxShadow:"0 0 0 3px rgba(52,211,153,0.15)"}}),
            jsx_runtime.jsx("b",{style:{fontSize:"11px"},children:m.rate>0?"活跃":"空闲"}),
            miniChip("r60","速率",m.rate.toFixed(1)+" tok/s"),
            miniChip("step","每步",m.p50!=null?fmtDur(m.p50):"—"),
            miniChip("tc","工具",fmtNum(m.tools)),
            miniChip("tn","轮次/步",m.turns+" / "+fmtNum(m.stepsN)),
            miniChip("rel","可靠性",Number((m.rel||{}).retries||0)+" 重试 · "+Number((m.rel||{}).compactions||0)+" 压缩"),
          ]});
        }
        function liveBlock(live, rel, records, hist){
          if(!live) return null;
          var m=liveMetrics(live, rel, records);
          var style=tmUsageStyle[0].live;
          if(style==="A") return liveA(m);
          if(style==="C") return liveC(m);
          return liveB(m, hist);
        }

        // 通用排行条（工具 / 项目 / 渠道共用；模型排行另有交互，见 modelRank）
        function rankRows(rows, weightOf){
          if(!rows || !rows.length) return null;
          var max=1;
          rows.forEach(function(r){ var w=weightOf(r); if(w>max) max=w; });
          return jsx_runtime.jsx("div",{style:{display:"flex",flexDirection:"column",gap:5},children: rows.map(function(r,i){
            var pct=Math.max(2,Math.round(weightOf(r)/max*100));
            return jsx_runtime.jsxs("div",{className:"oq-rank-row",title:r.tip||undefined,children:[
              jsx_runtime.jsx("span",{className:"oq-rank-name",children:r.name}),
              jsx_runtime.jsx("span",{className:"oq-rank-track",children:jsx_runtime.jsx("span",{className:"oq-rank-fill",style:{width:pct+"%",background:r.color||undefined}})}),
              jsx_runtime.jsx("span",{className:"oq-rank-val",children:r.val}),
            ]},r.name+"-"+i);
          })});
        }

        var c=cfg[0];
        var widgetOn=loadWidgetEnabled();

        function localDayStr(){
          var d=new Date();
          return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
        }
        function peakLabel(max){
          return jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)",whiteSpace:"nowrap"},children:"峰值 "+fmtTokens(max)});
        }
        // 按日柱：支持"只看某个模型"（点模型排行触发），三段堆叠 新输入/缓存读/输出。
        // 图表风格（tmUsageStyle.chart）：A 坐标系（刻度+网格+点击聚焦）/ B 摘要条+渐变 / C 极简。
        function chartSummaryRow(rows){
          if(!rows || !rows.length) return null;
          var max=0, sum=0;
          rows.forEach(function(d){ var v=Number(d.total||0); if(v>max) max=v; sum+=v; });
          return jsx_runtime.jsxs("div",{className:"oq-chart-sum",children:[
            jsx_runtime.jsxs("span",{children:["峰值 ",jsx_runtime.jsx("b",{children:fmtTokens(max)})]}),
            jsx_runtime.jsxs("span",{children:["日均 ",jsx_runtime.jsx("b",{children:fmtTokens(sum/rows.length)})]}),
            jsx_runtime.jsxs("span",{children:["有数据 ",jsx_runtime.jsx("b",{children:rows.length})," 天"]}),
          ]});
        }
        function chartAxisCol(max){
          return jsx_runtime.jsxs("div",{style:{width:"34px",flex:"none",display:"flex",flexDirection:"column",justifyContent:"space-between",
            height:"104px",paddingBottom:"16px",paddingTop:"4px",fontSize:"8px",lineHeight:1,
            color:"var(--dsw-alias-label-caption,#9a9aaa)",textAlign:"right",fontVariantNumeric:"tabular-nums"},children:[
            jsx_runtime.jsx("span",{children:fmtTokens(max)}),
            jsx_runtime.jsx("span",{children:fmtTokens(max/2)}),
            jsx_runtime.jsx("span",{children:"0"}),
          ]});
        }
        function renderDailyBars(daily, modelFilter){
          var style=tmUsageStyle[0].chart;
          var focus=tmBarFocus[0]||"";
          var all=(daily||[]).filter(function(d){ return d && d.date; }).sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
          function valOf(d){
            if(!modelFilter) return Number(d.total||0);
            var ms=(d.models||[]);
            for(var i=0;i<ms.length;i++){ if(ms[i] && ms[i].model===modelFilter) return Number(ms[i].total||0); }
            return 0;
          }
          var rows=all;
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无按日数据（产生带 usage 的对话事件后自动出现）"});
          var max=1; rows.forEach(function(d){ var v=valOf(d); if(v>max) max=v; });
          if(modelFilter && max<=1){
            return jsx_runtime.jsx("div",{style:styles.hint,children:"该模型在所选区间内没有按日数据"});
          }
          var cols = rows.map(function(d){
            var total=modelFilter?valOf(d):Number(d.total||0);
            var fresh=Math.max(0,Number(d.prompt||0)-Number(d.cache_read||0));
            var cr=Number(d.cache_read||0), out=Number(d.completion||0);
            var barH=barHeightFor(total, max);
            var top=(d.models&&d.models[0])?d.models[0].model:"";
            var tip=d.date+(modelFilter?" · "+modelFilter+" "+fmtNum(total):" · 共 "+fmtNum(total)+"（新输入 "+fmtNum(fresh)+" · 缓存读 "+fmtNum(cr)+" · 输出 "+fmtNum(out)+"）")
              +" · 回复 "+(d.requests||0)+" · 步骤 "+(d.steps||0)+" · 工具 "+(d.tools||0)
              +(top?"\n主力模型: "+top:"")
              +(d.models&&d.models.length>1?"\n其他模型: "+d.models.slice(1,4).map(function(m){return m.model+" "+fmtNum(m.total);}).join(" · "):"");
            var dim = (style==="A" && focus && focus!==d.date);
            return jsx_runtime.jsxs("div",{className:"oq-chart-col",title:tip,
              style:Object.assign({}, dim?{opacity:.3}:null, style==="A"?{cursor:"pointer"}:null),
              onClick: style==="A" ? function(){ tmBarFocus[1](focus===d.date?"":d.date); } : undefined,
              children:[
                jsx_runtime.jsxs("div",{className:"oq-chart-bar",style:{height:barH+"px",minHeight:CHART_MIN_H+"px",
                  background:total>0?undefined:"transparent",borderColor:total>0?undefined:"transparent",
                  boxShadow:(style==="A"&&focus===d.date)?"0 0 0 1px #8b7bff":undefined},
                  children: total>0?[
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"100%":(cr/total*100)+"%", background:C_CACHE}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"0":(out/total*100)+"%", background:C_OUT}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"0":(fresh/total*100)+"%", background:C_FRESH}}),
                  ]:null}),
                jsx_runtime.jsx("span",{className:"oq-chart-label",children:String(d.date).slice(5)}),
              ]}, d.date);
          });
          var chart=jsx_runtime.jsx("div",{className:"oq-chart"+(style==="C"?"":" oq-chart-grid"),children: jsx_runtime.jsx("div",{className:"oq-chart-cols",children: cols })});
          var legend=jsx_runtime.jsxs("div",{className:"oq-legend",children:[
            modelFilter?jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),"仅 "+modelFilter]}):[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),"新输入"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_OUT}}),"输出"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_CACHE}}),"缓存读"]}),
            ],
            style!=="C"?jsx_runtime.jsx("span",{className:"oq-legend-item",style:{marginLeft:"auto"},children:peakLabel(max)}):null,
          ]});
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[
            style==="B"?chartSummaryRow(rows):null,
            style==="A"
              ? jsx_runtime.jsxs("div",{style:{display:"flex",gap:4},children:[chartAxisCol(max), jsx_runtime.jsx("div",{style:{flex:1,minWidth:0},children:chart})]})
              : chart,
            legend,
          ]});
        }


        // 折线/面积图：日趋势 + 命中率曲线 + 上期对比（三条都用纯 SVG，不引图表库）
        function renderLineChart(daily, modelFilter, prevDaily){
          var style=tmUsageStyle[0].chart;
          var rows=(daily||[]).filter(function(d){ return d && d.date; }).sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无按日数据（产生带 usage 的对话事件后自动出现）"});
          function valOf(d){
            if(!modelFilter) return Number(d.total||0);
            var ms=d.models||[];
            for(var i=0;i<ms.length;i++){ if(ms[i] && ms[i].model===modelFilter) return Number(ms[i].total||0); }
            return 0;
          }
          var vals=rows.map(valOf);
          var prevRows=(prevDaily||[]).filter(function(d){ return d && d.date; });
          var prevVals=prevRows.map(function(d){ return Number(d.total||0); });
          var max=1;
          vals.forEach(function(v){ if(v>max) max=v; });
          prevVals.forEach(function(v){ if(v>max) max=v; });
          var W=100, H=100;
          var n=rows.length;
          var stepX=n>1?W/(n-1):0;
          function toPts(list){
            return list.map(function(v,i){
              var x=list.length>1?i*(W/(list.length-1)):W/2;
              return [x, H-Math.max(0,v)/max*(H-8)-3];
            });
          }
          var pts=toPts(vals);
          var line=pts.map(function(p){ return p[0].toFixed(2)+","+p[1].toFixed(2); }).join(" ");
          var area="M"+pts[0][0].toFixed(2)+","+H+" L"+line.split(" ").join(" L")+" L"+pts[n-1][0].toFixed(2)+","+H+" Z";
          var prevLine=prevVals.length?toPts(prevVals).map(function(p){ return p[0].toFixed(2)+","+p[1].toFixed(2); }).join(" "):"";
          var hitPts=[];
          rows.forEach(function(d,i){
            var p=Number(d.prompt||0), cr=Number(d.cache_read||0);
            if(p>0) hitPts.push([n>1?i*stepX:W/2, H-Math.max(0,Math.min(100,cr/p*100))/100*(H-8)-3]);
          });
          var hitLine=hitPts.map(function(p){ return p[0].toFixed(2)+","+p[1].toFixed(2); }).join(" ");
          var svg=jsx_runtime.jsx("div",{style:{position:"relative",padding:"6px 2px 0",flex:1,minWidth:0},children:[
            jsx_runtime.jsxs("svg",{viewBox:"0 0 "+W+" "+H,preserveAspectRatio:"none",style:{width:"100%",height:"120px",display:"block",overflow:"visible"},children:[
              jsx_runtime.jsx("line",{x1:0,y1:H-0.5,x2:W,y2:H-0.5,stroke:"rgba(255,255,255,0.14)",strokeWidth:0.5}),
              style!=="C"?jsx_runtime.jsx("line",{x1:0,y1:H/2,x2:W,y2:H/2,stroke:"rgba(255,255,255,0.08)",strokeWidth:0.5,strokeDasharray:"2 3"}):null,
              jsx_runtime.jsx("path",{d:area,fill:"url(#oq-line-fill)",stroke:"none"}),
              prevLine?jsx_runtime.jsx("path",{d:"M"+prevLine.split(" ").join(" L"),fill:"none",stroke:"rgba(255,255,255,0.35)",strokeWidth:1,strokeDasharray:"3 3","stroke-linejoin":"round"}):null,
              hitLine?jsx_runtime.jsx("path",{d:"M"+hitLine.split(" ").join(" L"),fill:"none",stroke:C_CACHE,strokeWidth:1,strokeDasharray:"4 2","stroke-linejoin":"round",opacity:0.9}):null,
              jsx_runtime.jsx("path",{d:"M"+line.split(" ").join(" L"),fill:"none",stroke:C_FRESH,strokeWidth:1.4,"stroke-linejoin":"round","stroke-linecap":"round"}),
              pts.map(function(p,i){ return jsx_runtime.jsx("circle",{cx:p[0],cy:p[1],r:n>20?0.9:1.6,fill:C_FRESH},i); }),
              jsx_runtime.jsx("defs",{children:jsx_runtime.jsx("linearGradient",{id:"oq-line-fill",x1:0,y1:0,x2:0,y2:1,children:[
                jsx_runtime.jsx("stop",{offset:"0%",stopColor:C_FRESH,stopOpacity:0.35}),
                jsx_runtime.jsx("stop",{offset:"100%",stopColor:C_FRESH,stopOpacity:0.02}),
              ]})}),
            ]}),
          ]});
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[
            style==="B"?chartSummaryRow(rows):null,
            style==="A"
              ? jsx_runtime.jsxs("div",{style:{display:"flex",gap:4},children:[chartAxisCol(max), svg]})
              : svg,
            jsx_runtime.jsxs("div",{className:"oq-line-x",children: rows.map(function(d,i){
              var show = n<=12 || i===0 || i===n-1 || i%Math.ceil(n/8)===0;
              var p=Number(d.prompt||0), cr=Number(d.cache_read||0);
              var h=p>0?(cr/p*100).toFixed(1)+"%":"—";
              return jsx_runtime.jsx("span",{title:d.date+" · "+fmtNum(valOf(d))+" · 命中 "+h,children:show?String(d.date).slice(5):""},d.date);
            })}),
            jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),modelFilter?("仅 "+modelFilter):"每日总量"]}),
              hitLine?jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_CACHE}}),"缓存命中率"]}):null,
              prevLine?jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:"rgba(255,255,255,0.45)"}}),"上期同长窗口"]}):null,
              style!=="C"?jsx_runtime.jsx("span",{className:"oq-legend-item",style:{marginLeft:"auto"},children:peakLabel(max)}):null,
            ]}),
          ]});
        }

        // 热力图：按自然月展示，可左右切换（保留 90 天 ≈ 近 3 个月）。
        // 点击某天 → 下方展开当天明细。这才是真"下钻"：hourly 只保 2 天，
        // 历史某天没有分时数据，所以不伪造分时图，而是给当日汇总 + 模型构成。
        function renderMonthHeat(daily, monthOffset){
          var byDate={}; (daily||[]).forEach(function(d){ if(d&&d.date) byDate[d.date]=d; });
          var tStr=localDayStr();
          var parts=tStr.split("-").map(Number);
          var off=Number(monthOffset)||0;
          var mdt=new Date(parts[0], parts[1]-1+off, 1);
          var y=mdt.getFullYear(), m=mdt.getMonth();
          var monthPrefix=y+"-"+String(m+1).padStart(2,"0")+"-";
          var lead=(new Date(y,m,1).getDay()+6)%7;
          var daysInMonth=new Date(y,m+1,0).getDate();
          var focus=tmDayFocus[0]||"";
          // 分档基准：当月数据按用量排序取分位（见 heatLvOf），当月样本不足时回落到
          // sqrt(v/max) 连续映射，保证 2-3 个数据点也能拉开档位
          var monthVals=[];
          var maxInMonth=0, maxAll=1;
          Object.keys(byDate).forEach(function(k){
            var v=Number(byDate[k].total||0);
            if(v>maxAll) maxAll=v;
            if(k.indexOf(monthPrefix)===0){
              if(v>maxInMonth) maxInMonth=v;
              if(v>0) monthVals.push(v);
            }
          });
          var max = maxInMonth>0 ? maxInMonth : maxAll;
          var useQuantile = monthVals.length>=4;
          if(useQuantile) monthVals.sort(function(a,b){return a-b;});
          function lvOf(v){ return heatLvOf(v, monthVals, useQuantile, max); }
          var rowsTotal=Math.ceil((lead+daysInMonth)/7);
          var wdCn=["日","一","二","三","四","五","六"];
          var weeks=[]; var idx=0;
          for(var r=0;r<rowsTotal;r++){
            var cells=[];
            for(var cc=0;cc<7;cc++){
              var dayNum=r*7+cc-lead+1;
              if(dayNum>=1&&dayNum<=daysInMonth){
                var key=y+"-"+String(m+1).padStart(2,"0")+"-"+String(dayNum).padStart(2,"0");
                var d2=byDate[key];
                var v2=d2?Number(d2.total||0):0;
                var cls="oq-heat-cell"; var lv=0;
                if(d2&&v2>0){ lv=lvOf(v2); cls+=" oh"+lv; }
                else if(key>tStr) cls+=" oh-future";
                if(key===tStr) cls+=" oh-today";
                if(v2>0&&v2===max) cls+=" oh-max";
                if(key===focus) cls+=" oh-sel";
                if(cc===0) cls+=" oh-el";
                if(cc===6) cls+=" oh-er";
                var dnum=new Date(y,m,dayNum);
                var payload={has:!!d2,total:v2,prompt:d2?Number(d2.prompt||0):0,out:d2?Number(d2.completion||0):0,cacheRead:d2?Number(d2.cache_read||0):0,requests:d2?(d2.requests||0):0,tools:d2?(d2.tools||0):null,models:(d2&&Array.isArray(d2.models))?d2.models:null,lv:lv,isMax:(v2>0&&v2===max),head:(m+1)+"月"+dayNum+"日 · 周"+wdCn[dnum.getDay()]};
                // ⚠️ key / v2 是 for 里的 var（函数作用域）：必须显式传进 IIFE，
                // 否则每个格子的 onClick 都会在点击时读到"最后一格"的值——
                // 实测就是当月 31 号（未来、无数据）→ if(v2>0) 恒假 → 点击完全无反应。
                if(v2>0) cls+=" oh-clickable";
                (function(payload,cls,idx,cellKey,hasData){
                  cells.push(jsx_runtime.jsx("div",{className:cls,
                    onClick:function(){ if(!hasData) return; var nx=(cellKey===focus?"":cellKey); tmDayFocus[1](nx); loadDayDetail(nx); },
                    onMouseEnter:function(ev){
                      var el=ev.currentTarget;
                      if(heatShowT){ clearTimeout(heatShowT); heatShowT=null; }
                      if(heatHideT){ clearTimeout(heatHideT); heatHideT=null; }
                      heatShowT=setTimeout(function(){ heatTipShow(el,payload); },80);
                      jellyCell(el,true);
                    },
                    onMouseLeave:function(ev){
                      if(heatShowT){ clearTimeout(heatShowT); heatShowT=null; }
                      heatHideT=setTimeout(function(){ heatTipHide(); heatHideT=null; },40);
                      jellyCell(ev.currentTarget,false);
                    }
                  },"hc"+idx));
                })(payload,cls,idx,key,v2>0);
              } else {
                cells.push(jsx_runtime.jsx("div",{className:"oq-heat-cell oh-empty"},"he"+idx));
              }
              idx++;
            }
            weeks.push(jsx_runtime.jsx("div",{className:"oq-heat-week",children:cells},"w"+r));
          }
          var fd=focus?byDate[focus]:null;
          var fdModels=(fd&&Array.isArray(fd.models))?fd.models.slice(0,3):[];
          return jsx_runtime.jsxs("div",{className:"oq-hm-lg",style:{display:"flex",flexDirection:"column",gap:3},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,marginBottom:2},children:[
              jsx_runtime.jsx("button",{type:"button",style:Object.assign({},styles.iconBtn,{width:20,height:20,fontSize:11,padding:0}),disabled:off<=-2,
                onClick:function(){ tmHeatMonth[1](Math.max(-2,off-1)); },title:"上一个月（保留 90 天，最多回看 3 个月）",children:"‹"}),
              jsx_runtime.jsx("span",{style:{fontSize:"10px",fontWeight:700,color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:y+" 年 "+(m+1)+" 月"}),
              jsx_runtime.jsx("button",{type:"button",style:Object.assign({},styles.iconBtn,{width:20,height:20,fontSize:11,padding:0}),disabled:off>=0,
                onClick:function(){ tmHeatMonth[1](Math.min(0,off+1)); },title:"下一个月",children:"›"}),
              off!==0?jsx_runtime.jsx("button",{type:"button",style:Object.assign({},styles.hint,{background:"none",border:"none",cursor:"pointer",padding:0}),onClick:function(){ tmHeatMonth[1](0); },children:"回到本月"}):null,
            ]}),
            jsx_runtime.jsx("div",{style:{display:"flex",gap:3},children:["一","二","三","四","五","六","日"].map(function(w,i){ return jsx_runtime.jsx("span",{style:{flex:1,fontSize:"10px",textAlign:"center",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:w},i); })}),
            jsx_runtime.jsx("div",{style:{display:"flex",flexDirection:"column",gap:3,width:"100%"},children:weeks}),
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"少"}),
              heatSwatchEls(12,3),
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"多"}),
            ]}),
            focus?jsx_runtime.jsxs("div",{style:{marginTop:4,paddingTop:6,borderTop:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))",display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)"},children:focus}),
              fd?jsx_runtime.jsxs("span",{style:styles.hint,children:[
                "总量 "+fmtTokens(fd.total||0)+" · 新输入 "+fmtNum(Math.max(0,Number(fd.prompt||0)-Number(fd.cache_read||0)))+" · 缓存读 "+fmtNum(fd.cache_read||0)+" · 输出 "+fmtNum(fd.completion||0),
                " · 回复 "+(fd.requests||0)+" · 步数 "+(fd.steps||0)+" · 工具 "+(fd.tools||0),
              ]}):jsx_runtime.jsx("span",{style:styles.hint,children:"当天无数据"}),
              fdModels.length?jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{flexBasis:"100%"}),children:"模型：" + fdModels.map(function(x){ return x.model+" "+fmtNum(x.total); }).join(" · ")}):null,
              jsx_runtime.jsx("button",{type:"button",style:Object.assign({},styles.iconBtn,{width:18,height:18,marginLeft:"auto",fontSize:10,padding:0}),onClick:function(){ tmDayFocus[1](""); },title:"收起",children:"✕"}),
            ]}):null,
          ]});
        }
        function heatColor(lv){ return "var(--bmon-h"+lv+",#252831)"; }

        // ── 单日详情块（热力图点某天 / 明细表点某行共用）────────────────────
        // 旧实现里热力图的"当日摘要"是自己拼的（只有总量+模型 Top3），与明细表下钻是两套。
        // 现在统一走 host 的 /api/token-meter/day：分时 24 列 + 模型/工具/项目/渠道 + 会话 + 调用。
        function renderDayDetail(){
          var d=dayDetail[0];
          if(dayDetailBusy[0]) return jsx_runtime.jsx("div",{style:styles.hint,children:"正在读取 "+ (d&&d.date? d.date : "当天") +" 的明细…"});
          if(dayDetailErr[0]) return jsx_runtime.jsx("div",{style:Object.assign({},styles.hint,{color:"#ef4444"}),children:"单日明细加载失败："+dayDetailErr[0]});
          if(!d) return null;
          var t=d.totals||{};
          var hours=Array.isArray(d.hours)?d.hours:[];
          var maxH=0; hours.forEach(function(v){ if(v>maxH) maxH=v; });
          if(maxH<=0) maxH=1;
          var topModels=(d.models||[]).slice(0,4);
          var topTools=(d.tools||[]).slice(0,5);
          var topProjects=(d.projects||[]).slice(0,4);
          var topSessions=(d.sessions||[]).slice(0,5);
          var recs=d.records||[];
          function kv(k,v,color){ return jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",gap:8,fontSize:"10px",lineHeight:1.5},children:[
            jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:k}),
            jsx_runtime.jsx("b",{style:{color:color||"var(--dsw-alias-label-primary,#fff)",fontVariantNumeric:"tabular-nums"},children:v}),
          ]}); }
          return jsx_runtime.jsxs("div",{style:{marginTop:6,paddingTop:8,borderTop:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))",display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)"},children:d.date}),
              jsx_runtime.jsx("span",{style:styles.hint,children:"总量 "+fmtTokens(t.total||0)+" · 回复 "+(t.requests||0)+" · 步数 "+(t.steps||0)+" · 工具 "+(t.tools||0)}),
              d.avgMs?jsx_runtime.jsx("span",{style:styles.hint,children:"平均响应 "+fmtDur(d.avgMs)}):null,
              // 当天另含网关多少：网关没有小时桶，所以它**不在上面的分时图里**，
              // 但在上面的"总量"里。不说清就会出现"分时加起来对不上总量"。
              d.gateway?jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{color:"#8b7bff"}),title:"网关流量只有日聚合，没有分时数据（UTC+8 日界）",children:"另含网关 "+fmtTokens(d.gateway.total)+" · "+(d.gateway.requests||0)+" 次（无分时）"}):null,
              jsx_runtime.jsx("button",{type:"button",style:Object.assign({},styles.iconBtn,{width:18,height:18,marginLeft:"auto",fontSize:10,padding:0}),onClick:function(){ dayDetail[1](null); tmDayFocus[1](""); },title:"收起",children:"✕"}),
            ]}),
            // 24 小时分布：没有分时数据就整块不画（不要伪造一条平线）
            (d.hoursTotal>0)?jsx_runtime.jsxs("div",{children:[
              jsx_runtime.jsx("div",{style:Object.assign({},styles.hint,{marginBottom:2}),children:"分时（本地小时）"}),
              jsx_runtime.jsx("div",{className:"oq-chart",style:{height:"46px"},children: hours.map(function(v,i){
                var h=Math.max(1,Math.round(v/maxH*40));
                return jsx_runtime.jsx("div",{className:"oq-chart-col",title:String(i).padStart(2,"0")+":00  "+fmtNum(v),children:jsx_runtime.jsx("div",{className:"oq-chart-bar",style:{height:h+"px",minHeight:v>0?2:1,background:v>0?undefined:"transparent",borderColor:v>0?undefined:"transparent"}})},i);
              })}),
              jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",fontSize:"9px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:[
                jsx_runtime.jsx("span",{children:"00"}),jsx_runtime.jsx("span",{children:"06"}),jsx_runtime.jsx("span",{children:"12"}),jsx_runtime.jsx("span",{children:"18"}),jsx_runtime.jsx("span",{children:"23"}),
              ]}),
            ]}):null,
            jsx_runtime.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8},children:[
              kv("新输入",fmtNum(t.freshInput||0)),
              kv("缓存读",fmtNum(t.cacheRead||0)),
              kv("输出",fmtNum(t.output||0)),
              kv("缓存命中率",t.cacheHitRate==null?"—":t.cacheHitRate+"%"),
            ]}),
            topModels.length?jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:2},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{fontWeight:600}),children:"模型"}),
              topModels.map(function(m){ return kv(m.model, fmtNum(m.total)+"  ·  "+(m.requests||0)+" 回复"); }),
            ]}):null,
            topProjects.length?jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:2},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{fontWeight:600}),children:"项目"}),
              topProjects.map(function(p){ return kv(p.project||"—", fmtNum(p.total)); }),
            ]}):null,
            topTools.length?jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:2},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{fontWeight:600}),children:"工具"}),
              topTools.map(function(x){ return kv(x.tool, (x.calls||0)+" 次 · "+fmtDur(x.avgMs)); }),
            ]}):null,
            topSessions.length?jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:2},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{fontWeight:600}),children:"会话"}),
              topSessions.map(function(s){ return kv((s.title||s.project||s.sessionId)+"  "+String(s.sessionId).slice(0,8), fmtNum(s.total)+"  ·  "+(s.requests||0)+" 回复"); }),
            ]}):null,
            recs.length?jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:1},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{fontWeight:600}),children:"当日调用（最近 "+recs.length+" 条，点击复制）"}),
              recs.slice(0,20).map(function(r,i){
                return jsx_runtime.jsxs("div",{className:"oq-recbar",title:recTip(r),onClick:function(){ recCopy(r); },children:[
                  jsx_runtime.jsx("span",{className:"w",children:fmtRecTime(r.time).slice(-8)}),
                  jsx_runtime.jsx("span",{className:"m",children:r.model||"—"}),
                  jsx_runtime.jsx("span",{style:{flex:1,textAlign:"right",fontVariantNumeric:"tabular-nums"},children:fmtNum(r.input)+" → "+fmtNum(r.output)}),
                ]},i);
              }),
            ]}):null,
          ]});
        }

        // ── 逐日明细表 ────────────────────────────────────────────────────
        // 列按用户选择：基础(日期/总量/回复) + 拆分(新输入/缓存读/输出) + 扩展(Top模型/项目/耗时)。
        // 合计行用 totals（不是把表格行加起来），因为窗口里可能有"有工具但无回复"的天不进行。
        function renderDailyDetail(daily, totals, win){
          var rows=(daily||[]).filter(function(d){ return d && d.date; });
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"所选区间没有逐日数据"});
          var sk=detailSort[0]||"date";
          var desc=/-desc$/.test(sk);
          var key=sk.replace(/-desc$/,"");
          var sorted=rows.slice();
          sorted.sort(function(a,b){
            var va=detailVal(a,key), vb=detailVal(b,key);
            var r;
            if(key==="date"||key==="topProject") r=String(va).localeCompare(String(vb));
            else r=(Number(va)||0)-(Number(vb)||0);
            return desc? -r : r;
          });
          // 默认 date 升序更符合"时间轴"直觉；其它列默认降序（先看最大值）
          if(key!=="date" && !desc && sk===key){
            // 首次点非日期列 → 降序
            sorted.reverse();
          }
          var cols="76px minmax(0,1fr) 44px 62px 62px 52px 74px 56px";
          var head=DETAIL_COLS.map(function(c){
            var active=key===c[0];
            return jsx_runtime.jsx("span",{
              onClick:function(){ toggleDetailSort(c[0]); },
              title:"点击按"+c[1]+"排序",
              style:{cursor:"pointer",color:active?"var(--bmon-c3,#c65f7f)":"var(--dsw-alias-label-caption,#9a9aaa)",fontWeight:active?700:500,userSelect:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
              children:c[1]+(active?(desc?" ↓":" ↑"):""),
            },c[0]);
          });
          var t=totals||{};
          var winNote=(win && win.clipped)?"已裁剪为实际可查范围 "+(win.from||"")+" ~ "+(win.to||""):"";
          return jsx_runtime.jsxs("div",{children:[
            winNote?jsx_runtime.jsx("div",{style:Object.assign({},styles.hint,{color:"#d97706",marginBottom:4}),children:winNote}):null,
            jsx_runtime.jsxs("div",{style:{display:"grid",gridTemplateColumns:cols,gap:6,padding:"3px 0 5px",borderBottom:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"},children:head}),
            sorted.map(function(d,i){
              var isFocus=tmDayFocus[0]===d.date;
              return jsx_runtime.jsxs("div",{
                onClick:function(){ tmDayFocus[1](isFocus?"":d.date); loadDayDetail(isFocus?"":d.date); },
                title:"点击查看 "+d.date+" 的单日明细",
                style:{display:"grid",gridTemplateColumns:cols,gap:6,padding:"3px 0",fontSize:"10px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",
                  background:isFocus?"rgba(139,123,255,0.10)":"transparent",fontVariantNumeric:"tabular-nums"},
                children:[
                  jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:d.date.slice(5)}),
                  jsx_runtime.jsx("b",{style:{color:"var(--dsw-alias-label-primary,#fff)"},children:fmtTokens(d.total||0)}),
                  jsx_runtime.jsx("span",{children:String(d.requests||0)}),
                  jsx_runtime.jsx("span",{style:{color:"#6b87d9"},children:fmtNum(Math.max(0,Number(d.prompt||0)-Number(d.cache_read||0)))}),
                  jsx_runtime.jsx("span",{style:{color:"#b08427"},children:fmtNum(d.cache_read||0)}),
                  jsx_runtime.jsx("span",{style:{color:"#c65f7f"},children:fmtNum(d.completion||0)}),
                  jsx_runtime.jsx("span",{style:{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:d.topProject||"—"}),
                  jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:d.avgMs==null?"—":fmtDur(d.avgMs)}),
                ],
              },d.date+"-"+i);
            }),
            // 合计：用 totals 而不是 sum(rows)，两者在"有工具无回复"的天上会有差别
            jsx_runtime.jsxs("div",{style:{display:"grid",gridTemplateColumns:cols,gap:6,padding:"4px 0",marginTop:2,borderTop:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.12))",fontSize:"10px",fontWeight:700,fontVariantNumeric:"tabular-nums"},children:[
              jsx_runtime.jsx("span",{children:"合计"}),
              jsx_runtime.jsx("span",{style:{color:"var(--bmon-c3,#c65f7f)"},children:fmtTokens(t.total||0)}),
              jsx_runtime.jsx("span",{children:String(t.requests||0)}),
              jsx_runtime.jsx("span",{style:{color:"#6b87d9"},children:fmtNum(t.freshInput||0)}),
              jsx_runtime.jsx("span",{style:{color:"#b08427"},children:fmtNum(t.cache_read||0)}),
              jsx_runtime.jsx("span",{style:{color:"#c65f7f"},children:fmtNum(t.completion||0)}),
              jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:rows.length+" 天"}),
              jsx_runtime.jsx("span",{}),
            ]}),
            dayDetail[0]?renderDayDetail():null,
          ]});
        }
        // 图表卡里的「自定义」控件：两个 date input + 应用/取消。
        // 约束：起止都由 host 裁剪（未来日、90 天保留窗口、reset_at），这里只挡"from>to"的即时体感。
        function renderCustomRangeBar(){
          var cr=customRange[0]||loadCustomRange();
          return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",margin:"6px 0 2px"},children:[
            jsx_runtime.jsx("span",{style:styles.hint,children:"从"}),
            jsx_runtime.jsx("input",{
              type:"date", value:cr.from,
              onChange:function(e){ var v=String(e.target.value||""); if(v) customRange[1]({from:v,to:cr.to}); },
              style:styles.inputSmall,
            }),
            jsx_runtime.jsx("span",{style:styles.hint,children:"到"}),
            jsx_runtime.jsx("input",{
              type:"date", value:cr.to,
              onChange:function(e){ var v=String(e.target.value||""); if(v) customRange[1]({from:cr.from,to:v}); },
              style:styles.inputSmall,
            }),
            jsx_runtime.jsx("button",{type:"button",style:styles.btn,onClick:function(){ setCustomRange(customRange[0]||cr); },title:"按所选起止查询",children:"应用"}),
            jsx_runtime.jsx("button",{type:"button",style:styles.hint,onClick:function(){
              var dft=defaultCustomRange(); setCustomRange(dft);
            },children:"近 7 天"}),
            jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{flexBasis:"100%"}),children:"可查范围最多近 90 天；超出部分会自动裁剪，起止写反自动交换。"}),
          ]});
        }
        // 时段热力：7 行（周一..周日）× 24 列（小时）。数据来自 host 的 daily_hour，
        // 覆盖 90 天窗口——回答"我一般在什么时间最费 token"。
        function renderHourHeat(hours){
          var rows=Array.isArray(hours)?hours:[];
          var vals=[];
          rows.forEach(function(r){ (r||[]).forEach(function(v){ if(v>0) vals.push(v); }); });
          if(!vals.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无时段数据（产生带 usage 的对话事件后自动出现）"});
          var max=1; vals.forEach(function(v){ if(v>max) max=v; });
          var useQ=vals.length>=4;
          var sorted=vals.slice().sort(function(a,b){ return a-b; });
          var order=[1,2,3,4,5,6,0];
          var wdCn=["日","一","二","三","四","五","六"];
          var peak=0, peakAt="";
          rows.forEach(function(r,d){ (r||[]).forEach(function(v,h){ if(v>peak){ peak=v; peakAt="周"+wdCn[d]+" "+String(h).padStart(2,"0")+":00"; } }); });
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[
            order.map(function(dow){
              var r=rows[dow]||[];
              return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:2},children:[
                jsx_runtime.jsx("span",{style:{width:14,flex:"none",fontSize:9,color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:wdCn[dow]}),
                jsx_runtime.jsx("div",{style:{display:"flex",gap:2,flex:1},children: Array.from({length:24}).map(function(_,h){
                  var v=Number(r[h]||0);
                  var lv=v>0?heatLvOf(v, useQ?sorted:null, useQ, max):0;
                  return jsx_runtime.jsx("span",{
                    title:"周"+wdCn[dow]+" "+String(h).padStart(2,"0")+":00 · "+(v>0?fmtTokens(v):"无数据"),
                    style:{flex:1,height:"13px",borderRadius:"3px",background:heatColor(lv),outline:v>0?undefined:"1px solid rgba(255,255,255,0.03)"},
                  },"h"+h);
                })}),
              ]},"d"+dow);
            }),
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:2},children:[
              jsx_runtime.jsx("span",{style:{width:14,flex:"none"}}),
              jsx_runtime.jsx("div",{style:{display:"flex",gap:2,flex:1},children:[0,6,12,18,23].map(function(h,i){
                return jsx_runtime.jsx("span",{style:{flex:1,fontSize:8,textAlign:"center",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:h+""},i);
              })}),
            ]}),
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:4,marginTop:2},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"少"}),
              heatSwatchEls(12,3),
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"多"}),
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:"auto"}),children:"峰值 "+peakAt+" · "+fmtTokens(peak)}),
            ]}),
          ]});
        }
        function renderTokenMeterChart(){
          if(meterLoading[0] && !meterData[0]) return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8},children:[jsx_runtime.jsx("span",{style:styles.spinner}),jsx_runtime.jsx("span",{style:styles.hint,children:"加载中…"})]});
          if(meterError[0]) return jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"#ef4444"},children: meterError[0]});
          var data=meterData[0];
          if(!data) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无数据"});
          var st=data.stats||data;
          var filter=tmModelFilter[0]||"";
          if(tmChartState[0]==="heat"){
            return renderMonthHeat(Array.isArray(st.daily)?st.daily:[], tmHeatMonth[0]);
          }
          if(tmChartState[0]==="hour"){
            return renderHourHeat(data.hours);
          }
          if(meterRangeState[0]!=="1d"){
            if(tmChartState[0]==="line") return renderLineChart(Array.isArray(st.daily)?st.daily:[], filter, data.prevDaily);
            return renderDailyBars(Array.isArray(st.daily)?st.daily:[], filter);
          }
          // 只渲染"今天"的小时桶（分组规则见 groupTodayHourBuckets）
          var byHour=groupTodayHourBuckets(data.hourly, localDayStr(), filter);
          var hours=Object.keys(byHour).sort();
          if(hours.length===0){
            var dlToday=Array.isArray(st.daily)?st.daily:[];
            if(dlToday.length) return tmChartState[0]==="line"?renderLineChart(dlToday,filter,data.prevDaily):renderDailyBars(dlToday,filter);
            return jsx_runtime.jsx("div",{style:styles.hint,children:"今日暂无分时数据（产生带 usage 的对话事件后自动出现）"});
          }
          var maxTotal=0;
          hours.forEach(function(h){
            var sum=0; byHour[h].forEach(function(v){ sum+= (v.uncachedInputTokens||0)+(v.outputTokens||0)+(v.cacheReadTokens||0)+(v.cacheWriteTokens||0); });
            if(sum>maxTotal) maxTotal=sum;
          });
          if(maxTotal===0) maxTotal=1;
          var colorMap=TM_COLORS;
          var hasWrite=false;
          hours.forEach(function(h){ byHour[h].forEach(function(v){ if(Number(v.cacheWriteTokens||0)>0) hasWrite=true; }); });
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{className:"oq-chart"+(tmUsageStyle[0].chart==="C"?"":" oq-chart-grid"),children:[
              jsx_runtime.jsx("div",{className:"oq-chart-cols",children: hours.map(function(hour){
                var list=byHour[hour];
                var agg={uncachedInputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0};
                list.forEach(function(v){ agg.uncachedInputTokens+=v.uncachedInputTokens||0; agg.outputTokens+=v.outputTokens||0; agg.cacheReadTokens+=v.cacheReadTokens||0; agg.cacheWriteTokens+=v.cacheWriteTokens||0; });
                var hourTotal=agg.uncachedInputTokens+agg.outputTokens+agg.cacheReadTokens+agg.cacheWriteTokens;
                var barH=barHeightFor(hourTotal, maxTotal);
                var label = (function(){ try{ var d=new Date(hour); if(!isNaN(d.getTime())) return String(d.getHours()).padStart(2,"0")+":00"; }catch(e){} return hour.slice(11,13)+":00"; })();
                var modelTips = list.map(function(v){ return v.model+":"+fmtNum(v.uncachedInputTokens+v.outputTokens+v.cacheReadTokens+v.cacheWriteTokens); }).join(" | ");
                return jsx_runtime.jsxs("div",{className:"oq-chart-col",title: modelTips+" ("+fmtNum(hourTotal)+")",children:[
                  jsx_runtime.jsxs("div",{className:"oq-chart-bar",style:{height:barH+"px",minHeight:CHART_MIN_H+"px",background:hourTotal>0?undefined:"transparent",borderColor:hourTotal>0?undefined:"transparent"},children: hourTotal>0?[
                    hasWrite?jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height:(agg.cacheWriteTokens/hourTotal*100)+"%", background:colorMap.cacheWriteTokens}}):null,
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height:(agg.cacheReadTokens/hourTotal*100)+"%", background:colorMap.cacheReadTokens}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height:(agg.outputTokens/hourTotal*100)+"%", background:colorMap.outputTokens}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height:(agg.uncachedInputTokens/hourTotal*100)+"%", background:colorMap.uncachedInputTokens}}),
                  ]:null}),
                  jsx_runtime.jsx("span",{className:"oq-chart-label",children:label}),
                ]}, hour);
              })}),
              tmUsageStyle[0].chart!=="C"?jsx_runtime.jsx("div",{className:"oq-chart-foot",children:peakLabel(maxTotal)}):null,
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:colorMap.uncachedInputTokens}}),"新输入"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:colorMap.outputTokens}}),"输出"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:colorMap.cacheReadTokens}}),"缓存读"]}),
              // 缓存写只在真有值时出现：宿主 usage 目前根本没有 cacheWriteTokens 字段（实测恒 0），
              // 无条件画一段永远为 0 的图例只会让人以为"这段数据丢了"
              hasWrite?jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:colorMap.cacheWriteTokens}}),"缓存写"]}):null,
            ]})
          ]});
        }

        // 设置页专用的轻量分段按钮（不依赖 useEffect 状态对，供排序/切换用）
        function sortPills(opts, current, onSet){
          return jsx_runtime.jsx("div",{style:{display:"inline-flex",gap:4},children: opts.map(function(p){
            var k=p[0], txt=p[1], active=current===k;
            return jsx_runtime.jsx("button",{key:k,onClick:function(){ onSet(k); },
              style:{padding:"2px 8px",borderRadius:999,fontSize:"10px",fontWeight:active?700:500,border:"1px solid "+(active?ACCENT:"var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"),background:active?"rgba(109,91,255,0.14)":"transparent",color:active?"var(--dsw-alias-state-business-primary,#8b7bff)":"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:"pointer",fontFamily:"inherit"},children:txt});
          })});
        }
        // 模型排行：支持按 总量/请求/缓存读 排序、显示渠道标注、点击筛选图表
        function modelRank(models, sortKey, filter, onPick, onSort){
          if(!models || !models.length) return null;
          var arr=models.filter(function(m){ return m && m.model; }).map(function(m){
            return { model:m.model, total:Number(m.total||0), requests:Number(m.requests||0), cacheRead:Number(m.cacheRead||0), output:Number(m.output||0), freshInput:Math.max(0,Number(m.input||0)-Number(m.cacheRead||0)) };
          });
          if(!arr.length) return null;
          var sum=0; arr.forEach(function(a){ sum+=a.total; });
          if(sum<=0) return null;
          var key=sortKey||"total";
          arr.sort(function(a,b){
            var av=key==="requests"?a.requests:(key==="cacheRead"?a.cacheRead:a.total);
            var bv=key==="requests"?b.requests:(key==="cacheRead"?b.cacheRead:b.total);
            return bv-av;
          });
          var top=arr.slice(0,5), rest=arr.slice(5);
          var rs=0; rest.forEach(function(a){ rs+=a.total; });
          function row(a,i,isRest){
            var pct=a.total/sum*100;
            var pctTxt=pct<1?"<1%":(Math.round(pct)+"%");
            var active=filter&&filter===a.model;
            return jsx_runtime.jsxs("div",{className:"oq-rank-row",style:{cursor:"pointer",opacity:filter&&!active?0.55:1},
              onClick:function(){ if(!isRest) onPick(filter===a.model?"":a.model); },
              title:(isRest?"其余 "+(rest.length):a.model)+" · "+fmtNum(a.total)+"（"+pctTxt+"）· 请求 "+a.requests+" · 输出 "+fmtNum(a.output)+" · 缓存读 "+fmtNum(a.cacheRead)+(isRest?"":"\n点击"+(filter===a.model?"取消筛选":"只看这个模型")),
              children:[
                jsx_runtime.jsx("span",{className:"oq-rank-name",children:(active?"◉ ":"")+a.model}),
                jsx_runtime.jsx("span",{className:"oq-rank-track",children:jsx_runtime.jsx("span",{className:"oq-rank-fill",style:{width:Math.max(2,pct)+"%",opacity:Math.max(0.45,1-i*0.12)}})}),
                jsx_runtime.jsx("span",{className:"oq-rank-val",children:pctTxt+" · "+fmtNum(a.total)}),
              ]}, a.model+"-"+i);
          }
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"},children:[
              jsx_runtime.jsx("span",{style:styles.hint,children:"排序"}),
              sortPills([["total","总量"],["requests","请求"],["cacheRead","缓存读"]], sortKey, onSort||function(){}),
              filter?jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ onPick(""); },children:"清除筛选"}):null,
            ]}),
            top.map(function(a,i){ return row(a,i,false); }),
            rest.length?row({model:"其他 "+rest.length+" 个",total:rs,requests:0,cacheRead:0,output:0},top.length,true):null,
          ]});
        }
        function fmtRecTime(t){
          var s=String(t||"");
          var d=new Date(s);
          if(!isNaN(d.getTime())){
            var day=localDayStr();
            var ds=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
            var hm=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0");
            return (ds===day?"":ds.slice(5)+" ")+hm;
          }
          var mm=s.match(/(\d{2}):(\d{2}):(\d{2})/);
          return mm?mm[0]:s.slice(0,19);
        }
        // 单条调用 → 可复制的文本（"最近调用"点击行即复制）
        function recLine(r){
          return fmtRecTime(r.time)+"  "+(r.model||"—")
            +(r.provider?" ["+r.provider+"]":"")
            +(r.project?" @"+r.project:"")
            +"  新输入 "+fmtNum(r.input)+" / 输出 "+fmtNum(r.output)
            +(Number(r.cacheRead||0)>0?" / 缓存读 "+fmtNum(r.cacheRead):"")
            +(Number(r.durationMs||0)>0?"  耗时 "+fmtDur(r.durationMs):"")
            +"  会话 "+(r.sessionId||"—");
        }
        function recCopy(r){
          var ok=copyText(recLine(r));
          showToast("meter",ok,ok?"已复制该条调用":"复制失败（剪贴板被拦截）");
        }
        function recTip(r){
          return [(r.model||"—"),
            r.provider?("渠道 "+r.provider):"",
            r.project?("项目 "+r.project):"",
            "会话 "+(r.sessionId||"—"),
            "耗时 "+fmtDur(r.durationMs),
            "点击复制该行"].filter(Boolean).join(" · ");
        }
        // A：时间线（左侧圆点 + 竖线，右侧两行 + token 微条）
        function recA(rows){
          return jsx_runtime.jsx("div",{className:"oq-tl",children: rows.map(function(r){
            var total=(Number(r.input)||0)+(Number(r.output)||0)+(Number(r.cacheRead)||0)||1;
            var fr=(Number(r.input)||0)/total*100, ca=(Number(r.cacheRead)||0)/total*100, ou=(Number(r.output)||0)/total*100;
            return jsx_runtime.jsxs("div",{className:"it",title:recTip(r),onClick:function(){ recCopy(r); },children:[
              jsx_runtime.jsxs("div",{className:"l1",children:[
                jsx_runtime.jsx("span",{className:"t",children:fmtRecTime(r.time)}),
                jsx_runtime.jsx("span",{className:"m",children:r.model||"—"}),
                jsx_runtime.jsxs("span",{className:"d",children:[fmtNum(r.input)," → ",fmtNum(r.output)]}),
                jsx_runtime.jsx("span",{className:"d",style:{color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:fmtDur(r.durationMs)}),
              ]}),
              jsx_runtime.jsxs("div",{className:"l2",children:[
                jsx_runtime.jsx("span",{style:{minWidth:"0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:r.project||"—"}),
                Number(r.cacheRead||0)>0?jsx_runtime.jsxs("span",{children:["缓存 ",fmtNum(r.cacheRead)]}):null,
                jsx_runtime.jsxs("span",{className:"tok",children:[
                  jsx_runtime.jsx("i",{style:{width:fr+"%",background:C_FRESH}}),
                  jsx_runtime.jsx("i",{style:{width:ca+"%",background:C_CACHE}}),
                  jsx_runtime.jsx("i",{style:{width:ou+"%",background:C_OUT}}),
                ]}),
              ]}),
            ]},"tl"+r.time+(r.model||""));
          })});
        }
        // B：紧凑表格（表头 + 斑马纹 + 右对齐数字）
        function recB(rows){
          var cols="56px minmax(0,1fr) minmax(0,0.8fr) 52px 56px 46px 40px";
          return jsx_runtime.jsxs("div",{className:"oq-tbl",children:[
            jsx_runtime.jsxs("div",{className:"th",style:{display:"grid",gridTemplateColumns:cols},children:[
              jsx_runtime.jsx("span",{children:"时间"}),jsx_runtime.jsx("span",{children:"模型"}),jsx_runtime.jsx("span",{children:"项目"}),
              jsx_runtime.jsx("span",{className:"n",children:"新输入"}),jsx_runtime.jsx("span",{className:"n",children:"缓存读"}),
              jsx_runtime.jsx("span",{className:"n",children:"输出"}),jsx_runtime.jsx("span",{className:"n",children:"耗时"}),
            ]}),
            rows.map(function(r,i){
              return jsx_runtime.jsxs("div",{className:"tr",style:{display:"grid",gridTemplateColumns:cols},title:recTip(r),onClick:function(){ recCopy(r); },children:[
                jsx_runtime.jsx("span",{className:"n",style:{textAlign:"left",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:fmtRecTime(r.time)}),
                jsx_runtime.jsx("span",{className:"nm",children:r.model||"—"}),
                jsx_runtime.jsx("span",{className:"nm",style:{color:"var(--dsw-alias-label-caption,#9a9aaa)",fontSize:"9px"},children:r.project||"—"}),
                jsx_runtime.jsx("span",{className:"n",children:fmtNum(r.input)}),
                jsx_runtime.jsx("span",{className:"n",style:{color:C_CACHE},children:fmtNum(r.cacheRead||0)}),
                jsx_runtime.jsx("span",{className:"n",children:fmtNum(r.output)}),
                jsx_runtime.jsx("span",{className:"n",style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:fmtDur(r.durationMs)}),
              ]},"tb"+i);
            }),
          ]});
        }
        // C：Token 条（条长 = 该条 token 占最大值的比例）
        function recC(rows){
          var max=1; rows.forEach(function(r){ var v=(Number(r.input)||0)+(Number(r.output)||0)+(Number(r.cacheRead)||0); if(v>max) max=v; });
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsx("div",{className:"oq-cap",style:{marginBottom:2},children:"条长 = token 占比 · 点击复制"}),
            rows.map(function(r,i){
            var total=(Number(r.input)||0)+(Number(r.output)||0)+(Number(r.cacheRead)||0);
            var w=total/max*100;
            var fr=total?(Number(r.input)||0)/total*w:0, ca=total?(Number(r.cacheRead)||0)/total*w:0, ou=total?(Number(r.output)||0)/total*w:0;
            return jsx_runtime.jsxs("div",{className:"oq-recbar",title:recTip(r),onClick:function(){ recCopy(r); },children:[
              jsx_runtime.jsx("span",{className:"w",children:fmtRecTime(r.time).slice(0,5)}),
              jsx_runtime.jsx("span",{className:"m",children:r.model||"—"}),
              jsx_runtime.jsxs("span",{className:"b",children:[
                jsx_runtime.jsx("i",{style:{width:fr+"%",background:C_FRESH}}),
                jsx_runtime.jsx("i",{style:{width:ca+"%",background:C_CACHE}}),
                jsx_runtime.jsx("i",{style:{width:ou+"%",background:C_OUT}}),
              ]}),
              jsx_runtime.jsx("span",{className:"num",style:{width:"46px",textAlign:"right",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:fmtDur(r.durationMs)}),
            ]},"rb"+i);
            }),
          ]});
        }
        function recordsList(records){
          var rows=(records||[]).filter(Boolean);
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无调用记录"});
          var style=tmUsageStyle[0].rec;
          var body=style==="B"?recB(rows):(style==="C"?recC(rows):recA(rows));
          if(rows.length>8){
            return jsx_runtime.jsxs("details",{style:{fontSize:"11px"},children:[
              jsx_runtime.jsx("summary",{style:{cursor:"pointer",color:"var(--dsw-alias-label-caption,#9a9aaa)",userSelect:"none"},children:"最近 8 条 · 展开全部 "+rows.length+" 条"}),
              jsx_runtime.jsx("div",{style:{marginTop:4},children:body})
            ]});
          }
          return body;
        }

        function tabBar(){
          var tabs=[["usage","用量统计"],["conf","外观"],["data","数据源"],["gen","通用"],["maint","维护"],["gateway","网关"]];
          return jsx_runtime.jsx("div",{className:"oq-tabs",style:{flexWrap:"wrap"},children:tabs.map(function(pair){
            var k=pair[0],txt=pair[1],active=tabState[0]===k;
            // 「网关」tab 的小圆点：检测到账本但监测关着时提示"这里有东西可看"。
            // 与"有更新"同一种心智，不用弹窗打扰（用户是自己关的，知情）。
            var dot = (k==="gateway" && gwData[0] && gwData[0].available && !gatewayEnabled());
            return jsx_runtime.jsxs("button",{type:"button",className:"oq-tab","data-active":active?"1":"0",
              onClick:function(){ setTab(k); },children:[
                txt,
                dot?jsx_runtime.jsx("i",{style:{display:"inline-block",width:5,height:5,borderRadius:"50%",background:ACCENT,marginLeft:4,verticalAlign:"middle"}}):null,
              ]},k);
          })});
        }
        // tab 记忆：此前不持久化，在「网关」tab 里刷新会跳回「用量统计」，
        // 而这一页恰好是排障页（看一眼→改配置→刷新验证），体感最明显。
        function setTab(k){ tabState[1](k); saveSettingsTab(k); }
        function fmtClock(ts){
          try{ return new Date(Number(ts)||0).toTimeString().slice(0,8); }catch(e){ return "—"; }
        }
        function rangeLabelTxt(){
          var k=meterRangeState[0]||"1d";
          var hit=null;
          for(var i=0;i<RANGES.length;i++){ if(RANGES[i][0]===k) hit=RANGES[i][1]; }
          var base=hit||k;
          // 热力图/时段图取 90 天数据源（月份切换、时段分布都需要更长的窗口）
          // custom 优先：否则选了起止日期，标题还写"近 90 天"会自相矛盾
          if(k==="custom"){
            var w=meterData[0]&&meterData[0].window;
            var cr=customRange[0]||loadCustomRange();
            var f=(w&&w.from)||cr.from, tt=(w&&w.to)||cr.to;
            return "区间："+f+" ~ "+tt+"（"+(Number(w&&w.days)||0)+" 天）";
          }
          if(tmChartState[0]==="heat") return "热力图数据源：近 90 天（可回看 3 个月）";
          if(tmChartState[0]==="hour") return "时段分布数据源：近 90 天";
          return "区间："+base+(k==="all"?"（最多保留 90 天）":"");
        }
        // 数据健康一行：存储形态 + 库文件大小 + 账本行数 + 跨度 + 最后回填时间。
        // host 端拿不到持久化路径时会静默降级为纯内存（每次启动重扫会话历史），
        // 这一行把它显式暴露出来；点击可复制整段诊断信息。
        function healthLine(health, nowMs){
          var h=health||null;
          if(!h) return null;
          var isMem = !h.store || h.store==="memory";
          var stale = h.lastScanAt ? (Number(nowMs)-Number(h.lastScanAt) > 24*3600*1000) : false;
          var parts=[];
          if(h.dbBytes!=null) parts.push((Number(h.dbBytes)/1048576).toFixed(1)+" MB");
          if(h.events!=null) parts.push("账本 "+h.events.toLocaleString()+" 行");
          if(h.days!=null) parts.push(h.days+" 天");
          if(h.lastScanAt) parts.push("回填 "+fmtAgo(h.lastScanAt, nowMs));
          return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",fontSize:"11px"},
            children:[
              jsx_runtime.jsx("span",{title:isMem?"未落盘：每次启动都会重新扫描会话历史，首屏可能延迟":"账本位置："+String(h.store).slice(3),
                style:{width:6,height:6,borderRadius:"50%",flex:"none",background:isMem?"#e8b463":(stale?"#8b7bff":"#34d399")}}),
              jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:isMem?"内存（不持久化）":"SQLite"}),
              jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:parts.join(" · ")}),
              jsx_runtime.jsx("button",{type:"button",style:{background:"none",border:"none",padding:0,fontSize:"11px",color:"#8b7bff",cursor:"pointer",fontFamily:"inherit"},
                onClick:function(){ var ok=copyText(diagText()); showToast("meter",ok,ok?"已复制诊断信息":"复制失败（剪贴板被拦截）"); },
                title:"复制完整诊断信息（存储路径/账本规模/回填时间/实时信号）",children:"诊断"}),
            ]});
        }
        // 诊断文本：粘贴就能说明"数据从哪来、多大、什么时候回填的"
        function diagText(){
          var d0=meterData[0]||{};
          var h=d0.health||{};
          var live=d0.live||{};
          return ["dsh-quota-widget 用量诊断",
            "时间: "+(meterUpdAt[0]?new Date(meterUpdAt[0]).toISOString():"-"),
            "存储: "+(h.store||d0.store||"-"),
            "库大小: "+(h.dbBytes!=null?h.dbBytes+" bytes":"-"),
            "账本行数: "+(h.events!=null?h.events:"-")+"  跨度: "+(h.days!=null?h.days+" 天":"-"),
            "最后回填: "+(h.lastScanAt?new Date(h.lastScanAt).toISOString():"-"),
            "区间: "+(d0.range||meterRangeState[0]),
            "总量: "+(d0.totals?fmtNum(d0.totals.total):"-")+"  命中率: "+(d0.totals&&d0.totals.cacheHitRate!=null?d0.totals.cacheHitRate+"%":"-"),
            "实时(本次启动): rate60="+(live.rate60||0)+" tok/s, steps="+(live.steps||0)+", toolCalls="+(live.toolCalls||0)+", 首token样本="+(live.firstTokenCount||0),
            "产出信号: "+JSON.stringify(live.signalCount||{}),
          ].join("\n");
        }
        // 图表卡标题下方的一行说明（随视图变化）
        function chartHint(isHeat, isHour, range, chart, filter){
          // custom 时区间是用户显式指定的，说明文字必须跟着改口（否则还写着"近 90 天"）
          if(range==="custom" && isHeat) return "每日一格，颜色越深代表当天 Token 消耗越多；区间外没有数据的天显示为空（所选区间见上方标题）。";
          if(range==="custom" && isHour) return "行 = 周一..周日，列 = 0..23 点；只统计所选区间内的时段分布。";
          if(isHeat) return "每日一格，颜色越深代表当天 Token 消耗越多；点击某天查看当日明细，左上角 ‹ › 切换月份（保留 90 天）。";
          if(isHour) return "行 = 周一..周日，列 = 0..23 点；颜色越深代表该时段累计 Token 越多（数据源近 90 天）。";
          if(range==="1d") return "统计今日各时段（悬停柱体看按模型明细）；今日尚无分时数据时自动回落为按日柱。";
          if(range==="custom") return "任意起止范围（最多近 90 天）"+(chart==="line"?"（实线=每日总量，黄虚线=缓存命中率，灰虚线=同长度前一窗口）":"（堆叠＝新输入+缓存读+输出，悬停看分项与模型）")+(filter?"；当前仅显示模型 "+filter:"")+";下方「逐日明细」可逐天核对。";
          return "统计所选范围内每日消耗"+(chart==="line"?"（实线=每日总量，黄虚线=缓存命中率，灰虚线=上期同长窗口）":"（堆叠＝新输入+缓存读+输出，悬停看分项与模型）")+(filter?"；当前仅显示模型 "+filter:"")+"。";
        }
        // ── 排行：统一取数 + 三种风格（A 颁奖台 / B 数据表 / C 两行制）──
        function rankItems(tab, d0, sortKey){
          var out=[];
          if(tab==="models"){
            // 顶层的 models 是 stats.models 的副本；老 host / 精简 payload 只有 stats.models
            var src=(d0&&d0.models&&d0.models.length)?d0.models:((d0&&d0.stats&&d0.stats.models)||[]);
            var arr=src.filter(function(m){ return m && m.model; }).map(function(m){
              return { name:m.model, total:Number(m.total||0), requests:Number(m.requests||0),
                cacheRead:Number(m.cacheRead||0), output:Number(m.output||0) };
            });
            var sum=0; arr.forEach(function(m){ sum+=m.total; });
            var key=sortKey||"total";
            arr.sort(function(a,b){ return (key==="requests"?b.requests:(key==="cacheRead"?b.cacheRead:b.total))-(key==="requests"?a.requests:(key==="cacheRead"?a.cacheRead:a.total)); });
            arr.slice(0,8).forEach(function(m){
              out.push({
                name:m.name, weight:m.total, pct:sum>0?m.total/sum*100:0,
                val:fmtTokens(m.total), pick:true,
                sub:"请求 "+m.requests+" · 输出 "+fmtNum(m.output)+" · 缓存读 "+fmtNum(m.cacheRead),
                tip:m.name+" · 共 "+fmtNum(m.total)+"（请求 "+m.requests+" · 输出 "+fmtNum(m.output)+" · 缓存读 "+fmtNum(m.cacheRead)+"）\n点击只看这个模型",
              });
            });
          } else if(tab==="sessions"){
            var ss=((d0&&d0.sessions)||[]).slice();
            ss.sort(function(a,b){ return Number(b.total||0)-Number(a.total||0); });
            ss.slice(0,8).forEach(function(s){
              var nm=s.title||s.project||String(s.sessionId||"").replace(/^session-/,"").slice(0,8);
              out.push({
                name:nm, weight:Number(s.total||0), pct:Number(s.total||0)/(Number(ss[0]&&ss[0].total)||1)*100,
                val:fmtTokens(s.total||0),
                sub:"请求 "+(s.requests||0)+" · 步数 "+(s.steps||0)+(s.project?" · "+s.project:""),
                tip:(s.title||"(无标题)")+"\n"+String(s.sessionId||"")+"\n项目 "+(s.project||"—")+" · 共 "+fmtNum(s.total),
              });
            });
          } else if(tab==="tools"){
            var ts=((d0&&d0.tools)||[]).slice();
            ts.sort(function(a,b){ return Number(b.calls||0)-Number(a.calls||0); });
            ts.slice(0,8).forEach(function(t){
              out.push({
                name:t.tool, weight:Number(t.calls||0), pct:Number(t.calls||0)/(Number(ts[0]&&ts[0].calls)||1)*100,
                val:(t.calls||0)+" 次",
                sub:"累计 "+fmtDur(t.ms||0)+(t.avgMs?" · 平均 "+fmtDur(t.avgMs):"")+(t.errors?" · 失败 "+t.errors:""),
                tip:t.tool+" · 调用 "+(t.calls||0)+" 次 · 累计 "+(t.ms||0)+" ms"+(t.errors?" · 失败 "+t.errors:""),
              });
            });
          } else {
            var list=tab==="projects"?((d0&&d0.projects)||[]):((d0&&d0.providers)||[]);
            var arr2=list.slice().sort(function(a,b){ return Number(b.total||0)-Number(a.total||0); });
            arr2.slice(0,8).forEach(function(p){
              var nm=tab==="projects"?p.project:p.provider;
              out.push({
                name:nm, weight:Number(p.total||0), pct:Number(p.total||0)/(Number(arr2[0]&&arr2[0].total)||1)*100,
                val:fmtTokens(p.total||0),
                sub:"请求 "+(p.requests||0)+(tab==="projects"?" · 工具 "+(p.tools||0):""),
                tip:nm+" · 共 "+fmtNum(p.total)+"（新输入 "+fmtNum(p.freshInput)+" · 缓存读 "+fmtNum(p.cacheRead)+" · 输出 "+fmtNum(p.output)+"）",
              });
            });
          }
          return out;
        }
        function rankRowsA(items, onPick, filter){
          if(!items.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无数据"});
          var top=items[0];
          return jsx_runtime.jsxs("div",{children:[
            jsx_runtime.jsxs("div",{className:"oq-podium",style:{cursor:top.pick?"pointer":"default"},title:top.tip,
              onClick:function(){ if(top.pick) onPick(filter===top.name?"":top.name); },children:[
              jsx_runtime.jsxs("div",{children:[
                jsx_runtime.jsx("span",{className:"nm",children:(filter===top.name?"◉ ":"")+top.name}),
                jsx_runtime.jsx("span",{className:"v",children:top.val}),
              ]}),
              jsx_runtime.jsx("div",{className:"bar",children:jsx_runtime.jsx("i",{style:{width:Math.max(3,top.pct)+"%"}})}),
              jsx_runtime.jsx("div",{className:"meta",children:"占比 "+(top.pct<1?"<1":Math.round(top.pct))+"%"+(top.sub?" · "+top.sub:"")}),
            ]}),
            items.slice(1).map(function(it,i){
              return jsx_runtime.jsxs("div",{className:"oq-rank-row",title:it.tip,
                style:{cursor:it.pick?"pointer":"default",opacity:filter&&filter!==it.name?0.5:1},
                onClick:function(){ if(it.pick) onPick(filter===it.name?"":it.name); },children:[
                jsx_runtime.jsx("span",{className:"oq-rank-name",children:(filter===it.name?"◉ ":"")+it.name}),
                jsx_runtime.jsx("span",{className:"oq-rank-track",children:jsx_runtime.jsx("span",{className:"oq-rank-fill",style:{width:Math.max(2,it.pct)+"%",opacity:Math.max(0.45,1-i*0.12)}})}),
                jsx_runtime.jsx("span",{className:"oq-rank-val",children:(it.pct<1?"<1":Math.round(it.pct))+"% · "+it.val}),
              ]},it.name+"a"+i);
            }),
          ]});
        }
        function rankRowsB(items, onPick, filter){
          if(!items.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无数据"});
          var cols="20px minmax(0,1fr) 112px 64px 46px";
          return jsx_runtime.jsxs("div",{className:"oq-tbl",children:[
            jsx_runtime.jsxs("div",{className:"th",style:{display:"grid",gridTemplateColumns:cols},children:[
              jsx_runtime.jsx("span",{children:"#"}),jsx_runtime.jsx("span",{children:"名称"}),
              jsx_runtime.jsx("span",{children:"占比"}),jsx_runtime.jsx("span",{className:"n",children:"总量"}),jsx_runtime.jsx("span",{className:"n",children:"权重"}),
            ]}),
            items.map(function(it,i){
              return jsx_runtime.jsxs("div",{className:"tr",title:it.tip,style:{display:"grid",gridTemplateColumns:cols,gridTemplateRows:"auto",gridAutoFlow:"row",cursor:it.pick?"pointer":"default",opacity:filter&&filter!==it.name?0.55:1},
                onClick:function(){ if(it.pick) onPick(filter===it.name?"":it.name); },children:[
                jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:String(i+1)}),
                jsx_runtime.jsx("span",{className:"nm",children:it.name}),
                jsx_runtime.jsx("span",{className:"oq-rank-track",style:{height:"6px"},children:jsx_runtime.jsx("span",{className:"oq-rank-fill",style:{width:Math.max(2,it.pct)+"%"}})}),
                jsx_runtime.jsx("span",{className:"n strong",children:it.val}),
                jsx_runtime.jsx("span",{className:"n",style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:Math.round(it.weight)}),
              ]},it.name+"b"+i);
            }),
          ]});
        }
        function rankRowsC(items, onPick, filter){
          if(!items.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无数据"});
          return jsx_runtime.jsx("div",{children: items.map(function(it,i){
            return jsx_runtime.jsxs("div",{className:"oq-r2",title:it.tip,style:{opacity:filter&&filter!==it.name?0.55:1},
              onClick:function(){ if(it.pick) onPick(filter===it.name?"":it.name); },children:[
              jsx_runtime.jsxs("div",{className:"r1",children:[
                jsx_runtime.jsx("span",{className:"idx"+(i<3?" top":""),children:String(i+1).padStart(2,"0")}),
                jsx_runtime.jsx("span",{className:"nm",children:(filter===it.name?"◉ ":"")+it.name}),
                jsx_runtime.jsx("span",{className:"pc",children:it.pct<1?"<1%":Math.round(it.pct)+"%"}),
                jsx_runtime.jsx("span",{className:"vv",children:it.val}),
              ]}),
              jsx_runtime.jsx("div",{className:"bar",children:jsx_runtime.jsx("i",{style:{width:Math.max(2,it.pct)+"%",
                background:i===0?"linear-gradient(90deg,#8b7bff,#2ec5ff)":"linear-gradient(90deg,rgba(139,123,255,0.72),rgba(46,197,255,0.45))"}})}),
              jsx_runtime.jsx("div",{className:"meta",children:it.sub}),
            ]},it.name+"c"+i);
          })});
        }
        function rankRender(style, items, onPick, filter){
          if(style==="A") return rankRowsA(items, onPick, filter);
          if(style==="B") return rankRowsB(items, onPick, filter);
          return rankRowsC(items, onPick, filter);
        }


        function usagePanel(){
          var d0=meterData[0];
          var st=d0?(d0.stats||d0):null;
          var isHeat=tmChartState[0]==="heat";
          var isHour=tmChartState[0]==="hour";
          var filter=tmModelFilter[0]||"";
          var rangeTxt=isHeat?(localDayStr().slice(0,4)+"年"+Number(localDayStr().slice(5,7))+"月 热力图")
            :(isHour?"时段分布（周 × 小时）":(meterRangeState[0]==="1d"?"今日分时":(tmChartState[0]==="line"?"按日趋势 · 折线":"按日趋势")));
          var tools=d0&&Array.isArray(d0.tools)?d0.tools:[];
          var projects=d0&&Array.isArray(d0.projects)?d0.projects:[];
          var provs=d0&&Array.isArray(d0.providers)?d0.providers:[];
          var sessions=d0&&Array.isArray(d0.sessions)?d0.sessions:[];
          var rel=d0?d0.reliability:null;
          var toolSort=tmToolSort[0]||"calls";
          var toolRows=tools.slice().sort(function(a,b){ return toolSort==="ms"?(Number(b.ms||0)-Number(a.ms||0)):(Number(b.calls||0)-Number(a.calls||0)); }).slice(0,8);
          var tab=tmRankTab[0]||"models";
          var tabOpts=[["models","模型"],["sessions","会话"],["tools","工具"],["projects","项目"],["providers","渠道"]];
          var rankNote={models:"点击一行可只看该模型",sessions:"一个会话往往吃掉大半用量",tools:"耗时 = tool/call → tool/result 的墙钟时间",projects:"按会话 cwd 归集",providers:"同名模型在不同渠道下是两笔账"}[tab]||"";
          // 网关流量没有项目/会话/工具维度（对方的账本只有 日×渠道×账号×模型）。
          // 这三张榜**只统计本机会话**，必须明说，否则"网关那半边的项目去哪了"没法自证。
          var gwActive = meterData[0] && meterData[0].sources && meterData[0].sources.gateway
            && meterData[0].sources.gateway.enabled!==false && Number(meterData[0].sources.gateway.total||0)>0;
          if(gwActive && (tab==="projects"||tab==="sessions"||tab==="tools")){
            rankNote = rankNote + "（仅本机会话：网关流量无此维度）";
          }
          var rankList=rankItems(tab, d0, tmSortState[0]);
          var rankBody=rankRender(tmUsageStyle[0].rank, rankList, function(v){ tmModelFilter[1](v); }, filter);

          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"12px"},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",flexWrap:"wrap",gap:"8px 14px"},children:[
              // 范围 pills 常驻（热力/时段模式下置灰但仍可见，说明"图表取的是 90 天"）
              // 末位多一个「自定义」：选中后图表卡里出现起止日期控件（见 renderCustomRangeBar）
              //
              // ⚠️ 热力/时段模式下**不能**把整组 pills 换成一句提示文字：那样「自定义」入口
              // 就彻底消失了（用户实测反馈："我没看到"）。现在两种情况都渲染 pills，
              // 只在热力/时段时补一句说明，并靠 disabled 表明"图表取的是 90 天"。
              pillGroup("范围",RANGES.concat([["custom","自定义"]]),meterRangeState,
                (isHeat||isHour)?null:setMeterRange),
              (isHeat||isHour)?jsx_runtime.jsx("span",{style:styles.hint,title:"热力图/时段分布固定取近 90 天数据源；切到柱状/折线后范围选择才作用于图表",children:"（图表固定近 90 天，切柱状/折线可选范围）"}):null,
              pillGroup("图表",[["bar","柱状"],["line","折线"],["heat","热力图"],["hour","时段"]],tmChartState,setMeterChart),
              jsx_runtime.jsx("span",{style:{flex:1}}),
              jsx_runtime.jsx("span",{style:styles.hint,children:meterUpdAt[0]?("更新于 "+fmtClock(meterUpdAt[0])+"（"+fmtAgo(meterUpdAt[0],nowTick[0])+"）"):"尚未加载"}),
              jsx_runtime.jsx("button",{style:Object.assign({},styles.btn,{padding:"3px 8px",fontSize:"10px"}),title:"导出当前视图为 CSV",onClick:exportCsv,children:"导出"}),
              jsx_runtime.jsx("button",{style:Object.assign({},styles.btn,{padding:"3px 8px",fontSize:"10px"}),title:"复制当前视图摘要",onClick:copySummary,children:"复制"}),
              jsx_runtime.jsx("button",{style:styles.iconBtn,onClick:function(){refreshMeter({force:true});},title:"刷新数据",disabled:meterLoading[0],children:"⟳"}),
            ]}),
            healthLine(d0?d0.health:null, nowTick[0]),
            toastRow("meter"),
            jsx_runtime.jsxs("div",{style:Object.assign({},styles.cardCol,{opacity:meterLoading[0]?0.65:1}),children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:"总览"}),
                jsx_runtime.jsx("span",{style:styles.hint,children:rangeLabelTxt()}),
              ]}),
              overviewBlock(st?st.totals:null, st?st.prevTotals:null, st?st.daily:null),
            ]}),
            jsx_runtime.jsxs("div",{style:Object.assign({},styles.cardCol,{opacity:meterLoading[0]?0.65:1}),children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:rangeTxt}),
                filter?jsx_runtime.jsxs("span",{style:{fontSize:"11px",color:"#8b7bff",flexShrink:0},children:["仅 ",filter,jsx_runtime.jsx("button",{style:Object.assign({},styles.iconBtn,{width:18,height:18,marginLeft:4,fontSize:10}),onClick:function(){tmModelFilter[1]("");},title:"清除模型筛选",children:"✕"})]}):null,
              ]}),
              renderTokenMeterChart(),
              jsx_runtime.jsx("div",{style:styles.hint,children:chartHint(isHeat, isHour, meterRangeState[0], tmChartState[0], filter)}),
              // 自定义区间：只在"图表卡"里出现（悬浮窗不参与，见 LS_CUSTOM_RANGE 注释）
              meterRangeState[0]==="custom"?renderCustomRangeBar():null,
              // 逐日明细表：默认收起（一次打开面板不必多一屏表格），展开后常驻
              jsx_runtime.jsxs("div",{style:{marginTop:8,paddingTop:6,borderTop:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"},children:[
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,cursor:"pointer"},onClick:function(){ detailOpen[1](!detailOpen[0]); },children:[
                  jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)"},children:"逐日明细"}),
                  jsx_runtime.jsx("span",{style:styles.hint,children:detailOpen[0]?"点击收起":"点击展开 · 可排序、点行看单日详情、导出 CSV"}),
                  jsx_runtime.jsx("span",{style:Object.assign({},styles.iconBtn,{marginLeft:"auto",width:18,height:18,fontSize:10,padding:0,transform:detailOpen[0]?"rotate(180deg)":"none"}),children:"⌄"}),
                ]}),
                detailOpen[0]?jsx_runtime.jsx("div",{style:{marginTop:6},children:renderDailyDetail(st?st.daily:null, st?st.totals:null, d0?d0.window:null)}):null,
              ]}),
            ]}),
            jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:"排行"}),
                jsx_runtime.jsx("span",{style:styles.hint,children:rankNote}),
              ]}),
              sortPills(tabOpts, tab, setRankTab),
              tab==="models"?jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",margin:"6px 0"},children:[
                jsx_runtime.jsx("span",{style:styles.hint,children:"排序"}),
                sortPills([["total","总量"],["requests","请求"],["cacheRead","缓存读"]], tmSortState[0], function(k){ tmSortState[1](k); }),
                filter?jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ tmModelFilter[1](""); },children:"清除筛选"}):null,
              ]}):null,
              jsx_runtime.jsx("div",{style:{marginTop:4},children:rankBody}),
            ]}),
            (function(){ var lv=st?liveBlock(st.live, rel, st?st.records:null, tmRateHist.current):null; return lv?jsx_runtime.jsxs("div",{style:styles.cardCol,children:[jsx_runtime.jsx("div",{style:styles.cTitle,children:"实时"}),lv]}):null; })(),
            jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:"最近调用"}),
                jsx_runtime.jsx("span",{style:styles.hint,children:"新输入 → 输出 · 点击复制"}),
              ]}),
              recordsList(st?st.records:null),
            ]}),
          ]});
        }
        // ── 用量统计外观：五模块 A/B/C 独立切换 ──
        var STYLE_LABELS={ overview:"总览", chart:"图表", rank:"排行", live:"实时", rec:"最近调用" };
        var STYLE_OPTS={
          overview:[["A","仪表盘"],["B","三色卡"],["C","一行"]],
          chart:[["A","坐标系"],["B","摘要"],["C","极简"]],
          rank:[["A","颁奖台"],["B","表格"],["C","列表"]],
          live:[["A","仪表"],["B","趋势"],["C","状态条"]],
          rec:[["A","时间线"],["B","表格"],["C","Token 条"]],
        };
        var STYLE_DESC={
          overview:{A:"大字总量 + 环形命中率 + 4 列次级",B:"新输入/缓存读/输出 各一张小卡",C:"一行摘要，细项折叠"},
          chart:{A:"y 轴刻度 + 网格 + 点击聚焦",B:"顶部摘要 + 渐变，不画网格",C:"纯图形，量级靠悬停"},
          rank:{A:"Top1 放大 + 2–5 紧凑",B:"多列数据表，最利于扫读",C:"序号 + 两行制，信息与观感均衡"},
          live:{A:"半环仪表 + 文字指标",B:"速率 sparkline + 5 列 KPI",C:"单行状态条，最省空间"},
          rec:{A:"时间轴 + 每条 token 微条",B:"时间/模型/项目/三段/耗时 七列",C:"按 token 占比画条，最直观"},
        };
        function setUsageStyle(mod, v){
          var next=Object.assign({}, tmUsageStyle[0]);
          next[mod]=v;
          tmUsageStyle[1](next); saveUsageStyle(next);
        }
        function applyUsagePreset(key){
          var p=USAGE_STYLE_PRESETS[key]; if(!p) return;
          var next=Object.assign({}, tmUsageStyle[0]);
          for(var i=0;i<USAGE_MODULES.length;i++) next[USAGE_MODULES[i]]=p[USAGE_MODULES[i]];
          tmUsageStyle[1](next); saveUsageStyle(next);
        }
        // ── 清空用量账本（独立卡片）──
        // 设计要点（用户反馈驱动）：
        //   · 与「重置配置 / 重置悬浮窗位置」拆开：后果量级完全不同，混排会误点；
        //   · 确认前先给数字（多少行、哪天到哪天、多大），破坏性操作必须可判断；
        //   · 需要手输「清空」二字，防手滑；
        //   · 默认先写快照，且把快照路径回显出来——不可逆操作必须留退路；
        //   · 范围可选：全清 / 只清更早的（保留最近 N 天）/ 只清某个项目。
        function fmtBytes(n){
          var v=Number(n)||0;
          if(v<=0) return "—";
          if(v<1024) return v+" B";
          if(v<1048576) return (v/1024).toFixed(0)+" KB";
          return (v/1048576).toFixed(2)+" MB";
        }
        // ── 清空用量账本（维护列表「危险区」一行）──
        // 收起时只露一行（状态 + 开启按钮），点「选择范围并统计」展开详情区手输确认。
        function clearLedgerRow(){
          var scope=clearScopeState[0];
          var pv=clearPreviewState[0];
          var typedOk=String(clearTypedState[0]).trim()===CLEAR_TYPE_KEYWORD;
          var scopeName=scope==="all"?"全部记录":(scope==="before"?("保留最近 "+clearDaysState[0]+" 天，清掉更早的"):("只清项目「"+(clearProjectState[0]||"—")+"」"));
          var res=clearResult[0];
          var head=jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
            jsx_runtime.jsx("span",{style:styles.cTitle,children:"清空用量账本"}),
            jsx_runtime.jsx("span",{style:Object.assign({},styles.chip,{borderColor:"#ef4444",color:"#ef4444"}),children:"不可逆"}),
          ]});
          var detail=null;
          if(maintOpen[0]==="clear"){
            var rows=[];
            rows.push(jsx_runtime.jsxs("div",{key:"scope",style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
              jsx_runtime.jsx("span",{style:styles.hint,children:"范围"}),
              pillGroup("",[["all","全部"],["before","按时间"],["project","按项目"]],clearScopeState,function(v){
                clearScopeState[1](v); clearTypedState[1](""); clearPreviewState[1](null);
                if(v==="project" || v==="before") loadClearPreview();
              }),
              scope==="before"?jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:4},children:[
                jsx_runtime.jsx("span",{style:styles.hint,children:"保留最近"}),
                jsx_runtime.jsx("input",{style:styles.inputSmall,type:"number",min:1,max:3650,value:clearDaysState[0],
                  onChange:function(e){ var v=parseInt(e.target.value,10); if(!isNaN(v)) clearDaysState[1](Math.max(1,Math.min(3650,v))); },
                  onBlur:loadClearPreview}),
                jsx_runtime.jsx("span",{style:styles.hint,children:"天"}),
              ]}):null,
              scope==="project"?jsx_runtime.jsx("select",{
                style:Object.assign({},styles.inputSmall,{width:"auto",minWidth:140,maxWidth:260}),
                value:clearProjectState[0],
                onChange:function(e){ clearProjectState[1](e.target.value); },
                children:(pv&&pv.projects&&pv.projects.length?pv.projects:[{project:"",events:0}]).map(function(p){
                  return jsx_runtime.jsx("option",{value:p.project,children:(p.project||"（未归入项目）")+"（"+p.events+" 行）"},p.project);
                })
              }):null,
              jsx_runtime.jsx("button",{style:styles.btn,onClick:loadClearPreview,disabled:clearPreviewBusy[0],children:clearPreviewBusy[0]?"统计中…":"统计"}),
            ]}));
            if(pv && pv.ok){
              rows.push(jsx_runtime.jsxs("div",{key:"pv",style:{display:"flex",alignItems:"center",gap:"8px 14px",flexWrap:"wrap",padding:"7px 10px",borderRadius:8,
                background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)"},children:[
                jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:700,color:"#ef4444"},children:["将删除 ",fmtNum(pv.target||0)," 行"]}),
                jsx_runtime.jsx("span",{style:styles.hint,children:"剩余 "+fmtNum(pv.remaining||0)+" 行"}),
                pv.firstDay?jsx_runtime.jsx("span",{style:styles.hint,children:pv.firstDay+" → "+(pv.lastDay||"—")+"（全库跨度）"}):null,
                pv.bytes!=null?jsx_runtime.jsx("span",{style:styles.hint,children:"库文件 "+fmtBytes(pv.bytes)}):null,
                pv.resetAt?jsx_runtime.jsx("span",{style:styles.hint,title:"此前的历史不会被回填拉回来",children:"历史下限 "+fmtDate(pv.resetAt)}):null,
              ]}));
            } else {
              rows.push(jsx_runtime.jsx("div",{key:"pvhint",style:styles.hint,children:"点「统计」先看将被删除的行数与日期跨度——不点也能清，但那样你不知道自己在删什么。"}));
            }
            rows.push(jsx_runtime.jsxs("label",{key:"bk",style:{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"},children:[
              jsx_runtime.jsx("input",{type:"checkbox",checked:!!clearBackupState[0],onChange:function(e){ clearBackupState[1](!!e.target.checked); }}),
              jsx_runtime.jsx("span",{style:styles.hint,children:"清空前自动写一份快照（推荐；关掉后无法恢复）"}),
            ]}));
            rows.push(jsx_runtime.jsxs("div",{key:"typed",style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
              jsx_runtime.jsxs("span",{style:styles.hint,children:["输入「",CLEAR_TYPE_KEYWORD,"」确认"]}),
              jsx_runtime.jsx("input",{
                style:Object.assign({},styles.inputSmall,{width:90}),
                value:clearTypedState[0],
                placeholder:CLEAR_TYPE_KEYWORD,
                onChange:function(e){ clearTypedState[1](e.target.value); },
              }),
              jsx_runtime.jsx("button",{
                style:Object.assign({},styles.btnDangerSolid,{padding:"5px 12px",fontSize:"12px",opacity:(typedOk&&!clearBusyState[0]&&(pv?pv.target!==0:true))?1:0.45,
                  cursor:(typedOk&&!clearBusyState[0])?"pointer":"not-allowed"}),
                disabled:!typedOk||clearBusyState[0],
                onClick:function(){
                  if(!typedOk) return;
                  if(pv && pv.target===0){ showToast("clr",false,"该范围内没有可删除的记录"); return; }
                  clearUsage();
                },
                children:clearBusyState[0]?"清空中…":"确认清空",
              }),
            ]}));
            rows.push(toastRow("clr"));
            detail=jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8,padding:"10px 12px",borderRadius:8,
              background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.2)"},children:[
              jsx_runtime.jsxs("div",{style:styles.cDesc,children:[
                "当前选择：",jsx_runtime.jsx("b",{style:{color:"var(--dsw-alias-label-primary,#fff)"},children:scopeName}),".",
                " 只删本插件自己的统计（events 与 7 张派生表），会话文件本身不受影响。",
                "清空后会把「历史下限」推到清空时刻，此后重启/回填都不会把这段历史拉回来。",
                // 网关数据来自另一个插件的账本，清空本插件库动不了它。不说清，
                // 用户清完发现总量没归零会以为"没清干净"（或以为清空失效）。
                jsx_runtime.jsx("br",{}),
                jsx_runtime.jsx("b",{style:{color:"#e8b463"},children:"注意：不影响网关用量。"}),
                "网关数据来自 dsh-providers-hub 的账本，本操作不会删除它；要彻底排除请在「网关」标签页关闭监测。",
              ]}),
              rows,
            ]});
          }
          var status="选范围 → 统计 → 手输「清空」执行";
          if(res) status="上次已清空 "+fmtNum(res.cleared)+" 行"+(res.backup&&res.backup.ok?" · 已备份":"");
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:10},children:[
              head,
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:"auto",flexShrink:0}),children:status}),
              maintOpen[0]==="clear"
                ? jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ maintOpen[1](""); },children:"收起"})
                : jsx_runtime.jsx("button",{style:styles.btnDanger,onClick:function(){ maintOpen[1]("clear"); },children:"选择范围并统计"}),
            ]}),
            detail,
          ]});
        }
        // ── 补齐历史维度 ──
        // 背景：旧版本实时路径只读 session.cwd，而 DSH 把 cwd 放在 session.header.cwd，
        // 于是那段时间落库的行 project 全为 NULL（本机实测 1,124 行落进「—」桶）。
        // 这些行的事件还在，项目名也能从会话头还原，所以可以补——但要重读全部会话文件，
        // 属于按需触发的一次性维护动作，不该在启动时自动跑。
        function enrichRow(){
          var r=enrichResult[0]||enrichResultS[0];
          return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:10},children:[
            jsx_runtime.jsx("span",{style:styles.cTitle,children:"补齐历史维度"}),
            jsx_runtime.jsx("span",{style:styles.hint,children:"项目 / 工具 / 耗时归因 · 只更新缺失的列，不动总量，可重复执行"}),
            r?jsx_runtime.jsxs("span",{style:{fontSize:"11px",color:"var(--dsw-alias-state-success-primary,#34d399)",flexShrink:0},children:["已补齐 ",fmtNum(r.updated||0)," 行"]}):null,
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",flexShrink:0},children:[
              jsx_runtime.jsx("button",{style:styles.btn,onClick:runEnrich,disabled:enrichBusy[0],children:enrichBusy[0]?"补齐中…":"补齐历史维度"}),
              toastRow("enrich"),
            ]}),
          ]});
        }
        // ── 补录缺失会话 ──
        // 与「补齐历史维度」的区别必须在界面上讲清楚：
        //   补齐历史维度 = 只改已有行的列，不动总量（安全、可重复）
        //   补录缺失会话 = 会新增行、会让总量变大（必须先看看到底加多少）
        function loadImportPreview(){
          importPreviewBusy[1](true);
          importResult[1](null);
          fetch("/api/token-meter/import-preview",{headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(j){ importPreviewBusy[1](false); if(j&&j.ok) importPreview[1](j); else showToast("imp",false,(j&&j.error)||"统计失败"); })
            .catch(function(e){ importPreviewBusy[1](false); showToast("imp",false,String(e.message||e)); });
        }
        function runImport(){
          importBusy[1](true);
          fetch("/api/token-meter/reset-token",{method:"POST",headers:{accept:"application/json"}})
            .then(function(r){ return r.json(); })
            .then(function(t){
              if(!t||!t.ok||!t.token) throw new Error((t&&t.error)||"取令牌失败");
              return fetch("/api/token-meter/import",{method:"POST",headers:{accept:"application/json","x-reset-token":t.token}});
            })
            .then(function(r){ return r.json().then(function(j){ return {status:r.status,body:j}; }); })
            .then(function(res){
              importBusy[1](false);
              var j=res.body||{};
              if(res.status===200 && j.ok){
                importResult[1](j);
                importPreview[1](null);
                showToast("imp",true,"已补录 "+fmtNum(j.sessions||0)+" 个会话、"+fmtNum(j.tokens||0)+" tokens");
                meterVerRef.current=null;
                refreshMeter({force:true});
              } else {
                showToast("imp",false,(j&&(j.error||j.hint))||("补录失败（HTTP "+res.status+"）"));
              }
            })
            .catch(function(e){ importBusy[1](false); showToast("imp",false,String(e.message||e)); });
        }
        function importRow(){
          var pv=importPreview[0];
          var r=importResult[0];
          var delta = pv && pv.currentTotal!=null && pv.projectedTotal!=null ? (pv.projectedTotal - pv.currentTotal) : null;
          var pct = delta!=null && pv.currentTotal>0 ? (delta/pv.currentTotal*100) : null;
          var open=maintOpen[0]==="import";
          // 收起时状态摘要
          var summary="磁盘上存在但账本里没有的会话";
          if(pv && pv.ok){
            if(pv.sessions === 0) summary="都已入库，无需补录";
            else summary="待补录 "+fmtNum(pv.sessions)+" 个会话 · +"+fmtNum(pv.totalTokens)+" tokens（占 "+(pct!=null?pct.toFixed(1):"—")+"%）";
          }
          if(r && r.ok) summary="已补录 "+fmtNum(r.sessions||0)+" 个会话 · 现总量 "+fmtNum(r.totalAfter||0);
          var detail=null;
          if(open){
            var rows=[];
            if(pv && pv.ok){
              if(pv.sessions === 0){
                rows.push(jsx_runtime.jsx("div",{key:"none",style:Object.assign({},styles.hint,{padding:"7px 10px",borderRadius:8,
                  background:"rgba(52,211,153,0.10)",border:"1px solid rgba(52,211,153,0.25)"}),children:"磁盘上的会话都已入库，无需补录。"}));
              } else {
                rows.push(jsx_runtime.jsxs("div",{key:"pv",style:{display:"flex",alignItems:"center",gap:"8px 14px",flexWrap:"wrap",padding:"7px 10px",borderRadius:8,
                  background:"rgba(245,158,11,0.10)",border:"1px solid rgba(245,158,11,0.30)"},children:[
                  jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:700,color:"#f59e0b"},children:["将新增 ",fmtNum(pv.sessions)," 个会话"]}),
                  jsx_runtime.jsxs("span",{style:styles.hint,children:[fmtNum(pv.totalMsgs)," 条回复"]}),
                  jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:600,color:"#f59e0b"},children:["+"+fmtNum(pv.totalTokens)," tokens"]}),
                  pct!=null?jsx_runtime.jsxs("span",{style:styles.hint,children:["占总量的 ",pct.toFixed(1),"%"]}):null,
                  jsx_runtime.jsxs("span",{style:styles.hint,children:[fmtNum(pv.currentTotal)," → ",fmtNum(pv.projectedTotal)]}),
                ]}));
                rows.push(jsx_runtime.jsxs("div",{key:"toggle",style:{display:"flex",alignItems:"center",gap:8},children:[
                  jsx_runtime.jsx("button",{style:Object.assign({},styles.btn,{padding:"3px 8px",fontSize:"10px"}),onClick:function(){ importShowList[1](!importShowList[0]); },
                    children:importShowList[0]?"收起明细":"查看明细（"+pv.sessions+" 个会话）"}),
                ]}));
                if(importShowList[0]){
                  rows.push(jsx_runtime.jsx("div",{key:"list",style:{display:"flex",flexDirection:"column",gap:3,maxHeight:220,overflow:"auto"},children:(pv.items||[]).map(function(it){
                    return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,fontSize:"11px",padding:"3px 8px",borderRadius:6,
                      background:"var(--dsw-alias-bg-layer-2,#1e1e26)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))"},children:[
                      jsx_runtime.jsx("span",{style:{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--dsw-alias-label-primary,#fff)"},children:it.project||"（未归入项目）"}),
                      jsx_runtime.jsxs("span",{style:styles.hint,children:[fmtNum(it.msgs)," 条"]}),
                      jsx_runtime.jsx("span",{style:styles.hint,children:fmtNum(it.tokens)+" tok"}),
                      it.lastTime?jsx_runtime.jsx("span",{style:styles.hint,children:fmtDate(it.lastTime)}):null,
                    ]}, it.sessionId);
                  })}));
                }
                // 会改变总量，所以确认方式与清空一致：手输「补录」
                rows.push(jsx_runtime.jsxs("div",{key:"typed",style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
                  jsx_runtime.jsxs("span",{style:styles.hint,children:["输入「补录」确认"]}),
                  jsx_runtime.jsx("input",{style:Object.assign({},styles.inputSmall,{width:90}),value:importTyped[0],placeholder:"补录",
                    onChange:function(e){ importTyped[1](e.target.value); }}),
                  jsx_runtime.jsx("button",{
                    style:Object.assign({},styles.btnAccent,{background:"#f59e0b",opacity:(String(importTyped[0]).trim()==="补录"&&!importBusy[0])?1:0.45,
                      cursor:(String(importTyped[0]).trim()==="补录"&&!importBusy[0])?"pointer":"not-allowed"}),
                    disabled:String(importTyped[0]).trim()!=="补录"||importBusy[0],
                    onClick:function(){ if(String(importTyped[0]).trim()!=="补录") return; importTyped[1](""); runImport(); },
                    children:importBusy[0]?"补录中…":"确认补录",
                  }),
                ]}));
              }
            } else {
              rows.push(jsx_runtime.jsxs("div",{key:"hint",style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
                jsx_runtime.jsx("span",{style:styles.hint,children:"先统计一下：磁盘上有哪些会话还没进账本、会带来多少用量。"}),
                jsx_runtime.jsx("button",{style:styles.btn,onClick:loadImportPreview,disabled:importPreviewBusy[0],children:importPreviewBusy[0]?"统计中…":"统计待补录"}),
              ]}));
            }
            if(r && r.ok){
              rows.push(jsx_runtime.jsxs("div",{key:"done",style:{display:"flex",alignItems:"center",gap:"8px 14px",flexWrap:"wrap",padding:"7px 10px",borderRadius:8,
                background:"rgba(52,211,153,0.10)",border:"1px solid rgba(52,211,153,0.25)"},children:[
                jsx_runtime.jsxs("span",{style:{fontSize:"12px",fontWeight:700,color:"var(--dsw-alias-state-success-primary,#34d399)"},children:["已补录 ",fmtNum(r.sessions||0)," 个会话"]}),
                jsx_runtime.jsxs("span",{style:styles.hint,children:["新增 "+fmtNum(r.events||0)+" 行事件"]}),
                jsx_runtime.jsxs("span",{style:styles.hint,children:["+"+fmtNum(r.tokens||0)+" tokens"]}),
                r.totalAfter!=null?jsx_runtime.jsxs("span",{style:styles.hint,children:["现总量 "+fmtNum(r.totalAfter)]}):null,
              ]}));
            }
            rows.push(toastRow("imp"));
            detail=jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8,padding:"10px 12px",borderRadius:8,
              background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.2)"},children:[
              jsx_runtime.jsx("div",{style:styles.cDesc,children:"把磁盘上存在、但账本里没有的会话补进来。与「补齐历史维度」不同：那项只补已有行的列、不动总量；这一项会新增记录、让总量变大，所以必须先统计再确认。"}),
              rows,
            ]});
          }
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:10},children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("span",{style:styles.cTitle,children:"补录缺失会话"}),
                jsx_runtime.jsx("span",{style:Object.assign({},styles.chip,{borderColor:"#f59e0b",color:"#f59e0b"}),children:"会改变总量"}),
              ]}),
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:"auto",flexShrink:0}),children:summary}),
              open
                ? jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ maintOpen[1](""); },children:"收起"})
                : jsx_runtime.jsx("button",{style:Object.assign({},styles.btn,{borderColor:"#f59e0b",color:"#f59e0b"}),onClick:function(){ maintOpen[1]("import"); if(!importPreview[0]) loadImportPreview(); },children:"统计待补录"}),
            ]}),
            detail,
          ]});
        }
        // ── 账本快照（维护列表一行，收起时摘要，展开才读列表）──
        function backupRow(){
          var b=backupsState[0];
          var items=(b&&b.items)||[];
          var open=maintOpen[0]==="backup";
          var summary=b?(items.length+" 份 · 保留最近 10 份"):"每次清空账本前自动写一份完整库快照";
          var detail=null;
          if(open){
            var body;
            if(!items.length){
              body=jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
                jsx_runtime.jsx("span",{style:styles.hint,children:"暂无快照（清空账本时会自动生成，只保留最近 10 份）"}),
                jsx_runtime.jsx("button",{style:styles.btn,onClick:loadBackups,disabled:backupsBusy[0],children:backupsBusy[0]?"读取中…":"刷新"}), ]});
            } else {
              body=jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},children:[
                  b.dir?jsx_runtime.jsxs("span",{style:Object.assign({},styles.hint,{wordBreak:"break-all"}),children:["目录 ",b.dir]}):null,
                  jsx_runtime.jsx("button",{style:styles.btn,onClick:loadBackups,disabled:backupsBusy[0],children:backupsBusy[0]?"读取中…":"刷新"}),
                ]}),
                jsx_runtime.jsx("div",{style:{display:"flex",flexDirection:"column",gap:4},children:items.map(function(it){
                  return jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:"11px",padding:"4px 8px",borderRadius:6,
                    background:"var(--dsw-alias-bg-layer-2,#1e1e26)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))"},children:[
                    jsx_runtime.jsx("span",{style:{fontWeight:600,color:"var(--dsw-alias-label-primary,#fff)"},children:it.name}),
                    jsx_runtime.jsx("span",{style:styles.hint,children:fmtBytes(it.bytes)}),
                    it.at?jsx_runtime.jsx("span",{style:styles.hint,children:fmtDate(it.at)}):null,
                    it.scope?jsx_runtime.jsx("span",{style:styles.hint,children:it.scope==="all"?"全清":(it.scope==="before"?"按时间":"按项目")}):null,
                    it.cleared!=null?jsx_runtime.jsx("span",{style:styles.hint,children:"删 "+fmtNum(it.cleared)+" 行"}):null,
                  ]}, it.name);
                })}),
                jsx_runtime.jsx("div",{style:styles.hint,children:"快照是完整 SQLite 库文件，可直接用 sqlite 打开查证；需要回灌时把原库停掉、用快照覆盖 storages/token-meter.db 即可（回灌后记得删掉 meta 里的 reset_at，否则历史下限仍然生效）。"}),
              ]});
            }
            detail=jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8,padding:"10px 12px",borderRadius:8,
              background:"rgba(255,255,255,0.03)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"},children:[
              jsx_runtime.jsx("div",{style:styles.cDesc,children:"每次清空账本前自动写一份完整库快照，保留最近 10 份。"}),
              body,
            ]});
          }
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:10},children:[
              jsx_runtime.jsx("span",{style:styles.cTitle,children:"账本快照"}),
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:"auto",flexShrink:0}),children:summary}),
              open
                ? jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ maintOpen[1](""); },children:"收起"})
                : jsx_runtime.jsx("button",{style:styles.btn,onClick:function(){ maintOpen[1]("backup"); loadBackups(); },children:"查看快照列表"}),
            ]}),
            detail,
          ]});
        }
        function confPanel(){
          var c=cfg[0];
          var widgetOn=loadWidgetEnabled();
          // 贴边收起开关（设置 → 外观）：与悬浮窗是两个 React 树，靠事件同步。
          var edgeCollapseState=react.useState(loadEdgeCollapse());
          // 「外观」：悬浮窗开关/模板/材质/小窗口图表（外加 R4Coder 悬浮样式），全部只影响小窗口观感，与数据源/用量统计图表是**不同偏好**。
          var appearance=jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("悬浮窗外观"),
              card({
                title:"小窗口",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"悬浮于侧边的额度轮播挂件 · 单源展示，右键或滑动切换 Opencode｜DeepSeek｜R4Coder｜TokenMeter"}),
                toastKey:"widget",
                control:switchEl(widgetOn,function(v){ saveWidgetEnabled(v); cfg[1](Object.assign({},cfg[0])); })
              }),
              // 贴边吸附收起：默认关。开启后**不会**改变现有的"松手自动吸附"行为，
              // 只是在已贴边时"再往边缘拽一下"才会收成把手条（用户明确要求的触发时机）。
              card({
                title:"贴边收起",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"开启后，把悬浮窗拖到窗口左/右边缘松手仍是原来的自动吸附；此时再往同一侧拽一下就收成一条把手，鼠标移上去自动展开、点击可固定展开。仅存本机，不影响其它设置。"}),
                toastKey:"edge",
                control:switchEl(edgeCollapseState[0],function(v){
                  saveEdgeCollapse(v);
                  edgeCollapseState[1](v);
                  if(!v){
                    // 关闭时若正收起，立刻恢复完整态（否则窗口停在把手条上无法操作）
                    try{ window.dispatchEvent(new Event("opencode:edge-reveal")); }catch(e){}
                    showToast("edge",true,"贴边收起已关闭，悬浮窗已恢复");
                  } else {
                    showToast("edge",true,"已开启：贴边后继续往边缘拽一下即收起");
                  }
                })
              }),
              card({
                title:"悬浮窗模板",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口 TokenMeter 轮播页的排版模板"}),
                control:pillGroup("",[["classic","经典版"],["compact","紧凑版"]],tmLayoutState,saveTmLayout)
              }),
              card({
                title:"面板材质",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口的外壳观感。默认「经典」= 插件原有背板；液态玻璃跟随指针高光，亚克力景深最强但模糊更耗 GPU，哑光纸不透明、零模糊。仅存本机，不改额度配置。"}),
                toastKey:"material",
                control:pillGroup("",[["classic","经典"],["liquid","液态玻璃"],["acrylic","亚克力"],["paper","哑光纸"]],panelMaterialState,function(v){
                  savePanelMaterial(v);
                  try{
                    if(v==="acrylic") showToast("material",true,"亚克力已启用（模糊半径较大，低配设备可选哑光纸）");
                    else if(v==="classic") showToast("material",true,"已恢复经典背板");
                    else showToast("material",true,"材质已切换为"+(v==="liquid"?"液态玻璃":"哑光纸"));
                  }catch(e){}
                })
              }),
              (c.providers.r4coder && c.providers.r4coder.enabled) ? card({
                title:"R4Coder 悬浮样式",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口 R4Coder 轮播页的排版（仅数据源启用时显示本项）"}),
                control:pillGroup("",[["ring","环形进度"],["bar","额度横条"]],r4LayoutState,saveR4Layout)
              }) : null,
              // 小窗口 TokenMeter 页的图表形态。注意与「用量统计」Tab 的图表选择是**两个独立偏好**：
              // 设置页的大图支持 柱状/折线/热力图/时段，小窗口只支持 柱状（近 7 日迷你柱）/ 热力图（当月日历），
              // 存的是不同的 localStorage key，互不影响（拆分原因见 loadSettingsChart 注释）。
              card({
                title:"小窗口图表",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口 TokenMeter 轮播页的图表形态：柱状=近 7 日趋势；热力图=当月日历。与「用量统计」页的图表选择互不影响。"}),
                toastKey:"tmchart",
                control:pillGroup("",[["bar","柱状"],["heat","热力图"]],tmWidgetChartState,function(v){
                  saveTmChart(v);
                  tmWidgetChartState[1](v);
                  showToast("tmchart",true,v==="heat"?"小窗口已切换为热力图":"小窗口已切换为柱状图");
                })
              }),
            ]});
          // 「数据源」：各家额度来源的凭证 + 连通性测试。这里只管「数据从哪来」，不管「小窗口长什么样」。
          var dataSources=jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("数据源", [
                rawResp[0]?jsx_runtime.jsx("button",{key:"raw",style:styles.iconBtn,title:"查看原始响应",onClick:function(){rawOpen[1](!rawOpen[0]);},children:"{}"}):null,
                jsx_runtime.jsx("button",{key:"testall",style:styles.btn,onClick:function(){doTest();},disabled:testLoading[0],children:testLoading[0]?"检测中…":"全部测试"})
              ]),
              providerSummary("opencode","Oc","linear-gradient(135deg,#6d5bff,#2ec5ff)","Opencode"),
              expandedSrc[0]==="opencode"?providerForm("opencode"):null,
              providerSummary("deepseek","DS","linear-gradient(135deg,#0ea5e9,#6366f1)","DeepSeek"),
              expandedSrc[0]==="deepseek"?providerForm("deepseek"):null,
              providerSummary("r4coder","R4","linear-gradient(135deg,#f59e0b,#f97316)","R4Coder"),
              expandedSrc[0]==="r4coder"?providerForm("r4coder"):null,
              rawOpen[0]&&rawResp[0]?jsx_runtime.jsx("div",{style:styles.code,children:JSON.stringify(rawResp[0],null,2).slice(0,2000)}):null,
              toastRow("test"),
            ]});
          // 「网关」：dsh-providers-hub 的网关用量（只读另一个插件的账本）。
          // 为什么是独立 tab 而不是塞进「数据源」：那一页每一条都是**出站凭据源**
          // （token / baseUrl / 测试连接 / 掩码 chip）。网关没有凭据可填，塞进去会渲染
          // 出空的「••••」chip 和点不动的「测试连接」，语义全错；而这里要放的是
          // "是否授权的开关 + 监测到了什么 + 与本机的对照"，信息量本来就不是一行摘要。
          var gwEnabled = gatewayEnabled(c);
          function gwStatus(){
            var d=gwData[0];
            if(!gwEnabled) return {tone:"off",text:"未监测"};
            if(gwErr[0]) return {tone:"err",text:"读取失败"};
            if(!d) return {tone:"idle",text:gwLoading[0]?"读取中…":"待读取"};
            if(d.disabled) return {tone:"off",text:"未监测"};
            if(!d.available){
              if(d.error==="not-found") return {tone:"warn",text:"未找到 Jet Hub 账本"};
              if(d.error==="bad-schema") return {tone:"warn",text:"账本格式不认识"};
              if(d.error==="bad-json") return {tone:"warn",text:"账本无法解析"};
              return {tone:"err",text:"读取失败"};
            }
            if(d.empty) return {tone:"warn",text:"账本里没有网关流量"};
            return {tone:"ok",text:"正常 · "+(d.schema||"账本")};
          }
          function gwToneColor(tone){
            if(tone==="ok") return "var(--dsw-alias-state-success-primary,#34d399)";
            if(tone==="err") return "#ef4444";
            if(tone==="warn") return "#e8b463";
            return "var(--dsw-alias-label-caption,#9a9aaa)";
          }
          var gwSt=gwStatus();
          var gwDays=(gwData[0]&&Array.isArray(gwData[0].days))?gwData[0].days:[];
          // 本页区间：1d/7d/30d，按 days[] 的本地日键过滤（gatewayReport 已按新在前排序）
          function gwWindowDays(){
            var n = gwRange[0]==="7d"?7:(gwRange[0]==="30d"?30:1);
            var today=localDayStrOf(Date.now());
            var t0=Date.parse(today+"T00:00:00");
            var out=[];
            for(var i=0;i<gwDays.length;i++){
              var d=gwDays[i];
              var t=Date.parse(String(d.day)+"T00:00:00");
              if(!isFinite(t)) continue;
              var diff=Math.round((t0-t)/86400000);
              if(diff>=0 && diff<n) out.push(d);
            }
            return out;
          }
          var gwWin=gwWindowDays();
          var gwSum={requests:0,total:0,freshInput:0,cacheRead:0,output:0};
          gwWin.forEach(function(d){ gwSum.requests+=Number(d.requests||0)||0; gwSum.total+=Number(d.total||0)||0;
            gwSum.freshInput+=Number(d.freshInput||0)||0; gwSum.cacheRead+=Number(d.cacheRead||0)||0; gwSum.output+=Number(d.output||0)||0; });
          // 近 7 天迷你柱（与当前区间无关：这一卡是"最近发生了什么"的稳定视图）
          var gwMini=gwDays.slice(0,7).slice().reverse();
          var gwMiniMax=0; gwMini.forEach(function(d){ var v=Number(d.total||0)||0; if(v>gwMiniMax) gwMiniMax=v; });
          if(gwMiniMax<=0) gwMiniMax=1;
          // 与本机对照：优先用主接口的 sources（它按**当前选择区间**算，口径与总览一致）；
          // 取不到时退回这一页自己的区间汇总，避免显示空白。
          var srcMeter=(meterData[0]&&meterData[0].sources)?meterData[0].sources:null;
          var gwAllTot = srcMeter? Number(srcMeter.gateway&&srcMeter.gateway.total||0) : 0;
          var localTot = srcMeter? Number(srcMeter.local&&srcMeter.local.total||0) : 0;
          var cmpLocal=localTot, cmpGw=gwAllTot;
          if(!srcMeter){ cmpGw=gwSum.total; cmpLocal=0; }
          var cmpAll=cmpLocal+cmpGw;
          var gwPct = cmpAll>0 ? Math.round(cmpGw/cmpAll*1000)/10 : null;
          function gwDiagText(){
            var d=gwData[0]||{};
            return ["dsh-quota-widget 网关账本诊断",
              "时间: "+(gwData[0]&&d.loadedAt?new Date(d.loadedAt).toISOString():"-"),
              "开关: "+(gwEnabled?"开":"关"),
              "状态: "+(d.available?"可用":"不可用")+(d.error?(" / "+d.error):""),
              "schema: "+(d.schema||"-"),
              "路径: "+(d.path||"-"),
              "试过: "+(Array.isArray(d.triedPaths)?d.triedPaths.join(" | "):"-"),
              "规模: "+(d.dayCount||0)+" 天 / "+(d.bucketCount||0)+" 桶",
              "跨度: "+(d.firstDay||"-")+" ~ "+(d.lastDay||"-"),
              "细节: "+(d.detail||"-"),
            ].join("\n");
          }
          var gatewayPanel=jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("网关"),
              // ① 授权开关
              card({
                title:"监测网关用量",
                desc:jsx_runtime.jsxs("div",{style:styles.cDesc,children:[
                  "读取 dsh-providers-hub（Jet Hub）的用量账本，把它的网关流量并进统计。",
                  jsx_runtime.jsx("br",{}),
                  "只读：不写入、不修改对方任何文件，也不含对话内容；关闭后立即停止读取。",
                ]}),
                control:switchEl(gwEnabled, function(v){
                  updateSource("gateway",{enabled:!!v});
                  showToast("gw",true, v?"已开启网关监测":"已关闭网关监测（统计将只含本机）");
                  // 开关改了必须重拉：宿主侧口径变了（gw=1/0），缓存判据里也带了它
                  meterVerRef.current=null;
                  refreshMeter({silent:true});
                  refreshGateway({force:true});
                })
              }),
              toastRow("gw"),
              // ② 数据源状态
              card({
                col:true,
                title:"数据源",
                desc:jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:5},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,fontSize:"11px",flexWrap:"wrap"},children:[
                    jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",flexShrink:0,background:gwToneColor(gwSt.tone)}}),
                    jsx_runtime.jsx("span",{style:{fontWeight:700,color:"var(--dsw-alias-label-primary,#fff)"},children:gwSt.text}),
                    gwData[0]&&gwData[0].path?jsx_runtime.jsx("span",{style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"Jet Hub 账本"}):null,
                  ]}),
                  gwErr[0]?jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"#ef4444",wordBreak:"break-all"},children:gwErr[0]}):null,
                  gwData[0]&&gwData[0].path?jsx_runtime.jsx("div",{
                    title:gwData[0].path,
                    style:{fontSize:"11px",fontFamily:"'Cascadia Code', Consolas, monospace",color:"var(--dsw-alias-label-secondary,#a0a0b0)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"},
                    children:gwData[0].path
                  }):null,
                  // 未安装时列出试过的路径（折叠）：排障唯一线索，不铺开是为了不吓人
                  (!gwData[0]||!gwData[0].available)&&gwData[0]&&Array.isArray(gwData[0].triedPaths)&&gwData[0].triedPaths.length
                    ? jsx_runtime.jsx("details",{style:{fontSize:"11px"},children:[
                        jsx_runtime.jsx("summary",{style:{cursor:"pointer",color:"var(--dsw-alias-label-caption,#9a9aaa)",userSelect:"none"},children:"已尝试的路径（"+gwData[0].triedPaths.length+"）"}),
                        jsx_runtime.jsx("div",{style:{marginTop:4,fontFamily:"'Cascadia Code', Consolas, monospace",wordBreak:"break-all",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:gwData[0].triedPaths.map(function(p,i){ return jsx_runtime.jsx("div",{children:p},i); })}),
                      ]})
                    : null,
                  gwData[0]&&gwData[0].available?jsx_runtime.jsxs("div",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:[
                    (gwData[0].dayCount||0)+" 天 · "+(gwData[0].bucketCount||0)+" 桶",
                    gwData[0].size!=null?(" · "+Math.max(1,Math.round(Number(gwData[0].size)/1024))+" KB"):"",
                    gwData[0].mtimeMs?(" · 文件更新 "+fmtAgo(Number(gwData[0].mtimeMs), nowTick[0])):"",
                  ]}):null,
                  gwData[0]&&gwData[0].error==="bad-schema"&&gwData[0].detail
                    ? jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"#e8b463",wordBreak:"break-all"},children:"读到的 schema："+gwData[0].detail})
                    : null,
                  gwData[0]&&gwData[0].available&&gwData[0].empty
                    ? jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"#e8b463",lineHeight:1.6},children:"账本存在，但里面只有直连记录（direct），没有网关记录（gateway）。这通常意味着网关没被外部客户端用过，或已被关闭——不是故障。"})
                    : null,
                ]}),
                control:[
                  jsx_runtime.jsx("button",{key:"reload",style:styles.btn,onClick:function(){ refreshGateway({force:true}); },disabled:gwLoading[0],children:gwLoading[0]?"读取中…":"重新读取"}),
                  jsx_runtime.jsx("button",{key:"diag",style:styles.iconBtn,title:"复制完整诊断信息（状态/路径/schema/规模）",onClick:function(){
                    var ok=copyText(gwDiagText()); showToast("gw",ok,ok?"已复制诊断信息":"复制失败（剪贴板被拦截）");
                  },children:"诊断"}),
                ]
              }),
              // ③ 监测到的内容
              card({
                col:true,
                title:"监测到的内容",
                desc:jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"},children:[
                    pillGroup("",[["1d","今日"],["7d","7天"],["30d","30天"]],gwRange,function(v){ gwRange[1](v); }),
                    jsx_runtime.jsx("span",{style:{flex:1}}),
                    jsx_runtime.jsx("span",{style:{fontSize:"10px",padding:"1px 6px",borderRadius:999,border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.1))",color:"var(--dsw-alias-label-caption,#9a9aaa)"},title:"对方的日聚合固定按 UTC+8 结算，与本机时区无关",children:"UTC+8 日界"}),
                  ]}),
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"},children:[
                    jsx_runtime.jsx("span",{style:{fontSize:"14px",fontWeight:800,fontFamily:"'Cascadia Code', Consolas, monospace",fontVariantNumeric:"tabular-nums",color:"var(--dsw-alias-label-primary,#fff)"},children:fmtTokens(gwSum.total)}),
                    jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:"Token · "+fmtNum(gwSum.requests)+" 次请求"}),
                  ]}),
                  jsx_runtime.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:"11px",fontWeight:700},children:[
                    jsx_runtime.jsxs("span",{style:{color:"var(--bmon-c1,#6b87d9)"},children:["输入 ",fmtTokens(gwSum.freshInput)]}),
                    jsx_runtime.jsxs("span",{style:{color:"var(--bmon-c3,#c65f7f)",textAlign:"center"},children:["缓存 ",fmtTokens(gwSum.cacheRead)]}),
                    jsx_runtime.jsxs("span",{style:{color:"var(--bmon-c2,#b08427)",textAlign:"right"},children:["输出 ",fmtTokens(gwSum.output)]}),
                  ]}),
                  gwMini.length?jsx_runtime.jsx("div",{title:"近 "+gwMini.length+" 天网关用量（悬停看当天分项）",style:{display:"flex",alignItems:"flex-end",gap:3,height:30,padding:"0 2px"},children: gwMini.map(function(d,i){
                    var v=Number(d.total||0)||0; var h=Math.max(3,Math.round(v/gwMiniMax*26));
                    var tip=d.day+" · 总 "+fmtNum(d.total)+"（输入 "+fmtNum(d.freshInput)+" / 缓存 "+fmtNum(d.cacheRead)+" / 输出 "+fmtNum(d.output)+"）· "+(d.requests||0)+" 次";
                    return jsx_runtime.jsx("div",{title:tip,style:{flex:1,height:h,minHeight:3,borderRadius:3,background:i===gwMini.length-1?"linear-gradient(180deg,#82a1ea,#5a71c4)":"rgba(109,91,255,0.45)"}}, d.day+"-"+i);
                  })}):jsx_runtime.jsx("div",{style:styles.hint,children:gwEnabled?"暂无网关用量数据":"监测已关闭，不读取任何数据"}),
                ]}),
                control:[
                  // 渠道 / 模型 Top（并列两列，各 5 条）
                  jsx_runtime.jsxs("div",{key:"top",style:{display:"flex",gap:14,flexWrap:"wrap",width:"100%"},children:[
                    jsx_runtime.jsxs("div",{style:{flex:"1 1 140px",minWidth:0},children:[
                      sectionLabel("渠道 Top5"),
                      (gwData[0]&&Array.isArray(gwData[0].providers)&&gwData[0].providers.length)
                        ? gwData[0].providers.slice(0,5).map(function(p,i){
                            return jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",gap:8,fontSize:"11px",lineHeight:1.8},children:[
                              jsx_runtime.jsx("span",{style:{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:p.provider}),
                              jsx_runtime.jsx("span",{style:{flex:"none",fontFamily:"'Cascadia Code', Consolas, monospace",color:"var(--dsw-alias-label-primary,#fff)"},children:fmtTokens(p.total)}),
                            ]}, "p"+i);
                          })
                        : jsx_runtime.jsx("div",{style:styles.hint,children:"—"}),
                    ]}),
                    jsx_runtime.jsxs("div",{style:{flex:"1 1 140px",minWidth:0},children:[
                      sectionLabel("模型 Top5"),
                      (gwData[0]&&Array.isArray(gwData[0].models)&&gwData[0].models.length)
                        ? gwData[0].models.slice(0,5).map(function(m,i){
                            return jsx_runtime.jsxs("div",{style:{display:"flex",justifyContent:"space-between",gap:8,fontSize:"11px",lineHeight:1.8},children:[
                              jsx_runtime.jsx("span",{style:{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:m.model}),
                              jsx_runtime.jsx("span",{style:{flex:"none",fontFamily:"'Cascadia Code', Consolas, monospace",color:"var(--dsw-alias-label-primary,#fff)"},children:fmtTokens(m.total)}),
                            ]}, "m"+i);
                          })
                        : jsx_runtime.jsx("div",{style:styles.hint,children:"—"}),
                    ]}),
                  ]}),
                ]
              }),
              // ④ 与本机对照 —— 这一卡专门回答"为什么我的总量是这个数"
              card({
                col:true,
                title:"与本机的对照",
                desc:jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:5},children:[
                  srcMeter
                    ? jsx_runtime.jsxs("div",{style:{fontSize:"11px",fontFamily:"'Cascadia Code', Consolas, monospace",color:"var(--dsw-alias-label-secondary,#a0a0b0)"},children:[
                        "本机 "+fmtTokens(cmpLocal)+" ＋ 网关 "+fmtTokens(cmpGw)+" ＝ "+fmtTokens(cmpAll),
                        gwPct!=null?("（网关占 "+gwPct+"%）"):"",
                      ]})
                    : jsx_runtime.jsx("div",{style:styles.hint,children:"主数据接口尚未返回分源拆解（旧 host 或未加载），下方只显示网关侧口径。"}),
                  !gwEnabled?jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"#e8b463",lineHeight:1.6},children:"监测已关闭：悬浮窗与总览显示的是「仅本机」口径，宿主也不会读取对方账本。"}):null,
                  jsx_runtime.jsx("div",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)",lineHeight:1.6},children:"网关流量没有：项目归属 / 会话 / 工具调用 / 24 小时分布 / 逐笔明细。这些维度仍只统计本机会话。"}),
                ]})
              }),
            ]});
          // 「通用」：额度刷新节奏 + 侧栏入口开关 + 用量统计页外观
          //（预设/A-B-C 风格只存本机，不影响悬浮窗）。
          var sidebarEntryOn=react.useState(loadSidebarEntry());
          react.useEffect(function(){
            // 其它标签页/面板页头改了开关时同步文案（同一事件源）
            var on=function(){ sidebarEntryOn[1](loadSidebarEntry()); };
            try{ window.addEventListener("opencode:sidebar-entry-changed", on); }catch(e){}
            return function(){ try{ window.removeEventListener("opencode:sidebar-entry-changed", on); }catch(e){} };
          },[]);
          var general=jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("通用"),
              card({
                title:"自动刷新",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"额度数据的自动拉取周期（30–3600 秒）"}),
                control:[
                  jsx_runtime.jsx("input",{style:styles.inputSmall,type:"number",min:30,max:3600,value:c.intervalSec,onInput:function(e){var v=parseInt(e.target.value,10); if(!isNaN(v)) update({intervalSec:Math.max(30,Math.min(3600,v))},{quiet:true});},onBlur:commitConfigNow}),
                  jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"秒"}),
                ]
              }),
              // 侧栏入口开关（DSH v0.2.1+ 的「全局面板」席位）：关闭后左侧栏「用量与额度」
              // 图标行与全局面板一并撤销；悬浮窗与设置页入口不受影响。仅存在于具备该席位的
              // DSH 上，旧版 DSH 上这个开关没有任何可见效果（侧栏入口本来就不会出现）。
              card({
                title:"侧栏入口",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"在左侧栏显示「用量与额度」入口（点击打开全宽管理面板）。关闭不影响悬浮小窗和这里的设置页。需要 DSH v0.2.1 及以上。"}),
                control:switchEl(sidebarEntryOn[0],function(v){ saveSidebarEntry(v); sidebarEntryOn[1](v); })
              }),
              groupHead("用量统计外观"),
              jsx_runtime.jsx("div",{style:{fontSize:"11px",lineHeight:1.7,color:"var(--dsw-alias-label-caption,#9a9aaa)",marginBottom:8},
                children:"每个模块可单独选 A/B/C，预设一次改全部。选择只存本机 localStorage，不写入插件配置，也不影响悬浮窗。"}),
              jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:8},children:[
                jsx_runtime.jsx("span",{style:styles.hint,children:"预设"}),
                Object.keys(USAGE_STYLE_PRESETS).map(function(k){
                  var active=stylePresetOf(tmUsageStyle[0])===k;
                  return jsx_runtime.jsx("button",{onClick:function(){ applyUsagePreset(k); },
                    style:{padding:"3px 10px",borderRadius:999,fontSize:"11px",fontWeight:active?700:500,cursor:"pointer",fontFamily:"inherit",
                      border:"1px solid "+(active?ACCENT:"var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"),
                      background:active?"rgba(109,91,255,0.14)":"var(--dsw-alias-bg-layer-2,#1e1e26)",
                      color:active?"var(--dsw-alias-state-business-primary,#8b7bff)":"var(--dsw-alias-label-secondary,#a0a0b0)"}},k);
                }),
                stylePresetOf(tmUsageStyle[0])==="custom"?jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"#8b7bff"},children:"自定义"}):null,
              ]}),
              USAGE_MODULES.map(function(mod){
                return jsx_runtime.jsxs("div",{className:"oq-style-row",children:[
                  jsx_runtime.jsx("span",{className:"nm",children:STYLE_LABELS[mod]}),
                  sortPills(STYLE_OPTS[mod], tmUsageStyle[0][mod], function(v){ setUsageStyle(mod, v); }),
                  jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:"auto",textAlign:"right"}),children:STYLE_DESC[mod][tmUsageStyle[0][mod]]}),
                ]},mod);
              }),
            ]});
          // 「维护」：账本类操作收敛成一张「账本维护」操作列表（手风琴展开，一次一个），
          // 重置类（配置/悬浮窗位置）单独一行放列表外。危险度用颜色+徽标分级，不与外观/数据源混排。
          var maintenance=jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("维护"),
              jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
                // 修复数据（安全 / 改总量）
                sectionLabel("修复数据"),
                importRow(),
                jsx_runtime.jsx("div",{style:styles.rowDivider}),
                enrichRow(),
                jsx_runtime.jsx("div",{style:styles.rowDivider}),
                // 危险区（不可逆）
                sectionLabel("危险区"),
                clearLedgerRow(),
                jsx_runtime.jsx("div",{style:styles.rowDivider}),
                backupRow(),
              ]}),
              card({
                toastKey:"maint",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"把配置还原默认 / 让悬浮窗回到默认停靠点。清空、补齐、补录账本见上方「账本维护」列表。"}),
                control:dangerCtl("cfg","重置配置",resetConfig).concat(dangerCtl("win","重置悬浮窗位置",resetWindowPos))
              }),
            ]});
          var panels={conf:appearance,data:dataSources,gen:general,maint:maintenance,gateway:gatewayPanel};
          var panelKids=[];
          Object.keys(panels).forEach(function(k){
            // data-panel / data-active 是**契约**：渲染测试用它判定"当前可见的是哪个面板"。
            // 靠 style 反推不可靠（隐藏面板仍在树里，且多个面板的 style 形状相同——
            // 实测按 display/flexDirection/gap 匹配会同时命中全部 6 个）。
            panelKids.push(jsx_runtime.jsx("div",{
              "data-panel":k,
              "data-active":tabState[0]===k?"1":"0",
              style:{display:tabState[0]===k?"flex":"none",flexDirection:"column",gap:"8px"},
              children:panels[k],
            },k));
          });
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"20px"},children:panelKids});
        }
        return jsx_runtime.jsxs("div",{"data-opencode-settings":"1",style:styles.section,children:[
          tabBar(),
          // data-panel / data-active 是渲染测试判定"当前可见面板"的契约（同 confPanel 末尾）
          jsx_runtime.jsx("div",{"data-panel":"usage","data-active":tabState[0]==="usage"?"1":"0",style:{display:tabState[0]==="usage"?"flex":"none",flexDirection:"column",gap:"12px"},children:usagePanel()}),
          jsx_runtime.jsx("div",{"data-panel":"conf","data-active":tabState[0]==="usage"?"0":"1",style:{display:tabState[0]==="usage"?"none":"flex",flexDirection:"column",gap:"20px"},children:confPanel()}),
        ]});
      }

      // ===== 热力图交互包（方案三：GSAP 果冻/涟漪/呼吸/扫光 + 自定义富 tooltip + A/B/C 悬停稳住）=====
      var heatTipEl=null, heatShowT=null, heatHideT=null, heatFxKey=null, isHeatHovering=false, pendingTmData=null, pendingChartTm=null;
      function flushPendingHeat(){
        if(pendingTmData){ try{ var p=pendingTmData; pendingTmData=null; var setter=p._setter; if(setter) setter(p.data); }catch(e){} }
        if(pendingChartTm){ try{ var q=pendingChartTm; pendingChartTm=null; var setter2=q._setter; if(setter2) setter2(q.data); }catch(e){} }
      }
      function heatTipEnsure(){
        if(heatTipEl && heatTipEl.isConnected) return heatTipEl;
        heatTipEl=document.createElement("div");
        heatTipEl.className="oq-heat-tip";
        document.body.appendChild(heatTipEl);
        return heatTipEl;
      }
      function heatTipBuild(d){
        var rows="";
        var row=function(l,v,c){ return '<div class="tt-row"><span>'+l+'</span><b style="'+(c?"color:"+c:"")+'">'+v+'</b></div>'; };
        if(d.has){
          rows+=row("输入",fmtTokens(d.prompt),"#6b87d9");
          rows+=row("输出",fmtTokens(d.out),"#b08427");
          rows+=row("缓存读",fmtTokens(d.cacheRead),"#c65f7f");
          rows+=row("请求",(d.requests||0)+" 次"+(d.tools!=null?" · 工具 "+d.tools:""));
          var mlist=(d.models&&d.models.length&&d.total>0)?d.models:null;
          if(mlist){
            var mc=["#6b87d9","#b08427","#c65f7f","#8d7ce4"];
            var showN=Math.min(2,mlist.length);
            var dot=function(c){ return '<i style="flex:none;width:6px;height:6px;border-radius:50%;background:'+c+'"></i>'; };
            var nameSpan=function(inner){ return '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:4px">'+inner+'</span>'; };
            rows+='<div style="border-top:1px solid rgba(255,255,255,0.08);margin:5px 0 3px"></div>';
            for(var mi=0;mi<showN;mi++){
              var mm2=mlist[mi];
              var pct=d.total>0?Math.round(mm2.total/d.total*100):0;
              rows+='<div class="tt-row">'+nameSpan(dot(mc[mi])+esc(mm2.model))+'<b>'+pct+'%</b></div>';
            }
            if(mlist.length>showN){
              var restTotal=0;
              for(var ri=showN;ri<mlist.length;ri++) restTotal+=(mlist[ri].total||0);
              if(restTotal>0){ var rpct=d.total>0?Math.round(restTotal/d.total*100):0;
                rows+='<div class="tt-row">'+nameSpan(dot("#9a9aaa")+"其他 "+(mlist.length-showN)+" 个")+'<b>'+rpct+'%</b></div>'; }
            }
          }
        } else {
          rows+='<div class="tt-row"><span>当日无调用记录</span></div>';
        }
        var lvDots="";
        for(var i=0;i<=HEAT_LV;i++){ lvDots+='<i style="background:var(--bmon-h'+i+')"'+(i===d.lv?' data-on="1"':'')+'></i>'; }
        return '<div class="tt-head">'+d.head+'</div>'
          +'<div class="tt-main" style="color:'+(d.has?"#82a1ea":"#9a9aaa")+'">'+(d.has?fmtTokens(d.total)+" tokens":"无数据")+'</div>'
          +rows
          +(d.isMax?'<div class="tt-row" style="color:#82a1ea">★ 当月峰值日</div>':"")
          +'<div class="tt-lv">'+lvDots+'<span style="font-size:9px;color:var(--dsw-alias-label-caption,#9a9aaa)">强度 lv'+(d.has?d.lv:0)+'</span></div>';
      }
      function heatTipShow(cellEl,d){
        isHeatHovering=true;
        var tip=heatTipEnsure();
        tip.innerHTML=heatTipBuild(d);
        try{
          var dots=tip.querySelectorAll(".tt-lv i");
          for(var i=0;i<dots.length;i++){ if(i===d.lv){ dots[i].style.boxShadow="0 0 0 1px rgba(255,255,255,0.7)"; } }
        }catch(e){}
        var r=cellEl.getBoundingClientRect();
        var tw=Math.max(132,(tip.offsetWidth||140)), th=(tip.offsetHeight||104);
        var x=Math.round(Math.min(Math.max(6,r.left+r.width/2-tw/2), window.innerWidth-tw-6));
        var y=Math.round(r.top-th-8); if(y<6) y=Math.round(r.bottom+8);
        tip.style.left=x+"px"; tip.style.top=y+"px";
        try{
          ensureGSAP(function(g){
            if(g){ g.killTweensOf(tip); g.fromTo(tip,{opacity:0,y:6,scale:0.92},{opacity:1,y:0,scale:1,duration:0.28,ease:"back.out(2)"}); }
            else { tip.style.opacity="1"; }
          });
        }catch(e){ tip.style.opacity="1"; }
      }
      function heatTipHide(){
        isHeatHovering=false;
        // B 方案：松手立即把悬停期间缓存的刷新推下去，避免数据冻住
        setTimeout(function(){ flushPendingHeat(); }, 0);
        if(!heatTipEl||!heatTipEl.isConnected) return;
        try{
          ensureGSAP(function(g){
            if(g){ g.killTweensOf(heatTipEl); g.to(heatTipEl,{opacity:0,duration:0.18,ease:"power2.in"}); }
            else { heatTipEl.style.opacity="0"; }
          });
        }catch(e){ heatTipEl.style.opacity="0"; }
      }
      function jellyCell(el,on){
        if(!el) return;
        try{
          ensureGSAP(function(g){
            if(!g) return;
            // 只杀 transform 补间：box-shadow 归 CSS 呼吸动画（oq-breathe），不喂给 kill
            g.killTweensOf(el,"scaleX,scaleY");
            if(on){
              g.timeline({targets:el})
                .to(el,{scaleX:1.24,scaleY:0.82,duration:0.12,ease:"power2.out"})
                .to(el,{scaleX:0.93,scaleY:1.16,duration:0.16,ease:"power2.out"})
                .to(el,{scaleX:1.15,scaleY:1.15,duration:0.22,ease:"elastic.out(1,0.5)"});
            } else {
              g.to(el,{scaleX:1,scaleY:1,duration:0.32,ease:"elastic.out(1,0.6)"});
            }
          });
        }catch(e){}
      }
      function sweepMaxOnce(g){
        var c=document.querySelector(".oq-heat-cell.oh-max");
        if(!c) return;
        var r=c.getBoundingClientRect();
        if(r.width<=0||r.height<=0) return;
        var ov=document.createElement("div");
        ov.style.cssText="position:fixed;pointer-events:none;z-index:1001;left:"+r.left+"px;top:"+r.top+"px;width:"+r.width+"px;height:"+r.height+"px;border-radius:4px;overflow:hidden";
        var bar=document.createElement("div");
        bar.style.cssText="position:absolute;top:0;bottom:0;left:0;width:60%;background:linear-gradient(105deg,transparent,rgba(255,255,255,0.9),transparent);transform:translateX(-120%)";
        ov.appendChild(bar); document.body.appendChild(ov);
        try{ g.killTweensOf(bar);}catch(e){}
        g.fromTo(bar,{xPercent:-120},{xPercent:320,duration:0.9,ease:"power2.inOut",onComplete:function(){ try{ov.remove();}catch(e){} }});
      }
      // 顶层滚动关掉悬空的 tooltip。
      // 注意：监听器体必须读 window.__oqHeatReset，不能直接捕获 apply 作用域里的
      // heatTipHide —— 插件热更新时 apply 会重跑并产生新闭包，而全局监听器只装一次，
      // 若它捕获旧闭包就会永远操作已卸载实例的 DOM 节点（既失效又拖住旧实例不释放）。
      try{
        if(!window.__oqHeatScrollBound){
          window.__oqHeatScrollBound=true;
          document.addEventListener("scroll",function(e){
            try{
              var t=e.target;
              if(t && t.closest && t.closest(".oq-overlay, .oq-heat-tip")){ try{ window.__oqHeatReset(); }catch(_){} }
              else if(t===document || t===window || t===document.documentElement || t===document.body){
                // 顶层滚动也关，避免 fixed tip 悬空
                try{ window.__oqHeatReset(); }catch(_){}
              }
            }catch(_){ /* 聊天区滚动不关，避免流式抖动 */ }
          },true);
        }
      }catch(e){}
      // 悬停标志的生命周期兜底：heatTipHide 是唯一的复位点，但组件卸载（关掉小窗、
      // 切材质触发重注册）时不会有人调它，isHeatHovering 会永远为 true，
      // 于是 pullMeter 一直把 payload 塞进 pendingTmData 而 flushPendingHeat 再不执行
      // → 轮询数据静止。这里在页面隐藏/卸载时强制复位并冲掉缓存。
      // __oqHeatReset 每次 apply 都**重新赋值**（指向本次闭包），监听器只装一次，
      // 这样热更新后调用的是最新实例、旧闭包可以被回收。
      try{
        window.__oqHeatReset=function(){
          try{ isHeatHovering=false; }catch(e){}
          try{ heatTipHide(); }catch(e){}
          try{ flushPendingHeat(); }catch(e){}
        };
        if(window.__oqHeatResetBound!==true){
          window.__oqHeatResetBound=true;
          document.addEventListener("visibilitychange",function(){
            try{ if(document.visibilityState==="hidden") window.__oqHeatReset(); }catch(e){}
          });
          window.addEventListener("pagehide",function(){ try{ window.__oqHeatReset(); }catch(e){} });
        }
      }catch(e){}

      slots.inject("shell.overlay",function(){
        return slots.register({name:"shell.overlay",id:"opencode-quota-widget",order:12,label:"额度轮播(TokenMeter)"},function(){return jsx_runtime.jsx(QuotaWidget,{});});
      });
      slots.inject("settings.section",function(){
        return slots.register({name:"settings.section",id:"opencode-quota-settings",order:920,label:SETTINGS_SECTION_LABEL},function(){return jsx_runtime.jsx(SettingsPanel,{});});
      });
      // 宿主设置弹窗的左导航入口图标（宿主按 id 兜底成齿轮，这里自绘，见 NAV_ROW_MARK 注释）
      installSettingsNavIcon();

      // ===== 左侧栏「用量与额度」全局面板（v0.2.1-rc.3 新增席位，详见 PANEL_ID 注释）=====
      // 图标行（sidebar.panellist）与面板本体（main，key=PANEL_ID）配对注册；两个席位都由
      // ui-sidebar / ui-layout 声明，官方插件（ui-plugin-manager）在 v0.2.1 前就已存在，
      // 而本插件 dsh.client.inject 只声明了 settings/slots/remotes——所以这里用
      // ctx.slots.inject() 的"已声明同步注册、未声明挂起等待"语义接线：席位出现时自动
      // 注册，插件卸载时随 effect 自动注销；在不具备该席位的旧版 DSH 上注入永远不会
      // 触发，零影响、无需升级依赖声明。
      // 选中由 ctx.layout.selectPanel(id) 负责（ui-sidebar 的行点击回调），本侧无需导出。
      function QuotaPanelIcon(props){
        var size=(props&&props.size)||18;
        // 仪表盘字形（与设置导航自绘图标同族的环 + 指针），stroke=currentColor 跟随行态：
        // 官方侧栏对选中行整行换色（panelActive），图标用 currentColor 即自动高亮
        return jsx_runtime.jsxs("svg",{width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",
          strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",focusable:"false",children:[
          jsx_runtime.jsx("path",{d:"M2 16a10 10 0 0 1 20 0"}),
          jsx_runtime.jsx("path",{d:"M12 16l5-6.5"}),
          jsx_runtime.jsx("circle",{cx:"12",cy:"16",r:"1.4",fill:"currentColor",stroke:"none"}),
        ]});
      }
      function QuotaPanelPage(){
        var widgetOn=react.useState(loadWidgetEnabled());
        react.useEffect(function(){
          // 只同步页头开关的文案（设置页/其它标签页开关悬浮窗时跟着变）。
          // 面板与悬浮窗互不隐藏：悬浮窗在左下角、面板内容居中，同屏不冲突；
          // "面板打开时自动隐藏悬浮窗"的两版实现（CSS display:none / 事件抑制位）
          // 都被实测否决，联动已整体移除，见 QuotaWidget 的 hidden 注释。
          var onWidgetToggle=function(){ widgetOn[1](loadWidgetEnabled()); };
          try{ window.addEventListener("opencode:widget-toggled", onWidgetToggle); }catch(e){}
          return function(){
            try{ window.removeEventListener("opencode:widget-toggled", onWidgetToggle); }catch(e){}
          };
        },[]);
        return jsx_runtime.jsxs("div",{className:"oq-page",children:[
          jsx_runtime.jsxs("div",{className:"oq-page-head",children:[
            jsx_runtime.jsxs("div",{children:[
              jsx_runtime.jsx("h1",{className:"oq-page-title",children:"用量与额度"}),
              jsx_runtime.jsx("p",{className:"oq-page-sub",children:"Token 用量统计 · Opencode / DeepSeek / R4Coder 额度一览"}),
            ]}),
            jsx_runtime.jsxs("button",{type:"button",className:"oq-page-toggle","data-on":widgetOn[0]?"1":"0",
              title:widgetOn[0]?"悬浮小窗显示中 · 点击隐藏（本面板不受影响）":"悬浮小窗已隐藏 · 点击恢复",
              onClick:function(){ saveWidgetEnabled(!widgetOn[0]); },children:[
              jsx_runtime.jsx("span",{className:"oq-page-toggle-dot","aria-hidden":"true"}),
              widgetOn[0]?"悬浮窗显示中":"悬浮窗已隐藏",
            ]}),
          ]}),
          // 设置弹窗里的完整表单/统计页直接复用：SettingsPanel 本身是纵向流式、无定宽假设
          jsx_runtime.jsx(SettingsPanel,{}),
        ]});
      }
      // 侧栏入口的用户开关（设置 → 通用，默认开）：关掉后同时撤销图标行与面板两条注册，
      // 悬浮窗与设置页不受影响。用户正停在面板上时，宿主布局 retainMainPanels 发现
      // main 里这个 key 没了会自动切回会话视图，无需本插件干预。
      // 撤销语义：slots.inject 返回的 disposer 会连同回调里 register 的条目一起注销
      // （回调把 register 返回的 disposer 交回给 ctx.effect，见 ui-renderer 的 inject
      // 实现），所以"关 → 拆等待与条目；开 → 重新 inject"。订阅与两条注入挂在同一个
      // ctx.effect 里，插件卸载/HMR 时一并回收。
      var entryFx=function(){
        var injects=[];
        var mount=function(){
          injects.push(slots.inject("sidebar.panellist",function(){
            return slots.register({name:"sidebar.panellist",id:PANEL_ID,order:100,
              label:"用量与额度"},QuotaPanelIcon);
          }));
          injects.push(slots.inject("main",function(){
            return slots.register({name:"main",key:PANEL_ID},QuotaPanelPage);
          }));
        };
        var remount=function(){
          while(injects.length){ try{ injects.pop()(); }catch(e){} }
          if(loadSidebarEntry()) mount();
        };
        try{ window.addEventListener("opencode:sidebar-entry-changed", remount); }catch(e){}
        if(loadSidebarEntry()) mount();
        return function(){
          try{ window.removeEventListener("opencode:sidebar-entry-changed", remount); }catch(e){}
          while(injects.length){ try{ injects.pop()(); }catch(e){} }
        };
      };
      if(typeof ctx.effect==="function") ctx.effect(entryFx, "dsh-quota-widget: sidebar entry switch");
      else entryFx(); // 测试桩没有 ctx.effect：同步执行，不回收
    }
    exports.apply=apply;
    // 测试出口：只暴露纯函数（供 test/client.test.mjs 用 node:test 断言），不参与运行时行为
    exports.__testing={ HEAT_LV, heatLvOf, groupTodayHourBuckets, fmtTokens, fmtNum, fmtDur, fmtAgo, barHeightFor,
      RANGE_KEYS, rangeDays, percentile, avgDelta, PANEL_MATERIALS, loadPanelMaterial, savePanelMaterial,
      loadTmChart, saveTmChart, loadSettingsChart, saveSettingsChart, PANEL_ID,
      loadSidebarEntry, saveSidebarEntry, LS_SIDEBAR_ENTRY,
      LIVE_JUDGE, LIVE_CHANNEL, LIVE_STYLE, LIVE_BADGE, ACTIVE_TTL_MS, SNAPSHOT_TTL_MS, ACTIVITY_SEL,
      // 自定义区间 / 逐日明细
      loadCustomRange, saveCustomRange, defaultCustomRange, rangeQuery, localDayStrOf, LS_CUSTOM_RANGE,
      DETAIL_COLS, detailVal,
      // 贴边收起
      loadEdgeCollapse, saveEdgeCollapse, loadEdgeState, saveEdgeState, edgeCardClass,
      LS_EDGE_COLLAPSE, LS_EDGE_STATE, EDGE_CARD_OUT_PCT, EDGE_CAPSULE_W, EDGE_HANDLE_HIT_W,
      EDGE_PULL_TRIGGER, EDGE_HOVER_OUT_MS, EDGE_GAP, EDGE_HANDLE_OFF, CARD_BORDER_W, EDGE_CAPSULE_H,
      // 缓存命中率圆环
      ringEl, RING_SIZE, RING_STROKE, RING_GAP,
      // 拽动吸入的纯判定（把"每帧重置 armAt"那个 bug 钉在测试里）
      edgePullVerdict,
      // 贴边相关的 CSS 规则原文（供测试断言"过渡只挂 transform"这类不变量）。
      // CSS 是 join("\n") 后的字符串，这里按行筛出贴边相关规则再返回数组。
      __EDGE_CSS_PROBE: (function(){
        // 匹配三类：
        //   1) oq-edge / oq-card.oq-edge —— 贴边收起相关规则
        //   2) oq-overlay{ —— EDGE_GAP 也决定 overlay 首屏 left，测试要断言"没有写死 px"
        //   3) oqEdge 驼峰 —— @keyframes oqEdgePulse / oqEdgeGrip / oqEdgeSnapRing
        //      （关键帧名是驼峰，不含连字符，只匹配 oq-edge 会漏掉它们）
        // oq-overlay 用宽松匹配（不是 oq-overlay\{）：还可能是
        // .oq-overlay.oq-overlay--collapsed{...} 这种带修饰类的写法。
        // oq-tm-ring：缓存命中率圆环（测试要断言字号与"旧内孔规则已删除"）。
        var out=[]; var re=/oq-edge|oqEdge|oq-overlay|oq-tm-ring/;
        var lines=String(CSS).split("\n");
        for(var i=0;i<lines.length;i++){ if(re.test(lines[i])) out.push(lines[i]); }
        return out;
      })() };
    return module.exports;
  }
});
