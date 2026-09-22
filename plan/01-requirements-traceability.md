# 01 · 需求可追踪矩阵

> 这份 planning 快照保留了最初的 `planned` 标记以便回看执行过程；最终验收状态以 [`delivery/evidence/requirements-matrix.md`](../delivery/evidence/requirements-matrix.md) 为准，那里只标记已经有代码与测试/线上证据的项目。

下表用于避免“功能做了，但无法证明”或“测试存在，但没覆盖题目要求”。实现阶段每项状态从 `planned` 更新为 `implemented` / `verified`，并链接代码或 CI 证据。

| ID | 原始/隐含需求 | 设计落点 | 验收证据 | 状态 |
|---|---|---|---|---|
| R01 | 体验参考 funnel | 记录已实际观察的前半段；后续重复问答与最终页按用户补充建模，不伪称实测 | `02-competitor-analysis.md` | observed in approved scope |
| R02 | 每步增量保存 | `PUT /steps/{stepKey}` + step DTO | API 集成测试 | planned |
| R03 | 中断后恢复 | current assessment、completedSteps、nextStep、revision | 新请求/刷新恢复测试 | planned |
| R04 | 核心字段完整 | `assessment_core_inputs` 强类型字段 | Migration + contract tests | planned |
| R05 | 服务端 BMI | 纯函数 domain 模块 | 表驱动单元测试 | planned |
| R06 | 建议摄入量 | BMR/TDEE/活动系数/目标调整 | 单元与性质测试 | planned |
| R07 | 目标日期 | 注入 Clock、UTC 日期、速率上限 | 跨月/年确定性测试 | planned |
| R08 | 结果持久化 | input snapshot + algorithm version + result | DB 集成测试 | planned |
| R09 | 订阅鉴权 | 每次结果请求实时查询有效 entitlement | active/expired/canceled 测试 | planned |
| R10 | 非会员脱敏 | preview/full 两个 allowlist DTO | 保护字段不存在断言 | planned |
| R11 | 会员完整结果 | full DTO 含精确数值与曲线 | contract/E2E | planned |
| R12 | `/pay` 修改状态 | 当前会话自助激活、事务 upsert | 重放与并发测试 | planned |
| R13 | 非法数值注入 | Zod 严格校验 + PostgreSQL CHECK | API 与 DB 双层测试 | planned |
| R14 | 算法极端/缺失值 | 边界表、非有限值、目标冲突 | 单元测试矩阵 | planned |
| R15 | 乱序提交 | 固定步骤图；跳步 409；历史步骤可修订 | 集成测试 | planned |
| R16 | 重复提交 | `Idempotency-Key + request_hash` | 同载荷 replay / 异载荷 409 | planned |
| R17 | 并发更新 | `revision + ETag/If-Match` 乐观锁 | 并发仅一方成功 | planned |
| R18 | 提交状态一致 | 完整性检查与计算同一事务 | 故障回滚测试 | planned |
| R19 | 支付前后闭环 | preview → pay → full | API E2E + Playwright | planned |
| R20 | 一键测试 | `pnpm test` | 本地和 CI 日志 | planned |
| R21 | CI 加分项 | GitHub Actions 全门禁 + badge | 绿色 workflow | planned |
| R22 | 公网部署 | Vercel + Supabase | 线上 URL + smoke | planned |
| R23 | `/pay` cURL | Cookie jar/Bearer 两种示例 | README 实际重放 | planned |
| R24 | 已支付 sessionId | 合成、可轮换、DB/RPC 强制只读 fixture；明确这是公开 demo credential | README 对比示例 + 写入拒绝测试 | planned |
| R25 | GitHub 仓库 | main、清晰历史、关键更改即 push | repo URL / git log | blocked: auth |
| R26 | Schema 图 | Mermaid ERD + 字段/关系说明 | README/docs | planned |
| R27 | AI 使用复盘 | 任务、输入、校验、否决案例 | `docs/ai-retrospective.md` | planned |
| R28 | 前端能吸引完成 | 单焦点、进度、信任、即时保存反馈、移动优先 | Playwright + 手工视觉审查 | planned |
| R29 | Auth/BOLA | token 绑定 owner，不接收 userId，跨用户 404 | 安全集成测试 | planned |
| R30 | 缓存安全 | 动态结果、`private, no-store` | header 测试 | planned |
| R31 | CSRF | SameSite Cookie + Origin 检查；Bearer 不受 Cookie CSRF | API 安全测试 | planned |
| R32 | 数据最小化 | 只收算法所需字段；无真实邮箱/姓名 | Schema/README | planned |
| R33 | 迁移可重建 | versioned SQL、fresh reset | CI fresh DB job | planned |
| R34 | RLS/默认权限 | revoke default ACL、全表 RLS、无客户端表访问 | anon bypass 测试 + advisors | planned |
| R35 | 可观测性 | `14-observability-privacy-operations.md` 的 allowlist 日志、requestId、health、runbook | smoke/脱敏日志样例 | planned |
| R36 | 数据留存 | 会话、草稿、幂等记录、日志、demo fixture 均有明确期限与清理说明 | retention 测试/运维命令/README | planned |
| R37 | 四邮箱与命名 | 最终文档按 `【姓名】_全栈挑战_YYYYMMDD`，邮件覆盖四个指定地址 | 发送前人工核对清单 | planned |
| R38 | demo fixture 不可破坏 | `demo_readonly` 由事务 RPC 拒绝所有业务写 | BOLA/写入负向集成测试 | planned |
| R39 | 线上 fixture 可复现 | `seed.sql` 仅本地/CI；显式 provisioning 脚本创建/轮换线上 fixture | 远端 smoke + 输出记录 | planned |

## 隐含验收场景

题面未逐字写出、但评审很可能会检查：

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
