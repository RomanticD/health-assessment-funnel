# 14 · 可观测性、隐私与运维

## 目标

两天 MVP 不建设复杂监控平台，但必须能回答：哪类请求失败、发生在哪个 release、是否涉及 migration/权限/缓存，以及公开 demo fixture 是否仍健康；同时不能把健康输入或 credential 变成日志泄露面。

## Request correlation

- 每个请求生成 UUID request ID；仅接受格式/长度严格合法的上游 `X-Request-Id`，否则覆盖生成。
- 响应 `X-Request-Id`，Problem Details 的 `traceId` 使用同一值。
- 线上 smoke 保存 request ID、commit SHA、deployment URL 和时间，不保存 Cookie/Bearer。

## 结构化日志 allowlist

允许字段：

```text
timestamp, level, environment, releaseSha,
requestId, routeTemplate, method, status, durationMs,
errorCode, stepKey?, assessmentState?, payOutcome?, resultAccess?
```

明确禁止：

- Cookie、Authorization、sessionId/token/hash、Supabase key、完整 idempotency key；
- request/response body、年龄、身高、体重、目标体重、projection；
- raw URL query、stack/SQL 回给客户端；
- 邮箱/IP/完整 User-Agent 等本项目不需要的身份数据。

assessment/user UUID 默认也不记；若调试必须关联，使用短期、不可逆、环境隔离的 correlation value，并在问题关闭后删除。

## 最小事件与指标

- `session_created` / `session_reused`（不含 credential）。
- `step_saved`（只含 stepKey、revision，不含答案）。
- `assessment_submitted`（algorithmVersion、available/warning codes，不含数值）。
- `result_served`（preview/full）。
- `payment_attempted`（activated/already_active/rejected_demo）。
- route 5xx rate、稳定 error code count、p95 latency；不按健康属性或个体切片。

日志 provider 不是 Must；Vercel runtime log 足够完成演示。若加入外部 provider，必须先核对 EU/region、retention 与 payload redaction，不能为了“有监控”扩大数据面。

## 健康检查与 smoke

- `GET /api/health` 只证明进程可响应，返回 release/version 和 `ok`；不访问 DB、不输出 env/hostname/依赖版本。
- DB readiness 不做公开 endpoint。部署脚本用 server-side smoke/RPC 直接验证 migration、session、preview/full 与 ACL。
- 线上 smoke 顺序：新 session → assessment → steps → submit → preview → pay → full；另跑 paid fixture full read + 四类写入拒绝。

## 基础 abuse control

- body、header、idempotency key 均有长度上限；枚举/数值 strict parse。
- `/sessions` 与 `/pay` 在部署层配置温和的 per-IP burst limit（若当前 Vercel 套餐可用）；应用语义仍靠幂等、ownership 和 demo read-only，不把 rate limit 当授权。
- 如果平台能力不可用，README 诚实记录为已知限制；不为此引入一套未充分测试的分布式 limiter。

## 运维 Runbook

### Migration 失败

停止 app release；保存 `migration list`/错误；优先新增 forward-fix migration。禁止直接 Dashboard 改表，也不执行破坏性 down migration。

### paid fixture 失效/泄露/过期

运行 provisioning 的 `--rotate`；确认旧 session `revoked_at`、新 session full read、所有写 403；更新 README 公开 credential 并重新 smoke。Fixture 只有合成数据且只读，泄露影响被限制为读取和流量消耗。

### preview 泄露或缓存异常

立即回滚 Vercel release、撤下公开 URL/fixture，复现并补 regression test；检查 CDN/browser response、日志与 serializer，不只修 UI 隐藏。

### 数据清理

先运行 cleanup dry-run 输出各表计数，再由 server credential 执行；验证 FK 顺序、fixture exclude/include 参数和清理后 smoke。自动调度是 stretch。

## 隐私与诚实披露

- seed、测试、截图、README 只用合成数据。
- 公网表单可能被真实用户填写，因此按健康相关数据对待：最小字段、短 retention、无第三方 analytics payload、TLS、no-store。
- 没有最终用户自助删除 endpoint 是 MVP 已知限制；README 给出 session 到期/清理周期和项目维护者删除流程，不能宣称“随时自助删除”。
- 结果是一般 wellness 估算，不能用成功率、伪造进度或医学背书制造信任。

## Release 证据包

最终 README/交付记录保留：commit SHA、两组 CI 链接、Vercel deployment、Supabase migration version、advisor/ACL 检查结果、线上 smoke 时间、paid fixture expiry。所有证据仍遵守日志 allowlist。
