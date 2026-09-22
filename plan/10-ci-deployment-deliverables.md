# 10 · Git、CI、部署与最终交付

## Git 仓库策略

建议仓库名：`health-assessment-funnel`。名字直接表达实现内容，便于评审搜索和理解。

已执行策略：

- Owner：`RomanticD`。
- Visibility：仓库按当前 GitHub 设置维护；交付链接和 CI 均已通过实际访问验证。
- Default branch：`main`。
- 禁止提交 `.env*`、数据库密码、secret key、session token、真实健康数据。
- 每个关键里程碑验证后立即 commit + push，不堆成一个“大爆炸”提交。

当前事实：`main` 已连接 `origin/main`，关键实现与文档提交均已 push 到 `RomanticD/health-assessment-funnel`；最终绿色 CI run 记录在交付证据中。

## 建议提交序列

1. `docs(plan): add reviewed implementation plan`
2. `chore: scaffold strict Next.js project`
3. `feat(db): add assessment schema and least-privilege policies`
4. `feat(api): add anonymous session and progressive persistence`
5. `feat(domain): add versioned health assessment algorithm`
6. `feat(auth): gate results and add idempotent mock payment`
7. `test: cover boundaries concurrency and payment flow`
8. `feat(ui): add recoverable assessment funnel`
9. `ci: add full verification workflow`
10. `docs: finalize API deployment and AI retrospective`

每个提交前运行与改动成比例的测试；数据库/权限/支付属于高风险改动，必须跑完整相关集成测试。

## GitHub Actions

建议 workflow（MVP 合并为两个 job）：

```text
quality
  ├─ immutable pnpm install
  ├─ secret scan
  ├─ format + ESLint
  ├─ TypeScript
  ├─ unit/property tests
  └─ production build

integration-e2e
  ├─ start local Supabase
  ├─ fresh migration + seed
  ├─ DB/API/contract tests
  ├─ generated type drift check
  ├─ ACL/RLS/RPC security assertions
  ├─ start app against local Supabase
  ├─ Playwright funnel + pay flow
  └─ upload trace/screenshots on failure
```

主分支保护建议把两组设 required。README 放真实 CI badge，不使用静态假 badge。

## Supabase 部署

目标：Supabase project `kfyqgzuatywmsuruwsei`（`RomanticD's Project`）。

流程：

1. 固定 Supabase CLI devDependency。
2. 用 `supabase link --project-ref kfyqgzuatywmsuruwsei` 显式核对目标，不依赖模糊项目名。
3. 本地 migration 从空库重建。
4. 运行集成测试与 security/performance advisors。
5. 审查 SQL 和生成 types 的 diff。
6. Git commit/push 且 CI 全绿后，通过受控 milestone gate 执行同一 migration 的 `supabase db push`；普通 push 不自动碰生产库。
7. 部署后执行 `supabase migration list`，查询表/约束/`pg_default_acl`/grant/RLS，跑 advisors 与远端只读 smoke。

规划阶段不直接修改远端 schema；发布阶段使用版本化 migration，并通过 Supabase 只读查询与 Schema Visualizer 验证远端结果。临时 fixture rotation 只更新受控合成记录，不改 migration history。

## Vercel 部署

### 环境变量分类

Public：

- 仅确有浏览器需要时才使用 `NEXT_PUBLIC_*`。
- 本方案浏览器只访问 Next API，理论上无需公开 Supabase secret。

Server-only：

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`（或当前项目的等价 secret key）
- `APP_ORIGIN`
- 可选日志/observability 配置

session token 本身已经是 256-bit opaque credential，Cookie 只承载它，不再额外引入未使用的 `SESSION_COOKIE_SECRET`。

规则：Preview/Production 分开，值不写入仓库；部署日志不打印。

### 部署检查

- runtime 固定 Node 22。
- Route Handlers 访问个性化数据时显式 dynamic/no-store。
- `/api/health` 只返回进程 liveness；MVP 不新增公开 DB readiness endpoint。
- 生产 migration 完成后再切流量。
- 部署完成跑线上 cURL smoke 与 Playwright 最小闭环。

## 合成数据与已支付 session

- `supabase/seed.sql` 只用于本地/CI reset；不能假设 `db push` 或 GitHub integration 会把 seed 自动部署到线上。
- 线上使用受控 Supabase provisioning 流程，显式核对 project ref，创建或轮换合成 assessment/result/subscription 和只读 session；当前 rotation 记录在 `delivery/evidence/ci-and-production.md`。
- paid fixture 使用数据库中的 `app_users.kind = demo_readonly`；所有写 RPC 拒绝，不能被公开 token 任意改坏。
- README 给出 paid `sessionId`（256-bit bearer credential）、内部含义说明、对应 `assessmentId` 与读取命令，并明确标记它是刻意公开的合成测试凭证。
- 提供一条从新 session 自己完成 preview → `/pay` → full 的 cURL，确保不依赖固定 fixture。
- 发布前轮换测试 token并在线上实际执行 full read 与写入拒绝 smoke；记录 30 天过期时间。

## README 必须包含

1. 线上 URL、GitHub URL、CI badge。
2. 30 秒项目说明与架构图。
3. 前置条件、环境变量、启动命令。
4. 一键测试和各测试层说明。
5. API 总览与 OpenAPI 链接。
6. 可复制的完整 cURL，包括 Cookie jar/Authorization、If-Match、Idempotency-Key。
7. 已支付 session/assessment。
8. Mermaid ERD 与 migration 说明。
9. 算法公式、边界、非医疗声明。
10. 安全模型：session、RLS、ACL、CSRF、缓存、日志。
11. 已覆盖/未覆盖场景与理由。
12. 部署、回滚、已知限制。
13. AI 使用复盘与至少一个否决案例。

仓库根 `README.md` 是上述交付入口；`src/app/README.md`、`src/server/README.md`、`supabase/README.md`、`tests/README.md` 分别解释前端、后端、数据库和测试，不把核心说明散落成无法发现的文档。

## 最终交付清单

| 交付物 | 验收 |
|---|---|
| 公网 URL | 无登录可完整演示，桌面/移动可用 |
| GitHub repo | 清晰历史、README、Actions 绿色 |
| `/pay` cURL | 从新 session 可重放，重复调用安全 |
| paid sessionId | 合成、可访问 full、可轮换 |
| 自动化测试 | `pnpm test` / `pnpm verify` 通过 |
| CI | required jobs 绿色、badge 有效 |
| Schema 图 | Mermaid/图片可读，关系与约束说明 |
| API 文档 | 手工维护 OpenAPI 3.1、线上 Swagger UI、规范文件和可重放 cURL |
| AI 复盘 | 具体任务、校验、否决案例、局限 |
| 命名文档 | `Kindred-Health_delivery_YYYYMMDD.md`；外发前由交付人按收件要求改名 |

## 交付邮件

外发邮件由交付人最后发送至指定收件人；这是仓库外的沟通动作，不由本 agent 自动发送。发送前需要：

- 用户确认邮件署名和附件命名；
- 用户审阅最终正文和链接；
- 所有链接在无本地状态的环境重新验证。
- 按最终署名重命名摘要文件；当前仓库使用中性的 `Kindred-Health_delivery_20260922.md`，避免留下未替换的姓名占位符。

邮件内容建议只含项目摘要、线上链接、仓库、CI、paid session、文档附件/链接和已知限制，不发送任何 secret。

## 回滚

- App：Vercel 回滚到上一已知良好 deployment。
- DB：优先 forward-fix migration；不在生产执行破坏性 down migration。
- 若 migration 与 app 必须协同，先做向后兼容 schema，再部署 app，最后清理旧字段。
- paid fixture token 泄露/被污染时立即轮换，不影响真实用户（本项目无真人数据）。
