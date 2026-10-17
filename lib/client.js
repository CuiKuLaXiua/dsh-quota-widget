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
    function loadConfig(){
      try{ var raw=localStorage.getItem(LS_KEY); if(raw){ var c=JSON.parse(raw);
        if(c.providers && typeof c.providers==="object"){
          if(!c.providers.opencode) c.providers.opencode=defaultProviders().opencode;
          if(!c.providers.deepseek) c.providers.deepseek=defaultProviders().deepseek;
          if(!c.providers.r4coder) c.providers.r4coder=defaultProviders().r4coder;
          else if(!c.providers.r4coder.baseUrl) c.providers.r4coder.baseUrl=defaultProviders().r4coder.baseUrl;
          if(c.intervalSec==null) c.intervalSec=120;
          return c;
        }
        if(c.token!=null||c.baseUrl!=null){
          return {intervalSec:c.intervalSec||120,providers:{opencode:{enabled:true,token:c.token||"",baseUrl:c.baseUrl||"https://opencode.ai/zen/go/v1/usage"},deepseek:defaultProviders().deepseek,r4coder:defaultProviders().r4coder}};
        }
        return c;
      }}catch(e){}
      return {intervalSec:120,providers:defaultProviders()};
    }
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
    var RANGE_KEYS=["1d","7d","30d","90d","all"];
    var RANGES=[["1d","今日"],["7d","7天"],["30d","30天"],["90d","90天"],["all","全部"]];
    function loadRange(){ try{ var v=localStorage.getItem(LS_RANGE); if(v && RANGE_KEYS.indexOf(v)>=0) return v; }catch(e){} return "1d"; }
    // 范围是"看哪个时间段"的偏好：设置页与悬浮窗共用同一份，变更时广播出去（见 opencode:range-changed）
    function saveRange(v){ try{localStorage.setItem(LS_RANGE,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:range-changed"));}catch(e){} }
    var LS_TM_LAYOUT="opencode_quota_tm_layout";
    function loadTmLayout(){ try{ var v=localStorage.getItem(LS_TM_LAYOUT); if(v==="classic"||v==="compact") return v; }catch(e){} return "compact"; }
    function saveTmLayout(v){ try{localStorage.setItem(LS_TM_LAYOUT,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:tm-layout-changed"));}catch(e){} }
    var LS_TM_CHART="opencode_quota_tm_chart";
    function loadTmChart(){ try{ var v=localStorage.getItem(LS_TM_CHART); if(v==="heat"||v==="bar") return v; }catch(e){} return "bar"; }
    function saveTmChart(v){ try{localStorage.setItem(LS_TM_CHART,v);}catch(e){} }
    // 设置页的图表形态多一个"折线"。悬浮窗的迷你图只认 柱状/热力 两态（loadTmChart），
    // 继续共用同一个 key 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
    // 所以设置页单开一个 key；首次使用沿用旧的共享值，避免用户已选的热力图被静默重置。
    var LS_SETTINGS_CHART="oq_settings_chart";
    function loadSettingsChart(){
      try{
        var v=localStorage.getItem(LS_SETTINGS_CHART); if(v==="heat"||v==="bar"||v==="line") return v;
        var legacy=localStorage.getItem(LS_TM_CHART); if(legacy==="heat") return "heat";
      }catch(e){}
      return "bar";
    }
    function saveSettingsChart(v){ try{localStorage.setItem(LS_SETTINGS_CHART,v);}catch(e){} }
    // R4Coder 悬浮样式：ring=环形（对齐 Opencode） / bar=额度横条
    var LS_R4_LAYOUT="opencode_quota_r4_layout";
    function loadR4Layout(){ try{ var v=localStorage.getItem(LS_R4_LAYOUT); if(v==="ring"||v==="bar") return v; }catch(e){} return "ring"; }
    function saveR4Layout(v){ try{localStorage.setItem(LS_R4_LAYOUT,v);}catch(e){} try{window.dispatchEvent(new Event("opencode:r4-layout-changed"));}catch(e){} }

    // 悬浮窗贴边（视口/窗口边缘）留白，单位 px。拖拽硬边界、松手贴边吸附、初始位置
    // 三处共用同一个值：旧实现硬边界写 6、吸附写 12（左侧还去对齐 DSH 会话列表左边缘，
    // 而侧栏自身有 12px 内边距），结果是贴边后离窗口边缘 12px、松手瞬间还会"弹"一下。
    var EDGE_GAP=6;

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
      ".oq-overlay{position:fixed;left:6px;bottom:80px;width:260px;max-width:min(260px,calc(100vw - 24px));z-index:999;pointer-events:auto;font-family:inherit;box-sizing:border-box;overflow:visible}",
      // card 是 position:fixed（拖拽依赖），脱离文档流后宽度按 shrink-to-fit
      // 由内容决定——热力图档位切换（今日 1 列 ↔ 近7天 7 列）会直接改变卡片
      // 宽度。必须与 overlay 同步钉死 260px（旧 syncWidth 时代靠 JS 每次写
      // card.style.width 掩盖了这一点）。
      ".oq-card{width:260px;max-width:min(260px,calc(100vw - 24px));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1a1a1f);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));box-shadow:var(--dsw-shadow-lv3,0 10px 30px rgba(0,0,0,0.35));overflow:hidden;backdrop-filter:blur(10px);display:flex;flex-direction:column;box-sizing:border-box;min-height:auto;transition:height 0.22s cubic-bezier(0.22,1,0.36,1);cursor:grab}",
      ".oq-card:active{cursor:grabbing}",
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
      ".oq-tm-ring{width:28px;height:28px;border-radius:50%;position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center}",
      ".oq-tm-ring::after{content:'';position:absolute;inset:4px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#1a1a1f)}",
      ".oq-tm-ring b{position:relative;z-index:1;font-size:8px;font-weight:750;color:var(--dsw-alias-label-primary,#fff);line-height:1}",
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
    function ensureGSAP(cb){
      try{
        if(typeof window!=="undefined" && window.gsap) return cb(window.gsap);
        if(typeof window!=="undefined" && window.GSAP) return cb(window.GSAP);
        var s=document.createElement("script");
        s.src=GSAP_URL; s.async=true;
        s.onload=function(){ try{ cb(window.gsap||window.GSAP||null);}catch(e){ cb(null);} };
        s.onerror=function(){ cb(null); };
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
    // 1d 分时图的数据整理：把 legacy hourly（键 = model::YYYY-MM-DDTHH）折叠成
    // { 小时键: [各模型桶] }，且只保留 dayStr（本地日，YYYY-MM-DD）当天。
    // 不过滤会把历史各天的小时柱混进"今日分时"、纵轴按全量峰值归一（实测 59 列跨 11 天）。
    // 第三个参数是按模型筛选（来自点击模型排行）。
    function groupTodayHourBuckets(hourly, dayStr, modelFilter){
      var byHour={};
      var entries=Object.entries(hourly||{});
      for(var i=0;i<entries.length;i++){
        var key=entries[i][0], v=entries[i][1];
        if(!v) continue;
        var hour=v.hour || key.split("::")[1] || "";
        if(!hour) hour=key;
        if(String(hour).slice(0,10)!==dayStr) continue;
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
        var r=await fetch(q,tmFetchInit({headers:{accept:"application/json"}})); var j=await r.json().catch(function(){return {ok:false};}); if(!r.ok||!j.ok) return {ok:false,error:j.error||("HTTP "+r.status)};
        return {ok:true, range:(j.range!=null? j.range : range), totals:j.totals, hourly:j.hourly, stats:j.stats, daily:j.daily, daily30:(j.daily30&&j.daily30.length)?j.daily30:null, models:j.models, records:j.records, live:j.live,
          // v4 维度和健康快照：悬浮窗暂时不用，但保持透传，避免"设置页有、解析层丢"
          tools:j.tools, projects:j.projects, providers:j.providers, reliability:j.reliability, health:j.health,
          todayStr:j.todayStr, updatedAt:j.updatedAt, version:j.version, store:j.store, raw:j};
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
        var hitBarRef=react.useRef(null);
        var opBucketsRef=react.useRef(null);
        // 已应用的 payload 版本/区间：用于跳过"数据没变"的整树重渲染。
        // 不能用 payload.updatedAt —— host 每次响应都现取 Date.now()，永远在变。
        var tmAppliedVersionRef=react.useRef(null);
        var tmAppliedRangeRef=react.useRef(null);
        var prevOpPctsRef=react.useRef({});

        function pullMeter(r, withChart, done, force){
          // 上一次还在飞就跳过本次轮询（手动刷新/切区间传 force=true 放行），
          // 否则 host 首屏回填的那 20s 等待窗口里会叠出多个请求。
          if(tmPullInFlight && !force){ if(done) done(); return; }
          tmPullInFlight=true;
          var settle=function(){ tmPullInFlight=false; if(done) done(); };
          fetchTokenMeter(r, {withChart:!!withChart}).then(function(j){
            if(j&&j.ok){
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
                var tmChanged = tmAppliedVersionRef.current!==j.version || tmAppliedRangeRef.current!==j.range;
                if(isHeatHovering){ pendingTmData={data:j,_setter:tmData[1]}; }
                else if(tmChanged){
                  tmAppliedVersionRef.current=j.version; tmAppliedRangeRef.current=j.range;
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
            schedulePoll(Date.now()<activeUntil ? FAST_MS : IDLE_MS);
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
                  if(m.addedNodes && m.addedNodes.length){
                    for(var k=0;k<m.addedNodes.length;k++){
                      var n=m.addedNodes[k]; if(!n || n.nodeType!==1) continue;
                      try{ if(n.matches && (n.matches('[data-role="assistant"]') || n.matches('.assistant'))){ hit=true; break; } if(n.querySelector && n.querySelector('[data-role="assistant"], .assistant')) hit=true; }catch(e){}
                    }
                  }
                  if(hit) break;
                }
                if(hit){ armFast(); if(moTimer) clearTimeout(moTimer); moTimer=setTimeout(function(){ onTokenRefresh(); }, 5000); }
              });
              mo.observe(target, {childList:true, subtree:true});
            }
          }catch(e){}
          var onStorage=function(e){ if(e.key===LS_KEY){ cfgRef.current=loadConfig(); intervalSecState[1](cfgRef.current.intervalSec||120); reload(true, true);} if(e.key===LS_WIDGET){ widgetOn[1](loadWidgetEnabled()); } };
          window.addEventListener("storage",onStorage);
          var onCfg=function(){ cfgRef.current=loadConfig(); intervalSecState[1](cfgRef.current.intervalSec||120); reload(true, true); };
          window.addEventListener("opencode:config-changed",onCfg);
          var onWidgetToggle=function(){ widgetOn[1](loadWidgetEnabled()); };
          window.addEventListener("opencode:widget-toggled", onWidgetToggle);
          var onTmLayout=function(){ tick[1](function(v){return v+1;}); };
          window.addEventListener("opencode:tm-layout-changed", onTmLayout);
          var onR4Layout=function(){ tick[1](function(v){return v+1;}); };
          window.addEventListener("opencode:r4-layout-changed", onR4Layout);
          // 区间偏好与设置页共用（LS_RANGE）：设置页改成 30 天，悬浮窗也要跟着切，
          // 否则同一份数据在两个界面上是两个时间段。仅在值真的变了时才重载，避免自触发循环。
          var onRange=function(){ var r=loadRange(); if(r!==rangeRef.current){ rangeRef.current=r; range[1](r); reload(true,true); } };
          window.addEventListener("opencode:range-changed", onRange);
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
            var sl=rect.left, sb=window.innerHeight-rect.bottom;
            dragging.current={startX:startX,startY:startY,sl:sl,sb:sb, prevUserSelect:prevUserSelect, prevWebkitUserSelect:prevWebkitUserSelect, onSelectStart:onSelectStart};
            function onMove(me){
              if(!dragging.current) return;
              selClear();
              var dx=me.clientX-dragging.current.startX, dy=me.clientY-dragging.current.startY;
              var nl=dragging.current.sl + dx, nb=dragging.current.sb - dy;
              nl=Math.max(EDGE_GAP,Math.min(window.innerWidth-el.offsetWidth-EDGE_GAP,nl));
              nb=Math.max(EDGE_GAP,Math.min(window.innerHeight-el.offsetHeight-EDGE_GAP,nb));
              el.style.left=nl+"px"; el.style.bottom=nb+"px"; el.style.right="auto"; el.style.top="auto";
            }
            function onUp(e){
              if(e && e.button!=null && e.button!==0) return;
              if(!dragging.current) return;
              window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp);
              try{ document.removeEventListener("selectstart", dragging.current.onSelectStart); }catch(err){}
              try{ document.body.style.userSelect=dragging.current.prevUserSelect; document.body.style.webkitUserSelect=dragging.current.prevWebkitUserSelect; }catch(err){}
              selClear();
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

        react.useEffect(function(){
          var el=cardRef.current; if(!el) return;
          function applyPos(){
            var p=loadPos();
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

        function renderTmCompact(d3, stats, totalsRaw){
          var live = stats ? stats.live : null;
          var prevTotals = stats ? stats.prevTotals : null;
          var ownDaily = stats && Array.isArray(stats.daily) ? stats.daily : [];
          var chartDaily = (chartTm[0] && chartTm[0].ok && chartTm[0].stats && Array.isArray(chartTm[0].stats.daily)) ? chartTm[0].stats.daily : [];
          var daily = chartDaily.length ? chartDaily : ownDaily;
          var totalVal = Number(totalsRaw.total|| (Number(totalsRaw.prompt||0)+Number(totalsRaw.completion||0)) )||0;
          var promptVal = Number(totalsRaw.prompt||0)||0;
          var completionVal = Number(totalsRaw.completion||0)||0;
          var cacheReadVal = Number(totalsRaw.cache_read!=null?totalsRaw.cache_read:(totalsRaw.cacheRead||0))||0;
          var reqVal = Number(totalsRaw.requests||0)||0;
          var turnsVal = totalsRaw.turns!=null? Number(totalsRaw.turns): null;
          var stepsVal = totalsRaw.steps!=null? Number(totalsRaw.steps): null;
          var toolsVal = totalsRaw.tools!=null? Number(totalsRaw.tools): null;
          var hitRate = promptVal>0 ? (cacheReadVal/promptVal*100) : null;
          var hitPct = hitRate!=null? Math.round(hitRate): null;
          var ringBg = hitPct==null ? "rgba(128,128,128,.15)" : "conic-gradient(var(--bmon-c3,#c65f7f) "+hitPct+"%, rgba(128,128,128,.15) 0)";
          var hasData = totalVal>0 || reqVal>0 || (turnsVal!=null && turnsVal>0);
          function _delta(cur, prev){ if(prev==null||!isFinite(prev)||prev===0) return null; var v=((cur/prev)-1)*100; return {text:(v>=0?"▲":"▼")+" "+Math.abs(v).toFixed(0)+"%", up:v>=0}; }
          var totalDelta = prevTotals ? _delta(totalVal, prevTotals.total) : null;
          var reqDelta = prevTotals ? _delta(reqVal, prevTotals.requests) : null;
          var isLive = false;
          try{ if(d3.updatedAt && (Date.now()-Number(d3.updatedAt))<15000 && live && live.tokPerSec>0) isLive=true; }catch(e){}
          var topModel=null, topShare=null;
          if(stats && Array.isArray(stats.models) && stats.models.length){
            var sumAll=0; stats.models.forEach(function(m){ sumAll+=Number(m.total||0); });
            topModel=stats.models[0];
            topShare= sumAll>0 ? Math.round(Number(topModel.total||0)/sumAll*100) : null;
          }
          var miniDays = daily.slice(-7);
          var miniMax=0; miniDays.forEach(function(d){ var v=Number(d.total||0); if(v>miniMax) miniMax=v; });
          if(miniMax<=0) miniMax=1;
          var chartType=loadTmChart();
          return jsx_runtime.jsxs("div",{style:{padding:"0",display:"flex",flexDirection:"column",gap:6,width:"100%",minWidth:0,boxSizing:"border-box",overflow:"hidden"},children:[
            jsx_runtime.jsxs("div",{className:"oq-tm-head",style:{display:"flex",alignItems:"center",gap:8,padding:"0",height:40},children:[
              jsx_runtime.jsx("div",{className:"oq-tm-ring",style:{background:ringBg,width:28,height:28,flex:"none"},children:[jsx_runtime.jsx("b",{children:hitPct!=null?hitPct+"%":"—"})]}),
              jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",justifyContent:"center",gap:3,flex:1,minWidth:0},children:[
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",minWidth:0},children:[
                  jsx_runtime.jsx("span",{style:{fontSize:"11px",fontWeight:600,color:"var(--bmon-c3,#c65f7f)",whiteSpace:"nowrap"},children:"缓存命中率"}),
                  jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,flex:"none"},children:[
                    hasData? jsx_runtime.jsx("span",{className:"oq-tm-total",style:{fontSize:"11px",fontWeight:600,whiteSpace:"nowrap"},children:fmtTokens(totalVal)+" Token"}) : null,
                    isLive? jsx_runtime.jsxs("span",{style:{display:"inline-flex",alignItems:"center",gap:3,fontSize:"9px",fontWeight:600,color:"#10b981",whiteSpace:"nowrap"},children:[
                      jsx_runtime.jsx("span",{style:{width:6,height:6,borderRadius:"50%",background:"#10b981",display:"inline-block",animation:"oq-pulse 1.6s infinite"}}),
                      "Live",
                    ]}) : null,
                  ].filter(Boolean)}),
                ]}),
                jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:4,width:"100%",minWidth:0},children:[
                  topModel? jsx_runtime.jsxs("span",{title:(stats.models.map(function(m){return m.model+" "+fmtNum(m.total);})).join("\n"),style:{fontSize:"11px",fontWeight:600,color:"var(--dsw-alias-label-primary,#fff)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"inline-flex",alignItems:"center",gap:4,maxWidth:"100%"},children:[
                    jsx_runtime.jsx("span",{style:{width:7,height:7,borderRadius:"50%",background:"#6b87d9",flex:"none",display:"inline-block"}}),
                    topModel.model+(topShare!=null?" "+topShare+"%":""),
                  ]}) : jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"无模型数据"}),
                ]}),
              ]}),
            ]}),
            jsx_runtime.jsxs("div",{style:{display:"flex",gap:4,width:"100%"},children: RANGES.map(function(r){
              var active=range[0]===r[0];
              return jsx_runtime.jsx("button",{onClick:function(){goRange(r[0]);},style:{flex:1,padding:"3px 0",fontSize:"10px",fontWeight:active?700:500,borderRadius:999,border:"1px solid "+(active?"rgba(109,91,255,0.45)":"var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"),background:active?"rgba(109,91,255,0.14)":"transparent",color:active?"#8b7bff":"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:"pointer"},children:r[1]}, r[0]);
            })}),
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
                jsx_runtime.jsx("div",{style:{display:"grid",gridTemplateColumns:"minmax(0,0.9fr) minmax(0,1.1fr) minmax(0,1.1fr)",gap:4,marginTop:3},children:[_pill("请求 ",reqVal,"var(--bmon-c2,#b08427)"),_pill("首tok ",live&&live.firstTokenMs?(live.firstTokenMs/1000).toFixed(1)+"s":null,"var(--bmon-c3,#c65f7f)"),_pill("速度 ",live&&live.tokPerSec?Math.round(live.tokPerSec)+" T/s":null,"var(--bmon-c1,#6b87d9)")].filter(Boolean)}),
              ]}),
              
            ]}) : jsx_runtime.jsx("div",{className:"oq-tm-empty",children:"暂无用量 · 发起一次对话后自动统计"}),
          ]});
        }

        function renderTmClassic(d3, stats, totalsRaw){
          var live = stats ? stats.live : null;
          var daily = stats && Array.isArray(stats.daily) ? stats.daily : null;
          var prevTotals = stats ? stats.prevTotals : null;
          var totalVal = Number(totalsRaw.total|| (Number(totalsRaw.prompt||0)+Number(totalsRaw.completion||0)) )||0;
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
          var ringBg = hitPct==null ? "rgba(128,128,128,.15)" : "conic-gradient(var(--bmon-c3,#c65f7f) "+hitPct+"%, rgba(128,128,128,.15) 0)";
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
        return jsx_runtime.jsxs("div",{className:"oq-overlay",style: hidden?{display:"none"}:undefined, onContextMenuCapture:handleContextMenu, children: [
          jsx_runtime.jsx("div",{ref:cardRef,className:"oq-card",style:{position:"fixed",boxSizing:"border-box"},children:[
            jsx_runtime.jsxs("div",{className:"oq-body",children:[
              jsx_runtime.jsx("div",{className:"oq-carousel",onTouchStart:onTouchStart,onTouchEnd:onTouchEnd,children:
                jsx_runtime.jsx("div",{className:"oq-track",style:{transform:"translateX(-"+(curIdx*100)+"%)",display:"flex",transition:"transform 0.32s cubic-bezier(0.22,1,0.36,1)",willChange:"transform"},children: slides.map(function(s, idx){
                  return jsx_runtime.jsx("div",{className:"oq-slide",style:{flex:"0 0 100%"},children: renderSlide(s)}, s.key);
                })}),
              }),
            ]}),
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
        var tabState=react.useState("usage");
        var tmLayoutState=react.useState(loadTmLayout());
        var r4LayoutState=react.useState(loadR4Layout());
        var tmChartState=react.useState(loadSettingsChart());
        // 模型排行排序 / 工具排行排序 / 图表模型筛选 / 相对时间节拍
        var tmSortState=react.useState("total");
        var tmToolSort=react.useState("calls");
        var tmModelFilter=react.useState("");
        var nowTick=react.useState(Date.now());
        // 已应用的 version：轮询时数据没变就不 setState（沿用悬浮窗那套判据）
        var meterVerRef=react.useRef(null);
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
        function update(patch){
          var next=Object.assign({},cfg[0],patch);
          if(patch.providers){ next.providers=Object.assign({},cfg[0].providers, patch.providers); for(var k in patch.providers) next.providers[k]=Object.assign({}, cfg[0].providers[k], patch.providers[k]); }
          if(patch.providers && patch.providers.opencode) resetOpencodeBackoff();
          cfg[1](next); saveConfig(next); try{window.dispatchEvent(new Event("opencode:config-changed"));}catch(e){}
        }
        function updateProvider(key, patch){ var np={}; np[key]=patch; update({providers:np}); }

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
        // 热力图固定取 30 天；柱状图/折线按所选范围取数
        function effMeterRange(ov){
          ov=ov||{};
          var cht=ov.chart!=null?ov.chart:tmChartState[0];
          if(cht==="heat") return "30d";
          return ov.range||meterRangeState[0]||"1d";
        }
        // silent：轮询用（不闪 loading）；skipIfSame：version 没变就不 setState
        function refreshMeter(ov){
          ov=ov||{};
          var rg=effMeterRange(ov);
          if(!ov.silent){ meterLoading[1](true); }
          meterError[1]("");
          // 设置页是显式拉取（手动刷新/切区间/切图/轮询），不参与悬浮窗的在飞守卫，但同样带超时
          return fetch("/api/token-meter?range="+encodeURIComponent(rg),tmFetchInit()).then(function(r){ return r.json(); }).then(function(j){
            meterLoading[1](false);
            if(j && j.ok){
              if(ov.skipIfSame && j.version===meterVerRef.current){ meterUpdAt[1](Number(j.updatedAt)||Date.now()); return; }
              meterVerRef.current=j.version;
              meterData[1](j);
              // 用服务端时间做"更新于"：此前用客户端 new Date()，无法判断数据到底多新
              meterUpdAt[1](Number(j.updatedAt)||Date.now());
            } else meterError[1](j? j.error||"加载失败": "加载失败");
          }).catch(function(e){ meterLoading[1](false); meterError[1](String(e.message||e)); });
        }
        react.useEffect(function(){ refreshMeter(); },[]);
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
        // 图表模式：设置页用自己的 key（见 loadSettingsChart 注释），不覆盖悬浮窗的偏好
        function setMeterChart(k){ tmChartState[1](k); saveSettingsChart(k); if(k!=="heat") tmModelFilter[1](""); refreshMeter({chart:k}); }
        function setMeterRange(k){ meterRangeState[1](k); saveRange(k); refreshMeter({range:k}); }
        function clearUsage(){
          cancelConfirm();
          fetch("/api/token-meter/reset",{method:"POST",headers:{accept:"application/json"}}).then(function(r){ return r.json(); }).then(function(j){
            if(j && j.ok){
              tmModelFilter[1]("");
              meterVerRef.current=null;
              showToast("maint",true,"已清空用量账本（"+j.cleared+" 行）");
              refreshMeter({force:true});
            } else showToast("maint",false,(j&&j.error)||"清空失败");
          }).catch(function(e){ showToast("maint",false,String(e.message||e)); });
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
            "工具 Top3: "+(d0.tools||[]).slice(0,3).map(function(x){return x.tool+"×"+x.calls;}).join(" / "),
            "项目 Top3: "+(d0.projects||[]).slice(0,3).map(function(p){return p.project+" "+fmtNum(p.total);}).join(" / "),
            "重试 "+Number(rel.retries||0)+" · 压缩 "+Number(rel.compactions||0)+" · 失败轮次 "+Number(rel.errors||0),
          ].join("\n");
          copyText(txt);
          showToast("meter",true,"已复制摘要");
        }

        // P5 危险操作二次确认（同仙豚设置服务操作模式）
        function askConfirm(k){ confirmKey[1](k); if(confirmTimerRef.current)clearTimeout(confirmTimerRef.current); confirmTimerRef.current=setTimeout(function(){confirmKey[1]("");},3000); }
        function cancelConfirm(){ confirmKey[1](""); if(confirmTimerRef.current)clearTimeout(confirmTimerRef.current); }
        function resetConfig(){
          cancelConfirm();
          var d={intervalSec:120,providers:defaultProviders()};
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
          code:{fontSize:"11px",padding:"6px 8px",borderRadius:8,marginTop:6,background:"var(--dsw-alias-bg-layer-2,#1e1e26)",color:"var(--dsw-alias-label-secondary,#a0a0b0)",wordBreak:"break-all",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.06))",maxHeight:200,overflow:"auto",whiteSpace:"pre-wrap"},
        };

        function groupHead(title,action){
          return jsx_runtime.jsxs("div",{style:styles.head,children:[
            jsx_runtime.jsx("h4",{style:styles.headTitle,children:title}),
            jsx_runtime.jsx("span",{style:styles.headLine}),
            action?jsx_runtime.jsx("div",{style:styles.ctrl,children:action}):null
          ]});
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
                  jsx_runtime.jsx("input",{style:styles.input,type:showPw[0]?"text":"password",placeholder:key==="opencode"?"opencode token":(key==="r4coder"?"coder_…（与推理同 key）":"sk-..."),value:p.token,disabled:!p.enabled,onInput:function(e){updateProvider(key,{token:e.target.value.trim()});}}),
                  jsx_runtime.jsx("button",{style:styles.iconBtn,title:showPw[0]?"隐藏凭据":"明文显示凭据",onClick:function(){showPw[1](!showPw[0]);},children:showPw[0]?"隐":"显"})
                ]})
              ]}),
              jsx_runtime.jsxs("div",{children:[
                jsx_runtime.jsx("label",{style:styles.fieldLabel,children:"Base URL"}),
                jsx_runtime.jsx("input",{style:styles.input,placeholder:key==="opencode"?"https://opencode.ai/zen/go/v1/usage":(key==="r4coder"?"https://api.r4.codes/v1/cli/meta":"https://api.deepseek.com"),value:p.baseUrl,disabled:!p.enabled,onInput:function(e){updateProvider(key,{baseUrl:e.target.value.trim()});}})
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
        function pillGroup(label,opts,state,save){
          return jsx_runtime.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:6},children:[
            label?jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:label}):null,
            opts.map(function(pair){
              var k=pair[0],txt=pair[1],active=state[0]===k;
              return jsx_runtime.jsx("button",{onClick:function(){save(k);state[1](k);},style:{padding:"4px 12px",borderRadius:999,fontSize:"11px",fontWeight:active?700:500,border:"1px solid "+(active?ACCENT:"var(--dsw-alias-border-l1,rgba(255,255,255,0.1))"),background:active?"rgba(109,91,255,0.14)":"var(--dsw-alias-bg-layer-2,#1e1e26)",color:active?"var(--dsw-alias-state-business-primary,#8b7bff)":"var(--dsw-alias-label-secondary,#a0a0b0)",cursor:"pointer",fontFamily:"inherit"},children:txt}, k);
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
        // 环比徽标：host 从 v1 起就下发 prevTotals（只不过设置页一直没用），这里显式消费
        function deltaBadge(cur, prev){
          if(prev==null || cur==null) return null;
          var p=Number(prev), c=Number(cur);
          if(!(p>0)) return null;
          var d=(c-p)/p*100;
          if(!isFinite(d)) return null;
          var up=d>=0;
          var txt=(up?"↑":"↓")+Math.abs(d).toFixed(Math.abs(d)>=100?0:1)+"%";
          return jsx_runtime.jsx("span",{key:"d",style:{fontSize:"10px",fontWeight:700,color:up?"#ef8b8b":"#34d399",marginLeft:2},children:txt});
        }
        // 总览：把"输入"拆成 新输入/缓存读，并显式给出命中率。
        // 旧实现把 prompt（= 新输入 + 缓存读）标成"输入"，旁边又并列一个"缓存读"，
        // 而实测缓存读占 prompt 的 93%~96%——看上去像重复计数，实际是口径没说清。
        function overviewBlock(totals, prev){
          totals=totals||{};
          prev=prev||null;
          var cr=Number(totals.cache_read||0), out=Number(totals.completion||0);
          var fresh=Number(totals.freshInput!=null?totals.freshInput:(Number(totals.prompt||0)-cr))||0;
          var total=Number(totals.total||0);
          var denom=fresh+cr+out;
          function pct(v){ return denom>0?(v/denom*100):0; }
          var hit=totals.cacheHitRate;
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsx("div",{title:"构成比例：新输入 "+fmtNum(fresh)+" / 缓存读 "+fmtNum(cr)+" / 输出 "+fmtNum(out),
              style:{display:"flex",height:8,borderRadius:999,overflow:"hidden",background:"var(--dsw-alias-bg-layer-2,#1e1e26)",border:"1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08))"},children:[
              jsx_runtime.jsx("span",{style:{width:pct(fresh)+"%",background:C_FRESH}}),
              jsx_runtime.jsx("span",{style:{width:pct(cr)+"%",background:C_CACHE}}),
              jsx_runtime.jsx("span",{style:{width:pct(out)+"%",background:C_OUT}}),
            ]}),
            jsx_runtime.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:6},children:[
              miniChip("total","总量",fmtTokens(total),deltaBadge(total, prev&&prev.total),"所选区间的总 token = 新输入 + 缓存读 + 输出"),
              miniChip("hit","缓存命中率",hit!=null?(hit+"%"):"—",null,"cacheRead ÷ (新输入 + cacheRead)；越高越省"),
              miniChip("fresh","新输入",fmtNum(fresh),deltaBadge(fresh, prev&&prev.freshInput),"inputTokens 之和（不含缓存读）"),
              miniChip("cr","缓存读",fmtNum(cr),null,"cacheReadTokens 之和（命中缓存的部分）"),
              miniChip("out","输出",fmtNum(out),deltaBadge(out, prev&&prev.output),"outputTokens 之和"),
              miniChip("req","请求",String(totals.requests||0),deltaBadge(totals.requests, prev&&prev.requests),"assistant 回复条数"),
              miniChip("turns","轮次",String(totals.turns||0)),
              miniChip("steps","步数",String(totals.steps||0)),
              miniChip("tools","工具调用",String(totals.tools||0)),
            ]}),
          ]});
        }
        // 实时卡：全部是"本次启动至今"的累计值（rate60 除外，它是近 60s 滑动窗口）
        function liveBlock(live, rel){
          if(!live) return null;
          var llm=Number(live.llmMs||0), tool=Number(live.toolMs||0), busy=llm+tool;
          var llmShare=busy>0?Math.round(llm/busy*100):null;
          var steps=Number(live.steps||0);
          var avgStep=steps>0?Math.round(llm/steps):null;
          var sig=live.signalCount||{};
          var sigKeys=Object.keys(sig);
          var sigTxt=sigKeys.length?sigKeys.map(function(k){return k+"×"+sig[k];}).join("，"):"尚未收到任何流式产出事件";
          var winSec=Number(live.rate60WindowSec||60);
          var rate60=Number(live.rate60||0);
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:6},children:[
              miniChip("r60","近"+winSec+"秒速率",rate60.toFixed(1)+" tok/s","窗口内输出 "+fmtNum(live.rate60Tokens||0)+" tokens ÷ "+winSec+" 秒（端到端，含思考与等待）；累计均值 "+(Number(live.tokPerSec)||0).toFixed(1)+" tok/s（只算 LLM 忙碌时间）"),
              miniChip("ft","首 token",live.firstTokenCount?("≈"+Math.round(Number(live.firstTokenMs)||0)+" ms"):"无样本",null,"样本 "+(live.firstTokenCount||0)+" 次。步内产出事件：" + sigTxt),
              miniChip("llm","LLM / 工具耗时",llmShare!=null?(llmShare+"% / "+(100-llmShare)+"%"):"—",null,"LLM "+Math.round(llm/1000)+"s · 工具 "+Math.round(tool/1000)+"s"),
              miniChip("avg","平均每步",avgStep!=null?(avgStep+" ms"):"—",null,"LLM 忙碌时间 ÷ 步数"),
              miniChip("tc","工具调用",String(live.toolCalls||0)),
              miniChip("tn","轮次 / 步骤",(live.turns||0)+" / "+(live.steps||0)),
              miniChip("msg","回复条数",String(live.msgs||0)),
            ]}),
            rel?jsx_runtime.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:6},children:[
              jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{alignSelf:"center"}),children:"可靠性（本次启动）"}),
              miniChip("retry","重试",String(rel.retries||0),null,(rel.retryCodes||[]).map(function(x){return x.code+"×"+x.n;}).join("，")||"无重试原因"),
              miniChip("comp","上下文压缩",String(rel.compactions||0),null,"官方 /compact 触发的上下文压缩次数（会一次性吃掉大量 token）"),
              miniChip("err","失败轮次",String(rel.errors||0),null,"turn/end 里 reason.kind=error 的轮次"),
              miniChip("terr","工具失败",String(rel.toolErrors||0)),
            ]}):null,
          ]});
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
        // 按日柱：支持"只看某个模型"（点模型排行触发），三段堆叠 新输入/缓存读/输出
        function renderDailyBars(daily, modelFilter){
          var all=(daily||[]).filter(function(d){ return d && d.date; }).sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
          function valOf(d){
            if(!modelFilter) return Number(d.total||0);
            var ms=(d.models||[]);
            var hit=null;
            for(var i=0;i<ms.length;i++){ if(ms[i] && ms[i].model===modelFilter){ hit=ms[i]; break; } }
            return hit?Number(hit.total||0):0;
          }
          var rows=all;
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无按日数据（产生带 usage 的对话事件后自动出现）"});
          var max=1; rows.forEach(function(d){ var v=valOf(d); if(v>max) max=v; });
          if(modelFilter && max<=1){
            return jsx_runtime.jsx("div",{style:styles.hint,children:"该模型在所选区间内没有按日数据"});
          }
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{className:"oq-chart oq-chart-grid",children:[
              jsx_runtime.jsx("div",{className:"oq-chart-cols",children: rows.map(function(d){
                var total=modelFilter?valOf(d):Number(d.total||0);
                var fresh=Math.max(0,Number(d.prompt||0)-Number(d.cache_read||0));
                var cr=Number(d.cache_read||0), out=Number(d.completion||0);
                var barH=barHeightFor(total, max);
                var top=(d.models&&d.models[0])?d.models[0].model:"";
                var tip=d.date+(modelFilter?" · "+modelFilter+" "+fmtNum(total):" · 共 "+fmtNum(total)+"（新输入 "+fmtNum(fresh)+" · 缓存读 "+fmtNum(cr)+" · 输出 "+fmtNum(out)+"）")
                  +" · 请求 "+(d.requests||0)+" · 步骤 "+(d.steps||0)+" · 工具 "+(d.tools||0)
                  +(top?"\n主力模型: "+top:"")
                  +(d.models&&d.models.length>1?"\n其他模型: "+d.models.slice(1,4).map(function(m){return m.model+" "+fmtNum(m.total);}).join(" · "):"");
                return jsx_runtime.jsxs("div",{className:"oq-chart-col",title:tip,children:[
                  jsx_runtime.jsxs("div",{className:"oq-chart-bar",style:{height:barH+"px",minHeight:CHART_MIN_H+"px",background:total>0?undefined:"transparent",borderColor:total>0?undefined:"transparent"},children: total>0?[
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"100%":(cr/total*100)+"%", background:C_CACHE}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"0":(out/total*100)+"%", background:C_OUT}}),
                    jsx_runtime.jsx("div",{className:"oq-chart-seg",style:{height: modelFilter?"0":(fresh/total*100)+"%", background:C_FRESH}}),
                  ]:null}),
                  jsx_runtime.jsx("span",{className:"oq-chart-label",children:String(d.date).slice(5)}),
                ]}, d.date);
              })}),
              jsx_runtime.jsx("div",{className:"oq-chart-foot",children:peakLabel(max)}),
            ]}),
            modelFilter?jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),"仅 "+modelFilter]}),
            ]}):jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),"新输入"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_OUT}}),"输出"]}),
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_CACHE}}),"缓存读"]}),
            ]}),
          ]});
        }
        // 折线/面积图（新增）：日维度看趋势比堆叠柱直观；用纯 SVG，不引第三方图表库
        function renderLineChart(daily, modelFilter){
          var rows=(daily||[]).filter(function(d){ return d && d.date; }).sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无按日数据（产生带 usage 的对话事件后自动出现）"});
          function valOf(d){
            if(!modelFilter) return Number(d.total||0);
            var ms=d.models||[];
            for(var i=0;i<ms.length;i++){ if(ms[i] && ms[i].model===modelFilter) return Number(ms[i].total||0); }
            return 0;
          }
          var vals=rows.map(valOf);
          var max=1; vals.forEach(function(v){ if(v>max) max=v; });
          var W=100, H=100;
          var n=rows.length;
          var stepX=n>1?W/(n-1):0;
          var pts=vals.map(function(v,i){ return [n>1?i*stepX:W/2, H-Math.max(0,v)/max*(H-8)-3]; });
          var line=pts.map(function(p){ return p[0].toFixed(2)+","+p[1].toFixed(2); }).join(" ");
          var area="M"+pts[0][0].toFixed(2)+","+H+" L"+line.split(" ").join(" L")+" L"+pts[n-1][0].toFixed(2)+","+H+" Z";
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[
            jsx_runtime.jsxs("div",{style:{position:"relative",padding:"6px 2px 0"},children:[
              jsx_runtime.jsxs("svg",{viewBox:"0 0 "+W+" "+H,preserveAspectRatio:"none",style:{width:"100%",height:"110px",display:"block",overflow:"visible"},children:[
                jsx_runtime.jsx("line",{x1:0,y1:H-0.5,x2:W,y2:H-0.5,stroke:"rgba(255,255,255,0.14)",strokeWidth:0.5}),
                jsx_runtime.jsx("line",{x1:0,y1:H/2,x2:W,y2:H/2,stroke:"rgba(255,255,255,0.08)",strokeWidth:0.5,strokeDasharray:"2 3"}),
                jsx_runtime.jsx("path",{d:area,fill:"url(#oq-line-fill)",stroke:"none"}),
                jsx_runtime.jsx("path",{d:"M"+line.split(" ").join(" L"),fill:"none",stroke:C_FRESH,strokeWidth:1.4,"stroke-linejoin":"round","stroke-linecap":"round"}),
                pts.map(function(p,i){ return jsx_runtime.jsx("circle",{cx:p[0],cy:p[1],r:n>20?0.9:1.6,fill:C_FRESH},i); }),
                jsx_runtime.jsx("defs",{children:jsx_runtime.jsx("linearGradient",{id:"oq-line-fill",x1:0,y1:0,x2:0,y2:1,children:[
                  jsx_runtime.jsx("stop",{offset:"0%",stopColor:C_FRESH,stopOpacity:0.35}),
                  jsx_runtime.jsx("stop",{offset:"100%",stopColor:C_FRESH,stopOpacity:0.02}),
                ]})}),
              ]}),
            ]}),
            jsx_runtime.jsxs("div",{className:"oq-line-x",children: rows.map(function(d,i){
              var show = n<=12 || i===0 || i===n-1 || i%Math.ceil(n/8)===0;
              return jsx_runtime.jsx("span",{title:d.date+" · "+fmtNum(valOf(d)),children:show?String(d.date).slice(5):""},d.date);
            })}),
            jsx_runtime.jsxs("div",{className:"oq-legend",children:[
              jsx_runtime.jsxs("span",{className:"oq-legend-item",children:[jsx_runtime.jsx("span",{className:"oq-legend-dot",style:{background:C_FRESH}}),modelFilter?("仅 "+modelFilter):"每日总量（新输入+缓存读+输出）"]}),
              jsx_runtime.jsx("span",{className:"oq-legend-item",style:{marginLeft:"auto"},children:peakLabel(max)}),
            ]}),
          ]});
        }
        function renderMonthHeat(daily){
          var byDate={}; (daily||[]).forEach(function(d){ if(d&&d.date) byDate[d.date]=d; });
          var tStr=localDayStr();
          var parts=tStr.split("-").map(Number);
          var y=parts[0], m=parts[1]-1;
          var monthPrefix=y+"-"+String(m+1).padStart(2,"0")+"-";
          var lead=(new Date(y,m,1).getDay()+6)%7;
          var daysInMonth=new Date(y,m+1,0).getDate();
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
                if(cc===0) cls+=" oh-el";
                if(cc===6) cls+=" oh-er";
                var dnum=new Date(y,m,dayNum);
                var payload={has:!!d2,total:v2,prompt:d2?Number(d2.prompt||0):0,out:d2?Number(d2.completion||0):0,cacheRead:d2?Number(d2.cache_read||0):0,requests:d2?(d2.requests||0):0,tools:d2?(d2.tools||0):null,models:(d2&&Array.isArray(d2.models))?d2.models:null,lv:lv,isMax:(v2>0&&v2===max),head:(m+1)+"月"+dayNum+"日 · 周"+wdCn[dnum.getDay()]};
                (function(payload,cls,idx){
                  cells.push(jsx_runtime.jsx("div",{className:cls,
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
                })(payload,cls,idx);
              } else {
                cells.push(jsx_runtime.jsx("div",{className:"oq-heat-cell oh-empty"},"he"+idx));
              }
              idx++;
            }
            weeks.push(jsx_runtime.jsx("div",{className:"oq-heat-week",children:cells},"w"+r));
          }
          return jsx_runtime.jsxs("div",{className:"oq-hm-lg",style:{display:"flex",flexDirection:"column",gap:3},children:[
            jsx_runtime.jsx("div",{style:{display:"flex",gap:3},children:["一","二","三","四","五","六","日"].map(function(w,i){ return jsx_runtime.jsx("span",{style:{flex:1,fontSize:"10px",textAlign:"center",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:w},i); })}),
            jsx_runtime.jsx("div",{style:{display:"flex",flexDirection:"column",gap:3,width:"100%"},children:weeks}),
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"},children:[
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"少"}),
              heatSwatchEls(12,3),
              jsx_runtime.jsx("span",{style:{fontSize:"10px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"多"}),
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
            return renderMonthHeat(Array.isArray(st.daily)?st.daily:[]);
          }
          if(meterRangeState[0]!=="1d"){
            if(tmChartState[0]==="line") return renderLineChart(Array.isArray(st.daily)?st.daily:[], filter);
            return renderDailyBars(Array.isArray(st.daily)?st.daily:[], filter);
          }
          // 只渲染"今天"的小时桶（分组规则见 groupTodayHourBuckets）
          var byHour=groupTodayHourBuckets(data.hourly, localDayStr(), filter);
          var hours=Object.keys(byHour).sort();
          if(hours.length===0){
            var dlToday=Array.isArray(st.daily)?st.daily:[];
            if(dlToday.length) return tmChartState[0]==="line"?renderLineChart(dlToday,filter):renderDailyBars(dlToday,filter);
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
            jsx_runtime.jsxs("div",{className:"oq-chart oq-chart-grid",children:[
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
              jsx_runtime.jsx("div",{className:"oq-chart-foot",children:peakLabel(maxTotal)}),
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
        function recordsList(records){
          var rows=(records||[]).filter(Boolean);
          if(!rows.length) return jsx_runtime.jsx("div",{style:styles.hint,children:"暂无调用记录"});
          function row(r,i){
            var tip=[(r.model||"—"),
              r.provider?("渠道 "+r.provider):"",
              r.project?("项目 "+r.project):"",
              "会话 "+(r.sessionId||"—"),
              "耗时 "+fmtDur(r.durationMs),
              "点击复制该行"].filter(Boolean).join(" · ");
            return jsx_runtime.jsxs("div",{className:"oq-rec-row",title:tip,style:{cursor:"pointer"},
              onClick:function(){ copyText(recLine(r)); if(showToast) showToast("meter",true,"已复制该条调用"); },
              children:[
                jsx_runtime.jsx("span",{className:"oq-rec-time",children:fmtRecTime(r.time)}),
                jsx_runtime.jsxs("span",{className:"oq-rec-model",children:[
                  r.model||"—",
                  r.project?jsx_runtime.jsx("span",{key:"pj",style:{color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:" · "+r.project}):null,
                ]}),
                jsx_runtime.jsxs("span",{className:"oq-rec-tok",children:[
                  fmtNum(r.input)+" → "+fmtNum(r.output),
                  Number(r.cacheRead||0)>0?jsx_runtime.jsx("span",{key:"cr",style:{color:C_CACHE,marginLeft:4},children:"缓存 "+fmtNum(r.cacheRead)}):null,
                ]}),
                jsx_runtime.jsx("span",{className:"oq-rec-dur",children:fmtDur(r.durationMs)}),
              ]},"rc"+i);
          }
          if(rows.length>8){
            return jsx_runtime.jsxs("details",{style:{fontSize:"11px"},children:[
              jsx_runtime.jsx("summary",{style:{cursor:"pointer",color:"var(--dsw-alias-label-caption,#9a9aaa)",userSelect:"none"},children:"最近 8 条 · 展开全部 "+rows.length+" 条"}),
              jsx_runtime.jsx("div",{style:{marginTop:4},children:rows.map(row)})
            ]});
          }
          return jsx_runtime.jsx("div",{children:rows.map(row)});
        }
        function tabBar(){
          var tabs=[["usage","用量统计"],["conf","数据源与通用"]];
          return jsx_runtime.jsx("div",{className:"oq-tabs",children:tabs.map(function(pair){
            var k=pair[0],txt=pair[1],active=tabState[0]===k;
            return jsx_runtime.jsx("button",{type:"button",className:"oq-tab","data-active":active?"1":"0",onClick:function(){tabState[1](k);},children:txt},k);
          })});
        }
        function fmtClock(ts){
          try{ return new Date(Number(ts)||0).toTimeString().slice(0,8); }catch(e){ return "—"; }
        }
        function rangeLabelTxt(){
          var k=meterRangeState[0]||"1d";
          var hit=null;
          for(var i=0;i<RANGES.length;i++){ if(RANGES[i][0]===k) hit=RANGES[i][1]; }
          var base=hit||k;
          return (tmChartState[0]==="heat")?"热力图固定取近 30 天":("区间："+base+(k==="all"?"（最多保留 90 天）":""));
        }
        // 数据健康一行：存储形态 + 库文件大小 + 账本行数 + 跨度 + 最后回填时间。
        // host 端拿不到持久化路径时会静默降级为纯内存（每次启动重扫会话历史），
        // 这一行把它显式暴露出来；点击可复制整段诊断信息。
        function healthLine(health, nowMs){
          var h=health||null;
          if(!h) return null;
          var isMem = !h.store || h.store==="memory";
          var parts=[isMem?"内存（不持久化）":"SQLite"];
          if(h.dbBytes!=null) parts.push("库 "+(Number(h.dbBytes)/1048576).toFixed(1)+" MB");
          if(h.events!=null) parts.push("账本 "+h.events+" 行");
          if(h.days!=null) parts.push(h.days+" 天");
          if(h.lastScanAt) parts.push("最后回填 "+fmtAgo(h.lastScanAt, nowMs));
          return jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,isMem?{color:"#e8b463"}:null,{cursor:"pointer"}),
            title:(isMem?"未落盘：每次启动都会重新扫描会话历史，首屏可能延迟":"账本位置："+String(h.store).slice(3))+"\n（点击复制诊断信息）",
            onClick:function(){ copyText(diagText()); showToast("meter",true,"已复制诊断信息"); },
            children:"数据："+parts.join(" · ")});
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
        function chartHint(isHeat, range, chart, filter){
          if(isHeat) return "每日一格，颜色越深代表当天 Token 消耗越多；悬停查看分项与主力模型。";
          if(range==="1d") return "统计今日各时段（悬停柱体看按模型明细）；今日尚无分时数据时自动回落为按日柱。";
          return "统计所选范围内每日消耗"+(chart==="line"?"（折线按日总量）":"（堆叠＝新输入+缓存读+输出，悬停看分项与模型）")+(filter?"；当前仅显示模型 "+filter:"")+"。";
        }
        function usagePanel(){
          var d0=meterData[0];
          var st=d0?(d0.stats||d0):null;
          var isHeat=tmChartState[0]==="heat";
          var filter=tmModelFilter[0]||"";
          var rangeTxt=isHeat?(localDayStr().slice(0,4)+"年"+Number(localDayStr().slice(5,7))+"月 热力图")
            :(meterRangeState[0]==="1d"?"今日分时":(tmChartState[0]==="line"?"按日趋势 · 折线":"按日趋势"));
          var tools=d0&&Array.isArray(d0.tools)?d0.tools:[];
          var projects=d0&&Array.isArray(d0.projects)?d0.projects:[];
          var provs=d0&&Array.isArray(d0.providers)?d0.providers:[];
          var rel=d0?d0.reliability:null;
          var toolSort=tmToolSort[0]||"calls";
          var toolRows=tools.slice().sort(function(a,b){ return toolSort==="ms"?(Number(b.ms||0)-Number(a.ms||0)):(Number(b.calls||0)-Number(a.calls||0)); }).slice(0,8);
          var projRows=projects.slice(0,8);
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"12px"},children:[
            jsx_runtime.jsxs("div",{style:{display:"flex",alignItems:"center",flexWrap:"wrap",gap:"8px 14px"},children:[
              isHeat?null:pillGroup("范围",RANGES,meterRangeState,setMeterRange),
              pillGroup("图表",[["bar","柱状图"],["line","折线"],["heat","热力图"]],tmChartState,setMeterChart),
              jsx_runtime.jsx("span",{style:{flex:1}}),
              jsx_runtime.jsx("span",{style:styles.hint,children:meterUpdAt[0]?("更新于 "+fmtClock(meterUpdAt[0])+"（"+fmtAgo(meterUpdAt[0],nowTick[0])+"）"):"尚未加载"}),
              jsx_runtime.jsx("button",{style:styles.iconBtn,title:"导出当前视图为 CSV",onClick:exportCsv,children:"⇩"}),
              jsx_runtime.jsx("button",{style:styles.iconBtn,title:"复制当前视图摘要",onClick:copySummary,children:"⧉"}),
              jsx_runtime.jsx("button",{style:styles.iconBtn,onClick:function(){refreshMeter({force:true});},title:"刷新数据",disabled:meterLoading[0],children:"⟳"}),
            ]}),
            healthLine(d0?d0.health:null, nowTick[0]),
            toastRow("meter"),
            jsx_runtime.jsxs("div",{style:Object.assign({},styles.cardCol,{opacity:meterLoading[0]?0.65:1}),children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:"总览"}),
                jsx_runtime.jsx("span",{style:styles.hint,children:rangeLabelTxt()}),
              ]}),
              overviewBlock(st?st.totals:null, st?st.prevTotals:null),
            ]}),
            jsx_runtime.jsxs("div",{style:Object.assign({},styles.cardCol,{opacity:meterLoading[0]?0.65:1}),children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:rangeTxt}),
                filter?jsx_runtime.jsxs("span",{style:{fontSize:"11px",color:"#8b7bff",flexShrink:0},children:["仅 ",filter,jsx_runtime.jsx("button",{style:Object.assign({},styles.iconBtn,{width:18,height:18,marginLeft:4,fontSize:10}),onClick:function(){tmModelFilter[1]("");},title:"清除模型筛选",children:"✕"})]}):null,
              ]}),
              renderTokenMeterChart(),
              jsx_runtime.jsx("div",{style:styles.hint,children:chartHint(isHeat, meterRangeState[0], tmChartState[0], filter)}),
            ]}),
            (function(){
              var mr=st?modelRank(st.models, tmSortState[0], filter, function(v){ tmModelFilter[1](v); }, function(k){ tmSortState[1](k); }):null;
              return mr?jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
                jsx_runtime.jsx("div",{style:styles.titleRow,children:jsx_runtime.jsxs("span",{style:styles.cTitle,children:["模型排行",jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:8,fontWeight:400}),children:"点击一行可只看该模型"})]})}),
                mr,
              ]}):null;
            })(),
            (function(){
              if(!toolRows.length) return null;
              return jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
                jsx_runtime.jsx("div",{style:styles.titleRow,children:jsx_runtime.jsxs("span",{style:styles.cTitle,children:["工具排行",jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:8,fontWeight:400}),children:"来自 tool/call 的工具名 + 调用耗时"})]})}),
                sortPills([["calls","按次数"],["ms","按耗时"]], toolSort, function(k){ tmToolSort[1](k); }),
                rankRows(toolRows.map(function(t){
                  return { name:t.tool, weight:(toolSort==="ms"?Number(t.ms||0):Number(t.calls||0)), color:"linear-gradient(90deg,#0ea5e9,#6d5bff)",
                    val:(t.calls||0)+" 次 · "+fmtDur(t.ms||0)+(t.avgMs?"（均 "+(t.avgMs>=1000?(t.avgMs/1000).toFixed(1)+"s":t.avgMs+"ms")+"）":""),
                    tip:t.tool+" · 调用 "+(t.calls||0)+" 次 · 累计 "+(t.ms||0)+" ms"+(t.avgMs?" · 平均 "+t.avgMs+" ms":"") };
                }), function(r){ return r.weight; }),
                jsx_runtime.jsx("div",{style:styles.hint,children:"耗时是 tool/call → tool/result 的墙钟时间，含命令/读写本身的执行时间。"}),
              ]});
            })(),
            (function(){
              if(!projRows.length) return null;
              return jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
                jsx_runtime.jsx("div",{style:styles.titleRow,children:jsx_runtime.jsxs("span",{style:styles.cTitle,children:["项目排行",jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:8,fontWeight:400}),children:"按会话工作目录（cwd）归集"})]})}),
                rankRows(projRows.map(function(p){
                  return { name:p.project, weight:Number(p.total||0), color:"linear-gradient(90deg,#6d5bff,#2ec5ff)",
                    val:fmtTokens(p.total||0)+" · "+(p.requests||0)+" 次 · 工具 "+(p.tools||0),
                    tip:p.project+" · 共 "+fmtNum(p.total)+"（新输入 "+fmtNum(p.freshInput)+" · 缓存读 "+fmtNum(p.cacheRead)+" · 输出 "+fmtNum(p.output)+"）· 请求 "+(p.requests||0) };
                }), function(r){ return r.weight; }),
              ]});
            })(),
            (function(){
              if(!provs.length) return null;
              return jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
                jsx_runtime.jsx("div",{style:styles.titleRow,children:jsx_runtime.jsxs("span",{style:styles.cTitle,children:["按渠道",jsx_runtime.jsx("span",{style:Object.assign({},styles.hint,{marginLeft:8,fontWeight:400}),children:"同名模型在不同渠道下是两笔账"})]})}),
                rankRows(provs.slice(0,8).map(function(p){
                  return { name:p.provider, weight:Number(p.total||0), color:"linear-gradient(90deg,#f59e0b,#c65f7f)",
                    val:fmtTokens(p.total||0)+" · "+(p.requests||0)+" 次",
                    tip:p.provider+" · 共 "+fmtNum(p.total)+"（新输入 "+fmtNum(p.freshInput)+" · 缓存读 "+fmtNum(p.cacheRead)+" · 输出 "+fmtNum(p.output)+"）" };
                }), function(r){ return r.weight; }),
              ]});
            })(),
            (function(){ var lv=st?liveBlock(st.live, rel):null; return lv?jsx_runtime.jsxs("div",{style:styles.cardCol,children:[jsx_runtime.jsx("div",{style:styles.cTitle,children:"实时"}),lv]}):null; })(),
            jsx_runtime.jsxs("div",{style:styles.cardCol,children:[
              jsx_runtime.jsxs("div",{style:styles.titleRow,children:[
                jsx_runtime.jsx("div",{style:styles.cTitle,children:"最近调用"}),
                jsx_runtime.jsx("span",{style:styles.hint,children:"新输入 → 输出 · 点击复制"}),
              ]}),
              recordsList(st?st.records:null),
            ]}),
          ]});
        }
        function confPanel(){
          var c=cfg[0];
          var widgetOn=loadWidgetEnabled();
          return jsx_runtime.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"20px"},children:[
            jsx_runtime.jsxs("div",{style:styles.group,children:[
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
            ]}),
            jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("通用"),
              card({
                title:"小窗口",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"悬浮于侧边的额度轮播挂件 · 单源展示，右键或滑动切换 Opencode｜DeepSeek｜R4Coder｜TokenMeter"}),
                toastKey:"widget",
                control:switchEl(widgetOn,function(v){ saveWidgetEnabled(v); cfg[1](Object.assign({},cfg[0])); })
              }),
              card({
                title:"悬浮窗模板",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口 TokenMeter 轮播页的排版模板"}),
                control:pillGroup("",[["classic","经典版"],["compact","紧凑版"]],tmLayoutState,saveTmLayout)
              }),
              (c.providers.r4coder && c.providers.r4coder.enabled) ? card({
                title:"R4Coder 悬浮样式",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"小窗口 R4Coder 轮播页的排版（仅数据源启用时显示本项）"}),
                control:pillGroup("",[["ring","环形进度"],["bar","额度横条"]],r4LayoutState,saveR4Layout)
              }) : null,
              card({
                title:"自动刷新",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"额度数据的自动拉取周期（30–3600 秒）"}),
                control:[
                  jsx_runtime.jsx("input",{style:styles.inputSmall,type:"number",min:30,max:3600,value:c.intervalSec,onInput:function(e){var v=parseInt(e.target.value,10); if(!isNaN(v)) update({intervalSec:Math.max(30,Math.min(3600,v))});}}),
                  jsx_runtime.jsx("span",{style:{fontSize:"11px",color:"var(--dsw-alias-label-caption,#9a9aaa)"},children:"秒"}),
                ]
              }),
            ]}),
            jsx_runtime.jsxs("div",{style:styles.group,children:[
              groupHead("维护"),
              card({
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"重置为默认配置；清除悬浮窗位置记忆（回到默认停靠点）"}),
                toastKey:"maint",
                desc:jsx_runtime.jsx("div",{style:styles.cDesc,children:"清空用量账本只删本插件自己的统计（SQLite 里的 events 与派生表），并记录清空时刻——此后回填不会再把之前的历史拉回来；会话文件本身不受影响。"}),
                control:dangerCtl("cfg","重置配置",resetConfig).concat(dangerCtl("win","重置悬浮窗位置",resetWindowPos)).concat(dangerCtl("usage","清空用量账本",clearUsage))
              }),
            ]}),
          ]});
        }
        return jsx_runtime.jsxs("div",{"data-opencode-settings":"1",style:styles.section,children:[
          tabBar(),
          jsx_runtime.jsx("div",{style:{display:tabState[0]==="usage"?"flex":"none",flexDirection:"column",gap:"12px"},children:usagePanel()}),
          jsx_runtime.jsx("div",{style:{display:tabState[0]==="conf"?"flex":"none",flexDirection:"column",gap:"20px"},children:confPanel()}),
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
      try{
        document.addEventListener("scroll",function(e){
          try{
            var t=e.target;
            if(t && t.closest && t.closest(".oq-overlay, .oq-heat-tip")) heatTipHide();
            else if(t===document || t===window || t===document.documentElement || t===document.body){
              // 顶层滚动也关，避免 fixed tip 悬空
              heatTipHide();
            }
          }catch(_){ /* 聊天区滚动不关，避免流式抖动 */ }
        },true);
      }catch(e){}

      slots.inject("shell.overlay",function(){
        return slots.register({name:"shell.overlay",id:"opencode-quota-widget",order:12,label:"额度轮播(TokenMeter)"},function(){return jsx_runtime.jsx(QuotaWidget,{});});
      });
      slots.inject("settings.section",function(){
        return slots.register({name:"settings.section",id:"opencode-quota-settings",order:920,label:SETTINGS_SECTION_LABEL},function(){return jsx_runtime.jsx(SettingsPanel,{});});
      });
      // 宿主设置弹窗的左导航入口图标（宿主按 id 兜底成齿轮，这里自绘，见 NAV_ROW_MARK 注释）
      installSettingsNavIcon();
    }
    exports.apply=apply;
    // 测试出口：只暴露纯函数（供 test/client.test.mjs 用 node:test 断言），不参与运行时行为
    exports.__testing={ HEAT_LV, heatLvOf, groupTodayHourBuckets, fmtTokens, fmtNum, fmtDur, fmtAgo, barHeightFor, RANGE_KEYS };
    return module.exports;
  }
});
