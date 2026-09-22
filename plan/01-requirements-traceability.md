# 01 · 需求可追踪矩阵

> 本页最初用于规划，现已在发布前回填最终状态；详细证据以 [`delivery/evidence/requirements-matrix.md`](../delivery/evidence/requirements-matrix.md) 为准。

下表用于避免“功能做了，但无法证明”或“测试存在但没有覆盖边界”。状态只使用 `verified`、`implemented`、`observed`、`user-action` 和 `partial`。

| ID | 原始/隐含需求 | 设计落点 | 验收证据 | 状态 |
|---|---|---|---|---|
| R01 | 体验参考 funnel | 记录已实际观察的前半段；后续重复问答与最终页按用户补充建模，不伪称实测 | `02-competitor-analysis.md` | observed in approved scope |
| R02 | 每步增量保存 | `PUT /steps/{stepKey}` + step DTO | API 集成测试 | verified |
| R03 | 中断后恢复 | current assessment、completedSteps、nextStep、revision | 新请求/刷新恢复测试 | verified |
| R04 | 核心字段完整 | `assessment_core_inputs` 强类型字段 | Migration + contract tests | verified |
| R05 | 服务端 BMI | 纯函数 domain 模块 | 表驱动单元测试 | verified |
| R06 | 建议摄入量 | BMR/TDEE/活动系数/目标调整 | 单元与性质测试 | verified |
| R07 | 目标日期 | 注入 Clock、UTC 日期、速率上限 | 跨月/年确定性测试 | verified |
| R08 | 结果持久化 | input snapshot + algorithm version + result | DB 集成测试 | verified |
| R09 | 订阅鉴权 | 每次结果请求实时查询有效 entitlement | active/expired/canceled 测试 | verified |
| R10 | 非会员脱敏 | preview/full 两个 allowlist DTO | 保护字段不存在断言 | verified |
| R11 | 会员完整结果 | full DTO 含精确数值与曲线 | contract/E2E | verified |
| R12 | `/pay` 修改状态 | 当前会话自助激活、事务 upsert | 重放与并发测试 | verified |
| R13 | 非法数值注入 | Zod 严格校验 + PostgreSQL CHECK | API 与 DB 双层测试 | verified |
| R14 | 算法极端/缺失值 | 边界表、非有限值、目标冲突 | 单元测试矩阵 | verified |
| R15 | 乱序提交 | 固定步骤图；跳步 409；历史步骤可修订 | 集成测试 | verified |
| R16 | 重复提交 | `Idempotency-Key + request_hash` | 同载荷 replay / 异载荷 409 | verified |
| R17 | 并发更新 | `revision + ETag/If-Match` 乐观锁 | 并发仅一方成功 | verified |
| R18 | 提交状态一致 | 完整性检查与计算同一事务 | 故障回滚测试 | verified |
| R19 | 支付前后闭环 | preview → pay → full | API E2E + Playwright | verified |
| R20 | 一键测试 | `pnpm test` | 本地和 CI 日志 | verified |
| R21 | CI 加分项 | GitHub Actions 全门禁 + badge | 绿色 workflow | verified |
| R22 | 公网部署 | Vercel + Supabase | 线上 URL + smoke | verified |
| R23 | `/pay` cURL | Cookie jar/Bearer 两种示例 | README 实际重放 | verified |
| R24 | 已支付 sessionId | 合成、可轮换、DB/RPC 强制只读 fixture；明确这是公开测试凭证 | README 对比示例 + 写入拒绝测试 | verified |
| R25 | GitHub 仓库 | main、清晰历史、关键更改即 push | repo URL / git log | verified |
| R26 | Schema 图 | Mermaid ERD + 字段/关系说明 | README/docs + Supabase Visualizer | verified |
| R27 | AI 使用复盘 | 任务、输入、校验、否决案例 | `docs/ai-retrospective.md` + `delivery/evidence/ai-review.md` | verified |
| R28 | 前端能吸引完成 | 单焦点、进度、信任、即时保存反馈、移动优先 | Playwright + 手工视觉审查 | implemented |
| R29 | Auth/BOLA | token 绑定 owner，不接收 userId，跨用户 404 | 安全集成测试 | verified |
| R30 | 缓存安全 | 动态结果、`private, no-store` | header 测试 | verified |
| R31 | CSRF | SameSite Cookie + Origin 检查；Bearer 不受 Cookie CSRF | API 安全测试 | verified |
| R32 | 数据最小化 | 只收算法所需字段；无真实邮箱/姓名 | Schema/README | verified |
| R33 | 迁移可重建 | versioned SQL、fresh reset | CI fresh DB job | verified |
| R34 | RLS/默认权限 | revoke default ACL、全表 RLS、无客户端表访问 | anon bypass 测试 + advisors | verified |
| R35 | 可观测性 | `14-observability-privacy-operations.md` 的 allowlist 日志、requestId、health、runbook | smoke/脱敏日志样例 | implemented |
| R36 | 数据留存 | 会话、草稿、幂等记录、日志、fixture 均有期限与清理说明 | retention 文档/运维 runbook | implemented |
| R37 | 四邮箱与命名 | 外发邮件和收件人由交付人最后确认 | 交付前 user-action | user-action |
| R38 | 公开 fixture 不可破坏 | `demo_readonly` 由事务 RPC 拒绝所有业务写 | BOLA/写入负向集成测试 | verified |
| R39 | 线上 fixture 可复现 | seed 仅本地/CI；远端通过受控 Supabase provisioning/rotation runbook 管理 | 远端 smoke + release evidence | partial |

## 隐含验收场景

原始需求未逐字写出、但发布验收会检查：

- 修改 URL 中的 assessment ID 是否能读到他人数据。
- 非会员是否可从嵌套字段、错误对象、缓存或旧响应拿到曲线。
- 支付后同一结果请求是否因缓存仍返回 preview。
- 两个标签页同时保存是否丢失更新。
- 复用同一幂等键但换 payload 是否被拒绝。
- submit 重试是否产生两条结果或两次不同预测。
- 目标体重与目标方向冲突是否被拒绝。
- `NaN`、`Infinity`、数字字符串、科学计数巨大值、额外字段是否被挡住。
- 订阅已过期或取消后是否重新锁定。
- migration 从空库执行和 rollback/重置是否可重复。
- 线上 demo 是否只含合成数据，且 token 可轮换。

## 文档到实现的追踪方式

- PR/commit 描述引用 R-ID，例如 `Implements R02, R03, R15–R17`。
- 测试标题引用 R-ID，避免覆盖统计与真实需求脱节。
- README 交付表最终把每个 R-ID 链接到代码、测试或线上证据。
- 任何删除或降级需求必须写 ADR，不允许静默省略。
