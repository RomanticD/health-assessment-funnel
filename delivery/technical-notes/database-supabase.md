# 数据库与 Supabase 技术难点

## 1. Migration-first source of truth

数据库结构只通过 forward-only migration 管理：

- [`20260922002212_initial_health_assessment_schema.sql`](../../supabase/migrations/20260922002212_initial_health_assessment_schema.sql) 建立主体、session、assessment、结果、订阅、支付、幂等、约束、trigger 和事务 RPC；
- [`20260922015929_expanded_funnel_answers.sql`](../../supabase/migrations/20260922015929_expanded_funnel_answers.sql) 为 15 题 UI 增加答案扩展表和核心答案一致性 trigger。

Dashboard 只用于观察和截图，不作为不可追踪的 DDL 编辑入口。完整可视化见 [ERD](../schema/assessment-erd.md) 和 [Supabase schema snapshot](../schema/supabase-schema-visualizer.md)。

## 2. 表关系与为什么这样拆

```text
app_users
  ├── anonymous_sessions (credential digest, TTL/revocation)
  ├── assessments ── assessment_core_inputs
  │                  ├── assessment_funnel_answers
  │                  └── assessment_results ── assessment_result_details
  ├── subscriptions (current entitlement)
  ├── payment_events (append-only audit)
  └── idempotency_records (bounded replay metadata)
```

### 主体与 session

`app_users` 是匿名业务主体，不保存姓名、邮箱、IP 或完整 User-Agent。`anonymous_sessions` 只存 SHA-256 digest，并通过 `user_id` 关联 owner。`token_hash` 长度 CHECK、过期 CHECK、撤销规则和不可变 identity trigger 防止 session 被替换或恢复。

### assessment 与输入

`assessments` 只保存 lifecycle、quiz version、revision 和更新时间；`assessment_core_inputs` 用强类型 numeric/smallint/text 保存算法关键字段。这样年龄、身高、体重、目标体重和运动等级可以同时受到 Zod、RPC 和 PostgreSQL CHECK 保护，而不是全都退化成不可查询的 JSONB。

`assessment_funnel_answers` 专门保存逐题 UI 答案；它允许未来扩展题目，而不会把核心计算字段的约束稀释掉。第二个 migration 的 trigger 在 assessment 转 completed 时检查 funnel 答案没有与 core inputs 分叉。

### 结果 basic/details 物理分区

这是权限边界，不只是性能优化：

- `assessment_results` 只放 BMI、category、calorie range、warnings 等 preview-safe 值；
- `assessment_result_details` 才放 raw energy values、exact daily calories、target date 和 projection；
- 两个表都有 immutable trigger，结果创建后不允许 update/delete（父级级联删除除外）；
- deferred consistency trigger 要求 completed assessment 在事务提交时同时拥有 basic 和 details，draft/ready 不允许残留结果。

这样 preview RPC 根本不读取 protected details，避免“先查完整 row 再 delete 字段”造成字段、日志或缓存泄漏。

### subscription、payment、idempotency

- `subscriptions` 一位 user 一行，revision 单调递增，active lookup 有 partial index；当前 entitlement 不放 JWT 或用户 metadata。
- `payment_events` 是 provider=`mock` 的 append-only audit，owner composite FK 确保 event 的 assessment 属于同一个 user；provider event id 和 user/idempotency key 都唯一。
- `idempotency_records` 绑定 owner 和可选 assessment，request hash 必须 32 bytes，replay payload 限制 8192 bytes，过期窗口不超过约 25 小时；不复制 session token、完整答案或结果。

## 3. 数据库状态不变量

这些规则分别由 CHECK、partial unique index、trigger、deferred constraint trigger 和 RPC 共同保证：

```text
draft --all core inputs complete--> ready --atomic submit--> completed
```

- 同一 user + quiz version 最多一个 draft/ready assessment；
- 每次成功 mutation 让 assessment revision 恰好 `+1`；completed identity、inputs 和结果不可改；
- draft 必须不完整，ready/completed 必须拥有全部核心输入；
- completed 必须有 basic result + details，非 completed 不得有 result；
- assessment、payment、idempotency 的 owner 通过 composite FK / RPC session resolution 绑定，客户端不能提交任意 user id；
- 目标变化最多当前体重 40%，并按目标方向和目标 BMI 做数据库级检查；
- projection JSONB 只允许每周连续日期、有限点数、有限体重范围和小于 48 KiB 的 payload。

数据库重复做应用层已经做过的验证，是为了应对未来新增 server caller、migration bug 或受限角色误用，而不是假设 TypeScript 永远是唯一入口。

## 4. RPC 事务边界

浏览器和 public Data API 没有业务表权限；Next.js server 通过 secret-backed Supabase client 调用显式 grant 的 RPC。每个 owner-sensitive RPC 都接收 session digest，调用 `app_private.resolve_session()` 在同一事务解析 user；RPC 不接收客户端 user id、subscription status、计算结果或 algorithm version。

| RPC                                                    | 事务职责                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `rpc_create_anonymous_session` / `rpc_resolve_session` | 建立或解析 session、检查 expiry/revocation、返回 user kind                                     |
| `rpc_create_or_get_assessment`                         | 通过 active partial unique index 复用或创建 draft，并写 create 幂等记录                        |
| `rpc_get_current_assessment` / `rpc_get_assessment`    | owner-scoped 恢复进度，不泄露其他 session 的 UUID                                              |
| `rpc_save_assessment_step`                             | lock assessment、检查 step 顺序/输入范围/revision/read-only、原子更新 core + answer + revision |
| `rpc_fetch_ready_inputs`                               | 只给已完成且 owner 匹配的 assessment 供服务端计算                                              |
| `rpc_finalize_assessment`                              | lock、replay check、写 basic/details、更新 completed、写最小 submit replay                     |
| `rpc_get_assessment_result`                            | 实时查询 entitlement，返回 preview 或 full 的结构化 row                                        |
| `rpc_simulate_payment`                                 | lock subscription、校验 completed、写 payment event 和 active subscription、记录 pay replay    |

函数统一 `SECURITY INVOKER SET search_path = ''`，使用全限定对象名；`app_private` schema 与 public table 默认权限均收紧。公开 session 的 `demo_readonly` 判断在所有 mutation RPC 和 submit service preflight 中重复执行，fixture 不会被线上验收者污染。

## 5. RLS / ACL 设计

九张 public 业务表全部启用 RLS，但没有给 `anon`/`authenticated` 添加业务 policy 或 table grant。这是刻意的 server-only、fail-closed 模式：

1. 浏览器 publishable key 无法直接 select/insert/update；
2. Route Handler 只用 server secret 调用受限 RPC；
3. RPC 自己解析 token digest、owner、revision、idempotency 和状态；
4. `app_private` helper 不暴露给浏览器。

Supabase advisor 对“RLS enabled without policy”给出 INFO 是此架构的预期信号，不是漏配；schema screenshot、远端 catalog 检查和无业务 grant 的 integration test 共同证明这一点。unused-index INFO 也只表示空库统计尚未产生真实读流量，不能据此删除 session、owner 和 active entitlement 热路径索引。

## 6. 索引与删除/留存

索引覆盖 session hash/expiry、assessment owner + updated_at、active assessment partial unique、result owner、active entitlement、payment owner 和 idempotency expiry/FK。索引选择优先支持每次请求都会执行的 owner/active lookup，而不是为了空库 advisor 的零 unused index 分数。

当前留存边界：普通 session 7 天、idempotency 约 24 小时、未完成 assessment 30 天建议、合成 completed 数据 90 天建议。清理任务不是公开 API，当前文档只把它列为运维 runbook 范围，不伪称已经有自动 scheduler。

## 7. fixture 与生产安全

公开已支付 fixture 是单独的 `demo_readonly` user kind，真实数据库状态为 completed + active subscription + payment event；GET result 可读取 full，create/step/submit/pay 写入均在 RPC 层返回 `DEMO_SESSION_READ_ONLY`。fixture token 30 天轮换，不与普通 7 天 session 混用；旧 token 已 revoke 并返回 401。

Supabase secret 只在 Vercel server environment/local test stack 中使用，根目录 `.env.example` 只给占位符。截图和文档中不放 secret、publishable key 或明文数据库连接串。

## 8. 验证证据

- 空库 `supabase db reset` 应能从零应用两份 migration；
- integration suite 通过真实 HTTP + 本地 PostgreSQL 验证乱序、重复、并发、BOLA、RLS fail-closed、preview/full、pay 和 readonly fixture；
- [database.md](../../docs/database.md) 记录完整字段、CHECK、RPC、RLS 和索引解释；
- [supabase-fixture.md](../evidence/supabase-fixture.md) 记录远端只读 fixture 的查询与拒写证据；
- [ci-and-production.md](../evidence/ci-and-production.md) 记录 advisor、Vercel smoke 和 release commit。
