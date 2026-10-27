# Changelog

## [Unreleased]

### 悬浮窗贴边吸附收起（2026-10-27）

#### Added

- **贴边收起（把手条，方案 A）**：开关在「设置 → 外观 → 贴边收起」，**默认关**（老用户升级观感不变）。
- **触发时机是"再拽一下"，不是松手即收**（用户明确要求）：现有的"松手自动吸附到左右边缘"
  行为**完全不变**；在已贴边的状态下，继续朝同一侧拖拽超过 `EDGE_PULL_TRIGGER`(18px)，
  卡片才收成把手条——手感像"按钮按下去咔哒一下"，且避免正常拖动路过边缘时误触发。
- **展开方式**：鼠标悬停自动展开（移开 `EDGE_HOVER_OUT_MS`(420ms) 后收回）；点击把手可
  **锁定展开**（再点收回）——触屏没有 hover，点击是必需路径。
- **把手条**：宽 `EDGE_HANDLE_W`(14px)，竖向紫色渐变 + 中间三道短线暗示"可拉出"。
  它是**真实 DOM `<button>`**（不是 `::after`）：需要独立承接 click / mouseenter，
  伪元素的事件会冒泡到卡片本身，无法与"拖拽卡片"区分。
- 状态分两层存：`localStorage["oq_edge_collapse"]`（开关）、`["oq_edge_state"]`（`{edge:"left"|"right"}` 或空）。

#### Fixed（首次实测反馈"拽一下没反应"的三个真缺陷）

1. **`armAt` 每帧被重置 → `pushed` 恒为 0**：旧实现在每个 `mousemove` 里都写
   `armAt = me.clientX`，而 `pushed` 又是 `armAt - me.clientX`，于是永远是 0，
   阈值 18px 根本达不到。改为**只在"刚进入贴边"那一帧记录锚点**（用侧别变化判定
   `null→left` / `left→right`），并把判定抽成纯函数 `edgePullVerdict()`，
   附变异测试（把它改回 `m.x` 会让 2 条用例立刻变红，已验证）。
2. **`oq-edge-open` 与收起态无条件并存 → `transform` 被永久压成 `none`**：
   `.oq-card.oq-edge-left{transform:translateX(...)}` 与
   `.oq-card.oq-edge-open{transform:none}` 特异性相同、后者写在前面，于是即使 JS
   算出了收起态，CSS 也把它拉回原位——**这就是"开关打开了、也拽了、但卡片纹丝不动"的
   直接原因**。现在两个类互斥，由纯函数 `edgeCardClass()` 统一计算：
   只有"悬停/锁定展开"才挂 `oq-edge-open`。
3. **吸入后 `mouseenter` 立刻把卡片弹回展开态**：鼠标物理位置仍停留在卡片即将推出的区域上，
   `mouseenter` 会马上把 `edgeOpen` 置 true，视觉上等于没吸进去。新增
   `edgeCollapseAtRef`：吸入后 500ms 内忽略悬停展开。
4. 附带修：吸入后只移除 `mousemove`、**保留 `mouseup`**（旧实现两个都移除，
   导致 `onUp` 不跑、`dragging.current` 永不清理，`clampPos` 会永久跳过）。

#### 动效重做（用户反馈"吸附和弹出动画设计很差"）

**根因：两套过渡同时在跑。** `collapseToEdge()` 给 `left/bottom` 加了 0.18s 过渡，CSS 又给
`transform` 加了 0.24s 过渡，两者各自计时、缓动不同，视觉上就是"先抖一下再滑出去"。

改法——**只让 transform 动**：

| 项 | 旧 | 新 |
|---|---|---|
| `left/bottom` | 0.18s 过渡 | **瞬时写死，无过渡** |
| 收起 `transform` | 0.24s `cubic-bezier(0.22,1,0.36,1)` | 0.42s `cubic-bezier(0.32,0.72,0,1)`（收束感） |
| 展开 `transform` | 同上（与收起无差别） | 0.40s `cubic-bezier(0.16,1,0.3,1)`（前快后缓，像抽屉拉出） |
| 内容 `.oq-body` | 无处理（整卡被推走） | 收起 0.12s 淡出 → "内容先退场、空壳再滑出"；展开 0.21s 淡入**无延迟** |
| `will-change` | 无 | `transform`（避免每帧重绘 backdrop-filter 模糊层） |
| 把手视觉 | 14px 铺满全高的渐变条（笨重） | 露出宽度 **10px**（≈ 8px 胶囊宽 + 1px 呼吸），视觉只有中间一枚 **8×44 胶囊**；悬停只变高到 52px + 提亮（不再变宽，否则会贴到视口边像卡片又滑出来）；收起态 3.6s 呼吸微光 |
| 把手可触区 | 与露出宽度相同 14px | **22px**（向外偏移 12px，热区一半落在视口内、一半在卡片内部）→ "看着细、点着不费劲" |
| `transition` 声明 | 只写 transform，但基类的 `height 0.22s` 仍生效 | 收起态整条覆盖（不含 height，避免位移时高度同时在抖）；展开态恢复 height |

另外：把手在展开态用 0.10s 淡出（比位移快，先让开），避免压在新滑出的内容上。

**把手宽度收窄（用户第二次反馈"太宽"）**：露出宽度 14px → **10px**（≈ 8px 胶囊 + 1px 呼吸）。
缩窄的同时把可触区**反向放大**到 22px 并向卡片内侧偏移 12px——热区有一半落在已推出视口的
卡片内部，`pointer-events` 仍然生效，所以"看着细、点着不费劲"。这要求收起态
`overflow:visible`（基类是 `hidden`，会把外扩的热区裁掉一半）。
悬停反馈从"变宽到 9px"改为"只变高"，因为 10px 露出区里胶囊一变宽就会贴到视口边缘，
看起来像"卡片又滑出来了一点"。

#### Fixed：收起态出现"两层"（用户截图指出）

**现象**：贴边收起后能看到**深色竖条 + 紫色胶囊**两条竖线叠在一起。

**根因**：位移写成 `translateX(calc(-100% + 10px))`——故意留 10px 在视口内当把手。
但那 10px 里除了紫色胶囊，还有 `.oq-card` 自己的**深色背景 + 1px 描边 + 14px 圆角**，
于是看起来就是两层。

**改法**：

| 项 | 旧 | 新 |
|---|---|---|
| 卡片位移 | `calc(-100% + 10px)`（留一条） | **`-100%`（完整移出视口）** |
| 卡片外壳 | 保留背景/描边/阴影 | `background/border-color:transparent` + `box-shadow:none`（防合成层 1px 抗锯齿漏边） |
| 把手位置 | 卡片内边界（`right:-12px`） | **卡片外边界**（`right:-22px`），即视口内唯一可见元素 |
| 常量 | `EDGE_HANDLE_W=10`（兼作露出宽度） | 拆成 `EDGE_CARD_OUT_PCT=100` / `EDGE_CAPSULE_W=8` / `EDGE_HANDLE_HIT_W=22` |

紫色胶囊的设计保留不变（8×44、悬停 52px、呼吸微光），只是现在它是**唯一**可见的东西。

新增回归测试 `贴边收起：卡片外壳必须整体移出视口，视口内只剩紫色把手`：
断言位移是完整 100%（含 `!/\dpx/` 拒绝 px 补偿）、把手挂在卡片外侧、背景与阴影已关闭。
**变异验证**：把位移改回 `calc(-100% + 10px)` → 该用例立即变红（已实测）。

#### Fixed：收起后仍见残留侧边 / 展开时变毛玻璃（用户第二次实测反馈）

两个独立缺陷，都源于我上一版的两处粗心：

**① 残留侧边（6px）**：`collapseToEdge()` 把卡片 `left` 设为 `EDGE_GAP`(6px)，
而位移只写 `translateX(-100%)`。于是收起后卡片**右边界停在 x=6px**，那 6px 就是看到的侧边。
修复：位移改为 `translateX(calc(-100% - EDGE_GAP))`，右边界精确落在 x=0。
把手偏移同步改为 `-(EDGE_HANDLE_HIT_W - EDGE_GAP)`，否则把手会整体跑到视口外 6px。

**② 展开时变毛玻璃、要再点一下才恢复**：`background:transparent!important` 等"隐形"声明
写在 `.oq-card.oq-edge` 上，而这个类**收起态和展开态都会命中**。展开时卡片没有背景色，
只剩基类的 `backdrop-filter:blur(10px)` 在跑 —— 看起来就是毛玻璃；点击后类名短暂变化
（或重渲染）才恢复。
修复：全部隐形声明收进 `.oq-card.oq-edge:not(.oq-edge-open)`，共用规则只保留
`will-change` + `transition`。另外补两条收起态专用规则：
- `backdrop-filter:none` —— 卡片移出后仍会在视口边缘留一条模糊带
- `::before/::after {opacity:0;background:none}` —— 材质伪元素（液态玻璃高光/描边、
  亚克力与纸面的噪点）画在卡片四边，会残留在视口里

**测试**：`贴边收起：卡片外壳必须整体移出视口` 扩成 4 组断言，其中最关键的一条是

```js
// 共用规则里不能有任何"隐形"声明（会让展开态也隐形 → 毛玻璃）
assert.ok(!commonRule[1].includes("background:transparent"))
```

**两次变异验证（均已实测）**：
1. 把 `background:transparent` 加回共用规则 → 用例变红
2. 位移改回 `translateX(-100%)`（去掉 EDGE_GAP）→ 用例变红

#### Changed：贴边间距 6px → 3px（用户要求缩小 50%）

`EDGE_GAP` 是**单一来源**，一个数同时决定四处行为：

| 用途 | 表达式 |
|---|---|
| 拖拽硬边界 | `Math.max(EDGE_GAP, ...)` |
| 松手吸附目标 | `left = EDGE_GAP` / `viewport - w - EDGE_GAP` |
| 收起位移补偿 | `translateX(calc(-100% - EDGE_GAP))` |
| 把手外侧偏移 | `-(EDGE_HANDLE_HIT_W - EDGE_GAP)` |

顺带把 `.oq-overlay` 的 `left:6px` 改成 `left: ${EDGE_GAP}px` 推导——那是首屏默认位置，
写死会让"首次打开"和"吸附后"落点不一致。

新增测试 `贴边间距：EDGE_GAP 单一来源，CSS 不得写死 px`，同时断言三处公式
（位移、把手偏移、overlay left）都与当前 `EDGE_GAP` 一致。改动后实测：

```
EDGE_GAP = 3
left rule: transform:translateX(calc(-100% - 3px))
handle:    right:-19px              (22 - 3)
overlay:   left:3px
```

#### Changed：紫色胶囊与视口边缘的间距也对齐到 EDGE_GAP(3px)

用户要求"胶囊间距也设为 3px"。**旧公式少算了胶囊自身宽度的一半**：

```
旧：偏移 = HIT_W - EDGE_GAP = 22 - 3 = 19px  →  胶囊左边缘落在 4px
新：偏移 = EDGE_GAP + (CAPSULE_W + HIT_W)/2 = 3 + 15 = 18px  →  胶囊左边缘正好 3px
```

推导（左停靠，卡片收起后右边界在视口 x=0）：
`把手左边界 = 偏移 - HIT_W` → `把手中心 = 偏移 - HIT_W/2` → 胶囊与把手同心
→ `胶囊左边缘 = 偏移 - HIT_W/2 - CAPSULE_W/2`，令其等于 `EDGE_GAP` 即得新公式。

代价：热区有 `(HIT_W - CAPSULE_W)/2 - EDGE_GAP = 4px` 落在视口外，实际可点区 18px，
仍远大于触控最小命中区。

常量 `EDGE_HANDLE_OFF` 已导出，测试里做**几何自洽断言**而不是硬编码数字：

```js
const capLeft = off - (HIT_W - CAPSULE_W)/2 - CAPSULE_W;
assert.equal(capLeft, EDGE_GAP);   // 3
```

**变异验证**：把公式改回 `HIT_W - EDGE_GAP` → 2 条用例变红（已实测）。

#### Changed：紫色胶囊提亮 + 动效（用户反馈"颜色淡了一点…加点动效"）

**底色提亮**（旧值两端只有 10% 不透明度，胶囊看起来像"半截"）：

| 项 | 旧 | 新 |
|---|---|---|
| 主渐变两端 | `rgba(139,123,255,0.10)` | `rgba(146,132,255,0.72)` |
| 主渐变中部 | `rgba(139,123,255,0.42)` | `rgba(126,110,240,0.92)` |
| 描边 | `rgba(139,123,255,0.18)` | `rgba(160,146,255,0.55)` |
| 外发光 | `0 2px 10px -2px …0.45` | `0 2px 12px -2px …0.55` |

**方案 4（呼吸 + 短线张开）+ 方案 5（吸附脉动一次性）**：

| 动画 | 关键帧 | 时长 | 作用 |
|---|---|---|---|
| 呼吸光晕 | `oqEdgePulse` | 2.4s | 描边与外发光的**强度+半径**一起呼吸 |
| 短线张开 | `oqEdgeGrip` | 2.4s | 三道短线 height 14↔20、opacity 0.55↔1 |
| 吸附脉动 | `oqEdgeSnapRing` | 0.65s ×1 | 吸入瞬间向外扩散一圈光晕（spread 0→14px） |

关键决策：
- **呼吸必须改 `box-shadow` 而不是 `opacity`**。旧实现 `opacity 0.86↔1` 幅度太小，
  视觉上等于静止（用户反馈"加一点动效"的直接原因）。改 box-shadow 还有一个好处：
  不会触发渐变重绘的中间帧，GPU 开销更低。
- **一次性脉动用 `box-shadow` 扩散，不用 `transform: scale`**。缩放会让胶囊离开刚调好的
  3px 间距基准；spread 扩散不影响布局。
- 两条循环动画**只在 `:not(.oq-edge-open)` 下跑**；悬停时 `animation-play-state: paused`
  （指针已在交互，继续呼吸反而干扰）。
- `oq-edge-snap` 类挂在 `.oq-edge-handle` 上（不是卡片），只让胶囊脉动。
- JS 侧用 state 驱动（不能直接改 DOM className，React 重渲染会覆盖），
  且"先清再置"确保连续两次吸入也能重播（同名 animation 不会自动重跑）。

**测试**：新增 3 条（底色不透明度下限、呼吸必须动 box-shadow 且短线必须改 height、
一次性脉动用 spread 不用 transform）。**变异验证**：把 `oqEdgePulse` 改回只动 opacity
→ 用例立即变红（已实测）。

#### Fixed：胶囊贴死在窗口边缘（无 3px 间距）/ 紫色太深

**① 间距丢失的根因：漏算了卡片的 1px 透明 border。**

收起态只把 `border-color` 设成 transparent，**宽度仍占 1px**。而把手是
`position:absolute`，其包含块是卡片的 **padding box**（不含 border）；位移却是按
**border box** 宽度算的。两者差 1px：

```
padding box 右边界 = -1px（不是 0）
→ 胶囊左边缘 = -1 + 19 - 11 - 4 = 2px   （期望 3px）
```

修复：偏移公式补上 `CARD_BORDER_W`：

```
X = EDGE_GAP + CARD_BORDER_W + (CAPSULE_W + HIT_W)/2 = 3 + 1 + 15 = 19px
→ 胶囊左边缘 = -1 + 19 - 11 - 4 = 3px ✅
```

**② 紫色太深**：0.72/0.92 那版被指出太重。取中间值：

| 项 | 第一版 | 第二版（太深） | 现在 |
|---|---|---|---|
| 两端 | 0.10 | 0.72 | **0.46** |
| 中部 | 0.42 | 0.92 | **0.74** |
| 描边 | 0.18 | 0.55 | **0.42** |

呼吸与悬停配色同步重新标定（常态基线变了，沿用旧值会显得忽深忽浅）。

测试改为**区间断言**而不是精确值，避免以后微调颜色就误报：
两端 `0.35~0.6`、中部 `0.65~0.85`、描边 `0.3~0.5`。

**变异验证**：从偏移公式里去掉 `CARD_BORDER_W` → 2 条几何用例变红（已实测）。

#### Fixed：hover 触发范围是整个面板宽度，不是胶囊（用户反馈）

**根因**：`onMouseEnter` 绑在 `.oq-card` 上，而卡片宽 260px。收起时卡片虽然
`translateX(±100%)` 移出视口，**但它仍然占据视口内 260px 的命中区域**——只是不可见。
于是鼠标扫过整个面板宽度都会展开。

**改法**：

| 项 | 旧 | 新 |
|---|---|---|
| 收起态 hover 监听 | `.oq-card`（260px） | **`.oq-edge-handle`（22px 热区）** |
| 收起态卡片 `pointer-events` | `auto` | **`none`**（否则仍挡住宿主界面，点不到下面的聊天内容） |
| 收起态把手 `pointer-events` | 继承 | **显式 `auto`**（父级 `none` 需要子级覆盖回来） |
| 展开态 hover 监听 | `.oq-card` | 保持 `.oq-card`（已展开，移出卡片才收回） |

JS 侧把 `edgeHoverIn` / `edgeHoverOut` 抽成共用函数，按 `collapsed` 决定挂在哪：
收起态卡身 `cardEvents = {}`，把手挂 in/out；展开态反过来。

新增测试 `hover：收起态命中区只到把手，不是整个面板宽度`，断言三件事：
收起态 `pointer-events:none`、把手 `pointer-events:auto`、展开态不能有 `none`
（否则展开后卡片点不动）。**变异验证**：去掉 `pointer-events:none` → 用例变红（已实测）。

#### Fixed：hover 范围收紧（第二轮）——上一版漏了 overlay 这个 260px 命中盒

上一版只给 `.oq-card` 加了 `pointer-events:none`，用户重启实测仍然"离胶囊很远也会弹出"。

**根因**：真正盖住面板原区域的是卡片的**父级** `.oq-overlay`：

```css
.oq-overlay{position:fixed;left:3px;bottom:80px;width:260px;pointer-events:auto}
```

overlay 不随卡片 `translateX` 位移，收起后它仍完整盖在原位置。鼠标事件打在 overlay 上，
卡片设成 `none` 也没用。

**另一处遗漏**：把手热区是 `top:0;bottom:0`，**纵向撑满整张卡片**（~200px），
而胶囊只有 44px。所以胶囊上下很远也会触发。

**改法**：

| 项 | 旧 | 新 |
|---|---|---|
| overlay 命中 | 始终 `auto` | 收起态加 `.oq-overlay--collapsed{pointer-events:none}` |
| 把手热区纵向 | `top:0;bottom:0`（≈200px） | `top:50% + height:EDGE_CAPSULE_H(44px)`，正好包住胶囊 |
| 悬停态胶囊高度 | 44 → 52px | **保持 44px**（热区=胶囊高，变高会导致指针落到热区外→抖动） |

`pointer-events:none` 的继承特性在这里正好可用：父级 overlay 设 none，把手用
`pointer-events:auto` 覆盖回来，于是**只有把手的 22×44 区域可命中**。

新增 2 条测试（overlay 必须按收起态收紧、把手纵向热区不得撑满卡片）。
**变异验证**：把 `.oq-overlay--collapsed` 的 `pointer-events:none` 去掉 → 用例变红（已实测）。

#### 关键实现约束（改动前必读）

- **绝不用 `display:none` / `width:0` 实现收起**。卡片高度由 JS 量 `.oq-carousel` 的
  `active.scrollHeight` 写入，元素不可见时会量到 0，恢复后没有 deps 变化触发重测 →
  塌成一条线。这个坑在"面板打开时隐藏悬浮窗"的两版实现里已经踩过（见 `QuotaWidget` 的
  `hidden` 注释）。收起一律用 `transform: translateX(calc(±(100% - 14px)))`。
- **位移量用百分比**（`calc(-100% + 14px)`）而不是硬编码 260px：卡片宽度是 CSS 常量，
  但百分比让 JS 与 CSS 不必各自维护同一个数字。
- **拖拽 effect 的依赖是 `[hidden]`**，闭包里读 React state 会读到首帧旧值。所有
  "拖拽/悬停回调里要读的 edge 状态"必须走 `edgeOnRef` / `edgeStateRef`（每次渲染同步），
  否则开关切了但拖拽逻辑仍按旧值判断。
- **关闭开关必须顺手清掉 `LS_EDGE_STATE`**：否则窗口停在把手条上、功能却已关闭，
  用户无从展开（预期是"恢复到普通悬浮窗"）。`saveEdgeCollapse(false)` 里已做，
  并额外广播 `opencode:edge-reveal` 让已挂载的实例立刻恢复。
- **收起前先把卡片摆到对应边缘**（`collapseToEdge` 写 `left/bottom` 并 `savePos`）：
  否则用户可能停在"离边缘 30px"处就被吸入，展开时卡片悬在半空。
- **`applyPos` 必须按停靠侧纠正位置**：右停靠时把 `left` 算成右边缘，不能沿用
  `loadPos()` 里用户上次的 `left`，否则展开会从错误一侧滑出。
- 拖拽中吸入后**立刻移除 mousemove/mouseup 监听并作废本轮拖拽**（`dragging.current.edgeDone`），
  否则后续 `onMove` 会继续按 free 位置写 `left`，把刚收起的卡片又拽出来。

#### Tests

- client 25 → **35**（默认关闭与读回、关闭时清状态、非法 edgeState 回落展开、
  把手宽度/阈值/收回延迟在可用区间；三个 bug 的回归：`edgeCardClass` 互斥不变量、
  `edgePullVerdict` 锚点不重置 / 未贴边不吸入 / 离开边缘重计时 / 右边缘方向相反；
  动效不变量：过渡只挂 transform、left/bottom 无过渡、收起与展开缓动不同、will-change、
  内容淡出 <0.2s、展开态内容淡入不延迟）、
  settings-render 27 → **28**（外观 Tab 有开关且默认关）
- 当前全绿：**159/159**
- **变异验证（两次，都实测确认）**：
  1. `armAt = prev.armAt` 改回 `armAt = m.x` → `edgePullVerdict` 2 条用例变红
  2. 给 `.oq-edge-left` 加回 `transition:left 0.3s` → 动效不变量用例变红
  两条都证明测试真的能捕获对应缺陷，不是摆设。

### 自定义区间 + 逐日明细表 + 单日下钻（2026-10-27，用户反馈驱动）

> 起因：用户在实机上反馈「缺少可选日期范围内的使用详情统计」，并且第一版实现上线后
> 反馈「我没看到呢」——两次都是同一类问题的两面：**功能做了，但入口在某些状态下不可见**。

#### Added

- **自定义区间**：范围 pills 新增「自定义」，可选任意起止日期（本地日、闭区间，最多近 90 天）。
  偏好存 `localStorage["oq_custom_range"]`，与固定档位（`opencode_quota_range`）分开存放。
  - `GET /api/token-meter?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - 非法格式回 **400**（`bad-range`），不静默回落——静默回落会让用户以为"选了但没生效"
- **服务端裁剪是唯一真相来源**（`resolveCustomWindow`）：客户端不做日期运算，只负责展示。
  - 起止写反 → 自动交换，`reason: "swapped"`
  - 止 > 今天 → 收到今天，`reason` 含 `to-clamped`
  - 起 < `max(今天-90d, reset_at 所在日)` → 抬到最早可查日，`reason` 含 `from-clamped`
  - 裁剪结果随 payload 的 `window: {from,to,days,clipped,reason}` 回传，并**回写日期控件**，
    用户看到的就是真正查的那一段
- **逐日明细表**（图表卡下方，**默认展开**）：日期 / 总量 / 回复 / 新输入 / 缓存读 / 输出 /
  项目 / 耗时，表头点击排序（日期升序，其它列首次点降序），底部合计行。
  - 合计行取 `totals` 而非 `sum(rows)`：窗口内可能有"只有工具调用、没有回复"的天，
    两者会不一致（与 `daily` 只统计 `assistant/message` 的口径差异同源）
  - 被裁剪时在表格上方显示橙色「已裁剪为实际可查范围 X ~ Y」
- **`daily[]` 新增两列**（明细表的扩展列）：
  - `topProject` / `topProjectTotal`：当日 token 最多的项目
  - `avgMs`：当日 `step/start → assistant/message` 的墙钟均值，**无样本给 `null` 而不是 0**
    （给 0 会让界面显示"0ms"，与"没有测量"无法区分）。新增 `usage.perDayDur`，
    `hydrateFromDb` 用 `SUM(ms)/COUNT(*) ... GROUP BY day` 按天重建
- **单日下钻 `GET /api/token-meter/day?date=YYYY-MM-DD`**（只读，不需要 nonce）：
  返回 24 小时分布、当日汇总 + 命中率 + 平均响应、模型/项目/渠道/工具构成、会话 Top10、
  当日调用（最多 100 条，查 `events` 走已有的 `idx_events_day`）、单日可靠性切片。
  - 明细表点某行 = 热力图点某天 = 同一套 `renderDayDetail`（此前热力图的"当日摘要"
    是另写的，只有总量 + 模型 Top3，两处口径不一致）
  - 空日返回全 0 **而不是报错**（界面要能显示"当天无数据"）
  - 非法/未来/超出保留窗口分别回 `bad-date` / `future-date` / `out-of-retention`

#### Fixed

- **「自定义」入口在热力图/时段模式下完全消失**（用户实测反馈"我没看到"）：
  旧实现是
  ```
  (isHeat||isHour) ? <span>范围：近 90 天（图表固定）</span> : pillGroup(...)
  ```
  为了让旧的"图表固定 90 天"提示保留，把整组 pills 连带新加的「自定义」一起藏掉了。
  现在任何图表形态下都渲染 pills，热力/时段时改为**只读态**（`pillGroup` 支持 `save=null`：
  照常显示与高亮，但 `disabled`、点击无效）并补一句说明。
  **教训：往既有条件分支里加新入口前，先确认那个分支不会被整体替换掉。**
- **custom 被图表形态吞掉**：`effMeterRange()` 里 `if(cht==="heat") return "90d"` 排在最前，
  无条件把 custom 压成 90d，导致"控件选了 10-01~10-07、明细表却是 90 天"。
  现在 **custom 优先级最高**、不受图表形态影响；热力/时段图在 custom 下只显示区间内的天
  （区间外的格子为空），语义上"选了 7 天就不该偷塞 90 天数据进图里"。
- **标题与说明文案自相矛盾**：`rangeLabelTxt()` 的 custom 分支原来排在 heat/hour 之后，
  永远走不到；`chartHint()` 同样。两处都把 custom 判断提到最前，并给 heat/hour 单独文案。
- **逐日明细表默认收起导致"以为没做"**：`detailOpen` 初值 `false` → **`true`**。
  收起态只有一行灰字，用户实测完全没注意到；表格本身很轻（一天一行），展开不影响首屏观感。

#### 设计约束（后续改动请遵守）

- **悬浮窗不参与自定义区间**：260px 宽的展示区放不下日期控件，且"配置类交互只在设置侧"
  是既有约束（CHANGELOG 里两次记录过同类教训）。悬浮窗维持 `1d/7d/30d/90d/all` 五档，
  `RANGE_KEYS` 里的 `custom` 只对设置页/全局面板生效。
- **热力图/时段图的数据源语义**：固定档位下仍固定取近 90 天（月份回看、时段样本量需要）；
  只有在 custom 时跟随用户区间。这两条不冲突，但**不能反过来**把固定档也压成区间。
- **日期只认 `YYYY-MM-DD` 补零格式**：`parseLocalDay` 用正则 + 反向校验，`2026-02-31`
  会被拒绝（`Date` 会静默归一化成 `03-03`，不校验就会让用户"选了 2 月 31 日"）。

#### Tests

- host 72 → **86**（区间裁剪四条路径、非法格式、`parseLocalDay` 往返、custom 窗口与上期、
  `topProject`/`avgMs`、`dayDetail` 的正常/非法/未来/超期/空日）
- client 19 → **25**（`RANGE_KEYS` 含 custom、`rangeQuery` 拼装、`loadCustomRange` 的
  默认与损坏回落、`detailVal` 的新输入 = `prompt - cache_read`、`DETAIL_COLS` 完整性）
- settings-render 24 → **27**（自定义 pills 与日期控件回填、明细表**默认展开**含合计行、
  裁剪提示可见）
- 当前全绿：**148/148**
- 端到端（真实账本副本 + 自建 http server，见 `docs/DEVELOPMENT.md`）**23/23**：
  实测 `window.days=7`、`topProject=autofamer`、`avgMs=8340`、超范围裁剪到 90 天、
  非法日期 400、`/day` 的分时合计与当日总量完全相等（42082006 = 42082006，无丢数据）

#### 测试夹具教训

- `test/host.test.mjs` 的 `resetUsage()` 只清 `perDay/perModel/records`。新增的
  `perProjectDay` / `perToolDay` / `perHourDay` / `perSessionDay` / `perRelDay` /
  `perRetryDay` / `perDayDur` 不会自动清，**新用例写入这些容器会污染后续用例**
  （实测 `dayDetail` 用例留下的 `proj-a` 把"工具/项目/渠道"用例的 `demo` 挤掉）。
  已把 9 个容器全部纳入 `resetUsage()`。
- `__resetAt` 是模块级状态：`enrichDimensions` 的 `reset_at` 回归用例会把它抬到"现在"，
  之后任何依赖"最早可查日"的用例都会算错。涉及可查下限的用例必须**显式
  `T.setResetAtForTesting(0)`**，不依赖执行顺序。

### 左侧栏「用量与额度」全局面板（适配 DSH 桌面端 v0.2.1-rc.3）

- **背景**：DSH v0.2.1-rc.3 新增左侧栏、会话视图与右侧栏的「更多」菜单，开放
  「全局面板」席位（`sidebar.panellist` 图标行 + `main` keyed 面板本体，官方
  `ui-plugin-manager` 的「插件」页走的就是这条路径）。本插件随之新增侧栏入口：
  左侧栏出现「用量与额度」图标行（order 100，排在官方「插件」order 0 之后，
  自绘半圆仪表盘 SVG、currentColor 跟随选中态），点开是 AppFrame 中栏的全宽
  管理面板。
- **面板内容与设置页同源**：直接复用 `SettingsPanel`（它本就是纵向流式、无定宽
  假设），五个标签（用量统计/外观/数据源/通用/维护）与「设置 → 用量与额度」完全
  一致，配置改一处两边同步；页壳对齐官方页几何（`height:100%` 内部滚动、内容列
  `max-width:960px` 居中、`clamp(24px,4vw,48px)` 横向留白、darwin 顶栏避让
  `--dsh-frame-top-clearance`）。
- **页头悬浮窗开关**：「悬浮窗显示中/已隐藏」按钮联动 `saveWidgetEnabled`
  （写 `opencode_quota_widget_enabled` + 广播），与设置页「通用」里的开关等效。
- **悬浮窗联动（已移除）**：最初设计为"面板打开期间自动隐藏悬浮小窗"，实机验证两版
  实现都有问题、且"点侧栏入口 → 悬浮窗消失"本身就违反直觉，已**整体移除**：
  - v1（CSS `html.oq-panel-open .oq-overlay{display:none}`）：`display:none` 期间悬浮窗
    的自适应轮播高度 effect 量到 `scrollHeight=0` 把高度写成 0px，关掉面板后没有 deps
    变化触发重测量，塌到下一次数据轮询（最长 120s）才恢复——"悬浮窗塌掉、隔好一会儿
    才重新弹出"（实机反馈）；
  - v2（`panelSuppressed` 抑制位 + 专属 suppress/restore 事件）：恢复了即时性，但
    "打开面板就藏悬浮窗"的语义仍不对——悬浮窗在左下角、面板内容居中，同屏并不冲突。
  - 现在显隐只由用户开关决定（`LS_WIDGET`，经 `widget-toggled` 事件广播）：面板页头的
    「悬浮窗显示中/已隐藏」与「设置 → 通用」里的开关等效，面板与悬浮窗可同屏。
- **入口开关**：「设置 → 通用 → 侧栏入口」可关闭左侧栏「用量与额度」入口（默认显示，
  老用户升级无感）。关闭后 `slots.inject` 的 disposer 把图标行（`sidebar.panellist`）与
  面板（`main`）两条注册一并撤销——真实语义是回调把 `register` 的 disposer 交回
  `ctx.effect`，销毁连带撤条目；用户正停在面板上时，宿主布局 `retainMainPanels`
  发现 key 消失会自动切回会话视图。选择存 localStorage（`oq_sidebar_entry_enabled`），
  经 `opencode:sidebar-entry-changed` 事件即时生效，开关态启动不注册任何条目；
  悬浮窗与设置页不受影响。旧版 DSH 无侧栏入口，此开关无可见效果。
- **兼容旧版 DSH**：两个席位都通过 `ctx.slots.inject()` 接线——该 API 在席位已
  声明时同步执行回调、未声明时挂起等待（官方 `ui-renderer` 语义），插件卸载随
  effect 自动注销。本插件 `dsh.client.inject` 保持原样（不加
  `dsh-client-ui-sidebar`/`dsh-client-ui-layout` 依赖声明）：v0.2.1 之前的 DSH
  没有这些席位，注入永不触发、行为与从前完全一致；在 rc.3 上无论插件与
  ui-sidebar 谁先就绪都能正确挂上（HMR 顺序无关）。
- **id 命名**：`dsh-quota-widget/panel`——避开官方保留值（`plugins`/`schedules`，
  侧栏的埋点分类与 Pin 硬编码依赖它们），第三方用自带命名空间的 id。
- **开发工作流修正**：桌面 profile 对本插件的依赖由 `file:`（安装时复制静态副本，
  改工作区代码不生效）改为 `link:` 并将 `node_modules/dsh-quota-widget` 替换为指向
  工作区的 junction——此后改代码重启桌面端即生效，与 `dsh-providers-hub` 同体验。
  顺带记录：编辑 profile 的 `package.json`/`cordis.patch.yml` 必须存**纯 UTF-8（无 BOM）**，
  Windows PowerShell 5.1 的 `-Encoding UTF8` 带 BOM 会让 DSH 无法启动（见
  `docs/DEVELOPMENT.md`）。
- 测试：新增 `test/sidebar-panel.test.mjs` 8 条（席位未声明挂起不注册、声明后
  注册且 `main.key === panellist.id` 配对、延迟声明同样生效、图标契约
  `{size,active}` 渲染 svg、页面组件完整渲染含设置页五标签与开关写回、
  悬浮窗显隐只由用户开关决定且历史联动事件无效果、侧栏入口开关默认开/
  关闭撤销两条注册/重开恢复、关闭态启动不注册），并抽出共享桩
  `test/react-stub.mjs`（含 `keepEffects` 模式供事件时序测试保留监听器）。
  当前全绿：**client 13/13、settings-render 24/24、sidebar-panel 8/8**
  （host 62 条需要 Node ≥ 22.5 的 `node:sqlite`，本机 Node 20 无法运行，
  本次未改动 host 侧）。

## [0.1.1] - 2026-10-24

> 首次给仓库打 tag（`v0.1.1`）。0.1.0 之后的所有改动都收在这个版本里；
> 此前 `package.json` 的 `version` 一直停在 0.1.0，只看版本号无法区分新旧代码。

### 设置页 Tab 重构（数据源与通用 → 外观 / 数据源 / 通用 / 维护）

- **问题**：原来所有设置项挤在一个「数据源与通用」Tab——外观（悬浮窗模板/材质/图表）、
  数据源凭证、刷新周期、维护操作（清空账本/补齐/补录/快照）全混在一起，分类混乱、
  找个设置要来回滚，用户反馈"样式设计 UI、布局、分类效果很差"。
- **拆成五个 Tab**：用量统计 / **外观**（悬浮窗观感）/ **数据源**（凭证+测试）/
  **通用**（自动刷新 + 用量统计外观）/ **维护**（重置 + 清空/补齐/补录/快照）。
  不可逆或会改总量的操作集中在「维护」，绝不与外观、数据源项混排。
- 涉及入口路径的文档（README / DEVELOPMENT / design-usage-ui）已同步改为新 Tab 名。

### 维护 Tab 重构（账本操作 → 操作中心列表）

- **问题**：清空账本 / 补齐维度 / 补录会话 / 账本快照各为一张独立大卡，标题重复、
  描述冗长、按钮文案不一（统计 / 统计待补录 / 读取 / 刷新）、操作与反馈混杂，
  危险度无分级，用户反馈"布局太乱、交互不够清晰明了"。
- **收敛为一张「账本维护」列表**（手风琴，一次只展开一个）：
  - **修复数据**区：补录缺失会话（橙 · 会改变总量）、补齐历史维度（绿 · 只补缺失列）；
  - **危险区**：清空用量账本（红 · 不可逆）、账本快照（灰）。
  - 每行 = 功能名 + 危险徽标 + 一行状态 + 动作按钮；点开后才滑出详情区
    （范围选择 / 预览数字 / 手输确认 / 结果横幅）。
  - 危险度用颜色 + 徽标分级（🗑红 / 📊橙 / 🔧绿 / 💾灰），降低误触。
- 按钮文案统一：分析类「统计…」、执行类「确认…」、读取类「查看…」。
- 补齐维度结果改为行内紧凑横幅（原多字段大卡片），快照列表改为展开才读。
- 重置配置 / 悬浮窗位置单独一张卡，放在列表外（它们不操作账本）。

### 补录「磁盘上有、账本里没有」的会话

- **问题**：本机实测有 **27 个会话全在 90 天窗口内（最近 62 天）却完全不在账本里**——
  517 条回复、约 6,675 万 tokens 的用量从未被统计过（另外 3 个是只有配置元数据的空会话，
  正确跳过）。这些是清空账本、或某段时期回填没跑到时留下的空洞。
- **新增设置页「数据源与通用 → 补录缺失会话」**，与「补齐历史维度」并列但**语义完全不同**：
  - 补齐历史维度：只改已有行的列，**不动总量**；
  - 补录缺失会话：**会新增行、会让总量变大**，所以强制两步——先「统计待补录」看数字，
    再手输「补录」确认执行。
- **预览显示**：将新增几个会话、多少条回复、多少 tokens、占现有总量百分比、
  以及 `现总量 → 补录后总量` 的前后对照；可展开逐会话明细（项目 / 回复数 / tokens / 时间）。
- **幂等**：按 `session_id` 判重，已入库的整条跳过，重复执行 `sessions=0`。
- **代次闸门同样适用**：补录途中若清空账本，立即中止剩余会话。
- ⚠️ **预估口径踩过的坑**：最初预览只算 `inputTokens + outputTokens`，而
  `computeUsage` 的 `totals.total` 是 `(input + cacheRead) + output`。agent 场景下
  cacheRead 才是大头，于是预览说 **+15.9M**、执行后实际 **+66.7M**（差 4 倍），
  预估彻底失效。现在两处口径统一，实测预览 `266,084,217` = 实际 `266,084,217`（差 0），
  并补了断言锁死；把 cacheRead 去掉会让该测试立即变红（已验证）。

### 补齐历史维度（project 列为空）

- **「项目排行」里的 `—` 桶可以补上了**：有一段时间实时路径只读 `session.cwd`，而 DSH 把
  cwd 放在 `session.header.cwd`，那批行落库时 project 全是 NULL（本机实测 **1,124 行**
  落进 `—` 桶）。新增 `repairProjects()` 与设置页「数据源与通用 → 补齐历史维度」卡片，
  按需触发一次即可把它们归到真实项目。
- **只用 `UPDATE`，绝不新增行**：这是本次最重要的一条约束。最初的实现直接复用
  `enrichDimensions` 的 fs 扫描路径，结果 events **从 3,186 行涨到 6,972 行**——
  因为 `scanFilesystemFallback` 除了收集维度还会正常 `ingestEvent`，把磁盘上从未入库的
  会话顺带灌了进来。补项目不该改变总用量，所以现在只按 session_id 回填已有的行：
  实测行数 3,186 → 3,186、总量 186,616,699 → 186,616,699，`project=NULL` 1,124 → 0。
- **cwd 三级来源**：`sessionQuery.readSession().session.cwd`（权威）→ 会话文件头的
  `cwd`（需要解压 zstd，只在上一级拿不到时用）→ 目录名反解（`--D-code-foo--`）。
  三级都拿不到的行保持 `—`，界面会如实显示"仍缺 N 行"。
- **幂等**：第二次执行 `updated=0`，不会重复写入（已补的行不再是 NULL，天然被排除）。
- 走 POST + 一次性 nonce（它要重读会话元数据，是需要授权的重活），失败如实报错。

### 回填代次闸门（补齐 A4）

- **清空账本能打断"正在进行中"的回填**：此前只有写入端（`flushDb`）有代次闸门，
  读取端没有——用户在一次 `scanHistory` 跑到一半时点清空，本轮剩余会话仍会带着旧的
  `cut` 继续摄入。现在 `scanHistory` 在每个块边界、每次 `readSession` 返回后都比一次
  `__ledgerGen`，不一致立即中止；`scanFilesystemFallback` 也接受 `genAtStart`，
  每读一个文件比一次。
- 这条闸门真的有用：临时把两处 `genStale()` 判断关掉后，新增的回归测试立刻变红
  （清空后剩余会话被写回，库里非 0 行），恢复后转绿。

### 清空用量账本：从"一个按钮"重做为可判断、可回退、可限范围的操作

#### Fixed（这条链路上原本有 4 个真实缺陷，其中 2 个是"说了假话"级别）
- **清空后的数据会「回魂」**：`resetUsage()` 清了 9 个内存容器，唯独没清
  `__eventsQueue`——而 `flushDb()` 的 50ms 防抖定时器与 `beforeExit`/`exit` 钩子都还在。
  实测：清空瞬间 `events = 0`，**300ms 后变回 1**，且永久残留（`reset_at` 只拦回填，
  不拦写入——实测清空后仍能写入 10 天前的事件，`computeUsage("all")` 立刻返回 5500）。
  现在清空时倒空队列并递增 `__ledgerGen`，`flushDb` 入口记代次、拿到写锁后再比一次，
  不一致整批作废（定时器到点、退出钩子再 flush 都写不回去）。
- **库不可用时界面报「已清空（0 行）」**：旧实现 `catch` 里只 `logger.warn`，
  仍 `return cleared`（= 0）→ 端点回 `200 {ok:true}`。用户以为清了，重启后数据全回来。
  现在 `clearUsageLedger()` 返回结构化结果，DB 句柄丢失（且 `__dbPath` 存在）→
  `ok:false, error:"store-unavailable"`，端点回 500，界面显示失败原因。
  纯内存模式（`__dbPath` 为空）单独区分：如实 `ok:true` 但标 `persistent:false`。
- **清空不回收磁盘**：`DELETE` 只把页放进空闲表，文件不缩小（实测 82 页 → `VACUUM` 后 2 页）。
  真实库清空后页数 90 → 25、文件 0.35 → 0.10 MB。现在清空后 `VACUUM` +
  `wal_checkpoint(TRUNCATE)`，失败则降级为只 checkpoint 并如实回报 `vacuum.ok:false`。
- **同一秒内连续两次清空，第二次被整个阻断**（我在端到端时才发现）：快照文件名只到秒，
  `VACUUM INTO` 遇到同名文件报 `output file already exists`，被 `strictBackup`
  当成备份失败 → 整次清空拒绝执行。现在同名就顺延 `-2`/`-3`…，并补了回归测试。

#### Added
- **清空前自动快照**：`VACUUM INTO <storages>/token-meter-backups/token-meter-<时间戳>.db`
  （SQLite 官方的在线一致性快照，不需要停写），旁边写一份 `.json` 旁注记录范围/行数/时刻。
  只保留最近 10 份。快照是**完整可打开的库**（实测清空后从快照仍读到 2840 行）。
- **按范围清空**（`scope` 参数）：
  - `all` —— 全清，`reset_at` = 现在；
  - `before` —— 只清 `time < cut` 的部分（保留最近 N 天），`reset_at` 推到 `cut`；
  - `project` —— 只清某个项目，**不移动 `reset_at`**，改用 `meta.suppress_projects` 墓碑。
- **项目墓碑**：按项目清空若只删行，下一次重启的会话文件回填会把历史原样灌回来
  （文件还在）。墓碑按"项目 + 清空时刻"生效：该项目**清空之前**的事件不再摄入，
  清空之后的新活动照常记账（两条都有断言）。
- **清空预览**：`GET /api/token-meter/reset-preview` 返回将删行数 / 剩余行数 /
  全库日期跨度 / 库文件大小 / 项目候选。设置页「统计」按钮把数字显示在确认区
  （`将删除 2,840 行 · 剩余 0 行 · 2026-08-23 → 2026-10-24`）。
- **快照列表**：`GET /api/token-meter/backups` + 设置页「账本快照」卡片，
  显示文件名 / 大小 / 时间 / 范围 / 删除行数 / 目录。
- **一次性 nonce**：破坏性端点先 `POST /api/token-meter/reset-token` 取令牌
  （60s 有效、用后即焚），再带着它调 `/reset`。`localGuard` 在缺 `Sec-Fetch-Site`
  时是放行的，此前本机任意进程一个空 POST 就能清库。

#### Changed
- **「清空用量账本」从「维护」组独立成卡**：与「重置配置」「重置悬浮窗位置」混排时，
  三者同一行、同一个 3 秒确认窗——后果量级完全不匹配，一次误点就可能删掉整本记录。
  现在它独占一张卡（红色描边 + 「不可逆」徽标），且**必须手输「清空」二字**才解锁确认按钮；
  范围内没有可删记录时直接拦住，不再弹"已清空 0 行"这种无意义成功。
- 界面文案明确"只删本插件自己的统计，会话文件本身不受影响"与"历史下限"语义。
- 测试：host 46 → **56**（回魂、假成功、按项目+墓碑、按时间+reset_at、预览、
  参数校验、VACUUM 回收、nonce 一次性、快照可读、快照文件名撞车），
  settings-render 11 → **17**（独立成卡、预览数字、禁用态、成功带备份/回收信息、
  host 报错不得显示成功、快照列表）。client 13 不变。
  当前全绿：**host 56/56、client 13/13、settings-render 17/17**。
  （补 A4 与 project 修复后又加到 host 62 / settings-render 19，见上面两节。）

### 口径与稳定性修复（2026-10-24，一轮全面分析后的收口）

#### Fixed
- **内存泄漏：四个容器在长期运行的桌面进程里只增不减**（同时修了我在上一轮引入的两个缺陷）：
  - `seenSeq`：每个摄入过的事件一条 `sid:seq`，此前只在用户点"清空账本"时清空。
    实测注入 10 万事件 = 10 万条，无上限；
  - `live.stepStart` / `live.toolStart`：靠 `step/end`、`tool/result` 配对删除，
    但**中断的步骤/工具调用永远等不到配对事件**（用户切走、点停止、进程崩溃），
    实测 5000 个未配对 `step/start` 会让容器停在 5000 条；
  - `usage.perDay` / `perHourDay` / `perSessionDay` 等维度容器：DB 侧 `pruneExpired` 只留 90 天，
    内存侧却从不裁剪，实测 200 天历史会全部留在内存里。
    新增 `pruneMemoryState()`：按 90 天保留窗口裁掉过期会话的水位线 / `seenSeq` /
    未配对的 step、tool 起始记录 / 各维度中窗口外的天。**已验证窗口内读数一字不变**
    （1d/7d/30d/90d 完全相同，只有 `all` 缩小到 90 天，与 DB 保留口径对齐）。
    调用点：`flushDb` 之后 + 10 分钟一次的 `unref()` 定时器（内存模式与长期无事件时也能跑）。
- **`live.*` 口径判定从"比较事件时间"改为"调用方显式声明"**（修我上一轮引入的误判）：
  上一轮用 `time < LIVE_SINCE` 区分回填与实时，但回填是**启动后 1.2s 才异步跑**的，
  这期间用户真实发出的消息时间戳同样早于启动时刻 → 被误判为历史、实时计数漏计；
  系统时钟回拨也会整段误判。现在回填路径（`scanHistory` / fs 兜底 / `enrichDimensions` /
  `backfillExtra`）显式传 `{ live: false }`，实时事件流不传，语义明确且不受时钟影响。
- **热更新后全局钩子仍指向旧闭包**（修我上一轮引入的泄漏）：`window.__oqHeatReset` 原先只在
  第一次 `apply()` 时赋值，插件热更新（DSH 客户端支持，实测改完即可生效）后它仍调用**旧实例**
  的 `heatTipHide`/`flushPendingHeat`，既操作已卸载的 DOM 节点，又拖住旧闭包不让回收。
  现在每次 `apply` 都重新赋值（监听器仍只装一次，实测连跑 3 次 apply 时
  scroll/visibilitychange/pagehide 各只有 1 个监听器，而钩子已指向最新实例）。
- **悬浮窗的图表切换按钮会触发两遍渲染**：`saveTmChart()` 已广播 `tm-chart-changed` 且本组件
  已监听，按钮里额外的 `tick++` 是重复的，去掉。（该按钮随后整体删除，见下条。）

#### Changed
- 测试：host 41 → 44 条（新增内存裁剪、维度裁剪不改窗口读数、实时事件不被时钟误杀），
  client 13 / settings-render 11 不变。当前全绿：**host 44/44、client 13/13、settings-render 11/11**。
  （后续「清空用量账本」改造又加到 host 56 / settings-render 17，见上节。）

- **悬浮窗的热力图模式无法进入**（用户可见，反馈自实机）：两轮之前把"范围"与"图表形态"两个
  localStorage key 拆开（`opencode_quota_tm_chart` 给悬浮窗、`oq_settings_chart` 给设置页）时，
  只保留了悬浮窗侧的**读取**函数 `loadTmChart()`，`saveTmChart()` 从此没有任何调用点，
  成了死代码——悬浮窗永远停在默认 `bar`，热力图在设置页能选、在悬浮窗里不可达。
  入口补在**设置页**的「数据源与通用 → 小窗口」组：一张「小窗口图表」卡片（柱状 / 热力图），
  与「面板材质」「自动刷新」并列，复用 `saveTmChart()` 并广播 `opencode:tm-chart-changed`，
  悬浮窗监听该事件即时重渲染（跨标签页另由 `storage` 事件兜底）。
  热力图所需 30 天数据本来就由 `pullMeter(..., withChart=true)` 一直携带，无需额外请求。
  补了 3 条单测锁住"读写闭环"、"两个 key 互不干扰"与"设置页卡片写入的是悬浮窗的 key"，
  防止再次退化成单侧死代码。
- **悬浮窗上不该出现配置按钮**（用户纠正，实机反馈）：上一轮为了让热力图能被发现，
  在悬浮窗「范围」pills 右侧加了个 `柱 / 热` 切换按钮——这是设计错误。悬浮窗是**功能展示区**，
  设置、配置类操作统一收敛在设置页，两者不混。该按钮（及 `oq-chart-toggle` 样式钩子、
  随形态变化的 tooltip 文案）整段删除，`renderTmCompact` 现在只读 `loadTmChart()`。
  测试同步：`client.test.mjs` 的读写在注释里标明"写入入口只在设置页，不要在这里加回按钮"，
  断言仍走 `saveTmChart()` 而非 UI 点击，因此删按钮不影响用例；设置页卡片的渲染冒烟
  （settings-render 11/11）保持不变。
- **1d 分时图丢掉本地 00:00–07:59 共 8 小时**（用户可见）：Host 用 `toISOString()` 打 **UTC** 小时键，
  客户端却按**本地日**过滤（`hour.slice(0,10) !== localDay`），UTC+8 下凌晨的桶日期段落到前一天，
  被整段丢弃（构造全天 24 小时实测只剩 16 列）。现在统一为本地小时：
  新增 `hourKeyOf()`，`realtimeHourly` 的键与 `hour` 字段都用本地值（不再带 `Z`）；
  `hydrateHourlyBuckets` 的 SQL 补 `'localtime'`（此前与 `rebuildHourPartitions` 的 localtime 口径不一致，
  重启前后、分时图与时段热力图各说一套）；桶内新增 `localDate`，客户端优先按它过滤，
  旧 host 缺该字段时退回键的日期段（向后兼容）。
- **轮次恒为 0**：`turns` 只统计 `turn/end`，而真实会话文件里只有 `turn/start`（本机 732 条记录、
  0 条 `turn/end`），界面上出现"步数 202 / 轮次 0"。改为按 `turn/start` 计数，`turn/end` 仍单独
  用于失败轮次与可靠性口径；三处派生表重建同步改口径，并新增 `applyLegacyTurnFallback()`
  为"整天没有 turn/start"的旧数据退回按 `turn/end` 计数。
- **"项目排行"对活跃会话恒为空**：实时路径只读 `session.cwd`，而 DSH 把 cwd 放在
  **`session.header.cwd`**。实测当日 134 条回复全部落 `—` 桶，只有重启重扫会话文件那条路能补上。
  现在按 `header.cwd` → 顶层 `cwd` 兜底，并顺带从 `header.title` 取一次标题。
- **`live.*` 被历史回填污染**：`live` 口径写的是"本次进程启动至今"，但回填与实时走同一个
  `ingestEvent`。实测 30 条 10 天前的事件就能让 `live.msgs=31`、`outputTokens=3001`。
  新增 `LIVE_SINCE` 闸门，早于启动时刻的事件只进账本与维度聚合，不推进 live 计数
  （`stepStart` / `toolStart` 这类配对缓存不受影响，否则回填出的工具名与耗时会变空）。
- **`models[]` 字段歧义**：`input` 已含缓存读、`total = input + output`，但只下发
  `input/cacheRead` 会让消费方按名字相加得到翻倍的总量。新增 `freshInput`（= 新输入，不含缓存读），
  与 `totals.freshInput` 同名同义；客户端总量兜底抽成 `totalsTotalOf()`，旧 host 缺 `prompt` 时
  用 `freshInput + cache_read + completion` 计算。
- **设置页每敲一个字符触发 3 个上游请求**：`onInput` → `update()` → 广播 `opencode:config-changed`
  → 悬浮窗 `reload()` → `Promise.all([opencode, deepseek, r4coder])`。粘贴 40 位 key ≈ 120 个请求。
  新增 `update(patch, {quiet:true})`：本地状态与 localStorage 仍即时写入，只有"广播 + 重置退避"
  被推迟到输入停顿 600ms（`onBlur` 立即 flush）。
- **悬停标志泄漏导致轮询数据冻结**：`isHeatHovering` 只在 `heatTipHide()` 复位，组件卸载
  （关小窗 / 切材质重注册）时无人调用，标志永远为 true，`pendingTmData` 持续缓存而
  `flushPendingHeat()` 再不执行。新增全局 `window.__oqHeatReset`，在 `visibilitychange`（隐藏）、
  `pagehide` 与重新 apply 时强制复位并冲掉缓存。
- **GSAP 加载无在飞记忆**：CDN 不可达时每次调用都 `appendChild` 一个新 `<script>`，
  而调用点有三个在轮询/渲染路径上。改为"共享等待者队列 + 失败冷却 5 分钟"：
  实测 100 次调用只发 1 个请求，50 个调用方全部收到 `null` 回调、走纯 CSS 降级。
- **顶层 scroll 监听重复叠加**：`apply()` 作用域的滚动监听既不移除也无幂等位，
  插件重载/HMR 每次再装一个。改用 `window.__oqHeatScrollBound` 保证全局只装一次。
- **必红的时间炸弹测试**：`test/host.test.mjs` 用硬编码 2026-10-17 摄入却读 `computeUsage("1d")`
  （窗口是"本地今天"），只能在写入当天通过。改为 `range:"all"` 并补一条"数据落在今天时
  1d 也能读到"的用例。**此前 CHANGELOG 把它记为"本机环境问题、与改动无关"是错的**，
  它在本机与 CI 上都会稳定失败。

#### Changed
- **`enrichDimensions` 改为按会话分批落库**（`ENRICH_BATCH_SESSIONS = 24`）：旧实现把 90 天内
  所有会话的事件都攒进一个 `pairs` 数组，读完才写，内存峰值与"历史事件总数"成正比
  （几十万行时明显卡顿）。现在每读满 N 个会话就落库并释放，峰值只与 N 个会话相关；
  单批 UPDATE 再按 `ENRICH_MAX_PAIRS_PER_TXN = 150` 切分，避免超过 SQLite 老版本
  999 个绑定变量的上限。派生表重建仍放在全部批次之后统一做一次，避免中途得到半截结果。
  实测真实账本 2.4k 条事件 / 7 会话：**8ms、applied=1584 行、daily_project 重建 9 行**。
- **点过「清空账本」会让维度回填永久失效**（本次排查 `enrichDimensions` 时发现的真 bug）：
  回填下限原本写成 `Math.max(now - 90d, __resetAt)`，而 `reset_at` 是"清空账本的时刻"，
  于是用户一旦清过账本，`cut` 就等于清空时刻，**所有更早创建的会话都被判为越界**。
  更糟的是循环用的是 `break`（依赖 listSessions 的 createdAt 降序），第一个会话就终止整轮，
  而 `dims_backfill` 仍被置 1 —— 结果 `project` / `tool` / `ms` / `provider` 四个维度永久为空，
  且因为标记已置 1 再也不会重试。现在读取下限只用保留窗口（`reset_at` 的语义是"哪些事件算数"，
  由 UPDATE 的幂等性保证，不该用来决定"哪些会话要读"），循环改 `continue`。
  新增 2 条测试：分批结果与一次性写一致（60 会话 > 24，断言 batches>1）、
  `reset_at` 之后仍能回填。
- `package.json` 新增 `engines.node >= 22.5.0`（`node:sqlite` 的真实起始版本）与
  `test:host` / `test:client` 分开的脚本；README 的 "Node >= 22" 更正为 ">= 22.5"，
  并注明桌面版自带 Node 24 运行时。
- `docs/DEVELOPMENT.md` 更正：`SCHEMA_VERSION` 为 `"5"`（原写 4）、表数量（1 事实源 + 1 元信息 +
  7 派生表，原写"两张"）、区间白名单补 `90d`、清空账本删 7 张派生表（原写三张），
  并新增"小时口径必须是本地"一节。
- 测试：host 34 → 46 条（小时键本地化、回填不进 live、轮次口径、models 字段语义、
  内存裁剪、实时不被时钟误杀、维度回填分批与 reset_at 语义），
  client 9 → 13 条（UTC+8 凌晨桶回归、旧 host 无 localDate 的兼容、
  小窗图表读写闭环），settings-render 10 → 11 条（「小窗口图表」卡片写入正确 key）。
  当前全绿：**host 46/46、client 13/13、settings-render 11/11**。

### 悬浮面板材质：经典（默认）+ 液态玻璃 / 亚克力 / 哑光纸（2026-10-21，样板见 `docs/mockups/panel-materials.html`）

#### Added
- 悬浮小窗新增「材质」外观层，四档可选，入口在「数据源与通用 → 面板材质」：
  **经典**（默认，= 材质层引入前的原背板）、
  **液态玻璃**（低半径模糊 + 指针跟随镜面高光 + 渐变描边）、
  **亚克力**（38px 强模糊 + feTurbulence 噪点，景深最强）、
  **哑光纸**（不透明暖白 + 纸纹，零背景模糊）。
- 材质选择存 `localStorage["oq_panel_material"]`（不写插件配置），默认 `classic`；
  切换通过 `opencode:material-changed` 事件即时生效，跨标签页另有 `storage` 兜底。
- `docs/mockups/panel-materials.html`：10 款材质样板页（首张为默认经典背板），可切明暗主题与
  4 种背景（编辑器 / 照片 / 极光 / 浅色），支持 `?theme=light&bg=photo` 固定一组便于截图对照。

#### Changed
- **默认外观未变**：老用户升级后仍是原背板。`classic` 直接复用基础 `.oq-card` 的
  `--dsw-alias-bg-layer-2` / `--dsw-alias-border-l1` / `--dsw-shadow-lv3` / `blur(10px)`，
  只把材质层借用的 `::before` / `::after` 关掉（`content:none`），
  computed style 与"无材质类"逐项比对一致（背景、边框、阴影、模糊、圆角、尺寸全部相同）。
- 玻璃系材质在作用域内覆盖 `--dsw-alias-bg-layer-*`：`renderTmCompact` 的瓦片与
  DeepSeek 余额行用的是*内联* `background`，只写类选择器盖不住，否则玻璃面板里会嵌着不透明的深色砖。
- 亮色主题（`prefers-color-scheme: light`）为玻璃系单独一套底色/描边/内阴影，
  避免深色玻璃底叠深色文字；`prefers-reduced-motion` 下玻璃系退回实色渐变，省掉每帧模糊开销。
- 哑光纸自带浅色语义变量与热力色阶（深色主题下不会白底白字），并覆盖柱槽 / 网格线 / 进度槽 /
  时间线 / 环形进度轨道等硬编码白色的部件。

#### 已知
- ~~`test/host.test.mjs:478`（hours 7×24 矩阵按本地星期累计）在本机失败，
  与本次改动无关（只改了 `lib/client.js`，host 侧未动；断言期望周六 15 点为 110、实得 0）。~~
  **【2026-10-24 更正】** 该结论是错的：测试用硬编码的 2026-10-17 摄入，却读 `computeUsage("1d")`
  （窗口为"本地今天"），因此只能在写入当天通过，之后在本机与 CI 上都稳定失败。
  已在 [Unreleased] 的"口径与稳定性修复"里改为 `range:"all"` 并补回归用例。

### 用量统计外观：五模块 A/B/C 可切换（2026-10-17，详见 `docs/design-usage-ui.md`）

#### Added
- **每个模块三套风格，用户自选**，入口在「数据源与通用 → 用量统计外观」：
  总览（仪表盘/三色卡/一行）、图表（坐标系/摘要/极简）、排行（颁奖台/表格/列表）、
  实时（仪表/趋势/状态条）、最近调用（时间线/表格/Token 条）。
- 三个预设一键切全部：**专业监控**（A/A/B/B/B）、**轻卡片**（A/A/C/B/A）、**极简**（C/C/C/C/C）；
  自定义时显示「自定义」。
- 外观选择存 `localStorage["oq_usage_style"]`（不写插件配置、不影响悬浮窗），
  默认 `{overview:A, chart:A, rank:C, live:B, rec:A}`。
- 新增 CSS 层（约 90 条 `.oq-*` 规则）承载三种结构，全部走 `--dsw-alias-*` 主题变量，深浅色都适配。
- 实时 B 的 sparkline 使用前端环形缓冲（每次刷新追加 `rate60`，最多 20 点）。

#### Changed
- 排行的取数抽成 `rankItems()` + 三种渲染器，模型来源兼容「顶层 models」与「stats.models」。
- 图表的 1d 分时图也跟随风格：C 不画网格与峰值标注。
- `data-source` 维护组里重复的 `desc` 键合并为一条。

#### Fixed
- 重构时误删的 `renderMonthHeat`（热力图/月切换/点选下钻）已恢复，并补了点击回归测试。

### 用量统计 v3 改造（2026-10-17，schema v5，详见 `docs/plan-usage-v3.md`）

#### Added
- **会话排行**：新增 `daily_session` 派生表 + `session/title` 标题，payload 增加 `sessions[]`。
  实测 62 个会话里 Top8 占 70% 的 token，长尾极短。
- **时段热力图**（7 行 × 24 列）：新增 `daily_hour` 派生表（本地小时），payload 增加 `hours[]`；
  图表手册新增「时段」形态，并标注峰值时段（实测周五 17:00）。
- **可靠性落库**：`events.err` / `events.num` + `daily_reliability` / `daily_retry`，
  重试/压缩/被压缩 token/失败轮次/工具失败改为**区间口径**，重启不再归零。
- **热力图月份切换**：‹ › 回看近 3 个月（保留 90 天），点击某天展开当日明细条（含模型 Top3）。
- **折线图叠加曲线**：缓存命中率（黄虚线）+ 上期同长窗口（灰虚线，payload 新增 `prevDaily`）。
- **总览日均 chip** 与三段比例条的段内百分比标注。
- 渲染冒烟测试扩到 6 条（五个排行维度 + 四种图表形态），宿主单测覆盖新维度与重建幂等。

#### Fixed
- **环比失真**：`↑737%` 这类数字来自"绝对量环比 + 上期窗口覆盖不足"（本机数据 12 天，
  上期 30 天里只有 3 天有数据）。改为**日均比较**，且上期有效天数 < 窗口一半时
  显示「上期覆盖 x/N 天」而不是百分比。
- **首 token 恒「无样本」**：实时事件流不投递任何 chunk 类事件（`signalCount` 实测为 `{}`）。
  主指标改为「每步耗时 P50/P90」（`records[].durationMs`），首 token 降级到 tooltip。
- **清空账本后内存不归零**：`resetUsage()` 漏清 v5 的四个 Map（会话/时段/可靠性/重试），
  界面要等重启才归零。
- 复制失败仍提示成功（最近调用/诊断/摘要三处改为按 `copyText()` 返回值提示）。

#### Changed
- **排行卡合并**为「模型 | 会话 | 工具 | 项目 | 渠道」分段切换（此前 5 张卡纵向堆叠），
  选择记忆在 `oq_rank_tab`；设置页总高度明显下降。
- 热力图/时段图的数据源改为 **90 天**（否则无法回看前两个月）；范围 pills 在这两个模式下
  显示为「近 90 天（图表固定）」而不是整排消失。
- 「热力图固定取近 30 天」提示从**总览**卡标题移到图表卡；总览卡标题显示实际区间。
- 数据健康行重做：状态点 + 紧凑指标 + 「诊断」按钮（原来是一行 11px 灰字，几乎看不见）。
- 工具栏 `⇩/⧉` 改为「导出」「复制」文字按钮；「请求」改名「回复」并注明口径。

### 用量统计 v2 改造（2026-10-16，详见 `docs/plan-usage-v2.md`）

#### Added
- **三个新维度：工具 / 项目 / 渠道**（schema v4）。`events` 增补 `project` / `tool` / `ms` /
  `provider` 四列（`ALTER TABLE` 幂等升级），新增派生表 `daily_tool`、`daily_project`，
  并新增 `tools[]` / `projects[]` / `providers[]` 三个 payload 字段。设置页对应新增
  「工具排行」（按次数/耗时切换）、「项目排行」（按会话 cwd 归集）、「按渠道」三张卡。
  实测回填本机 90 天数据后：`read 2368 / pwsh 2003 / edit 1202 / grep 899`，
  项目 Top 为 `zenith / harmonycast / dsh-smart-commit / token-lens / ems资源包`。
- **缓存命中率与口径拆分**：`totals` 新增 `freshInput` / `cacheHitRate`，总览卡把
  「输入」拆成「新输入 / 缓存读 / 输出」三段并给出 100% 堆叠比例条（旧 `prompt` 口径保留，
  悬浮窗不受影响）。实测命中率 96.3%，旧 UI 上"输入 611M"里 95.8% 其实是缓存读。
- **环比**：设置页开始消费宿主一直在下发、却从没被用过的 `prevTotals`，总量/新输入/输出/请求
  都带 ↑↓ 百分比徽标。
- **折线/面积图 + 近 90 天区间**：图表形态从「柱状/热力」扩到「柱状/折线/热力」，
  区间白名单新增 `90d`（与 90 天保留窗口对齐）。
- **图表模型筛选**：点击模型排行某一行，柱状图/折线图/今日分时都只看该模型（再点取消）。
- **数据健康一行 + 清空用量账本**：设置页显示 库大小 / 账本行数 / 跨度 / 最后回填时间
  （点击复制诊断），维护组新增 `POST /api/token-meter/reset`（二次确认）——清空后写
  `meta.reset_at`，此后回填会跳过该时刻之前的历史，一次重启不会把刚清掉的数据灌回来。
- **导出与复制**：当前视图一键导出 CSV；一键复制摘要；「最近调用」点击某行即复制该条。
- **可靠性统计**：`llm/retry`（含 `failure.code`）、`compaction/end`、失败轮次、工具失败计数
  进入 payload 的 `reliability`，设置页在实时卡下方展示。
- **设置页渲染冒烟测试**（`test/settings-render.test.mjs`）：用最小 hook 运行时 + jsx 桩直接
  调用组件函数，喂真实形状的 payload，覆盖 有数据 / 三种图表形态 / 旧 host 缺字段 / 拉取失败。

#### Fixed
- **首 token 恒显示 `—`**：`assistant/chunk` 在会话文件里 100% 带 `turn/step`，但实时事件流
  并不保证投递它——实测活跃对话下 `firstTokenCount` 恒为 0 而 `steps`/`llmMs` 正常增长。
  现在对 4 类流式事件（`assistant/chunk` / `text-chunks` / `reasoning-chunks` /
  `tool-call-chunks`）广匹配，并把按事件名的分类计数 `live.signalCount` 下发：无样本时明确
  显示"无样本"并在 tooltip 里列出各事件名计数，便于一眼定位。
- **「实时」卡的速率名不副实**：`tokPerSec` 是进程启动至今、且只算 LLM 忙碌时间的累计均值，
  却被当成瞬时速率显示。新增 `live.rate60`（近 60s 输出 token ÷ 墙钟秒数）作为主指标，
  累计均值降为 tooltip。
- **图表 0 值画假柱**：`Math.max(8, …)` 让空白日也显示一根 8px 柱，看起来"有消耗"；
  改为 0 值只留 2px 基线且不配色，并补峰值标注与参考线。
- **缓存写永远为空段**：宿主 `usage` 只有 `inputTokens/outputTokens/cacheReadTokens`
  三个字段（实测 `cacheWrite` 恒 0），图例里那一段永远不会出现；改为有值才渲染。
- **「最近调用」重启后混入 `__system` 行**：hydrate 的查询没过滤 `type`，重启后列表里会出现
  一堆 "`__system` · 0 → 0"；现在只取 `assistant/message`。
- **「更新于」用的是客户端时间**：改为服务端 `updatedAt` 并显示「x 分钟前」。

#### Changed
- 「最近调用」补齐 缓存读 / 耗时 / 项目 三列（`records` 新增 `durationMs`，来自
  `step/start`→`assistant/message`），`sessionId` 从 8 位改 12 位。
- **范围偏好统一**：设置页与悬浮窗共用 `LS_RANGE` 并广播 `opencode:range-changed`
  （此前设置页另存 `oq_settings_range`，两个界面会显示不同时间段）。
- **图表形态偏好分离**：悬浮窗迷你图只有 柱状/热力 两态，设置页多一个"折线"，继续共用
  `LS_TM_CHART` 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
  因此设置页改用 `oq_settings_chart`（首次使用沿用旧的共享值）。
- 设置页新增 20s 低频轮询（`version` 未变则跳过 `setState`）：此前只在挂载/切区间/切图时拉，
  打开面板看到的是"打开那一刻"的快照。
- `docs/DEVELOPMENT.md` 补「v4 用量维度」「实时指标的口径与自证」「视图偏好」三节。

### 上一轮（用量优化执行计划，详见 `docs/plan-usage-optimization.md`）

#### Fixed
- **1d"今日分时"混入历史天**（用户可见）：host 的 `realtimeHourly` 由 hydrate 无条件聚合 90 天小时桶
  （实测 77 桶跨 11 天），客户端 1d 分支又没按今天过滤 —— 分时图会画出 59 列跨 11 天、纵轴按全量
  峰值归一，今天的柱子被压得几乎看不见。现在 host 只回填 `HOURLY_KEEP_MS`（2 天）窗口，客户端
  再用 `groupTodayHourBuckets()` 按本地日过滤，两侧都收口。
- **`live.firstChunk` 内存泄漏**：key 为 `session:turn:step`，此前只写不删，长时间运行 + 每次启动
  全量回填都会持续增长；现在在 `step/end` 一并清理。
- 存储降级不再静默：`/api/token-meter` 新增 `store` 字段（`db:<路径>` / `memory`），设置页"用量统计"
  面板显示一行「存储：SQLite / 内存（不持久化）」，避免"启动慢/数据不对"再次无从定位。

- 桌面版持久化从未生效：`resolveDbPath()` 只认 `process.env.DSH_HOME`，而官方桌面版不设该环境变量
  （host 内部按 `DSH_HOME || ~/.dsh` 解析），于是插件静默降级成纯内存——每次启动全量重扫会话、
  首屏还只有半截聚合。现在改为 env 优先 + 宿主 loader 提供的 `dshHomePath` 服务兜底
  （`ctx.get("dshHomePath")("storages")`），两级都不可用才 warn 并降级内存模式。
- 启动首屏用量偏小、十几秒后才"自己变对"：`/api/token-meter` 的就绪等待写成了
  `!usage.ready && usage.perDay.size===0`，第一个会话一摄入 `perDay` 就非空，回填还在跑就把
  "半截聚合"当结果返回。现在改成回填未结束就等它（`scanHistoryOnce` 的 in-flight 门把并发请求
  收敛到同一次扫描），并加 `READY_WAIT_MS = 20s` 上限，避免 sessionQuery 卡住时把数据接口一起拖死。

#### Changed
- 启动/常驻性能：`scanHistory` 的 `readSession` 由串行改为 **4 路并发**（`SCAN_CONCURRENCY`，块间仍保持
  `createdAt` 降序的 90 天边界语义，结果按原顺序摄入以保证去重与水位线推进的确定性）；并新增
  **会话级跳过**——会话最后一次活动时间（`header.updatedAt`，仅接受毫秒级 epoch）≤ 已记录水位线时
  直接跳过 `readSession`，这是"启动后增量 catch-up / 反复重扫"的主要开销来源；日志新增
  `scanned/skipped/ingested/耗时` 打点便于验证。
- 删除冗余的 `?meta=live` 轻量链路（host 分支 + client `mergeLive()`）：其存在理由是"Rust 快路径不携带
  live"，随 Zenith 剥离已失效；全量 payload 本就含 `live`，删掉后每个轮询周期少一次 HTTP + 一次
  `computeUsage`。
- 客户端按 `version` 跳过无变化的重渲染：payload 的 `updatedAt` 是 host 每次现取 `Date.now()`，
  不能用于判"数据没变"；改用 `usage.version`（事件级自增）比较后再 `setState`，流式期间 5s 一次的
  轮询不再把热力图/柱状图/donut 整棵树重渲染。
- 客户端轮询新增在飞守卫与统一超时：上一发未回时跳过本次**轮询**（手动刷新/切区间/配置变更带
  `force` 放行），并把 token-meter 请求超时统一为 30s（必须大于 host 的 `READY_WAIT_MS` 20s，
  否则会把携带完整口径的响应掐掉）。
- 删除 legacy 兼容层（约 85 行）：host 的 `today` / `byModel` / `totalsLegacy` / `hourlyLegacy`
  与 client 对应的兜底分支、`byModel` 归一化。依据：`byModel` 无任何渲染消费者；`today`/`totals`
  仅在 `stats` 缺失时兜底而 host 恒发 `stats`；`hourly` 保留（1d 分时图唯一数据源）。
- 清理死字段与过期注释：删掉只 seed 从不读写的 `meta.last_seen_seq`；`events.raw` 恒为 NULL，
  列保留但注释不再声称"raw 全量账本"（删列需表重建迁移，收益极低）。
- 工程化：新增 `test/` 单测（21 条，覆盖日历窗口边界/水位线代际重置/home 两级解析/小时桶窗口/
  热力分档/1d 今天过滤/三家额度归一化）、`npm run check` + `npm test` 脚本与 GitHub Actions CI；
  host 与 client 各增加一个只暴露纯函数的 `__testing` 出口。
- `docs/DEVELOPMENT.md` 补齐"数据链路 / 存储与降级（含 home 两级解析与静默降级坑）/
  就绪语义与客户端超时的约束关系 / 测试"章节。
- 修正安装文档：README 的 Web 安装命令原为 `add dsh-quota-widget`（依赖 npm registry，
  而本包未发布，实测 404），改为 `add github:CuiKuLaXiua/dsh-quota-widget`；补"git 源默认取 main
  最新提交、可用 `#tag` 固定"与"无构建步骤、无需 allowBuilds"说明；`docs/PUBLISHING.md` 补
  两种分发形态对照（GitHub 源 vs npm 源）与发版顺序（改 version → 打 tag → push）。
  另修正 README 中设置入口文案为「用量与额度」。
- 热力色阶配色调整（只换色，未动质感与尺寸）：6 档由蓝紫系改到品牌紫（`#8b7bff`）一族——
  暗色 `#c8c6ee → #a9a4e6 → #8b83dd → #7066cf → #5749ba → #443699`，浅色
  `#d9d4f0 → #c1b8e6 → #a699d8 → #8a79c6 → #7059b0 → #574194`，按感知均匀取值，
  相邻档更易分辨；"少=浅、多=深"的方向与界面说明保持一致。
- 设置入口更名：`settings.section` 导航文案由「额度查询」改为「用量与额度」（与「账号与余额」
  并列，覆盖 Token 用量统计 + Opencode / DeepSeek / R4Coder 额度）；`locale/*.json` 的
  `meta.title` 同步为「用量与额度小窗 / Quota & Usage Widget」。
- 设置入口图标不再沿用宿主的兜底齿轮：宿主 `ui-settings-general` 的 `navIcon(id)` 只认
  account / models / agent-presets / plugins / archived-sessions，未知 id 一律给齿轮，而
  `settings.section` 的注册项只有 id/order/label（无 icon 字段），插件无法声明自己的图标。
  现在按导航行文案精确匹配后只加一个标记属性（不替换、不改写 React 拥有的节点），再由
  CSS 隐藏齿轮、用 mask 自绘"半圆仪表盘"字形（与 `icon.svg` 的环+指针同族）。
- 悬浮窗贴边留白统一为 6px（`EDGE_GAP`）：拖拽硬边界、松手贴边吸附、初始停靠位置三处
  共用同一数值。旧实现吸附写 12px（左侧还会去对齐 DSH 侧栏会话列表 `.qDHVXG_list` 的
  左边缘，而侧栏自身有 12px 内边距），贴边后离窗口边缘偏大，且松手瞬间会从 6px 硬边界
  "弹"到 12px。底部初始停靠仍为 80px（让出底部输入区）。
- 修正热力图配色方向：旧实现"用量越多颜色越浅"（暗色主题最高档 `#82a1ea` 泛白），
  与设置页说明"颜色越深代表当天 Token 消耗越多"相反，看起来用量最多的一天反而最淡。
  现统一为"用量越多颜色越深"——暗色主题为 灰蓝浅色 → 饱和深蓝紫，浅色主题为 淡紫 → 深紫，
  且最高档与"无数据"底色（`--bmon-h0`）保持明显差异。
- 热力图档位由 4 档扩展为 6 档（`--bmon-h1`~`--bmon-h6`，含"无数据"档共 7 个色块），
  分档阈值等比细分；悬停提示的档位色点与设置页图例同步扩展。
- 两处热力图（悬浮小窗 / 设置页）的分档逻辑抽为共用的 `heatLvOf()` + `HEAT_LV`，
  避免同一阈值各写一份后跑偏。

## [0.1.0] - 2026-08

### Added
- 初始公开版本：从 Zenith 内置插件提取为独立 DSH 标准插件 `dsh-quota-widget`
- 支持 Opencode / DeepSeek / R4Coder 额度查询
- 支持 TokenMeter 用量统计与持久化（`$DSH_HOME/storages/token-meter.db`）
- 可拖拽悬浮小窗、迷你态/收起态、明暗主题适配
- 标准 bundle 安装：`dsh plugin --profile web add dsh-quota-widget`
