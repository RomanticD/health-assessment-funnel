# Database design

数据库 source of truth 是 [`supabase/migrations`](../supabase/migrations)。所有 DDL、约束、RPC 和 grant 都在 forward-only migration 中；Dashboard 不做不可追踪的 schema 修改。

## ERD

```mermaid
erDiagram
  APP_USERS ||--o{ ANONYMOUS_SESSIONS : owns
  APP_USERS ||--o{ ASSESSMENTS : owns
  ASSESSMENTS ||--|| ASSESSMENT_CORE_INPUTS : has
  ASSESSMENTS ||--o| ASSESSMENT_FUNNEL_ANSWERS : drafts
  ASSESSMENTS ||--o| ASSESSMENT_RESULTS : produces
  ASSESSMENT_RESULTS ||--|| ASSESSMENT_RESULT_DETAILS : has
  APP_USERS ||--o| SUBSCRIPTIONS : entitled_by
  APP_USERS ||--o{ PAYMENT_EVENTS : records
  ASSESSMENTS ||--o{ PAYMENT_EVENTS : paid_for
  APP_USERS ||--o{ IDEMPOTENCY_RECORDS : scopes
  ASSESSMENTS ||--o{ IDEMPOTENCY_RECORDS : optionally_scopes

  APP_USERS {
    uuid id PK
    text kind "standard|demo_readonly"
    timestamptz created_at
    timestamptz updated_at
    timestamptz last_seen_at
  }
  ANONYMOUS_SESSIONS {
    uuid id PK
    uuid user_id FK
    bytea token_hash UK
    timestamptz expires_at
    timestamptz revoked_at
  }
  ASSESSMENTS {
    uuid id PK
    uuid user_id FK
    text quiz_version
    text status "draft|ready|completed"
    bigint revision
    timestamptz submitted_at
  }
  ASSESSMENT_CORE_INPUTS {
    uuid assessment_id PK_FK
    text sex_for_calorie_estimation
    text primary_goal
    smallint age_years
    numeric height_cm
    numeric weight_kg
    numeric target_weight_kg
    text activity_level
  }
  ASSESSMENT_RESULTS {
    uuid id PK
    uuid assessment_id UK_FK
    text algorithm_version
    bigint input_revision
    jsonb input_snapshot
    numeric bmi
    text bmi_category
    int calorie_range_min
    int calorie_range_max
    boolean calorie_estimate_available
    jsonb warnings
  }
  ASSESSMENT_RESULT_DETAILS {
    uuid result_id PK_FK
    int bmr_kcal
    int tdee_kcal
    int exact_daily_calories
    date target_date
    jsonb weight_projection
  }
  SUBSCRIPTIONS {
    uuid id PK
    uuid user_id UK_FK
    text status
    text plan_code
    timestamptz valid_from
    timestamptz valid_until
    bigint revision
  }
  PAYMENT_EVENTS {
    uuid id PK
    uuid user_id FK
    uuid assessment_id FK
    text provider_event_id UK
    text idempotency_key
    text outcome
  }
  IDEMPOTENCY_RECORDS {
    uuid id PK
    uuid user_id FK
    uuid assessment_id FK
    text scope
    text key
    bytea request_hash
    jsonb replay_payload_minimal
    timestamptz expires_at
  }
```

## Why these boundaries

`app_users` 是匿名业务主体，不保存姓名、邮箱、IP 或完整 User-Agent。`anonymous_sessions` 只保存 256-bit token 的 SHA-256 digest；明文只在 session 创建响应出现一次。

`assessments` 只保存生命周期与 revision，`assessment_core_inputs` 保存核心强类型答案。这样 draft 可以有 nullable 字段，但每个非空值仍受到数据库范围、方向、比例和目标 BMI 约束。扩展问题未来可以单独 version，不需要把核心测量值降级为无约束 JSONB。

结果采用 basic/details 物理拆表：preview 查询 basic，订阅有效后才读取 details。TypeScript 同时使用两个独立 strict DTO allowlist，降低新增字段意外泄漏的风险。

`subscriptions` 表示当前 entitlement；`payment_events` 是 append-only attempt audit。`idempotency_records` 只保存 request hash、resource reference 和最小重放 payload，不复制 session token、完整答案或完整结果。

## Lifecycle invariants

```text
draft --all inputs complete--> ready --atomic submit--> completed
```

- 同一 user + quiz version 最多一个 `draft/ready` assessment。
- `revision` 每次成功业务修改恰好 +1；completed 记录不可再修改。
- draft 必须不完整；ready/completed 必须拥有完整合法 inputs。
- completed 必须同时拥有 basic result 与 details；draft/ready 不得拥有 result。
- result 与 result details append-only，input snapshot + algorithm version 固化计算语义。
- payment 必须指向同一 owner 的 completed assessment。
- 相同 session、scope、idempotency key 唯一；同 key 不同 hash 永久拒绝。

这些规则不只存在于 TypeScript：CHECK、FK、partial unique index、mutation trigger 和 deferred constraint trigger 在事务提交时再次证明状态一致。

## Public Data API and RLS

- 九张 public 业务表全部启用 RLS。
- `anon`/`authenticated` 没有业务表或 RPC grant，也没有浏览器 policy；公开 Data API fail closed。
- server secret 映射的角色可 bypass RLS，因此真正的 BOLA 边界在事务 RPC：接收 session hash，解析 owner，再在同一事务验证 owner/revision/idempotency。
- RPC 不接收客户端 `userId`、subscription status、计算结果或算法版本。
- 函数使用 `SECURITY INVOKER SET search_path = ''`，对象名全限定，execute grant 按签名显式给 server role。

RLS advisor 会把“RLS 已启用但无 policy”列为 INFO；本项目这是刻意的 server-only 模式，不是遗漏。

## Indexes and retention

索引覆盖 session hash、session expiry、active assessment、owner recent progress、assessment result、active entitlement、payment ownership、idempotency expiry/FK。新建空库会暂时收到 unused-index INFO，产生真实流量后再根据 `pg_stat_user_indexes` 判断，不能因为空库统计就删除约束/热路径索引。

建议留存：普通 session 7 天有效；幂等记录 24 小时；未完成 assessment 30 天；演示 completed 数据 90 天。自动清理不是本挑战的公开 API，也不在仓库里假称已经调度。

## Verified deployment evidence

- 本地空库 `supabase db reset` 成功。
- DB smoke 覆盖 session、create/save、乱序、stale revision、重放冲突、submit、preview/pay/full 和最小幂等 payload。
- 本地 advisor warn/error：`No issues found`。
- 远端 migration：`20260922002212_initial_health_assessment_schema`。
- 远端检查：9 张 public tables、10 个 `rpc_*`、所有 public tables `relrowsecurity = true`。
