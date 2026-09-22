# Kindred Health · 交付验收入口

> 交付日期：2026-09-22 · 版本基线：`main`

这是项目的 release verification package。所有健康数据均为合成数据；浏览器 session 使用 HttpOnly Cookie，URL 不承载 bearer credential、支付凭证或健康数值。

## 线上与仓库

- 线上应用：[health-assessment-funnel.vercel.app](https://health-assessment-funnel.vercel.app)
- 结果访问与 checkout 页面：[打开固定结果页面](https://health-assessment-funnel.vercel.app/demo/paywall)（固定合成数据，不写入 Supabase）
- GitHub：https://github.com/RomanticD/health-assessment-funnel
- 健康检查：https://health-assessment-funnel.vercel.app/api/health
- API reference（Swagger UI）：https://health-assessment-funnel.vercel.app/api-docs
- OpenAPI 3.1：<https://health-assessment-funnel.vercel.app/openapi.yaml>

## 评审者 5 分钟路径

1. 打开公网链接，点击 `Find my starting point`，完成 15 道题。
2. 结果页先展示可读的免费预览；顶部 sticky 入口显示 `YOUR PERSONAL PLAN` 和 `Unlock your full summary`，内容内也保留 `See your full summary`，无需猜测付费入口。
3. 打开弹窗，确认 `No card · No charge · No renewal`，点击 `Unlock full summary — no charge`。
4. 支付后页面重新读取结果，徽标变为 `Your full summary`，出现完整能量数值和带绘制动画的目标曲线。
5. 刷新结果页，full entitlement 仍然有效。

## 结果访问与 checkout URL

如果只需要检查付费弹窗、按钮状态和 preview/full 差异，不必重新填写 15 题：

```text
https://health-assessment-funnel.vercel.app/demo/paywall
```

这个页面使用固定的合成结果数据，打开后会显示 `YOUR PERSONAL PLAN` 和 `Unlock your full summary`。点击后可以检查 checkout 弹窗，再点击 `Unlock full summary — no charge` 查看完整结果布局。该页面只验证前端呈现，不创建 session、不调用支付接口，也不会修改 Supabase；真实后端闭环仍按上面的 5 分钟路径或 pre-authorized session 验证。

## 已支付 session（只读 fixture）

这是可重放的合成凭证，不是 Supabase key，也不应被用于真实用户。它由 `demo_readonly` 数据库角色绑定，所有保存、提交、支付写入都会在事务 RPC 层拒绝。

```text
sessionId:   Cm4dsRc3ybdSeNc3CPYuHVumgLi4HLQ6lnWy_s0eOAY
assessmentId: 2378aded-3fab-4ed5-a958-ac73d09dddad
expiresAt:   2026-10-22T11:46:35Z
```

读取完整结果：

```bash
export BASE_URL=https://health-assessment-funnel.vercel.app
export SESSION_ID='Cm4dsRc3ybdSeNc3CPYuHVumgLi4HLQ6lnWy_s0eOAY'
export ASSESSMENT_ID='2378aded-3fab-4ed5-a958-ac73d09dddad'

curl --fail-with-body "$BASE_URL/api/v1/assessments/$ASSESSMENT_ID/result" \
  -H "Authorization: Bearer $SESSION_ID" | jq
```

响应应包含 `access: "full"`、`bmrKcal`、`tdeeKcal`、`exactDailyCalories`、`targetDate` 和 `weightProjection`。使用另一个未付费 session 读取同类 assessment 时，响应只允许 `access: "preview"` 与 `lockedFeatures`。

## `/pay` 可重放闭环

对新 session 的完整 cURL（先完成四个核心 step 并提交，再支付）见 [docs/api.md](../docs/api.md)。固定 plan 只接受 `demo_monthly`，每个写请求必须提供稳定的 `Idempotency-Key`；重复同 key 同 body 是安全重放，不会重复延长订阅。

浏览器中的按钮调用的就是同一接口：`POST /api/v1/pay` → 重新 `GET /api/v1/assessments/{assessmentId}/result`。UI 从服务端 `access` 字段决定 preview/full，不在客户端自行设置订阅状态。

## 交付物索引

| 交付项                          | 证据                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公网链接、GitHub、paid session  | 本页顶部与 paid fixture 区块                                                                                                                                                                                                                |
| API 文档与 cURL                 | [在线 Swagger UI](https://health-assessment-funnel.vercel.app/api-docs)、[OpenAPI 3.1](https://health-assessment-funnel.vercel.app/openapi.yaml)、[docs/api.md](../docs/api.md)、[evidence/api-and-payment.md](evidence/api-and-payment.md) |
| 15 题分步保存/恢复              | [evidence/requirements-matrix.md](evidence/requirements-matrix.md)、[src/components/quiz/personal-quiz.tsx](../src/components/quiz/personal-quiz.tsx)                                                                                       |
| 订阅鉴权与差异化结果            | [evidence/api-and-payment.md](evidence/api-and-payment.md)、[tests/integration/access-payment-api.test.ts](../tests/integration/access-payment-api.test.ts)、[tests/e2e/funnel.spec.ts](../tests/e2e/funnel.spec.ts)                        |
| 自动化测试总览与一键命令        | [evidence/test-delivery.md](evidence/test-delivery.md)、[tests/README.md](../tests/README.md)                                                                                                                                               |
| Unit / domain 测试              | [tests/unit/](../tests/unit/)、[evidence/test-map.md](evidence/test-map.md)                                                                                                                                                                 |
| Supabase integration / API 测试 | [tests/integration/](../tests/integration/)、[tests/support/with-test-stack.mjs](../tests/support/with-test-stack.mjs)                                                                                                                      |
| Playwright 浏览器测试           | [tests/e2e/funnel.spec.ts](../tests/e2e/funnel.spec.ts)、[playwright.config.ts](../playwright.config.ts)、[evidence/test-delivery.md](evidence/test-delivery.md)                                                                            |
| GitHub Actions 配置与通过证据   | [.github/workflows/ci.yml](../.github/workflows/ci.yml)、[evidence/ci-and-production.md](evidence/ci-and-production.md)、[CI run #35739988212](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35739988212)              |
| 测试场景映射与边界说明          | [evidence/test-map.md](evidence/test-map.md)                                                                                                                                                                                                |
| 数据库 Schema 图                | [schema/assessment-erd.md](schema/assessment-erd.md)、[schema/supabase-schema-visualizer.md](schema/supabase-schema-visualizer.md)、[docs/database.md](../docs/database.md)                                                                 |
| CI / 部署 / smoke               | [evidence/ci-and-production.md](evidence/ci-and-production.md)                                                                                                                                                                              |
| Supabase fixture 轮换与拒写证据 | [evidence/supabase-fixture.md](evidence/supabase-fixture.md)                                                                                                                                                                                |
| AI 使用复盘                     | [docs/ai-retrospective.md](../docs/ai-retrospective.md)、[evidence/ai-review.md](evidence/ai-review.md)                                                                                                                                     |
| UI 验收与参考图                 | [evidence/ui-acceptance.md](evidence/ui-acceptance.md)、[references/](references/)                                                                                                                                                          |

## URL 与隐私边界

链接恢复策略采用同浏览器恢复，而不是把 session 当作 URL token：

- 题目 URL 只表达当前导航，例如 `/quiz/ageYears`、`/quiz/review`。
- 结果 URL 可以包含 assessment UUID，但 UUID 不是授权凭证；服务端仍要求当前浏览器的 HttpOnly session。
- 新浏览器或无 Cookie 复制链接时，结果接口返回统一的 session-required / private-session 文案，不能读取健康数据。
- `sessionId`、`order`、支付幂等 key、订阅状态、年龄、身高、体重和完整答案不进入 URL、localStorage 或 sessionStorage。
- 若未来需要跨设备分享，应新增短期、一次性、可撤销的 signed resume token；本产品不使用 assessment UUID 冒充授权。

## 已知边界

Kindred Health 当前提供 wellness 估算与测试环境 checkout，不构成医疗诊断，也不连接外部收费渠道。目标日期和热量是服务端估算，不能替代医生或注册营养师意见；公开 paid fixture 是合成只读数据，按到期时间轮换。
