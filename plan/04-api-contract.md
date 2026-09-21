# 04 · API 契约

## 通用约定

- Base path：`/api/v1`。
- JSON 字段使用 `camelCase`；数据库使用 `snake_case`。
- 公制为 canonical units：cm、kg、kcal/day；英制仅前端转换。
- 成功响应：`{ "data": ..., "meta"?: ... }`。
- 错误响应：`application/problem+json`，含 `type`、`title`、`status`、`code`、`detail`、`traceId`，字段错误放 `errors`。
- 所有 object schema 为 strict；**先拒绝未知字段，再做 canonicalization/hash**，未知字段返回 422。
- 所有敏感/个性化响应：`Cache-Control: private, no-store`、`Vary: Cookie, Authorization`。
- 只接受 HTTPS 生产请求；CORS 默认同源；JSON body 上限 16 KiB。
- 客户端永远不能提交 `userId`、`subscriptionStatus`、计算结果或算法版本。

## Endpoint 总览

| Method | Path | 用途 | 身份/并发 |
|---|---|---|---|
| POST | `/api/v1/sessions` | 创建或识别匿名会话 | 无或已有 session |
| POST | `/api/v1/assessments` | 创建或返回当前 draft | session + idempotency |
| GET | `/api/v1/assessments/current` | 恢复当前进度 | session |
| GET | `/api/v1/assessments/{assessmentId}` | 获取指定 assessment 进度 | owner |
| PUT | `/api/v1/assessments/{assessmentId}/steps/{stepKey}` | 保存完整一步 | owner + If-Match + idempotency |
| POST | `/api/v1/assessments/{assessmentId}/submit` | 完整校验并计算 | owner + If-Match + idempotency |
| GET | `/api/v1/assessments/{assessmentId}/result` | preview/full 结果 | owner + live entitlement |
| POST | `/api/v1/pay` | 模拟当前用户支付 | session + idempotency + Origin（Cookie 模式） |
| GET | `/api/health` | liveness | 无，不访问数据库/敏感配置 |

MVP 不提供 session revoke、独立 readiness 或管理端 endpoint；避免在两天范围内增加无验收价值的攻击面。

## Session

### 术语与凭证选择

- 题面和公开 API 的 `sessionId`：CSPRNG 生成的 256-bit 不透明 bearer credential，编码为恰好 43 字符 base64url，只在创建时返回明文。
- 数据库 `user_sessions.id`：内部 `sessionRecordId` UUID，不是凭证，不向客户端开放。
- 浏览器凭证：`__Host-health_session` Cookie（`HttpOnly; Secure; SameSite=Lax; Path=/`，无 `Domain`）。
- cURL：标准 `Authorization: Bearer <sessionId>`。
- Cookie 与 Bearer 同时存在且解析为不同 session：400 `AMBIGUOUS_SESSION`，不静默选一个。

### `POST /api/v1/sessions`

请求体为空：

- 无 credential：创建 user/session，201；返回明文 `sessionId` 一次并设置 Cookie。
- 已有有效 credential：200，复用当前 session，只返回元数据，不轮换且不再次暴露 token。
- 已有无效/过期 credential：401；客户端显式清理后再创建，不自动换身份掩盖数据丢失。
- 绝对 TTL 为 7 天，不按访问滑动。

首次响应：

```json
{
  "data": {
    "sessionId": "<base64url-encoded-256-bit-token>",
    "expiresAt": "2026-09-28T12:00:00.000Z",
    "reused": false
  }
}
```

已有会话响应不含 `sessionId`：

```json
{
  "data": {
    "expiresAt": "2026-09-28T12:00:00.000Z",
    "reused": true
  }
}
```

公开 paid fixture 的 bearer credential 是经过风险隔离的明确例外：它绑定 `demo_readonly` 合成用户，所有写 RPC 都拒绝该身份，不能保存、提交、支付或破坏 fixture。

## Assessment 创建与恢复

### `POST /api/v1/assessments`

```json
{
  "quizVersion": "health-v1"
}
```

- 同一用户、同一 `quizVersion` 若已有 active assessment，则返回它而不是重复创建。
- `Idempotency-Key` 必填，格式 `[A-Za-z0-9._:-]{16,128}`，记录 TTL 24 小时。
- 新建为 201，复用为 200。

### `GET /api/v1/assessments/current`

```json
{
  "data": {
    "assessmentId": "uuid",
    "status": "draft",
    "quizVersion": "health-v1",
    "revision": 4,
    "completedSteps": ["sex", "goal", "body"],
    "nextStep": "activity",
    "answers": {
      "sex": { "sexForCalorieEstimation": "female" },
      "goal": { "primaryGoal": "lose_weight" },
      "body": { "ageYears": 32, "heightCm": 165, "weightKg": 70, "targetWeightKg": 60 }
    },
    "updatedAt": "2026-09-21T10:00:00.000Z"
  }
}
```

响应带 `ETag: "rev-4"`。无 active assessment 返回 404 `ASSESSMENT_NOT_FOUND`，前端再创建。

## 分步保存

### `PUT /api/v1/assessments/{assessmentId}/steps/{stepKey}`

Headers：

```http
If-Match: "rev-4"
Idempotency-Key: 73a1d0f8-5fc9-47a6-9ad2-9fd5bccb84e3
Content-Type: application/json
```

Body 按 `stepKey` 使用判别 schema：

```json
{
  "data": {
    "ageYears": 32,
    "heightCm": 165,
    "weightKg": 70,
    "targetWeightKg": 60
  }
}
```

返回新的 revision、完成步骤、下一步和 ETag。规则：

- 当前 next step 可以写；已完成历史 step 可以用另一个完整有效值修改。
- 跨字段校验失败不会清空旧值，也不会把 `ready` 降成非法状态。
- 跳过缺失前置 step 写未来 step：409 `STEP_OUT_OF_ORDER`。
- 缺 `If-Match`：428 `PRECONDITION_REQUIRED`。
- revision 过期：412 `REVISION_MISMATCH`，响应 meta 带当前 revision，不自动覆盖。
- 同幂等键 + 同 canonical body：返回首次响应，revision 不再递增；即使重试携带旧 ETag，也优先重放已提交结果。
- 同幂等键 + 不同 body：409 `IDEMPOTENCY_KEY_REUSED`。
- completed assessment：409 `ASSESSMENT_LOCKED`。

## 提交与计算

### `POST /api/v1/assessments/{assessmentId}/submit`

请求体为空，Headers 同样要求 `If-Match` 和 `Idempotency-Key`。

- 缺字段：422 `ASSESSMENT_INCOMPLETE`，返回缺失 step/field。
- 目标与方向矛盾或超过安全边界：422 `UNREASONABLE_TARGET`。
- 成功：原子生成一条不可变 result，assessment → `completed`。
- 重放：返回同一 result ID 和同一计算结果，不重复计算成不同日期。

```json
{
  "data": {
    "assessmentId": "uuid",
    "resultId": "uuid",
    "status": "completed",
    "calculatedAt": "2026-09-21T10:10:00.000Z"
  }
}
```

## 结果权限投影

### `GET /api/v1/assessments/{assessmentId}/result`

以下示例基于 `female / 32 / 165 cm / 70 kg / 60 kg / light / lose_weight` 与 2026-09-21 UTC 的固定 clock。

未付费 preview：

```json
{
  "data": {
    "access": "preview",
    "bmi": 25.7,
    "bmiCategory": "overweight",
    "summary": "A gradual plan is recommended.",
    "calorieRange": { "min": 1500, "max": 1700 },
    "upgradeRequired": true,
    "lockedFeatures": ["bmrKcal", "tdeeKcal", "exactDailyCalories", "targetDate", "weightProjection"]
  }
}
```

已付费 full：

```json
{
  "data": {
    "access": "full",
    "bmi": 25.7,
    "bmiCategory": "overweight",
    "bmrKcal": 1410,
    "tdeeKcal": 1939,
    "exactDailyCalories": 1551,
    "calorieEstimateAvailable": true,
    "targetDate": "2027-04-12",
    "weightProjection": [
      { "date": "2026-09-21", "weightKg": 70.0 },
      { "date": "2026-09-28", "weightKg": 69.6 }
    ],
    "algorithmVersion": "health-v1"
  }
}
```

若安全热量包络无法满足，full DTO 返回 `calorieEstimateAvailable: false`、`exactDailyCalories: null`、`targetDate: null`、空曲线和稳定 warning code，不把下限 clamp 后伪装成可靠预测。

关键约束：preview schema 根本不声明 `bmrKcal`、`tdeeKcal`、`exactDailyCalories`、`targetDate`、`weightProjection` 等保护字段，不使用“完整对象创建后 delete 字段”的写法。测试递归检查保护字段名在整个 JSON（含 error/meta）中不存在。

## 模拟支付

### `POST /api/v1/pay`

```json
{
  "assessmentId": "uuid",
  "planCode": "demo_monthly"
}
```

- 这是显式 demo endpoint，不接收金额、userId、状态或 provider 结果。
- 只激活当前 session 派生出的用户；assessment 必须属于该用户且已 completed。
- 原子写 `payment_events` 并 upsert `subscriptions`。
- 相同幂等键重放同一响应，不再次延长有效期或新增事件。
- 两个不同幂等键并发时可留下两个 append-only attempt：一个 `activated`，另一个 `already_active`；只有第一方创建/激活 current subscription，后续请求不延长有效期。
- `demo_readonly` session 一律 403 `DEMO_SESSION_READ_ONLY`。
- 响应不包含数据库密钥或内部 provider payload。

## Origin/CSRF 与错误码

- Cookie 参与的 unsafe method 在生产必须带与 `APP_ORIGIN` 精确匹配的 `Origin`；缺失或不匹配均 403。
- 纯 Bearer CLI 请求不依赖浏览器 Cookie，可不带 Origin。
- GET 不改变状态；SameSite 是辅助层，不替代 Origin 校验。

| 场景 | HTTP | code |
|---|---:|---|
| 无/无效/过期 session | 401 | `SESSION_REQUIRED` / `SESSION_EXPIRED` |
| Cookie/Bearer 冲突 | 400 | `AMBIGUOUS_SESSION` |
| 资源不存在或非 owner | 404 | `ASSESSMENT_NOT_FOUND` |
| body/字段/业务边界非法 | 422 | `VALIDATION_FAILED` / `UNREASONABLE_TARGET` |
| 缺 If-Match | 428 | `PRECONDITION_REQUIRED` |
| revision 过期 | 412 | `REVISION_MISMATCH` |
| 跳步/已锁定/幂等冲突 | 409 | 稳定业务 code |
| demo fixture 尝试写入 | 403 | `DEMO_SESSION_READ_ONLY` |
| Origin/CSRF 校验失败 | 403 | `ORIGIN_NOT_ALLOWED` |
| 频率超限 | 429 | `RATE_LIMITED` |
| 未处理错误 | 500 | `INTERNAL_ERROR`，不回传 stack/SQL |

## 契约验证

- MVP 手工维护 `docs/openapi.yaml`；contract tests 逐 route 校验 Zod 请求/响应与 OpenAPI status/schema，防止文档漂移。
- contract tests 验证 status、content type、header、schema、body size 和未知字段拒绝。
- README `curl` 片段由 smoke 脚本实际执行，而非只写文档。
- API 版本升级走 `/api/v2` 或新的 `quizVersion`，不静默改变已有结果语义。
