# P0 产品与体验复审

> 复审基线：`13e5353 docs: clarify payment replay fixture usage`。本文件只记录产品判断、验收标准和证据要求；业务实现仍以 `src/`、数据库 migration 与自动化测试为准。

## 结论摘要

后端的订阅闭环已经具备：结果接口根据服务端 entitlement 返回 `preview`/`full`，结果页的 locked panel 打开 `UpgradeDialog`，确认后调用 `/api/v1/pay` 并重新请求结果。这个闭环在 `tests/integration/access-payment-api.test.ts` 与 `tests/e2e/funnel.spec.ts` 有证据。

但是，面向评审者和真实用户仍有五个 P0 体验缺口需要在最终版显式解决：

1. 付费入口不能依赖用户猜到“Explore my full summary”后才看到弹窗；结果 preview 区必须直接呈现“模拟解锁 / $0 / 会看到什么”，并在完成页首屏或紧接首屏可见。
2. Summary 应从“多个同质卡片”改为 BetterMe 风格的信息叙事：标题与结论、BMI 视觉刻度、个人画像/运动偏好、能量/目标方向、进度曲线和解释性文案；曲线需有轻量绘制动画且支持 reduced motion。
3. 每题 URL 要与当前问题同步，但不能把 bearer session、支付凭证或健康数据放入 query/hash。复制链接只应当在同一浏览器的 HttpOnly session 内恢复；没有 session 时必须拒绝读取，不得把 assessment UUID 当作授权凭证。
4. 选项、加号、箭头、CTA 都要有清晰按压反馈；保存期间应在被点击的控件内反馈，避免整页等待。单选保存成功后应尽快切题，失败则保留选项并提供重试。
5. Landing 的 header 与三句 value strip 必须全宽铺开：logo 左、How it works 右，内容列可以居中但背景/边界不能只停在居中容器。

## P0-1 付费与差异化结果闭环

### 用户应该看到的流程

```text
完成 15 题
  → Review
  → 结果页：先展示可读的 preview
  → preview 下方立即看到“完整摘要 / 模拟解锁 $0”入口
  → UpgradeDialog（明确无真实扣款）
  → POST /api/v1/pay
  → 重新 GET /result
  → access=full，展示受保护字段与曲线
```

“自动弹出”不是必要的转化手段，也不应阻塞用户阅读免费 preview；但入口必须在结果页首屏或第一段之后可见，且价格、模拟性质、解锁内容不能只藏在 modal 内。建议锁定区同时显示：`Demo checkout · $0`、`No card. No charge. No renewal.` 和三项实际解锁内容。

### 必须保留的后端约束

- UI 不自行设置会员状态；`GET /result` 的 `access` 是唯一权威。
- preview JSON 中不能出现 `bmrKcal`、`tdeeKcal`、`exactDailyCalories`、`targetDate`、`weightProjection`，包括嵌套对象、错误对象和缓存响应。
- `/pay` 只接受固定 `demo_monthly`，按当前 session owner 校验已完成 assessment，重复同一幂等键不会重复延长订阅。
- 支付成功后必须重新请求结果；刷新结果页仍保持 `full`。
- assessment UUID 可出现在 path，但不具备授权能力；不同 session 读取、支付、修改都应失败。

### P0 验收

- 新 session 完成 15 题后，评审者无需猜测即可在结果页找到解锁入口。
- 点击入口后可见 `role=dialog`，确认按钮可操作，Escape/关闭可回到 preview。
- 确认后页面能看到 `Your full summary` 和至少一个此前锁定字段；网络断开时保留 preview，不伪造成功。
- API 集成测试验证 preview/full 字段差异、递归保护字段扫描、跨 session 越权和支付幂等；浏览器测试验证 preview → dialog → pay → full → reload。

## P0-2 Summary 信息架构与动画

当前 `ResultExperience` 的 `result-overview`、`metric-card`、`locked-panel`、`timeline-panel`、`routine-card` 均是圆角容器，功能完整但视觉上容易变成“AI dashboard”。最终版按以下层级重排：

1. **标题区**：一句结果标题 + 一句温和的结论，不展示内部算法名或工程状态。
2. **BMI 区**：横向色带/刻度、当前位置圆点、分类说明和简短解释；数字与刻度对齐，移动端可横向缩放但不产生横向滚动。
3. **Personal profile 区**：使用无边框或轻分隔的列表呈现经验、活动频率、练习时长、每周天数、器材与 focus；避免每项都做独立卡片。
4. **Energy / direction 区**：preview 只给宽范围与方向；full 用两到三列数字或 editorial rows 呈现 BMR、TDEE、daily target，并在旁边说明估算性质。
5. **Timeline 区**：宽幅浅色画布、带面积淡入的曲线、起点/终点标签和日期；曲线不是装饰，要有文字摘要可读。
6. **解释与免责声明**：把“这是方向，不是保证”放在图表下方，不在首屏用工程术语打断节奏。

### 图表验收

- 使用服务端 `weightProjection`，客户端不得重新推算数据。
- 首次显示时曲线从 0% 绘制到 100%，总时长建议 550–850ms；圆点/终点标签可随后轻微出现。
- `prefers-reduced-motion: reduce` 时直接显示最终图形，不能隐藏信息。
- SVG 有 `title`/`desc`，并有文本日期/体重摘要；不能只靠颜色传达走势。
- preview 不返回也不绘制预测曲线，不能通过 blur、DOM 属性或静态 HTML 泄漏受保护数据。

建议文案：

- 标题：`Here’s your starting point` / `A direction that fits your life`
- 曲线标题：`A gentle path toward your goal`
- 说明：`This is an estimate to help you choose a direction. Your pace may change, and that is okay.`
- 维护目标：`A steady range, not an arrival date.`
- 长期目标：`This goal deserves a longer horizon and smaller milestones.`

## P0-3 URL、恢复与隐私边界

### 推荐决策

保留 HttpOnly cookie session；让 URL 只表达导航状态，不表达授权状态：

```text
/quiz/motivation
/quiz/ageYears
/quiz/review
/results/<opaque-assessment-uuid>
```

每次答案推进后使用 `router.replace` 同步当前 `stepKey`，刷新时服务端 `nextStep` 决定真实落点。因此同一浏览器复制 URL 可以恢复，换浏览器/无 cookie 访问时返回安全的 session-required/assessment-not-found，不泄露是否存在该 assessment 的细节。

不要把以下内容放入 URL、referrer、localStorage 或 sessionStorage：

- 明文 session bearer、支付 idempotency key、订阅状态；
- 年龄、身高、体重、目标体重及完整答案；
- 可直接绕过 cookie 的 `order`/`pay` 参数。

若未来需要跨设备分享，应另行设计短期、一次性、可撤销的 signed resume token，并只允许恢复 draft；这不是本挑战的必需功能，不能用 assessment UUID 代替。

### 验收

- 每一题 URL 与页面题目一致；后退/刷新不跳过服务端未完成步骤。
- 同浏览器刷新能恢复最新已保存答案；新隐身窗口复制结果 URL 不能读取健康数据。
- E2E 检查 URL 不含 `sessionId`、`token`、`pay`、健康数值；检查 Web Storage 为空。

## P0-4 按压反馈、保存与性能

### 交互规范

- `.answer-option:active`：`transform: scale(.985)` 或 `translateY(1px)`、边框/背景短暂加深；`transition` 约 120–180ms。
- 选中态的 `+`/`→` 不使用普通文本基线定位，使用统一 24×24 flex/grid 容器或 inline SVG，`line-height: 1`；不同选项行的 icon 中心必须一致。
- 被点击的单选项显示 spinner/pressed 状态；其他选项暂时不可重复提交，失败后恢复可操作。
- Continue CTA 在 multi/number save 期间显示 spinner，保留输入；按钮不因整页 overlay 阻断阅读。
- 保持 `prefers-reduced-motion` 下无位移/绘制动画。

### 性能验收

- 单选点击到下一题：先立即呈现 pressed/selected 状态；网络等待只阻止重复提交，不显示整页 loading。
- 每题最多一次有效 save；同值重试由 revision/idempotency 保证，不重复创建 session。
- 题目切换使用轻量 CSS 动画；不加载大图或重复请求 session。生产浏览器测试应记录 `/sessions` 请求数为 1。
- 保存失败时不丢失用户刚选的值，且能原地重试；revision conflict 给出“另一标签页已更新”的可理解反馈。

## P0-5 Header 与全宽 strip

当前 `src/app/studio.css` 的 `.site-header { max-width: 1320px; margin: auto; padding: 26px 5%; }` 与 `.studio-home { max-width: 1600px; }` 会在宽屏制造居中窄条；`.studio-values` 又作为其子元素继承容器宽度，因此背景无法铺满视口。这正是截图中顶部和三句文案条“只在中间有背景”的原因。

建议结构：

- header 背景和底边框占 `100%`，内部内容用 `width: min(1320px, calc(100% - 80px)); margin-inline: auto`；logo 左对齐，`How it works ↗` 右对齐。
- values strip 使用 `width: 100%;`，必要时用 `margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw);` 做 full-bleed；文字内容仍可用内部 max-width 控制。
- compact header（quiz/result）也保持 logo 左对齐；隐藏右侧链接可以，但不能把 logo 置于页面正中。
- 375px 下保留安全区和 16–20px 内边距；不产生横向滚动。

### 验收截图

- 1440px/390px 各一张 Landing：logo 靠左、How it works 靠右（桌面）、底边框贯穿全宽；values 背景贯穿全宽。
- 结果页桌面截图包含 preview locked panel、dialog 截图和 full timeline；移动截图无横向溢出。

## 原始需求与现有计划复核

| 要求 | 当前证据 | 复审判断 |
| --- | --- | --- |
| 15 题分步保存/恢复 | `src/components/quiz/personal-quiz.tsx`、`src/app/api/v1/assessments/[assessmentId]/funnel/route.ts`、`tests/e2e/funnel.spec.ts` | 核心已完成；补上 URL 与当前题同步验收 |
| BMI/摄入/日期服务端计算 | `src/server/domain/health-assessment-v1.ts`、submit integration tests | 已完成；UI 只消费 DTO |
| preview/full 鉴权 | `src/server/domain/result-projection.ts`、`access-payment-api.test.ts` | 核心已完成；需让 P0 入口在 UI 首屏可发现 |
| `/pay` 闭环 | `src/components/results/upgrade-dialog.tsx`、`src/client/health-api.ts`、E2E | 已完成；需要截图/线上证据说明点击路径 |
| 边界/并发/越权测试 | `tests/unit`、`tests/integration`、CI workflow | 已完成；交付包需标注代码位置与通过 run |
| 公网、GitHub、paid session | README、Vercel、GitHub Actions | 已具备；交付文件夹还需要把证据集中索引 |
| Schema 图与 AI 复盘 | `docs/database.md`、`docs/ai-retrospective.md` | 已具备；交付文件夹需复制链接，不必复制敏感 secret |

计划文档 `plan/01-requirements-traceability.md` 的状态列仍有大量 `planned` 遗留。最终交付前应根据真实 CI/线上 smoke 把已验证项改为 `verified`，否则会让评审误以为功能未完成。

## 交付证据最低集合

交付目录建议包含：

```text
delivery/
├── README.md                         # 验收入口、URL、GitHub、paid demo
├── 【姓名】_全栈挑战_YYYYMMDD.md      # 邮件正文/项目摘要
├── screenshots/
│   ├── landing-desktop.png
│   ├── quiz-mobile-pressed.png
│   ├── result-preview.png
│   ├── paywall-dialog.png
│   ├── result-full-chart.png
│   └── header-full-bleed.png
├── evidence/
│   ├── ci-run.md                      # workflow URL、commit、jobs
│   ├── production-smoke.md            # health、preview/pay/full、时间
│   └── test-map.md                    # 需求 → 测试文件/代码位置
└── schema/assessment-erd.png|md       # 可读 ERD 与 migration 版本
```

截图只使用合成健康数据；session bearer 只在交付 README 的明确 demo 区域出现，不进入截图、日志或普通产品文案。

