# Health Assessment Funnel — 项目规划索引

> 仓库建议名：`health-assessment-funnel`
> 规划基线日期：2026-09-21（Asia/Shanghai）
> 当前阶段：仅规划与环境审计；尚未修改 Supabase 远端 Schema，尚未开始实现

## 目标

在 2 天硬截止内交付一个可公开演示的健康测评漏斗。系统必须证明的不只是页面可点通，而是以下链路在工程上闭环：

```text
匿名会话 → 分步保存 → 中断恢复 → 服务端计算 → 结果持久化
          → 非会员脱敏 → 模拟支付 → 会员完整结果
```

质量证据必须随代码一起交付：数据库迁移、API 契约、自动化测试、CI、线上 smoke 结果、Schema 图和 AI 协作复盘。

## 已确定的默认方案

- Next.js App Router + TypeScript strict，单仓部署，后端使用 Route Handlers。
- Supabase 托管 PostgreSQL；目标是 `Full Stack Demo` 组织下的 `RomanticD's Project`（项目 ref 仅记录在本地环境配置，不写入公开文档）。
- 使用高熵匿名会话 token，不要求用户注册；浏览器以安全 Cookie 携带，cURL 可用 `Authorization` 头。
- 所有业务表启用 RLS，撤销 `anon` / `authenticated` 的表级默认权限；浏览器不直连业务表。
- 核心输入采用强类型列，扩展问卷才用 JSONB。
- `PUT step + If-Match + Idempotency-Key` 明确定义乱序、重复和并发行为。
- 计算结果版本化并持久化；非会员与会员使用两个显式 DTO，保护字段在非会员 JSON 中完全不存在。
- Vitest 覆盖单元与集成，Playwright 覆盖浏览器闭环，GitHub Actions 执行完整门禁。
- Vercel 部署；真实支付、后台、复杂账号体系不在本次范围。

其中题面所称 `sessionId` 是 **256-bit 不透明 bearer credential**，不是数据库中的 session UUID。数据库内部 UUID 统一称 `sessionRecordId`，对外不作为身份凭证。公开的已支付 fixture 使用独立 `demo_readonly` 身份，只能读取其固定结果，任何保存、提交、支付或撤销写入都会在数据库事务入口被拒绝。

## 规划文档

| 文件 | 内容 |
|---|---|
| [00-executive-summary.md](./00-executive-summary.md) | 项目范围、成功标准、关键决策 |
| [01-requirements-traceability.md](./01-requirements-traceability.md) | 题目需求到设计与验收证据的映射 |
| [02-competitor-analysis.md](./02-competitor-analysis.md) | BetterMe 交互观察及可借鉴/不照搬部分 |
| [03-architecture-and-decisions.md](./03-architecture-and-decisions.md) | 系统架构、模块边界、技术选型与 ADR |
| [04-api-contract.md](./04-api-contract.md) | REST API、错误模型、缓存与鉴权约定 |
| [05-database-schema-security.md](./05-database-schema-security.md) | 表结构、ERD、约束、RLS 与迁移策略 |
| [06-state-concurrency-idempotency.md](./06-state-concurrency-idempotency.md) | 状态机、恢复、乱序、并发、幂等 |
| [07-health-algorithm-validation.md](./07-health-algorithm-validation.md) | 公式、边界、版本化、非医疗声明 |
| [08-testing-quality-strategy.md](./08-testing-quality-strategy.md) | 单元/集成/E2E/安全测试与 CI 门禁 |
| [09-frontend-funnel-plan.md](./09-frontend-funnel-plan.md) | 漏斗体验、状态、无障碍与基础视觉 |
| [10-ci-deployment-deliverables.md](./10-ci-deployment-deliverables.md) | Git、CI、Supabase/Vercel、交付清单 |
| [11-ai-collaboration-plan.md](./11-ai-collaboration-plan.md) | AI 使用方法、证据记录与否决案例 |
| [12-risk-register-open-decisions.md](./12-risk-register-open-decisions.md) | 风险、阻塞、假设与待确认事项 |
| [13-two-day-execution-plan.md](./13-two-day-execution-plan.md) | 两天分阶段执行与退出标准 |
| [14-observability-privacy-operations.md](./14-observability-privacy-operations.md) | 日志脱敏、健康检查、隐私、runbook 与 release 证据 |
| [99-agent-review.md](./99-agent-review.md) | 独立 agent 对本计划的审查和修订记录 |

## 进入实现的门槛

1. 需求矩阵无遗漏，review 中 P0 问题清零。
2. GitHub 远端认证恢复，能保证每个关键提交及时 push。
3. Supabase 目标项目再次核对且仍为空库；不在规划阶段直接改远端。
4. 数据边界、session 策略、`/pay` demo 语义冻结。
5. 本地 Docker 可用，或明确备用的集成测试数据库方案。

当前第 2、5 项仍是实现阶段的外部 Go/No-Go 条件：GitHub 凭证失效且 Docker daemon 未启动。规划文档可以本地提交，但在恢复远端 push 和真实测试数据库前，不宣称实现链路可交付。

## 事实与假设

- 题面标题和交付要求写“2 天”，末尾又出现“3 天节奏”。本计划把 **2 天作为硬截止**，将 3 天段落视为旧文案残留。
- UI 不是评分中心，但必须达到真实用户愿意完成流程的基础标准。
- 所有演示数据均为合成数据，不收集或提交真实健康信息。
- 算法是产品演示估算，不是诊断、治疗或营养处方。
