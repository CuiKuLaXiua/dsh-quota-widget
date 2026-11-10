---
name: dsh-quota-widget
description: DSH 右下角的用量与额度悬浮小窗——边缘胶囊的退场与召回
colors:
  # ── 品牌紫（强调色族）──
  brand-violet: "#8b7bff"
  brand-violet-deep: "#6d5bff"
  brand-violet-soft: "#b3aaff"
  # ── 玫瑰（命中率 / 用量进度）──
  accent-rose: "#c65f7f"
  accent-rose-lit: "#ff8fab"
  # ── 青（排行渐变终点，只做渐变右端，不做文字色）──
  brand-cyan: "#2ec5ff"
  # ── 数据语义四色（封闭，禁止新增第五色）──
  data-fresh: "#6d5bff"
  data-cache-read: "#f59e0b"
  data-output: "#10b981"
  data-cache-write: "#0ea5e9"
  # ── 模型/渠道分类色（--bmon-c1..c4，仅用于区分，不表示好坏）──
  model-steel: "#6b87d9"
  model-ochre: "#b08427"
  model-rose: "#c65f7f"
  model-violet: "#8d7ce4"
  # ── 状态色 ──
  state-success: "#34d399"
  state-warn: "#d97706"
  state-danger: "#ef4444"
  # ── 中性（深色主题）──
  neutral-void: "#1a1a1f"
  neutral-panel: "#242433"
  neutral-menu: "#1e1e28"
  neutral-ink: "#ffffff"
  neutral-muted: "#a0a0b0"
  neutral-caption: "#9a9aaa"
  neutral-tertiary: "#7a7a8a"
  # ── 哑光纸材质（自带一套浅色中性）──
  paper-high: "#fdfaf3"
  paper-base: "#f7f2e6"
  paper-low: "#f1ebdd"
  paper-ink: "#2a2318"
  paper-muted: "#6b6152"
  paper-caption: "#96897a"
  # ── 热力色阶 h0..h6（越深 = 当天消耗越多）──
  heat-0: "#252831"
  heat-1: "#c8c6ee"
  heat-2: "#a9a4e6"
  heat-3: "#8b83dd"
  heat-4: "#7066cf"
  heat-5: "#5749ba"
  heat-6: "#443699"
typography:
  display:
    fontFamily: "inherit"
    fontSize: "30px"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "inherit"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: "28px"
    letterSpacing: "0em"
  title:
    fontFamily: "inherit"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
  body:
    fontFamily: "inherit"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "inherit"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0em"
  micro:
    fontFamily: "inherit"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0em"
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0em"
rounded:
  underline: "2px"
  micro: "3px"
  tiny: "4px"
  chip: "6px"
  icon: "7px"
  control: "8px"
  tile: "10px"
  card: "12px"
  shell: "14px"
  pill: "999px"
spacing:
  hair: "2px"
  tight: "4px"
  snug: "6px"
  base: "8px"
  gap: "10px"
  block: "12px"
  section: "14px"
  group: "20px"
  page: "28px"
components:
  panel-shell:
    backgroundColor: "{colors.neutral-void}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.shell}"
    padding: "0"
    width: "260px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-muted}"
    rounded: "{rounded.icon}"
    padding: "7px 10px"
    typography: "{typography.title}"
  menu-item-active:
    backgroundColor: "rgba(109,91,255,0.15)"
    textColor: "{colors.brand-violet}"
    rounded: "{rounded.icon}"
    padding: "7px 10px"
  chip-badge:
    backgroundColor: "rgba(109,91,255,0.12)"
    textColor: "{colors.brand-violet}"
    rounded: "{rounded.pill}"
    padding: "1px 5px"
    typography: "{typography.micro}"
  page-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-muted}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  page-toggle-on:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
---

# Design System: dsh-quota-widget

## Overview

**Creative North Star: "The Edge Capsule"**

这套系统的第一状态是**不在场**。悬浮小窗不是一块一直摆在那里的面板，而是贴在视口边缘的一条细带：整卡退到屏幕外，只留一枚 8×44px 的紫色胶囊（`EDGE_GAP = 3px`，热区 22px）。指针靠近才把整卡拉出来，离开 420ms 后自己缩回去。所有设计判断都从这个前提出发——**任何"常驻装饰"都要先回答"它退场时还在不在"**。

由此派出两条几何纪律。其一，宽度只有一个真理：260px。它由内容包络反推得出（TokenMeter 的 7 列柱状图 7×30px + 6×6px gap = 246px，加内边距正好 260），热力图从 1 列切到 7 列**不允许**改变卡片宽度。其二，收起态只允许存在一个可见物体——胶囊。卡片外壳的底色、1px 描边、投影、`backdrop-filter` 全部关掉，因为 `translateX` 只移动绘画层，不移动命中区，残留任何一层都会在视口边缘留下一条"半截卡片"。

质感来自**材质而不是装饰**。四套面板材质（经典背板 / 液态玻璃 / 亚克力 / 哑光纸）是并列的一等公民，各自拥有完整的明暗、边界与内部面片规则，不是同一套皮肤换个模糊值。它们共享同一组语义变量 `--dsw-alias-*`，通过就地覆盖变量完成换肤，所以文字、热力色阶、边框在任何材质下都成立。哑光纸最极端：它自带一整套浅色中性，在深色主题下也不会出现白底白字。

信息密度是克制的：11–12px 正文、10px 说明、9px 脚注，1px 细描边，圆角停在 14px（外壳）/ 8px（控件）两档。**没有一个数字是比例字体**——所有计数、金额、百分比、时间都走 `tabular-nums`，因为这类界面的核心体验是"扫一眼对比"，字宽跳动会直接破坏它。

**Key Characteristics:**
- 退场优先：收起态只有一枚胶囊，其余零残留
- 260px 单一定宽，切图不改变外壳尺寸
- 四套材质并列，靠覆盖 `--dsw-alias-*` 换肤
- 四色封闭的数据语义（紫 / 黄 / 绿 / 青），允许同族深浅做层级
- 等宽数字 + 1px 细描边 + 8/10px 圆角，精密克制
- 动效状态驱动（120–180ms ease-out），只有两处常驻呼吸是例外

## Colors

配色性格：**深底上的低饱和语义色**——没有一个颜色是为了好看而存在，每个色相都绑定一个数据口径。

### Primary
- **Brand Violet 品牌紫**（#8b7bff）：全局唯一强调色。用于可点选中态（tab 下划线、pill 选中、排行前 3 序号、时间线圆点、菜单 active 文字）、悬浮窗徽标、网关胶囊。在深色底上直接用，不做混合。
- **Brand Violet Deep 深品牌紫**（#6d5bff）：`--dsw-alias-state-business-primary` 的兜底值，只出现在**实心填充**与**渐变起点**：主按钮底色、开关打开态、排行进度条 `linear-gradient(90deg,#6d5bff,#2ec5ff)` 的左端。不做文字色——在深底上对比不足。
- **Brand Violet Soft 软品牌紫**（#b3aaff）：网关分量的专用数字色（`#b3aaff` 配 `#8b7bff` 圆点）。这是"同族深浅"允许的边界：它不引入新语义，只是把"网关"这条既有语义从胶囊底色里拎出来。
- **Brand Cyan 品牌青**（#2ec5ff）：**只做渐变终点，永远不是文字色或填充色**。它唯一的落点是排行榜进度条 `linear-gradient(90deg, #6d5bff, #2ec5ff)` 的右端——紫走到青，表达"从品牌色滑入数据"。脱离这个渐变单独使用就是不成立的。

### Secondary
- **Accent Rose 玫瑰**（#c65f7f）：缓存命中率的唯一身份色。刻度盘的已点亮刻度、指针渐变起点、命中率进度条、命中率数字本身。它与品牌紫是**两套系统**：紫 = 交互与品牌，玫瑰 = 命中率这个指标。

### Tertiary
- 无。本系统只有两个强调族（品牌紫、玫瑰），其余颜色全部属于数据语义或中性。

### Neutral
- **Void 空底**（#1a1a1f）：卡片外壳底色（经典材质），也是深色主题的"最底层"。
- **Panel 面板层**（#242433）：卡片内部的第一个面片层（provider tile、detail 块）。
- **Menu 菜单底**（#1e1e28）：右键菜单与 tooltip 的底，比卡片再深半档，让它"压在"卡片上。
- **Ink 主文**（#ffffff）：标题、主数字、被强调的值。
- **Muted 次文**（#a0a0b0）：副标题、provider sub、账单金额。
- **Caption 说明**（#9a9aaa）：标签、脚注、坐标轴刻度、单位。
- **Tertiary 三级文**（#7a7a8a）：未激活的 tab 文字，只在"有更高优先级的同屏文字"时使用。
- **Paper 纸面族**（#fdfaf3 → #f7f2e6 → #f1ebdd / 文字 #2a2318 / #6b6152 / #96897a）：哑光纸材质独占的一整套中性。一旦卡片带 `.m-paper`，`--dsw-alias-label-*` 就地覆盖成这一族，**不再与深色中性混用**。

### 数据语义色（封闭四色）
- **Fresh 新输入**（#6d5bff）— 紫，与品牌紫同值，因为在"新输入"这件事上它承担的就是品牌级的注意力。
- **Cache Read 缓存读**（#f59e0b）— 黄，占比通常最大，需要一个"暖而低饱和"的色相，避免抢走主数字。
- **Output 输出**（#10b981）— 绿，最"贵"的一段，也是唯一允许被解释为"好"的数据色。
- **Cache Write 缓存写**（#0ea5e9）— 青，当前宿主恒为 0，保留但不上场。

### 分类色（不表态）
`--bmon-c1..c4`：钢蓝 #6b87d9 / 赭黄 #b08427 / 玫瑰 #c65f7f / 紫 #8d7ce4。仅用于区分模型、渠道、项目，**不暗示大小或好坏**。四色循环使用，超过 4 项走"其他"。

### 热力色阶
`h0..h6` 从 #252831 到 #443699，同一色相（品牌紫），明度按感知均匀递进。**方向不能反过来**：界面文案写的是"颜色越深代表当天消耗越多"，所以在深色底上必须是"越多越深"，而不是"越多越亮"。浅色主题另有一套 `--bmon-h*`（#ece4d1 → #574194），由 `body:not([data-ds-dark-theme])` 切换，由哑光纸材质再覆盖一次。

### Named Rules

**The Closed Palette Rule.** 数据语义只有紫 / 黄 / 绿 / 青四色，**禁止新增第五种**。需要新的强调层级时，用同族深浅（#8b7bff → #6d5bff → #b3aaff）或透明度，不新开色相。

**The Two Families Rule.** 品牌紫只做"可交互 / 被选中"，玫瑰只做"命中率"。把玫瑰用在按钮上、或把紫色用在命中率上，都是越界。

**The Neutral Never Assumes Rule.** 任何写死的中性色值（#9a9aaa 这种）都必须带一个 `var(--dsw-alias-*, 兜底)` 前缀。裸色值意味着换材质或换主题时它会失效。

**The Body-Scoped Token Rule.** 整套 `--oq-*` 派生必须声明在 `body` 上，不能挂 `:root`。宿主的 `--dsw-alias-*` 定义在 `<body>`（`body[data-ds-dark-theme]` 切深浅），而自定义属性在**声明处**求值：挂在 `:root` 上时 `var(--dsw-alias-*, 兜底)` 在 `<html>` 那层取不到 body 的值，全部退回兜底 —— 浅色皮肤下插件整体仍是深色就是这条错的。`:root` 只保留一份纯兜底（宿主变量缺失时仍有颜色）。明暗信号一律用 `body[data-ds-dark-theme]`，**不用** `prefers-color-scheme`（那是操作系统偏好，与 DSH 主题可不同步）。见 `lib/client.js` 的令牌层与 `test/theme-adaptation.test.mjs`。

**The Two-Tier Surface Rule.** 小面片（胶囊、徽标）必须与它所在的容器**至少差一档**，且这一档要在两套主题下都成立。判定方法不是看颜色值，而是问："深色下它靠变亮、浅色下靠变暗，还是两边都同色？" 只用 `bg-layer-1` vs `bg-layer-2` 这种"换一档变量"的做法在深色主题成立、浅色主题失效（`#242433` vs `#1a1a1f` 差得开，`#f6f2ea` vs `rgba(255,253,246,.94)` 差不开）。正确写法是与 `label-primary` 做 `color-mix`：深色 label 是白 → 提亮，浅色 label 是深 → 压深，同一表达式自动换向。描边用 `border-l2` 而非 `border-l1`（后者 10% 的强度兜不住浅色下的低对比）。见 `--oq-pill-bg` / `--oq-pill-line`。

## Typography

**Display Font:** inherit（跟随 DSH 宿主的无衬线栈）
**Body Font:** inherit
**Label/Mono Font:** `'Cascadia Code', Consolas, monospace`

**Character:** 全部继承宿主字体，插件**不引入任何字体文件**——这是硬约束，因为它在别人页面里运行。层级全靠字号与字重（500 / 600 / 650 / 700 / 750 / 800 六档）拉开，而数字靠 `tabular-nums` 拉齐。等宽字体是唯一的"外来"字体，且只服务三类内容：凭据掩码、token 计量、路径与键名。

### Hierarchy
- **Display**（750，30px / 1.1 / -0.5px）：总览的总量数字。全系统只有这一处用到 30px。
- **Headline**（500，20px / 28px）：全局面板的页标题「用量与额度」。刻意用 500 而不是 700——它与官方「插件」页同款几何，不靠字重抢注意力。
- **Title**（600，13px / 1.4）：设置卡片标题、tab 文字、环形中心数字的容器。
- **Body**（400，11px / 1.5）：provider 副行、说明文字、菜单项。悬浮窗里的正文基准就是 11px。
- **Label**（500，10px / 1.3）：字段标签、KPI 说明、图例。大量使用 `letter-spacing: 0.08–0.12em` + 大写的分组标题（`MENU` 式）也落这一档。
- **Micro**（400，9px / 1.2）：坐标轴刻度、热力图日期、徽标、页脚口径说明。9px 是下限，不再往下走。
- **Mono**（650，11px）：掩码凭据、token 值、网关路径。凡是"逐位对齐才有意义"的字符串。

### Named Rules

**The Tabular Rule.** 每一个会变化的数字都必须是 `font-variant-numeric: tabular-nums`。百分比从 99% 跳到 100%、余额从 4 位变 5 位时，**不允许任何横向位移**。这条没有例外——包括 SVG 里的 `text`。

**The No Import Rule.** 不引入 Web 字体、不引入图标字体。图标一律内联 SVG 或 CSS mask（导航图标就是一段 URL 编码的 mask 路径）。

## Layout

单列纵向流，没有栅格系统——这是 260px 宽的小窗，栅格会变成装饰。

**悬浮窗**：`.oq-overlay` 固定 `left: EDGE_GAP (3px)`、`bottom: 80px`、`width: 260px`、`z-index: 999`。卡片 `position: fixed`（拖拽依赖），宽度必须与 overlay 同步钉死，否则 `shrink-to-fit` 会让宽度随内容呼吸。内部 `.oq-body` 是 `flex-direction: column; gap: 4px; padding: 2px 5px 4px`——**4px 的节奏**，非常紧，因为小窗高度直接换算成遮挡面积。

**卡片内块**：provider tile 是 `padding: 5px 7px`、`border-radius: 10px`；detail 块 `padding: 8px 8px 6px`、`gap: 6px`；stat 小格 `padding: 6px 8px`。三层内边距从外到内递减（7 → 8/6 → 6/8），形成"外壳松、内容紧"的层次，而不是全用一个值。

**全局面板**：`.oq-page` 是 `padding: 28px clamp(24px, 4vw, 48px) 48px`、`gap: 20px`，所有直接子元素 `max-width: 960px` 居中。macOS 上额外加 `padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px))` 让出红绿灯。设置弹窗内的分区（宽度约 640–720px）复用同一组块，只缩小外距。

**响应式**：只有一条——`max-width: min(260px, calc(100vw - 24px))`。窄视口下卡片缩，不折行、不改布局。热力图与柱状图横向滚动而不是压缩，因为压缩后的格子失去"日历"的语义。

**触摸/热区**：边缘把手视觉 8px、热区 22px（有 4px 落在视口外，实际可点 18px，仍远超最小命中区）。图例点 8px、状态点 6px、热力格最小 3px 宽——这些是**不可点**元素，尺寸只服务可读性。

## Elevation & Depth

**多层分档，按容器等级取值。** 这不是"越浮越好看"，而是"越靠上层，投影越多层"：卡片一层主投影，菜单与 tooltip 在卡片之上，所以它们共享同一档但配更深的底；悬浮展开态再上一层。四套材质各自定制投影，但**档位语义不变**——换材质只换公式，不换它代表的高度。

阴影永远配合 1px 描边出现。投影单独存在时，深底上几乎看不见，所以"边界"这件事由 `border` 承担，"离地高度"由 `box-shadow` 承担，两者不互相替代。

### Shadow Vocabulary
- **Shell / lv3**（`var(--dsw-shadow-lv3, 0 10px 30px rgba(0,0,0,0.35))`）：悬浮主卡。经典材质用它，纸材质换成暖色版（`0 16px 30px -16px rgba(61,50,30,0.38), 0 2px 6px -2px rgba(61,50,30,0.16)`）。
- **Popover**（`0 8px 24px rgba(0,0,0,0.40)`）：右键菜单。比卡片更紧、更近，暗示"我从卡片上弹出来"。
- **Tooltip**（`0 8px 24px rgba(0,0,0,0.45)`）：全局富 tooltip，与菜单同档但更深一点（它盖在所有东西上）。
- **Liquid**（`0 22px 48px -18px rgba(0,0,0,0.72), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 1px rgba(255,255,255,0.40), inset 0 -18px 28px -20px rgba(139,123,255,0.50)`）：液态玻璃。关键是**内侧两层 insets**——上缘 1px 白高光造镜面，下缘 28px 紫雾造厚度。大负扩散（-18px）让它像"悬"起来而不是"贴"上去。
- **Acrylic**（`0 26px 52px -22px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.13)`）：亚克力。扩散更负、更暗，因为大面积模糊本身已经"厚"了。
- **Paper**（`inset 0 1px 0 rgba(255,255,255,0.90), 0 16px 30px -16px rgba(61,50,30,0.38), 0 2px 6px -2px rgba(61,50,30,0.16)`）：哑光纸。上缘 1px 内白高光是"纸的纤维受光"，两层外投影分工不同——大的那层管离地，小的那层管贴边。
- **Inset 内凹**：进度条与柱状槽统一用 `inset 0 1px 2px rgba(0,0,0,0.20)` 表达"挖下去"。凡是"容器"就内凹，凡是"内容"就外凸。

### Named Rules

**The Tiered Depth Rule.** 投影档位绑定容器等级，不绑定审美：主卡 = lv3，菜单/tooltip = popover，展开态 = 加 z-index 而非加投影。跨档使用（给内嵌小格加 popover 阴影）会让整个界面失去高度参照。

**The Border Carries the Edge Rule.** 1px 描边承担"边界"，`box-shadow` 承担"高度"。任何块都必须有 `border: 1px solid var(--dsw-alias-border-l1, ...)`，即使它的投影被材质覆盖掉。收起态把 `border-color` 设成 `transparent` 而**保留 1px 宽度**——宽度参与几何计算，改宽度会让把手偏移错 1px。

## Shapes

**圆角只有三档语义**：外壳 14px（`rounded.shell`）、面片 10px（provider tile / detail / 菜单 / tooltip）、控件与短条 6–8px（按钮 6–8px、图标钮 7px、pill 与开关 999px）。热力格 4px（8px 高）/ 6px（20px 高的大格）——**格子越大圆角越大**，小格用大圆角会看着像药丸。

形状语言的核心是"**多层圆角嵌套，每层减一档**"：卡片 14px 里放 10px 的块，10px 的块里放 8px 的小格，再往里有 4–6px 的条与格。这让嵌套块看起来是"从卡片里长出来的"，而不是"贴上去的贴纸"。

描边一律 1px，用的是"白 + 低透明度"的物理模型：`rgba(255,255,255,0.06 / 0.08 / 0.10 / 0.12)` 四档，从"几乎不可见"到"明确分区"。深色主题下这是唯一能画出立体边界的方式；纸材质把同一套透明度换成暖棕 `rgba(120,100,70,0.14–0.30)`。

**特殊几何**：
- 胶囊与把手全程 `border-radius: 999px`，包括进度条、开关、pill、徽标。
- 命中率环是 **24 根刻度的刻度盘**，不是进度弧。极坐标内径 13.6 / 外径 16.4（点亮时 17.2），指针从 11.2 起笔穿过刻度。34px 直径下环宽 4.2px，缺口 5.5px（缺口与环宽解耦，否则 99% 和 100% 分不清）。
- 网关胶囊带一个 **纯 CSS 三角**（3+3px border，`top:-4; left:6`），朝上指，表达"我是上方总量的一部分"。位置靠左是因为它要落在"网关"二字附近，读起来是「↑ 网关」。
- 进度条的满环单独画（不加 `stroke-dasharray`），因为 `round` 线帽在 100% 时两端会重叠成鼓包。

### Named Rules

**The Radius Steps Down Rule.** 嵌套容器的圆角必须小于等于父级，且逐层递减（14 → 10 → 8 → 6 → 4）。同层并列的块用同一个值。

**The 99% Is Not 100% Rule.** 任何环形进度只要不是真的满，就必须留出**可见**缺口（≥ 5.5px 弧长）。"几乎满分"与"满分"在视觉上必须可区分。

## Components

### Buttons

精密克制的手感：**字重先于颜色，描边先于填充**。

- **Shape:** 6px（`pillGroup` 短 pill）/ 8px（设置页按钮、输入框）/ 999px（过滤型 pill）。统一 `padding: 4–5px 12px`、`height` 不写死、`line-height: 1.5`。
- **Primary:** 实心 `ACCENT`（`var(--dsw-alias-state-business-primary, #6d5bff)`）+ 白字 + `padding: 5px 12px` + 8px 圆角。全屏只有"测试连接"与"保存"这一级用实心。
- **Secondary / Ghost:** 透明底 + 1px 描边 + 主文字色。这是默认形态——设置页 90% 的按钮都是它，包括 `oq-page-toggle`（`height: 28px`，与官方页头操作按钮同款几何）。
- **过滤 Pill:** 选中态 `border-color: ACCENT` + `background: rgba(109,91,255,0.14)` + `color: #8b7bff` + `font-weight: 700`；未选中态 `border: rgba(255,255,255,0.1)` + 透明底 + `font-weight: 500`。**选中靠三重信号（描边 + 底色 + 字重）而不是单一颜色**，因为它同时出现在深色与纸面两种底上。
- **Hover / Focus:** `background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))` + 文字提到 `label-primary`，过渡 `0.12s`。没有缩放、没有位移、没有阴影。
- **Danger:** 透明底 + `1px solid #ef4444` + 红字；确认态切换成实心红 + 白字。危险按钮**永远需要二次确认**（`确认执行？` + 3s 自动还原）。

### Chips

- **Style:** `padding: 1px 5px`、999px、9px 字、`line-height: 1.4`。底色是语义色的 12% 透明，描边是同色 18–20%，文字是语义色本身。
- **变体：** `default`（紫）/ `.live`（绿，带 6px 呼吸点）/ `.warn`（黄）/ `.err`（红）。四个变体对应 provider 的四种状态：套餐正常 / 正在生成 / 未配置或已禁用 / 拉取失败。
- **State:** 徽标**不可点**，永远是状态标签。可点的胶囊一律用 pill 形态，不混用。

### Cards / Containers

- **Corner Style:** 外壳 14px、面片 10px、小格 8px。
- **Background:** 外壳走材质（四选一），内部面片 `var(--dsw-alias-bg-layer-1 / layer-2)`。玻璃材质下这两个变量被就地覆盖成 `rgba(255,255,255,0.055)` 左右，否则玻璃后面会嵌着几块不透明深砖。
- **Shadow Strategy:** 见 Elevation——外壳一层 lv3，内部面片**不加投影**，只用描边区分。
- **Border:** `1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))`，hover 提到 `0.12`。
- **Internal Padding:** provider 块 `5px 7px`、detail 块 `8px 8px 6px`、stat 小格 `6px 8px`、tm 瓦片 `6px 7px`。外壳 `.oq-body` 是 `2px 5px 4px`。
- **Nesting:** 不允许三层以上。外壳 → 面片 → 小格已经是极限，再往下一律用 `border-top` 分隔线。

### Inputs / Fields

- **Style:** 8px 圆角、`padding: 6px 10px`（小号 `5px 9px` / 宽 72px）、`background: var(--dsw-alias-bg-layer-2)`、`border: 1px solid var(--dsw-alias-border-l1)`、12px 字、无投影。
- **Focus:** **只靠描边**，不发光、不加外圈。输入框是"最不该有仪式感"的控件。
- **Disabled:** 整块 `opacity: 0.55`，不单独改颜色。凭据字段配一个 26×26 的图标钮切换明文/密码。
- **Error:** 输入框本身不变色；错误以 6px 圆点 + 11px 红字出现在**同一行的右侧**，与成功态共用同一个位置，避免布局跳动。

### Navigation

- **设置导航（宿主内）：** 把宿主兜底的齿轮图标**隐藏掉**（`svg{display:none}`），用 `::before` + CSS mask 自绘一个半圆仪表盘（24×24 / 2.1px 描边，`currentColor`）。插入方式是给匹配到的导航行加一个标记属性，**不替换也不改写 React 拥有的节点**。
- **标签页（插件内）：** `.oq-tabs` 横向 `gap: 22px`，底线 `1px solid border-l2`；`.oq-tab` 13px、`padding: 7px 1px 9px`、未激活 `label-tertiary`、激活 `label-primary` + 底部 2px 品牌紫下划线（`border-radius: 2px 2px 0 0`，即 `{rounded.underline}` 只在顶部两角取用，底部两角必须是 0 才能贴住栏线）。悬停即提亮到主文字色，**不预热下划线**——下划线只属于当前项。
- **移动/窄屏：** tab 允许 `flex-wrap: wrap`，其余布局不折行。

### 悬浮外壳与边缘胶囊（Signature）

整个系统的签名组件，也是唯一同时涉及几何、事件命中与动画的地方。

- **收起位移：** `translateX(calc(-100% - 3px))`。**必须减掉 EDGE_GAP**，只 `-100%` 会在视口边留下 6px 的"残留侧边"。
- **把手几何：** 挂在卡片外侧（负偏移），偏移公式 `EDGE_GAP + CARD_BORDER_W + (CAPSULE_W + HIT_W) / 2`，由 JS 常量推导后传入 CSS。卡片收起后外边界恰好在 x=0，所以把手必须朝内伸。
- **胶囊：** 8×44px、999px、竖向渐变 `rgba(152,140,255,0.46) → rgba(133,118,244,0.74) → rgba(152,140,255,0.46)`，描边 `0 0 0 1px rgba(164,152,255,0.42)`，外发光 10px。三道 2×16px 白色短线（`opacity: 0.62`）暗示"可以拉"。
- **动效分层：** 收起 `0.42s cubic-bezier(0.32,0.72,0,1)`；展开 `0.40s cubic-bezier(0.16,1,0.3,1)`。**只有 `transform` 在动**——`left/bottom` 由 JS 瞬时写入且无过渡，否则两套计时会打架，视觉上是"抖一下再滑"。内容 opacity 比位移更快（收起 0.12s / 展开 0.21s），形成"内容先退、空壳再滑"的次序。
- **常驻呼吸：** 胶囊描边与外发光在 `0.34 ↔ 0.66` 之间以 2.4s 呼吸，同步三道短线高度 `14 ↔ 20px`。**只在真收起态跑**，展开态停止，hover 时暂停。

### 全局 Tooltip

- 单例 DOM 节点 + 同一套样式，**热力图与其余所有地方共用**，替代原生 `title`。
- `padding: 8px 10px`、10px 圆角、10px 字、`min-width: 132px`、`max-width: 260px`、`pointer-events: none`、`z-index: 1002`。
- 结构化四段：`head`（9px 说明）→ `main`（14px/750 主值）→ `rows`（左标签右值，`justify-content: space-between`）→ `footer`（9px 口径说明）。
- 文案**延迟到 hover 那刻求值**（数据每 5s 刷新，闭包里捕获旧值会显示过期数字）。

## Do's and Don'ts

### Do:
- **Do** 把每一个数字包进 `font-variant-numeric: tabular-nums`，包括 SVG `<text>`。
- **Do** 用 `var(--dsw-alias-*, 兜底值)` 的双写形式引用主题变量——兜底值不是装饰，是宿主变量缺失时的唯一保障。
- **Do** 在收起态把卡片外壳的四件套全部关掉：`background` / `border-color` / `box-shadow` / `backdrop-filter`，并把 overlay 的 `pointer-events` 设成 `none`（`translateX` 不移动命中区）。
- **Do** 保持 1px 描边宽度不变，哪怕把颜色设成 `transparent`——宽度参与几何计算。
- **Do** 用同族深浅（#8b7bff → #6d5bff → #b3aaff）或透明度表达强调层级。
- **Do** 每处 hover / 切图 / 数据更新用 120–180ms ease-out。
- **Do** 给所有常驻动画配 `prefers-reduced-motion: reduce` 的关闭分支，并让静态兜底值的环宽/透明度**精确等于动画起点**，否则首帧会跳变。
- **Do** 在容器上用 `inset` 内凹阴影，在内容上不用阴影。

### Don't:
- **Don't** 新增第五种数据语义色相。四色（紫 #6d5bff / 黄 #f59e0b / 绿 #10b981 / 青 #0ea5e9）是封闭的。
- **Don't** 让玫瑰色（#c65f7f）出现在按钮或交互选中态上——它只属于命中率。
- **Don't** 让卡片宽度随内容变化。260px 是单一定义，热力图从 1 列切到 7 列时不许变形。
- **Don't** 给内部面片加 popover 阴影，或给主卡加菜单阴影。档位绑定容器等级，不绑定审美。
- **Don't** 引入 Web 字体、图标字体或外部图标包。图标内联 SVG 或 CSS mask。
- **Don't** 在 `left/bottom` 上做过渡来驱动边缘收起/展开。只允许 `transform`。
- **Don't** 给输入框加发光或外圈 focus ring。描边提亮就是全部反馈。
- **Don't** 在哑光纸材质下混入深色中性（#9a9aaa 这类）。纸材质一旦生效，`--dsw-alias-label-*` 整族被替换，混用会出现白底浅灰字。
- **Don't** 用原生 `title` 承载需要口径说明的信息。走全局 tooltip 单例。
- **Don't** 在收起态用 `display: none` 或 `width: 0` 隐藏卡片——高度是 JS 量 `scrollHeight` 写进去的，不可见时量到 0，恢复后会塌成一条线。
