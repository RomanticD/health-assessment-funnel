# 08 · 测试与质量保障

## 测试金字塔

```text
少量 Playwright：真实浏览器全流程与恢复
中量 API/DB integration：事务、RLS/ACL、并发、幂等、鉴权
大量 unit/property：算法、校验、状态机、DTO 投影
```

所有测试使用合成数据、固定随机种子与注入 clock。测试数据库必须是本地 Supabase 或 CI 临时环境，绝不指向生产项目。

## 实施顺序

按用户要求，测试代码在全部功能实现并通过 typecheck/build 后，由独立 test agent 集中编写；测试计划和 oracle 则在编码前由本文件、OpenAPI 与算法黄金样例冻结。测试 agent 必须把第一轮失败如实交回主 agent，不能顺手修改生产代码或降低断言；主 agent 负责分类并修复。

## 命令契约

| 命令 | 内容 |
|---|---|
| `pnpm test` | 一键启动/复用本地测试栈，运行 unit + integration + contract |
| `pnpm test:unit` | 快速算法/状态/DTO 测试 |
| `pnpm test:integration` | fresh migration + DB/API 测试 |
| `pnpm test:e2e` | Playwright 浏览器流程 |
| `pnpm test:coverage` | 生成覆盖率与阈值检查 |
| `pnpm verify` | format-check + lint + typecheck + test + build + e2e |

若 Docker 未运行，`pnpm test` 应给出明确前置条件，而不是神秘超时。

## 单元测试矩阵

### 算法

- BMI/BMR/TDEE 公式与每个活动系数。
- lose/gain/maintain 分支；`improve_fitness` 明确不在 V1 enum。
- 边界、刚好越界、缺失、null、错误类型、未知字段。
- NaN、Infinity、极大指数等内部防御。
- 目标方向、BMI 下限、比例异常。
- calorie envelope 的 exact/刚好越界、不 silently clamp、速率 cap、ROUND_HALF_UP、固定 clock、跨月/闰年/跨年、104 周上限。
- fast-check 性质：finite、单调、确定性、曲线不越界。

### 状态与权限

- completedSteps/nextStep 推导。
- draft → ready；ready 下合法历史修改仍 ready，无效修改原子拒绝。
- completed 锁定。
- preview/full DTO 分支。
- 递归扫描 preview JSON，保护字段名完全不存在。
- subscription active/expired/canceled/future 的 entitlement 判断。

## 集成测试矩阵

### Session 与所有权

- 创建 session 后 token 明文不出现在 DB。
- 首次 token 只返回一次；有效复用不重发、不轮换；过期、管理员撤销、格式错误 token。
- Cookie 与 Bearer 相同可用，不同返回 `AMBIGUOUS_SESSION`。
- A 读取/修改 B 的 assessment 返回 404。
- body 伪造 userId/subscriptionStatus 被 strict schema 拒绝。
- Cookie 写请求 Origin 缺失/不匹配返回 403；纯 Bearer cURL 正常。
- `demo_readonly` 对 create/save/submit/pay 全部 403，且 fixture 状态不变。

### 分步保存与恢复

- 每一步保存后用全新 HTTP request 恢复。
- 中断在任意 required step，answers/completedSteps/nextStep 正确。
- 跳过前置步骤返回 409，数据库不变化。
- 修改历史步骤成功，revision 只增一次。
- 同幂等键同 payload 重放不增 revision。
- 同幂等键异 payload 返回 409。
- 校验/权限/precondition 失败不留下幂等记录；修正后可用同 key 重新发起。
- 缺 If-Match 返回 428；stale revision 返回 412。
- 两个并发请求用同 revision，恰好一个成功、一个失败，无丢失更新。

### 提交与结果

- 缺任一必填字段 submit 返回 422 并列出缺失项。
- 业务目标冲突被拒绝。
- 合法 submit 原子写 basic/details result 并 completed。
- 人为制造 details 写失败时 assessment/result 全部回滚。
- 重复/并发 submit 只生成一个 result。
- input snapshot 与提交 revision 一致。

### 订阅与 `/pay`

- 无 session、非 owner、未 completed assessment 分别拒绝。
- 首次 pay 写一条 event 并激活 subscription。
- 同 key 重放不重复 event/延长有效期。
- 同 key 异 body 冲突。
- 并发 pay 最终只有一个有效 current subscription。
- A 支付不影响 B。
- active → full；expired/canceled → preview。
- preview → pay → full 在同一 API E2E 中验证。

### Supabase 安全

- 使用 publishable/anon 身份直接请求 Data API，业务表不可读写（验证 ACL/RLS 的 public fail-closed）。
- `authenticated` 也不能绕过 Next API 修改 subscription/payment event。
- functions 默认不可由 PUBLIC/anon/authenticated execute；`service_role` 只获显式 grant。
- 单独执行 BOLA 测试：server RPC 收到外部 assessment ID 时仍从 session digest 派生 owner，A 永远不能读写 B。该测试不以 RLS 作为通过理由。
- 每个写 RPC 用 `demo_readonly` session digest 调用均在数据库层失败，不能被绕过 route 后成功。
- migration 从空数据库完整 reset。
- 生成的 Database types 与 schema 一致。
- security/performance advisors 在 DDL 后检查。

## Contract 测试

- 手工维护的 OpenAPI 中每个 endpoint 有成功与主要错误响应。
- 真实响应通过 Zod/OpenAPI schema。
- `application/problem+json`、稳定 error code、traceId 正确。
- ETag、Cache-Control、Vary、Set-Cookie 安全属性正确。
- 未知字段、错误 content type、大 body 被拒绝。
- cURL 文档片段在 smoke 脚本中实际运行。
- Idempotency-Key 长度/字符集、24h TTL、same-key replay 优先于 stale ETag、最小 replay payload 均有断言。

## Playwright 场景

1. 新用户从入口完成完整 funnel。
2. 保存到中间步骤，刷新/新开页，恢复到正确位置。
3. 输入边界错误时可理解且焦点移动到错误字段。
4. 模拟保存失败，输入不丢失，重试后成功。
5. 结果页先显示 preview/锁定内容说明。
6. 点击明确的 demo pay，确认不会扣款，随后 full 结果出现。
7. 重新加载 full 仍保持；subscription 过期 fixture 返回 preview。
8. 移动视口、键盘操作、基础无障碍名称与焦点。

## 覆盖率策略

- 不追求整个 Next UI 的虚高全局百分比。
- `server/domain` 与 `server/application` 设高阈值，目标 statements/lines ≥ 90%、branches ≥ 85%。
- route/repository 用场景覆盖与真实 DB 断言，不用大量脆弱 mock 抬覆盖率。
- CI 上传 coverage、失败 Playwright trace/screenshot；不提交生成物到 Git。

## CI 门禁

每次 push/PR 保持两个易读 job，减少两天内的 CI 编排成本：

1. `quality`：immutable install、secret scan、format/lint/typecheck、unit/property、production build。
2. `integration-e2e`：local Supabase fresh reset、ACL/RLS/RPC/contract tests、Playwright preview→pay→full；失败上传 coverage/trace。

生产 `db push` 不绑定每次 push，只在明确 milestone 经人工 gate 运行；两个 job 全绿是部署前置条件。

## Flake 与隔离

- 每个测试创建独立 user/session/assessment；不依赖执行顺序。
- clock、UUID/random 可注入或固定。
- 并发测试使用 barrier 同时发出请求，不靠 `sleep` 猜时序。
- Playwright 使用确定性 seed，不调用真实第三方支付。
- CI 失败不得简单重跑掩盖；先保存 trace 并定位。

## 暂不覆盖及理由

- 真实支付 provider webhook 签名：题目只要求模拟 `/pay`。
- 大规模压测/长时间 soak：2 天范围；保留索引与简单并发验证。
- 全浏览器矩阵与像素回归：UI 非评分重点；优先 Chromium + 移动 viewport。
- 医疗有效性临床验证：本项目明确不是医疗产品。
- 灾备恢复演练：依赖 Supabase 平台能力，README 记录限制。
- 自动 retention cron：MVP 提供 dry-run cleanup 脚本及测试；调度属于 stretch。
