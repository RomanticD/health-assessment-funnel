# 11 · AI 协作计划与复盘证据

## 原则

AI 用于扩大覆盖面和并行验证，不代替工程责任。每个 AI 产物必须落到可审查的 schema、类型、测试或命令结果；“AI 说对了”不是证据。

## AI 的具体使用方式

| 工作 | AI 角色 | 人工/工具验证 |
|---|---|---|
| 竞品观察 | 提炼页面、数据与恢复/付费模式 | Computer 实际浏览，不凭记忆 |
| 需求拆解 | 生成覆盖矩阵、发现隐含边界 | 与原题逐条映射 R-ID |
| DB 建模 | 提出关系、约束、索引、RLS 候选 | migration reset、SQL tests、advisors |
| API 契约 | 候选路径/status/error schema | OpenAPI contract tests、curl smoke |
| 算法 | 生成公式实现与边界样例 | 手工公式 oracle、表驱动/property tests |
| Mock 数据 | 组合边界与并发 fixture | Zod + DB CHECK，固定 seed |
| 测试 | 扩充异常、竞态、泄露用例 | 先看到测试失败，再实现通过 |
| 安全审查 | BOLA、CSRF、缓存、secret、RLS threat modeling | 负向请求与直接 Data API 测试 |
| 文档 | 生成初稿与一致性检查 | 运行文档命令，检查链接/字段 |
| Code review | 独立 agent 按 P0/P1/P2 审查 | 修复记录进 review 文档 |

## 推荐的协作闭环

```text
需求/风险 → AI 生成候选 → 人工选定不变量 → AI 生成实现/测试
        → 运行失败用例 → 修复 → 独立 agent review → CI/线上证据
```

## Prompt/决策日志

实现过程中在 `docs/ai-retrospective.md` 维护精简日志：

| 日期 | 任务 | AI 建议 | 采纳/拒绝 | 验证证据 |
|---|---|---|---|---|
| 2026-09-21 | 需求/Schema 初步审查 | 强类型核心字段、扩展 JSONB | 采纳 | 计划与后续 migration tests |
| 2026-09-21 | 结果权限 | preview/full 显式 DTO + 物理拆表 | 采纳 | 字段泄露负向测试 |
| 2026-09-21 | 身份策略 | Supabase Anonymous Auth vs 自建高熵 session | 选择 256-bit opaque session | cURL/paid fixture 适配；RPC 内 session→owner BOLA 测试 |
| 2026-09-21 | 算法样例复核 | 初稿把 68kg/165cm 的 BMI 写成 overweight，并给出错误 BMR | 否决并替换为 70kg 可复算 oracle | Decimal 手算 + API/domain 共用黄金测试 |

不记录密钥、真实数据、完整隐私载荷或无价值的长对话转储。

## 必须包含的“否决 AI”案例

最终复盘至少写一个真实发生、可以解释工程原因的否决。候选：

### 候选 A：把全部测评答案放入单个 JSONB

**为什么看起来诱人**：分步 merge 快，新增问题无需迁移。
**为什么否决**：核心身高/体重/年龄失去强约束，查询/索引/迁移困难，非法数据更容易绕过。
**修订**：核心字段强类型列；只把非核心、版本化扩展题放 JSONB。

### 候选 B：把 subscription status 放入 JWT/app metadata

**为什么看起来诱人**：结果接口无需查库。
**为什么否决**：JWT 可能陈旧，支付后不能即时解锁，取消/过期也不能即时回收；user metadata 还可被用户编辑。
**修订**：每次结果读取实时查数据库 entitlement。

### 候选 C：先构造完整结果再在 TypeScript 中 delete 保护字段

**为什么看起来诱人**：复用一个 DTO。
**为什么否决**：新增嵌套字段时容易漏删，日志/cache 也可能先拿到完整对象。
**修订**：数据库 basic/details 拆表；preview/full 分别 allowlist 构造。

### 已发生 D：AI 生成的算法样例数字自相矛盾

**原建议问题**：初稿声称 female/32 岁/165 cm/68 kg 的 BMI 为 25 且属于 overweight，并给出 BMR 1380；实际 BMI raw 约 24.98（按 raw 应为 healthy_weight），Mifflin BMR 为 1390.25。
**为什么否决**：如果测试照抄同一错误 expected value，会得到“实现与测试一起错”的假绿色。
**修订**：换成 70 kg 的黄金样例，逐步公开 raw 计算、half-up、预测日期；API 示例与 domain test 引用同一人工复算 oracle。

最终文档只把确实在实现过程中遇到并判断过的案例写成“实际否决”。

## AI 生成测试的质量规则

- 先给边界表和不变量，再让 AI 写用例，避免只有 happy path。
- 同一规则至少含 `min-ε / min / max / max+ε`。
- 并发用 barrier/Promise.all 与数据库断言，不用延时模拟。
- 权限测试从攻击者角度断言“字段不存在/资源不可枚举”。
- 每个 bug 修复先加能复现的 regression test。
- 对 AI 给出的 expected number 用独立公式或手算 oracle 验证，防止实现与测试复制同一错误。

## Agent review 机制

- 规划完成后由独立 agent 读取实际文件，按 P0/P1/P2 输出。
- 数据库安全另由熟悉 Supabase 的 agent 检查 ACL、RLS、函数 grants 和迁移流程。
- P0：会导致数据泄露、要求缺失、不可部署或测试无法证明；进入实现前必须清零。
- P1：显著影响评分/稳健性；原则上修复或写出接受理由。
- P2：可读性或未来优化；排入 backlog。

## 最终复盘结构

1. AI 参与了哪些任务，节省了什么时间。
2. 哪些产物由 AI 初稿、哪些由人工决定。
3. 如何验证 AI 产出，而不是凭感觉接受。
4. 一次具体错误/不合适建议、否决理由和替代方案。
5. AI 未解决或仍需人工判断的限制。
6. 对两天节奏的实际影响，用 commit/CI 时间线佐证。
