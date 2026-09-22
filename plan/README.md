# Health Assessment Funnel — 项目规划索引

> 仓库：`health-assessment-funnel`
> 规划基线日期：2026-09-21（Asia/Shanghai）
> 当前状态：实现、部署和交付验收已完成（2026-09-22）。本目录保留设计决策与执行记录；最终状态以 [`delivery/README.md`](../delivery/README.md) 和 [`delivery/evidence/requirements-matrix.md`](../delivery/evidence/requirements-matrix.md) 为准。

## 目标

在 2 天硬截止内交付一个可公开演示的健康测评漏斗。系统必须证明的不只是页面可点通，而是以下链路在工程上闭环：

```text
匿名会话 → 分步保存 → 中断恢复 → 服务端计算 → 结果持久化
          → 非会员脱敏 → 模拟支付 → 会员完整结果
```

质量证据必须随代码一起交付：数据库迁移、API 契约、自动化测试、CI、线上 smoke 结果、Schema 图和 AI 协作复盘。

## 已确定的默认方案

- Next.js App Router + TypeScript strict，单仓部署，后端使用 Route Handlers。
- Supabase 托管 PostgreSQL；当前项目 ref 为 `kfyqgzuatywmsuruwsei`。
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

## 实现门槛（已关闭）

1. ✅ 需求矩阵无遗漏，P0 入口、preview/full、只读 fixture 和支付闭环已通过代码与线上 smoke。
2. ✅ GitHub `main` 已建立并持续 push；关键提交对应绿色 Actions run。
3. ✅ Supabase 远端 migration 已执行，RLS/ACL/RPC 与 Schema Visualizer 已核验。
4. ✅ 数据边界、session 策略、固定测试 plan 和 `/pay` 幂等语义已冻结。
5. ✅ 本地 Docker/Supabase stack 与 CI fresh stack 均可运行。

实现阶段已结束；不要把本页的原始门槛误读成当前未完成项。

## 事实与假设

- 题面标题和交付要求写“2 天”，末尾又出现“3 天节奏”。本计划把 **2 天作为硬截止**，将 3 天段落视为旧文案残留。
- UI 不是评分中心，但必须达到真实用户愿意完成流程的基础标准。
- 所有演示数据均为合成数据，不收集或提交真实健康信息。
- 算法是产品演示估算，不是诊断、治疗或营养处方。
