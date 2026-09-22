# Final requirements and plan review

审查日期：2026-09-22

## 审查方法

本轮按原始需求、`plan/` 设计文档和线上部署状态发起了三个只读审查方向：需求闭环、计划兑现、CI/Playwright。CI/Playwright 审查完成；另外两个 agent 在完成初步扫描后遇到当日 agent usage limit，因此没有把失败轮次伪称为独立通过。本文件只记录可复核的代码、测试、Supabase 查询和线上 smoke 证据。

## 原始交付要求

| 要求                                         | 结论   | 证据                                                                                                                                                                         |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15 题增量保存、刷新恢复、乱序/重复/并发      | 已完成 | `src/app/api/v1/assessments/[assessmentId]/funnel/route.ts`；`tests/integration/persistence-api.test.ts`、`tests/integration/funnel-api.test.ts`、`tests/e2e/funnel.spec.ts` |
| 服务端 BMI、建议摄入量、目标日期计算并持久化 | 已完成 | `src/server/domain/health-assessment-v1.ts`；`tests/unit/health-assessment-v1.test.ts`；submit RPC                                                                           |
| 非会员 preview 与会员 full 的结构化差异      | 已完成 | `src/server/domain/result-projection.ts`；`tests/integration/access-payment-api.test.ts` 递归检查保护字段                                                                    |
| `/pay` 状态闭环与幂等                        | 已完成 | `src/app/api/v1/pay/route.ts`；payment RPC；integration/E2E                                                                                                                  |
| 非法数值、年龄、目标方向、越界和缺失输入     | 已完成 | Zod + PostgreSQL CHECK；unit/integration 边界用例                                                                                                                            |
| 公网可演示、README cURL、已支付 session      | 已完成 | Vercel URL、根 README、`delivery/README.md`；只读 fixture 已在线 smoke                                                                                                       |
| ERD、API 文档、AI 复盘、测试范围             | 已完成 | `delivery/`、`docs/`、`plan/`                                                                                                                                                |

## 本轮修复

1. 公开 paid fixture 不再使用 `standard` 用户。由于 `app_users_enforce_identity` 明确禁止更新 `kind`，已创建新的 `demo_readonly` user/session/assessment/result/subscription/payment event，并把 README 凭证轮换到新记录。
2. 新 fixture 有效期为 30 天轮换窗口；线上查询确认 `kind=demo_readonly`、assessment `completed`、subscription `active`、payment event 仅一条。
3. 此前 README 中的 7 天 `standard` fixture 已在 Supabase 撤销；线上旧凭证返回 `401 SESSION_EXPIRED`，不会再成为可重放的污染入口。
4. Playwright 线上 smoke 确认新凭证能读 `access=full` 且包含 projection；create assessment 与 `/pay` 均返回 `403 DEMO_SESSION_READ_ONLY`。
5. submit 服务原先会先读 assessment，未知 ID 可能在 read-only session 上返回 404；现在先检查 session write capability，所有四类 mutation 都返回稳定 403。该场景加入真实 Supabase integration suite。
6. OpenAPI 补齐 `/assessments/{assessmentId}/funnel` GET/PUT，并删除 submit/pay 不实际返回的 201 响应。
7. GitHub Actions 的 Playwright job 现在安装 Chromium、运行真实 stack，并总是上传 report/results；CI 设置 `failOnFlakyTests`，E2E 使用 URL 事件等待代替固定 5 秒等待。
8. 根 README 已改为真实产品定位，去掉挑战/教育性 demo 的产品描述；支付仍明确标为测试环境激活，避免把模拟支付误述为真实支付渠道。

## CI / Playwright 结论

GitHub Actions 的 `integration-e2e` job 明确执行：

```text
pnpm exec playwright install --with-deps chromium
pnpm test:stack
```

本地 fresh stack 验证结果：47 unit tests、21 integration tests、2 Chromium E2E tests 均通过；最近一次 E2E 首次运行没有 retry/flaky。

修订 commit `6306d97` 的远端 run `35724751307` 中，quality job 已通过，integration 的 21 个 API tests 也已通过；唯一失败是 Chromium 首条测试在 CI 冷启动时超过 Playwright 默认 30 秒总测试预算，retry 后业务断言通过。为保留 `failOnFlakyTests` 的严格策略，已将 CI E2E 总预算提高到 60 秒，而不是允许 flaky 通过；本地复跑仍为首次 2/2 通过。

修复后的 commit `d6aed85` 对应 run `35725526106` 已全绿：quality 与 integration-e2e 均成功，21 个 integration tests 和 2 个 Chromium E2E 首次通过，没有 flaky retry。

## 仍属于计划中的生产强化项

以下项目不是原始挑战的必交功能，当前没有被伪称为已完成：可自动 rotate 的线上 fixture CLI、自动 cleanup dry-run、自动 advisor/ACL/type-drift 检查和真实支付 provider webhook。当前通过 forward-only migrations、Supabase 手工受控 provisioning、文档化 runbook 和 CI 核心门禁覆盖；如果进入长期生产运营，应继续补齐这些运维自动化。
