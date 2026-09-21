# 05 · 数据库 Schema、约束与安全

## Supabase 基线

- `Full Stack Demo` 是 organization；其中唯一可用项目是 `RomanticD's Project`，ref 为非密钥项目标识 `kfyqgzuatywmsuruwsei`。
- 项目为 `ACTIVE_HEALTHY`，PostgreSQL 17.6，规划审计时无业务表、migration、branch 或 Edge Function。
- advisor 暂无告警只是因为数据库为空，不能视为安全证明。
- `public` 默认 ACL 仍较宽；首个 migration 必须先改 default privileges，再创建业务对象并显式 grant。
- 不创建按小时计费的 Supabase preview branch；本地 Supabase + CI 验证后才部署主项目。

## ERD（MVP）

```mermaid
erDiagram
    APP_USERS ||--o{ USER_SESSIONS : owns
    APP_USERS ||--o{ ASSESSMENTS : completes
    ASSESSMENTS ||--|| ASSESSMENT_CORE_INPUTS : has
    ASSESSMENTS ||--o| ASSESSMENT_RESULTS : produces
    ASSESSMENT_RESULTS ||--o| ASSESSMENT_RESULT_DETAILS : protects
    APP_USERS ||--o| SUBSCRIPTIONS : entitled_by
    APP_USERS ||--o{ PAYMENT_EVENTS : attempts
    ASSESSMENTS ||--o{ PAYMENT_EVENTS : pays_for
    APP_USERS ||--o{ IDEMPOTENCY_RECORDS : scopes
    ASSESSMENTS ||--o{ IDEMPOTENCY_RECORDS : optionally_scopes

    APP_USERS {
      uuid id PK
      text kind "standard|demo_readonly"
      timestamptz created_at
      timestamptz last_seen_at
    }
    USER_SESSIONS {
      uuid id PK "internal sessionRecordId"
      uuid user_id FK
      bytea token_hash UK
      timestamptz expires_at
      timestamptz revoked_at
      timestamptz created_at
    }
    ASSESSMENTS {
      uuid id PK
      uuid user_id FK
      text quiz_version
      text status "draft|ready|completed"
      bigint revision
      timestamptz submitted_at
      timestamptz created_at
      timestamptz updated_at
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
      jsonb input_snapshot
      numeric bmi
      text bmi_category
      int calorie_range_min_nullable
      int calorie_range_max_nullable
      boolean calorie_estimate_available
      jsonb warnings
      timestamptz calculated_at
    }
    ASSESSMENT_RESULT_DETAILS {
      uuid result_id PK_FK
      int bmr_kcal
      int tdee_kcal
      int exact_daily_calories_nullable
      date target_date_nullable
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
      text provider
      text provider_event_id
      text idempotency_key
      text outcome "activated|already_active"
      timestamptz processed_at
    }
    IDEMPOTENCY_RECORDS {
      uuid id PK
      uuid user_id FK
      uuid assessment_id FK_nullable
      text scope
      text key
      bytea request_hash
      text resource_type_nullable
      uuid resource_id_nullable
      int response_status
      jsonb replay_payload_minimal
      timestamptz expires_at
    }
```

扩展问答表不是 MVP 必需项。若核心闭环完成且时间仍充足，再以 versioned `question_key + jsonb` 增加；不让它占用两天后端基本盘。

## 表职责与约束

### `app_users`

匿名业务主体，不存姓名、邮箱、IP、完整 User-Agent 或真实身份。

- `standard`：普通读写 funnel 用户。
- `demo_readonly`：公开 paid fixture；所有 create/save/submit/pay 写 RPC 在解析 session 后立即拒绝。

### `user_sessions`

- 对外 `sessionId` 是 32 random bytes 的 base64url token；此表 `id` 只称 `sessionRecordId`。
- 数据库只存 SHA-256 digest，`token_hash` 唯一；明文 token 不进日志、表或 trace。
- 普通 session 绝对 TTL 7 天；`revoked_at` 只用于管理员失效/轮换，本版无公开 revoke endpoint。
- `last_seen_at` 在 app user 上节流更新，不让每个 GET 都产生写放大。

### `assessments`

- 只存生命周期与并发元数据，不重复存核心答案。
- `status`：`draft | ready | completed`；无不可达的 `abandoned` 分支。
- `revision bigint not null default 0`，每个成功业务写入只增一次。
- partial unique index：同一 `user_id + quiz_version` 最多一个 `draft/ready`。
- 触发器只允许 `draft → draft/ready`、`ready → ready/completed`；`completed` 不可更新。
- `ready` 下历史 step 只能替换为另一个完整有效值；跨字段无效请求整体拒绝，不做 `ready → draft`。

### `assessment_core_inputs`

一对一；draft 时字段可空，每个非空值仍受 CHECK。服务端由完整有效字段推导 `completedSteps` 和 `ready`。

```text
age_years                 integer 18..80
height_cm                 numeric(5,2) 120..230
weight_kg                 numeric(6,2) 35..300
target_weight_kg          numeric(6,2) 35..300
sex_for_calorie_estimation female | male
primary_goal              lose_weight | maintain_weight | gain_weight
activity_level            sedentary | light | moderate | active | very_active
```

同一行可表达的方向/比例 CHECK 放数据库；更复杂的目标 BMI、完整性与 warning 在事务 RPC 中再次验证。更新触发器查父 assessment：若已 completed 就拒绝，防止绕过应用修改结果输入。

### `assessment_results` 与 `assessment_result_details`

物理拆表：preview 查询只碰基础表；entitlement 成立后才查询 details。这样即使 TypeScript serializer 出错，也降低把预测曲线带入 preview 的概率。

- 一组 `BEFORE UPDATE OR DELETE` 触发器让 basic/details 结果 append-only；重算创建新 assessment/result。
- `input_snapshot` 只保存 canonical 单位、quiz version、输入 revision，不保存 credential。
- `algorithm_version` 不由客户端传入。
- `weight_projection` 限制最大 105 点与 JSON 大小；warnings 是稳定 code 白名单。

### `subscriptions` 与 `payment_events`

- 订阅有效：`status = active AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())`。
- `subscriptions.user_id` 唯一；current entitlement 与 append-only attempt audit 分开。
- `payment_events` 必含 `assessment_id`。
- unique `(provider, provider_event_id)`；另有 unique `(provider, user_id, idempotency_key)`，而不是全局 key。
- 两个不同 key 的并发 pay 可各写 attempt：赢家 `activated`，后来者 `already_active`；只有第一方决定 `valid_from/valid_until`，后来者绝不续期。

### `idempotency_records`

unique `(user_id, scope, key)`，TTL 24 小时。保存 canonical request hash、HTTP status 与最小重放信息/资源引用；不复制完整健康结果或 session token。

- 同 key 同 hash：重放首次结果。
- 同 key 异 hash：409。
- 先 strict parse 并拒绝未知字段，再 canonicalize；key 格式 `[A-Za-z0-9._:-]{16,128}`。

## 索引与数据库规则

- 所有 FK 列显式建索引；PostgreSQL 不会自动为 FK 建索引。
- 热路径索引：active assessment、session token hash、owner/result、有效 subscription、幂等 key。
- UUID PK、`timestamptz` 时间、`numeric` 测量/结果；不使用 binary float 保存最终业务值。
- `created_at/updated_at` 由数据库生成；客户端时间仅可作非权威 telemetry。
- 外键删除策略显式：assessment 子记录 `ON DELETE CASCADE`；支付审计 `RESTRICT`，由受控 retention 脚本按顺序处理。

## 真正的授权边界

### 服务端 secret 与 RLS 的职责

Supabase secret/legacy `service_role` 具备 `BYPASSRLS`。因此：

- RLS + revoke 用于让 public Data API 对 `anon` / `authenticated` fail closed。
- 服务端 BOLA 不能依赖 RLS；所有 owner-sensitive SQL 必须把有效 session digest 的子查询/join 与 owner filter 放在同一 statement/transaction。
- 每个写 RPC 只接收 `p_session_hash` 和业务参数，不接收 `userId`。RPC 同事务验证 session expiry/revocation、读取 `app_users.kind`、派生 owner、验证 assessment owner/revision/idempotency，再执行写入。
- `demo_readonly` 的禁止写入必须在每个写 RPC 的 session guard 内，不能只在 Next route 判断。

### 首个 migration 的可执行 ACL 顺序

1. 针对实际 object owner（预期 `postgres`，部署前查询确认）修改 `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public`：tables、sequences、functions 对 `PUBLIC`、`anon`、`authenticated`、`service_role` 默认均 `REVOKE ALL`。
2. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`，并检查 schema usage。
3. 创建对象后，对所有业务 tables/sequences/functions 再执行显式 revoke，覆盖历史/default 差异。
4. 所有 public 业务表 `ENABLE ROW LEVEL SECURITY`；不创建 anon/authenticated 业务策略。
5. 只向 `service_role` 显式 grant RPC 所需 schema usage、表级 DML 与函数 execute；每次新对象 migration 必须同文件 grant。
6. 每个 RPC：`SECURITY INVOKER SET search_path = ''`，对象名全限定；按完整 signature `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`，再 `GRANT EXECUTE TO service_role`。
7. Data API 保持开启，因为 server 通过它调用 RPC；直接 table endpoint 因 ACL + 无 policy 失败。

迁移测试必须查询 `pg_default_acl`、`information_schema.role_table_grants`、`pg_proc.proacl`、`pg_class.relrowsecurity`，而不是只看 Dashboard。

### Server runtime

- `SUPABASE_SECRET_KEY`/legacy `service_role` 只在 server runtime，绝不使用 `NEXT_PUBLIC_` 前缀。
- 浏览器不直连业务表，不需要 Supabase secret。
- server client 每次请求创建，不把用户状态挂在全局 client。
- CI/日志/错误响应对 key 和 session token 做脱敏。

## Migration 与生产 fixture 工作流

1. 固定 Supabase CLI 版本，先用 `--help` 验证实际命令。
2. `supabase migration new <name>` 创建 migration；本地 `db reset` 从零重建。
3. 运行 DB/API、安全、ACL 和 advisor 检查；生成 Database types 并做 drift check。
4. commit/push 以后，仅在明确 milestone 通过受控 CI/manual gate 执行一次 `supabase db push`；不让每个普通 push 自动改生产库。
5. 部署后执行 `supabase migration list`、schema/grant/RLS 查询、advisors 与远端只读 smoke。
6. Dashboard 不做不可追踪 DDL；生产修复始终新增 forward migration。

`supabase/seed.sql` **只服务本地/CI reset，不会被当作线上部署机制**。线上 paid fixture 使用 `scripts/provision-demo-session.ts`：

- 由 server secret 显式运行，要求目标 project ref 二次确认；
- 幂等 upsert 固定合成 user/assessment/result/subscription；
- 创建或显式 `--rotate` 只读 session，输出 `paidSessionId`、`assessmentId`、过期时间和 smoke 命令一次；
- 随后验证 full 可读、所有写 endpoint 为 403；
- credential 过期/轮换后同步更新 README 交付片段。

## 数据留存

本项目只用合成演示数据，但仍采用最小留存：

| 数据 | 期限/动作 |
|---|---|
| 普通 session | 7 天绝对有效期；过期 30 天后可物理清理 |
| 未完成 assessment | 最后更新 30 天后清理 |
| completed 合成 assessment | 90 天或项目下线时清理 |
| idempotency record | 24 小时 |
| 结构化应用日志 | 7 天；不含健康 payload/token |
| paid demo fixture | 30 天 credential，交付期间显式轮换/续建 |

MVP 提供可 dry-run 的受控 cleanup 脚本/SQL 与测试；自动 cron 是 stretch，不在 README 假称已自动执行。

## 当前 Supabase 变化对方案的影响

- 使用 publishable/secret 新 key 命名；旧 `anon/service_role` 仅作为 Postgres role/兼容术语。
- 2026 年 Data API 新表默认暴露行为正在调整，但当前项目 ACL 实测仍宽，所以始终显式 revoke，不依赖平台默认值。
- 不依赖 GraphQL introspection，本项目不需要 pg_graphql。
- Node 固定 22+，避开已停止支持的 Node 20。
