# 99 · 独立 Agent Review 与修订记录

## 审查方式

规划初稿完成后，主 agent 将实际 `plan/` 文件交给三个独立 agent 只读审查：

1. `requirements_arch`：逐条需求、API/状态/算法/排期与交付完整性。
2. `supabase_audit`：Supabase 项目事实、service role/RLS/ACL、migration、fixture 与部署。
3. `workspace_audit`：本地 Git/CLI/Docker/GitHub 可用性与外部阻塞。

三者均未修改文件或远端。之后主 agent 根据具体 P0/P1 修订文档，并发起第二轮复审；第二轮三个 agent 都因当时的 agent usage limit 失败，因此本文不把“二次独立确认”伪称为成功。第一轮独立 review 已完成，修订后由主 agent逐条做了 cross-document self-audit；进入功能实现仍受下述外部 Go/No-Go 限制。

## 第一轮结论

### Requirements/architecture agent

初稿判定 No-Go，主要 P0：

- BetterMe 只观察到中段，却把最终结果/付费行为写得像实测。
- `paid sessionId`、Cookie/token、公开 credential、session revoke 语义冲突。
- health 算法常量未冻结，API 示例 BMI/BMR 数学错误。
- GitHub remote/push 与 Docker integration DB 实际不可用。
- 两天计划超载且只裁剪 UI，没有裁剪后端非核心范围。

主要 P1：不可达状态、支付并发/schema 不一致、service role/RLS 表述过强、结果不可变缺少 DB trigger、localStorage 健康草稿、session 生命周期、private repo 访问、幂等 canonicalization、`improve_fitness`、retention、外部交付 R-ID。

### Supabase security agent

建议保留自建 256-bit opaque session，不切 Supabase Anonymous Auth；但必须承认 secret/service role `BYPASSRLS`。

P0：

- 写 RPC 必须自己接收 session digest，在同一事务校验 expiry/revocation/scope、派生 owner，再做 ownership/revision/idempotency/write；RLS 不能替代 BOLA。
- `seed.sql` 不会随 production `db push` 自动产生线上 paid fixture，必须有显式 provisioning/rotation。

P1：ACL/default privileges 要到可执行级；函数空 search path/全限定对象；service role 显式 grant；demo read-only 必须在 DB RPC 拒绝；Data API 保持开启供 RPC；public-key fail-closed 与 BOLA tests 分开；部署路径只选 gated `db push`。

### Workspace agent

初查发现空工作区、未初始化 Git、`gh` token 失效、GitHub App 未装到 `RomanticD`、Docker daemon 未运行、Supabase CLI 未安装。主 agent 随后已初始化本地 `main`，但其余外部问题仍需在 scaffold/preflight 解决。

## P0 修订闭环

| P0 | 修订 | 证据 | 状态 |
|---|---|---|---|
| 竞品观察过度声称 | 把 Computer 实测和用户补充/工程推导分节；不再继续浏览 | `02-competitor-analysis.md` | 文档已修复 |
| session/paid fixture 歧义 | `sessionId`=43-char base64url 256-bit bearer；内部为 `sessionRecordId`；标准 Bearer；demo_readonly；移除 revoke endpoint | `03`、`04`、`05`、`06` | 文档已修复 |
| 算法未冻结/示例错误 | 冻结 raw 分类、所有阈值/百分比/floor/cap/rounding/unavailable；70kg 黄金样例可复算 | `07-health-algorithm-validation.md`、`04-api-contract.md` | 文档已修复 |
| service role/RLS 信任边界 | RLS 只证明 public Data API fail-closed；RPC 同事务 session_hash→owner/scope，绝不接收 userId | `03`、`05`、`06`、`08` | 文档已修复，待实现证明 |
| 线上 fixture 误用 seed | seed 仅 local/CI；独立 provisioning/rotate script + full read/write-deny smoke | `05`、`10`、`13` | 文档已修复，待实现证明 |
| 两天范围超载 | Must/Stretch、15% buffer；移除扩展表/revoke/ready/自动 OpenAPI；两组 CI | `13-two-day-execution-plan.md` | 文档已修复 |
| GitHub/Docker/Vercel | 记录为实现前 Go/No-Go，不把计划文字当成外部状态已解决 | `12`、`13` | **仍阻塞实现** |

## P1 修订摘要

- 状态机精简为 `draft → ready → completed`；无不可达 abandoned/ready→draft。
- 不同 pay idempotency key 可产生 `activated`/`already_active` 两条 attempt；subscription 只首次激活且不续期；event 增加 assessment scope。
- DB trigger 保护 completed input/result immutable。
- health answers 不进 localStorage/sessionStorage。
- session reuse、7 天 absolute TTL、Cookie/Bearer 冲突、Origin 缺失、demo 30 天 rotation 均冻结。
- private repo 按用户要求保留，但交付前必须验证 reviewer access。
- strict parse 先于 canonicalization；key charset/length/TTL、stale ETag replay、错误不缓存均冻结。
- V1 删除 `improve_fitness`；定义 retention 与 cleanup dry-run。
- 增加四邮箱/命名/线上 fixture/retention R-ID。
- ACL 覆盖 tables/sequences/functions 与 object owner 审计；SECURITY INVOKER 明确只是事务封装。
- 新增可观测性/隐私/runbook 文档；日志采用 allowlist。

## 用户后续约束的处理

用户要求“全部功能完成后再统一写测试，并使用独立 agent”。这不是初稿的边写边测策略。最终计划接受该约束，同时采取三项缓解：

- 编码前冻结 OpenAPI、DB invariants 和算法 oracle；
- 功能阶段仍执行 format/typecheck/build 与最小人工 smoke，但不创建测试代码；
- Day 2 为独立 test agent 保留硬时间，第一轮真实失败由主 agent 修生产代码，不能削弱断言。

用户还要求同一 GitHub 库、根 README、前后端各自 README。最终采用单个 Next.js full-stack deployable：`src/app` 与 `src/server` 明确分层并各有 README，另有 `supabase/README.md`、`tests/README.md`，避免拆成两个服务增加 CORS/部署成本。

## 修订后外部状态复核（2026-09-21）

| 能力 | 权威检查 | 结果 |
|---|---|---|
| Local Git | `git status --branch` | `main` 已初始化，无 commit/remote |
| GitHub profile | GitHub connector `get_profile` | `RomanticD` / Junhua Di 可识别 |
| GitHub installation | `list_installed_accounts` + owner repo list | App 未装到 `RomanticD`，该 owner 0 可访问 repo |
| GitHub CLI | `gh auth status` | token invalid |
| Supabase | connector `get_project` | `kfyqgzuatywmsuruwsei` ACTIVE_HEALTHY |
| Docker | `docker info` | daemon unavailable |
| Vercel | connector `list_teams` | 0 teams |
| Playwright | tool inventory | browser plugin 已可调用 |

## 最终审查结论

**规划内容：Complete with documented constraints。** 原始需求、架构、API、DB、安全、算法、状态/并发、测试矩阵、UI、CI/部署、可观测性、AI 复盘和两天排期均有独立文档；第一轮所有内部设计 P0 已逐项处理。

**功能实现：No-Go until external preflight。** 必须先让 `RomanticD` 能创建/push private repo，并让 Vercel target 可见；Docker/local Supabase 需在进入集中测试前可用。Supabase 与 Playwright connector 已通过只读可用性检查。

第二轮独立复审在 agent quota 恢复后应再次运行；即使未运行，也不能降低上述外部 Go/No-Go 条件或测试门槛。

## Post-review preflight update

用户完成授权后，GitHub CLI OAuth 已成功，private `RomanticD/health-assessment-funnel` 已创建并推送；Docker 24.0.6 与 Vercel team `romanticds-projects` 也已确认。原 review 的外部阻塞记录保留为审计历史，不再代表当前 GitHub/Docker 状态。
