# API contract and replayable demo

Base URL：`https://health-assessment-funnel.vercel.app/api/v1`。JSON 使用 camelCase，公制单位为 cm、kg、kcal/day。

## Cross-cutting contract

- Browser auth：`__Host-health_session`（HttpOnly、Secure、SameSite=Lax、Path=/）。
- CLI auth：`Authorization: Bearer <43-char sessionId>`。
- Cookie 与 bearer 同时存在且不一致：`400 AMBIGUOUS_SESSION`。
- `POST`/`PUT` 只接受 `application/json`；body 上限 16 KiB；所有 schema 拒绝未知字段。
- `POST /assessments`、step save、submit、pay 要求 `Idempotency-Key: [A-Za-z0-9._:-]{16,128}`。
- step save 与 submit 要求 `If-Match: "rev-N"`。
- 个性化响应：`Cache-Control: private, no-store`，并按 Cookie/Authorization 区分。
- 错误：RFC 7807 `application/problem+json`，含 `type/title/status/code/detail/traceId`；字段错误含 `errors[]`。

## Endpoints

### `POST /sessions`

Body：`{}`。无凭证时返回 201、设置 Cookie，并且只在这一次返回明文 `sessionId`；有效已有凭证返回 200 和 `reused: true`，不再次暴露 token。

### `POST /assessments`

```json
{ "quizVersion": "health-v1" }
```

为当前 session 创建 assessment，或返回同版本仍在进行的 assessment。新建 201，复用 200。

### `GET /assessments/current`

返回当前未完成 assessment 的服务端进度，包括 `completedSteps`、`nextStep`、已确认 answers 与 `ETag`。没有当前记录时返回 404。

### `GET /assessments/{assessmentId}`

按 ID 读取 owner 自己的进度；不存在与非 owner 均返回 404，避免资源枚举。

### `PUT /assessments/{assessmentId}/steps/{stepKey}`

`stepKey` 为 `sex | goal | body | activity`。示例：

```http
If-Match: "rev-2"
Idempotency-Key: 73a1d0f8-5fc9-47a6-9ad2-9fd5bccb84e3
Content-Type: application/json
```

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

乱序为 409；缺 `If-Match` 为 428；旧 revision 为 412 并返回当前 revision；完成后写入为 409。同 key、同 canonical body 重放第一次响应且不会再次递增 revision。

### `POST /assessments/{assessmentId}/submit`

Body：`{}`。在同一事务中验证完整输入与 revision、计算结果、写 basic/details result，并把 assessment 置为 completed。重放返回相同 `resultId`。

### `GET /assessments/{assessmentId}/result`

未订阅时：

```json
{
  "data": {
    "access": "preview",
    "bmi": 25.7,
    "bmiCategory": "overweight",
    "summary": "A gradual plan is recommended.",
    "calorieRange": { "min": 1500, "max": 1700 },
    "warnings": [],
    "upgradeRequired": true,
    "lockedFeatures": [
      "bmrKcal",
      "tdeeKcal",
      "exactDailyCalories",
      "targetDate",
      "weightProjection"
    ]
  }
}
```

订阅有效时返回 `access: "full"`，并包含 `bmrKcal`、`tdeeKcal`、`exactDailyCalories`、`targetDate`、`weightProjection`、`algorithmVersion`。preview 从独立 allowlist 构建，受保护字段在整个 JSON 中不存在。

### `POST /pay`

```json
{
  "assessmentId": "uuid",
  "planCode": "demo_monthly"
}
```

只为当前 session owner 且已经完成的 assessment 激活固定 demo plan。相同 key 重放不会再次延长期限；结果接口随后立即变为 full。

## 可重放 cURL：从零到付费

需要 `curl` 和 `jq`。该脚本使用 bearer，因此不依赖浏览器 Cookie/Origin。

```bash
BASE='https://health-assessment-funnel.vercel.app/api/v1'

SESSION_ID="$(curl --fail-with-body --silent --show-error \
  -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  --data '{}' | jq -r '.data.sessionId')"

ASSESSMENT_ID="$(curl --fail-with-body --silent --show-error \
  -X POST "$BASE/assessments" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: readme-create-000001' \
  --data '{"quizVersion":"health-v1"}' | jq -r '.data.assessmentId')"

curl --fail-with-body --silent --show-error \
  -X PUT "$BASE/assessments/$ASSESSMENT_ID/steps/sex" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "rev-0"' \
  -H 'Idempotency-Key: readme-sex-00000001' \
  --data '{"data":{"sexForCalorieEstimation":"female"}}' | jq

curl --fail-with-body --silent --show-error \
  -X PUT "$BASE/assessments/$ASSESSMENT_ID/steps/goal" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "rev-1"' \
  -H 'Idempotency-Key: readme-goal-0000001' \
  --data '{"data":{"primaryGoal":"lose_weight"}}' | jq

curl --fail-with-body --silent --show-error \
  -X PUT "$BASE/assessments/$ASSESSMENT_ID/steps/body" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "rev-2"' \
  -H 'Idempotency-Key: readme-body-0000001' \
  --data '{"data":{"ageYears":32,"heightCm":165,"weightKg":70,"targetWeightKg":60}}' | jq

curl --fail-with-body --silent --show-error \
  -X PUT "$BASE/assessments/$ASSESSMENT_ID/steps/activity" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "rev-3"' \
  -H 'Idempotency-Key: readme-activity-0001' \
  --data '{"data":{"activityLevel":"light"}}' | jq

curl --fail-with-body --silent --show-error \
  -X POST "$BASE/assessments/$ASSESSMENT_ID/submit" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "rev-4"' \
  -H 'Idempotency-Key: readme-submit-00001' \
  --data '{}' | jq

# preview: must not contain bmrKcal/tdeeKcal/exactDailyCalories/targetDate/weightProjection
curl --fail-with-body --silent --show-error \
  "$BASE/assessments/$ASSESSMENT_ID/result" \
  -H "Authorization: Bearer $SESSION_ID" | jq

curl --fail-with-body --silent --show-error \
  -X POST "$BASE/pay" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: readme-payment-0001' \
  --data "{\"assessmentId\":\"$ASSESSMENT_ID\",\"planCode\":\"demo_monthly\"}" | jq

# full: same resource now exposes the entitled projection
curl --fail-with-body --silent --show-error \
  "$BASE/assessments/$ASSESSMENT_ID/result" \
  -H "Authorization: Bearer $SESSION_ID" | jq
```

## Stable error codes

| HTTP | Code examples                                                       | Meaning                            |
| ---: | ------------------------------------------------------------------- | ---------------------------------- |
|  400 | `AMBIGUOUS_SESSION`, `INVALID_PRECONDITION`                         | malformed/ambiguous protocol state |
|  401 | `SESSION_REQUIRED`, `SESSION_EXPIRED`                               | credential missing or invalid      |
|  403 | `ORIGIN_NOT_ALLOWED`, `DEMO_SESSION_READ_ONLY`                      | write not authorized               |
|  404 | `ASSESSMENT_NOT_FOUND`                                              | missing or not owner               |
|  409 | `STEP_OUT_OF_ORDER`, `ASSESSMENT_LOCKED`, `IDEMPOTENCY_KEY_REUSED`  | state conflict                     |
|  412 | `REVISION_MISMATCH`                                                 | stale ETag                         |
|  415 | `UNSUPPORTED_MEDIA_TYPE`                                            | non-JSON write body                |
|  422 | `VALIDATION_FAILED`, `UNREASONABLE_TARGET`, `ASSESSMENT_INCOMPLETE` | field/business validation          |
|  428 | `PRECONDITION_REQUIRED`                                             | missing `If-Match`                 |

所有 500 响应使用稳定公开错误，不返回 stack、SQL 或 Supabase 原始错误。
