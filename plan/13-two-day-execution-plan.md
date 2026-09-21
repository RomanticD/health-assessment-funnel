# 13 · 两天执行计划

## 预算、顺序与外部 Go/No-Go

题面多处写 2 天，末尾“3 天节奏”按旧文案处理。按两个约 10 小时工作日设计，总计 20 小时，其中 3 小时（15%）只处理集成、CI、部署与文档意外。

按用户最新要求，执行顺序固定为：

```text
计划/契约冻结
→ 全部功能实现（期间只做 typecheck/build/人工 smoke，不写测试代码）
→ 独立 test agent 一次性实现完整测试矩阵
→ 主 agent 复核失败、修代码、接 GitHub Actions
→ Supabase/Vercel 部署与线上验证
```

这与常见“边写边测”不同，风险是缺陷更晚暴露；缓解手段是 API/DB/算法 oracle 先写入 plan/OpenAPI，模块保持纯函数和 dependency injection，且为集中测试阶段保留不可挪用时间。

初始外部事实及后续状态：

1. GitHub 已通过 CLI OAuth 恢复，`RomanticD/health-assessment-funnel` private repository 已创建并首推。
2. Vercel team `romanticds-projects` 已可见；项目仍待从 GitHub 导入并获得公开 URL。
3. Supabase connector 可正常访问 `kfyqgzuatywmsuruwsei`；Docker 24.0.6 已可用，local Supabase reset 尚待 migration 阶段验证。

GitHub Go/No-Go 已清除，功能编码可以开始；Vercel linkage 与 local Supabase 是当前 bootstrap 后续检查点。

## Must / Stretch

### Must

- versioned migration、ACL/RLS public fail-closed、事务 RPC、server-side BOLA guard。
- 256-bit session、分步保存/恢复、乱序、ETag、幂等、并发。
- health-v1、input snapshot、immutable result。
- preview/full 字段隔离、实时 entitlement、幂等 `/pay`。
- 算法单测 + DB/API 集成 + preview→pay→full E2E + GitHub Actions。
- 最小可信 funnel、Vercel/Supabase 线上部署、只读 paid fixture。
- 根/前端/后端/Supabase/tests README、OpenAPI、ERD、测试/未覆盖、AI 复盘。

### Stretch（不占用 Must 时间）

- 扩展问答、自动 OpenAPI generation、session 自助撤销、公开 DB readiness。
- 自动 retention cron、多浏览器矩阵、视觉回归、高级动画/analytics/后台。
- Supabase preview branch、复杂账号升级、真实支付 provider。

## Phase 0 · Remote preflight（实现前）

- 用户将 GitHub App 安装到 `RomanticD`，或重新完成 `gh auth login -h github.com`。
- 创建 private `RomanticD/health-assessment-funnel`，设置 `origin`，push plan initial commit。
- 用户连接至少一个 Vercel account/team；只验证 connector 可见，部署留到测试后。
- 启动 Docker Desktop；确认 local Supabase 可 reset。不得用生产库代替 destructive integration test DB。

退出：remote push 成功、Vercel target 可见、local test DB 路径可用。

## Day 1 · 后端功能实现（9h + 1h buffer）

### 0–1h · 工程基线

- scaffold Next.js strict、pnpm、Node 22、lint/format/Supabase CLI。
- 根 README、`src/app/README.md`、`src/server/README.md`、`supabase/README.md` 和 env example。
- 只运行 install、format、typecheck、production build；尚不创建测试文件。

退出：空应用可 build；`chore: scaffold...` commit/push。

### 1–3.5h · Schema、ACL 与 RPC 基线

- migration 创建 MVP 表、enum/check/index/FK、transition/immutability triggers。
- default ACL 先收紧、显式 grants、RLS 无 public table policy。
- session/assessment transaction RPC 骨架：只接收 session hash，同事务派生 owner/scope。
- 本地 reset、生成 types、人工 catalog/SQL smoke；不写自动化测试。

退出：schema 可从空库创建，关键 SQL 经手工 smoke；`feat(db)` commit/push。

### 3.5–6.5h · Session、保存与恢复

- session create/reuse/expiry、Cookie/Bearer/Origin。
- create/current assessment、strict step contracts。
- PUT step 的顺序、revision、If-Match、24h idempotency、minimal replay。
- route → application → RPC 全链实现；用两组手工 API 请求验证基本保存/恢复。

退出：实现路径完整、typecheck/build 绿色；`feat(api)` commit/push。

### 6.5–9h · health-v1、submit、result、pay

- Decimal/half-up、BMI/BMR/TDEE、目标规则、unavailable envelope、Clock。
- submit snapshot/basic/details；preview/full allowlist；live entitlement。
- `/pay` attempt/subscription 并发语义；demo_readonly guard。
- OpenAPI 与模块 README 同步；只做黄金样例人工复算和最小 smoke。

退出：后端所有 Must 功能已编码且 build；按 domain/auth 合理拆分 1–2 个 commit 并 push。

### 9–10h · Day 1 buffer

只修 migration、build、模块边界或 remote CI 基线，不开始 stretch。

## Day 2 · 最小前端 → 独立测试 → CI/部署（8h + 2h buffer）

### 0–2.5h · 全部剩余功能与文档骨架

- Landing、4 个输入 step、review、preview/result/paywall。
- 保存、422/412/session expiry 状态；移动优先与基础无障碍。
- health answers 只在内存/server；客户端不重算、不自行授权。
- provisioning/cleanup/smoke scripts 与四类 README 初稿。

退出：所有功能实现结束、production build 可启动；`feat(ui)`/`docs` commit/push。此后冻结新功能，才进入测试。

### 2.5–5.5h · 独立 test agent 集中实现

向独立 agent 交付：题面、plan、OpenAPI、schema、全部实现代码；要求它从攻击者/评审者视角写而非照抄实现。

- unit/property：algorithm、validation、state、preview projector。
- integration：session、restore、乱序/replay/concurrency、BOLA、ACL/RLS、submit rollback、pay concurrency、demo read-only。
- contract：Problem Details、headers、OpenAPI、README cURL。
- Playwright：fresh funnel、refresh restore、preview→pay→full、移动/键盘。
- `tests/README.md` 映射 R-ID、覆盖与未覆盖。

主 agent 同期只能做不影响测试 oracle 的文档/部署准备，不提前改写 agent 正在覆盖的行为。

退出：测试代码完整，先记录真实失败结果；`test: add...` commit/push。

### 5.5–7h · 修复、全量验证与 GitHub Actions

- 主 agent 逐项判断是实现 bug、测试 oracle 错误还是环境问题；不为“变绿”削弱断言。
- 跑 format/lint/typecheck/unit/integration/contract/build/Playwright。
- 两个 Actions job：quality、integration-e2e；保留 coverage/trace artifacts。

退出：fresh local `pnpm verify` 与 main Actions 全绿；修复按主题 commit/push。

### 7–8.5h · 受控 Supabase/Vercel 部署

- CI 绿色后 gated `supabase db push`；migration list、ACL/default privileges/RLS/advisors。
- 配置 Vercel server-only env 并部署。
- provision/rotate `demo_readonly` paid session；线上完整 cURL/Playwright smoke。

退出：无本地状态可走全流程；记录 URL、paidSessionId、assessmentId、expiry、CI/deployment evidence。

### 8.5–10h · Release buffer 与交付

- 完成根 README、AI 复盘、ERD、OpenAPI、测试范围/限制、runbook。
- secret scan、链接/命令复跑、private repo reviewer access。
- 生成 `【姓名】_全栈挑战_YYYYMMDD` 和四邮箱草稿，由用户确认外发。
- 最后 30 分钟只跑全新浏览器/cookie jar：refresh restore、preview→pay→full、paid fixture read + all writes rejected。

## 关键提交留痕

每个里程碑遵守：

```text
功能/迁移完成
  + format/typecheck/build（测试阶段后再加 relevant tests）
  + docs/contract 同步
  + diff review
  + atomic commit
  + push
= milestone complete
```

不 squash 掉有评审价值的里程碑，不提交 `.env`/token/真实数据；失败修复 commit 说明对应 R-ID 或 regression 场景。
