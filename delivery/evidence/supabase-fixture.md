# Supabase paid fixture rotation

核验日期：2026-09-22  
Project ref：`kfyqgzuatywmsuruwsei`

## 轮换结果

公开的 paid session 已从旧的 `standard` 记录轮换为独立的 `demo_readonly` 记录。新记录只包含合成答案和结果：

| 字段                         | 当前值                                        |
| ---------------------------- | --------------------------------------------- |
| `sessionId`                  | `Cm4dsRc3ybdSeNc3CPYuHVumgLi4HLQ6lnWy_s0eOAY` |
| `assessmentId`               | `2378aded-3fab-4ed5-a958-ac73d09dddad`        |
| `app_users.kind`             | `demo_readonly`                               |
| assessment                   | `completed`                                   |
| subscription                 | `active`                                      |
| payment events               | `1`                                           |
| `expires_at` / `valid_until` | `2026-10-22T11:46:35Z`                        |

Supabase 只保存 session token 的 SHA-256 digest；明文凭证只出现在这份公开验收文档和创建响应中。新 fixture 的 30 天窗口与普通 session 的 7 天 TTL 分离，避免公开验收链接因普通 session 策略过早失效。

## 数据库强制只读

`demo_readonly` guard 位于每个写事务 RPC，而不是只依赖前端或 route。真实集成测试 [access-payment-api.test.ts](../../tests/integration/access-payment-api.test.ts) 为 `demo_readonly` 创建 session，并并发验证以下四类写入均返回 `403 DEMO_SESSION_READ_ONLY`：

- `POST /api/v1/assessments`
- `PUT /api/v1/assessments/{id}/steps/{stepKey}`
- `POST /api/v1/assessments/{id}/submit`
- `POST /api/v1/pay`

同一 fixture 的结果读取仍返回 `access: "full"`，因此评审者可以读取会员字段，但不能污染 assessment、订阅或支付审计记录。线上 smoke 与当前凭证、过期时间记录在 [ci-and-production.md](./ci-and-production.md)。

## 旧凭证处理

README 曾公开的旧 token 属于 `standard` 用户、7 天 session。轮换时已在 Supabase 设置 `revoked_at`；旧 token 现在返回 `401 SESSION_EXPIRED`，不会再拥有读取或写入能力。Git 历史中的旧字符串不作为当前交付凭证。

## 受控操作边界

本次只更新受控合成 fixture 的数据记录，没有把 secret/service key、明文 token 或健康数据写入 migration、seed、日志或前端 bundle。下一次轮换必须先完成：新记录 full read、四类写入拒绝、README 更新，再撤销旧记录。
