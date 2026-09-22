# 后端架构与核心业务难点

## 1. 目标与边界

后端的目标不是把表单字段简单写进一张表，而是让一个匿名访客能够：

1. 创建一个不可猜测、可恢复的 session；
2. 逐步保存 15 题答案，并在刷新或中断后恢复服务端进度；
3. 在服务端完成健康评估、固化算法版本和结果快照；
4. 在同一个结果上区分 preview 与 full entitlement；
5. 通过可重放的 `/pay` 模拟回调完成状态变更；
6. 在乱序、重复、并发、错误输入和跨 session 访问下返回稳定结果。

本项目选择 Next.js App Router Route Handler 作为 HTTP 边界，Supabase PostgreSQL 作为持久化层，纯 TypeScript domain function 负责算法。浏览器永远不直接读业务表，也不在 URL、Web Storage 中携带 bearer credential。

## 2. 分层与依赖方向

```text
Browser / cURL / Playwright
          │
          ▼
Next.js Route Handlers (src/app/api/v1)
          │  parse JSON / auth / origin / ETag / Problem Details
          ▼
HTTP adapters (src/server/http)
          │
          ▼
HealthAssessmentService (application use case)
          ├── health-assessment-v1 (纯算法、Decimal、目标合理性)
          ├── result-projection (preview/full allowlist)
          └── AssessmentStore port
                    │
                    ▼
          SupabaseHealthAssessmentStore
                    │  typed RPC envelope + Zod response validation
                    ▼
          PostgreSQL transaction RPCs / triggers / constraints
```

Route Handler 不包含 SQL、算法或 entitlement 规则；Supabase adapter 也不把数据库 row 直接透传到浏览器。每一层都有自己的 schema 或 port，这样可以单独测试协议错误、领域公式和真实数据库行为。

## 3. session 鉴权与隐私边界

### 凭证生成与存储

- `newSessionToken()` 生成 32 bytes 的随机值，再编码成 43 字符 base64url。
- 浏览器使用 `__Host-health_session` HttpOnly、Secure、SameSite=Lax cookie；cookie 只保存 bearer credential，不写 localStorage/sessionStorage。
- 数据库只保存 SHA-256 digest（`bytea` 32 bytes），不会持久化明文 token。
- session 默认绝对 TTL 为 7 天；RPC 同时检查过期和撤销状态。
- CLI 可以使用 `Authorization: Bearer <sessionId>`，因此验收人员能用 cURL 重放；真实结果仍需要该凭证和 owner 匹配的 assessment UUID。

### 防止凭证混淆

`optionalSessionCredential()` 同时解析 cookie 和 Bearer。如果两者都存在但 token 不相同，立即返回 `AMBIGUOUS_SESSION`；相同 token 才允许继续。比较使用固定长度 ASCII bytes 的 `timingSafeEqual`。结果路径中的 assessment UUID 只是资源标识，不是授权凭证，复制 URL 到没有原 cookie 的浏览器不会获得数据。

### 写请求的 CSRF 边界

Cookie-authenticated write 必须带精确匹配的 `APP_ORIGIN`；Bearer-only CLI write 不参与浏览器 cookie CSRF。所有 POST/PUT 仍需 `Content-Type: application/json`，请求体超过 16 KiB 会在解析前返回 413。

## 4. 15 题持久化与恢复

UI 中有 15 个问题，但后端把它们按四个可原子提交的 step 聚合：`sex`、`goal`、`body`、`activity`。其中 body step 同时包含年龄、身高、体重和目标体重，activity step 包含运动频率与相关习惯。数据库保存：

- `assessment_core_inputs`：算法需要的强类型核心字段；
- `assessment_funnel_answers`：逐题 UI 答案的 JSONB 扩展，供 review 和未来题目版本使用；
- `assessments`：生命周期、quiz version 和 revision。

每次 step 保存都携带：

```text
assessmentId + stepKey + patch
If-Match: "rev-N"
Idempotency-Key: stable-request-key
```

服务端从数据库恢复 `completedSteps`、`nextStep`、答案和 revision；客户端只能导航到服务器允许的下一步，不能通过修改 URL 跳过题目。相同值的安全重试不会重复推进 revision；不同值使用旧 revision 写入会返回 `REVISION_MISMATCH`，并在 error meta 中给出当前 revision。

## 5. 并发与幂等：最容易被表单掩盖的难点

### 乐观并发控制

`assessments.revision` 是每次成功业务修改恰好加一的版本号。RPC 在同一事务内锁定 assessment row，并验证 owner、当前状态和 `p_expected_revision`。两个请求拿到同一 ETag 时只有一个能提交；另一个得到稳定的 412，而不是静默覆盖第一个答案。

### 幂等记录

每个 create、step、submit、pay 请求都要求 16–128 字符的 `Idempotency-Key`。服务端把 method、scope、quiz/algorithm version、resource id 和 canonical JSON body 计算为 SHA-256 request hash：

- 同一个 owner/scope/key + 同一个 hash：返回之前保存的最小 payload，并标记 `replayed`；
- 同一个 key + 不同 hash：返回 `IDEMPOTENCY_KEY_REUSED`，不会执行第二个语义；
- replay payload 不保存 session token、完整答案或完整 result，仅保存 response status 和资源引用；
- 数据库限制记录最长约 25 小时，运维可按过期时间清理。

### submit 的特殊顺序

submit 先解析 session 的 write capability，再读取 assessment。这样公开 `demo_readonly` fixture 的任何写操作都稳定返回 `DEMO_SESSION_READ_ONLY`，不会因为结果已完成而误返回普通 404。正常 submit 读取 ready inputs，调用纯 domain evaluator，再用 finalize RPC 在一个事务内写入 basic/details result、更新 assessment 为 completed，并记录幂等响应。网络丢包后的重试可以使用旧 ETag，因为 RPC 会先处理同 key replay。

## 6. 服务端健康算法与结果固化

`evaluateHealthAssessmentV1()` 只接受经过 Zod 的 `HealthInputV1`，并使用 Decimal（precision 40、HALF_UP）计算：

- BMI raw 与一位小数 BMI/category；
- Mifflin-St Jeor BMR；
- activity factor 对应的 TDEE；
- 按目标的 calorie range 和 exact daily calories；
- 受最大周变化、40% 目标变化、目标 BMI 和 104 周 horizon 保护的 weight projection；
- 不适合给出数字时的 warning 和 `calorieEstimateAvailable=false`。

目标合理性在应用层和数据库 CHECK/RPC 都验证：减重必须低于当前体重、增重必须高于当前体重、维护目标必须在容差内；目标体重不能造成不安全 BMI 或超过当前体重 40%。submit 时把 `input_revision`、`input_snapshot`、`algorithm_version=health-v1` 和 `calculated_at` 一起固化，未来算法升级不会悄悄改变旧结果。

## 7. preview/full 与 `/pay` 闭环

`assessment_results` 只保存 preview-safe 字段；`assessment_result_details` 保存 BMR、TDEE、exact calories、target date 和完整 projection。`rpc_get_assessment_result` 每次实时解析 session owner 和 subscription entitlement：

- 未 active：只从 basic row 构造 `access: "preview"`、`upgradeRequired` 和固定 `lockedFeatures`；不查询 details；
- active：才读取 details，并构造 `access: "full"` allowlist DTO；
- 应用层 schema 是 discriminated union，客户端不能把 preview 强转为 full。

`POST /api/v1/pay` 只接受当前 session 所属、已 completed 的 assessment 和固定 `demo_monthly` plan。RPC 会在同一事务内锁定 entitlement、写 append-only `payment_events`、创建或推进 subscription，并通过 provider event/idempotency 唯一约束防重复。UI 支付成功后重新 GET result，而不是在客户端直接把状态改成 full；因此刷新后仍由数据库 entitlement 决定权限。

## 8. 错误协议与可观测性

所有成功响应为 `{ data: ... }`，并设置 `private, no-store` 与 `Vary: Cookie, Authorization`；有 ETag 的资源返回 `ETag: "rev-N"`。失败响应为 RFC 7807 风格 `application/problem+json`，包含稳定 `code`、字段错误、可选 revision meta 和 `X-Trace-Id`。未知 SQL/网络错误只记录结构化 trace、状态和 error name，不把 SQL、token、健康答案写回客户端。

## 9. 关键取舍与范围

- 匿名 session 让流程无需注册，但 7 天 TTL 和同浏览器恢复意味着当前不是跨设备账号系统。
- 事务 RPC 比直接从 Route Handler 拼 SQL 更长，但能把 owner、revision、幂等和生命周期判断放在一个数据库原子边界内。
- `/pay` 是题目要求的模拟支付；生产接入 provider 时还需签名验真、事件顺序、退款/撤销和 webhook 重放保护。
- 当前不把临床有效性、孕期/疾病/药物场景伪装成已解决；结果明确是 wellness estimate。

代码索引：[application service](../../src/server/application/health-assessment-service.ts)、[Supabase store](../../src/server/infrastructure/supabase/health-assessment-store.ts)、[session credential](../../src/server/http/session-credential.ts)、[request guards](../../src/server/http/request.ts)、[result projection](../../src/server/domain/result-projection.ts)。
