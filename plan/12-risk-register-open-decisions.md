# 12 · 风险登记、阻塞与开放决策

## 风险登记

| ID | 风险 | 概率/影响 | 预防与应对 | Owner/截止 |
|---|---|---|---|---|
| K01 | 题面 2 天/3 天矛盾导致范围失控 | 高/高 | 以 2 天为硬截止，冻结非核心范围 | 开工前 |
| K02 | GitHub 无法 push | 已解决/高 | CLI OAuth 已恢复，private repo 已创建并完成首推 | resolved |
| K03 | Docker daemon 未启动，集成测试跑不起来 | 已解决/高 | Docker/Supabase fresh stack 与 CI 均已通过 | resolved |
| K04 | Supabase CLI 未安装/版本漂移 | 已发生/中 | 固定 devDependency + lockfile，所有命令先 `--help` | scaffold |
| K05 | 当前 public 默认 ACL 过宽 | 高/高 | 首 migration revoke defaults + RLS + 权限测试 | 首 migration |
| K06 | server secret 泄露到客户端/日志 | 低/严重 | server-only env、secret scan、bundle grep、日志脱敏 | 持续 |
| K07 | service role 绕过 RLS 放大代码 bug | 中/高 | RPC 同事务从 session hash 派生 owner、全查询 owner filter、BOLA tests；RLS 只作 public fail-closed | ADR 已冻结 |
| K08 | 分步并发丢失更新 | 中/高 | revision/If-Match + 事务 CAS + 并发测试 | persistence 完成 |
| K09 | 幂等记录与业务写不原子 | 中/高 | 同一 DB transaction，故障注入测试 | API 完成 |
| K10 | preview 泄露 protected data | 中/严重 | 物理拆表、独立 allowlist DTO、recursive negative tests、no-store | result 完成 |
| K11 | 支付后仍拿缓存 preview | 中/高 | dynamic + `private,no-store` + 支付后 refetch + header tests | result 完成 |
| K12 | 健康算法被误解为医疗建议 | 中/高 | 明确非医疗声明、保守边界、warning、方法页 | UI/docs |
| K13 | 公式/测试复制同一 AI 错误 | 中/高 | 独立 oracle、性质测试、手算样例、agent review | algorithm |
| K14 | paid fixture 被公开用户污染 | 已缓解/中 | `demo_readonly`、旧凭证撤销、轮换记录和自建 session cURL | release evidence |
| K15 | Vercel/Supabase 区域延迟 | 中/中 | 选择接近用户/DB 的 runtime、测 smoke、避免多次往返 | deploy |
| K16 | 免费项目休眠/限额影响演示 | 中/高 | 交付前唤醒与 smoke，README 提示；避免高资源后台任务 | final |
| K17 | 依赖最新版本兼容问题 | 中/中 | 稳定版、Node 22、锁文件、build early | scaffold |
| K18 | 邮件/文档姓名缺失 | 高/中 | 最终阶段向用户获取姓名并预览邮件 | final |
| K19 | 误以为 `seed.sql` 会随 production migration 部署 | 已缓解/中 | seed 仅 local/CI；受控 provisioning/rotation runbook + remote smoke | release evidence |
| K20 | 两天排期无余量导致测试/部署被挤掉 | 高/高 | Must/Stretch 冻结，20h 中保留 3h buffer | 持续 |

## 已解决的环境疑问

- Supabase organization 名称与 project 名称不同；目标 project 是 `RomanticD's Project`，ref 为 `kfyqgzuatywmsuruwsei`。
- 项目是空库，适合由 versioned migration 建立干净基线。
- 本地 Git 已以 `main` 初始化。
- 仓库名由实现内容决定，建议 `health-assessment-funnel`。

## 外部配置状态

### 1. GitHub 认证

已解决：`gh auth login` 成功，`RomanticD/health-assessment-funnel` private repository 已创建，`main` 跟踪 `origin/main`。

### 2. Vercel 目标

Vercel team `romanticds-projects` 已可见；deploy connector action 不可用，CLI 登录端点失败，因此改用已登录 Dashboard 从 GitHub 导入，再记录 project linkage。

### 3. 最终姓名

用于最终邮件署名和附件命名；仓库内已使用中性的 `Kindred-Health_delivery_20260922.md`，外发前由交付人确认。

## 技术决策：默认与备选

### Session

默认：自建高熵匿名 token + server-only Supabase access。
优点：cURL 与 paid session 直观、无需账号、符合题目。
风险：server role 会绕过 RLS，不能把 RLS 当 owner auth。
缓解：表对客户端 deny-all；token digest；每个写 RPC 同事务解析 session→owner/scope；所有 owner-sensitive read 带 session-derived owner filter；直接 Data API fail-closed 与 BOLA 分开测试。

备选：Supabase Anonymous Auth + `@supabase/ssr` + auth.uid RLS。
优点：行级所有权更强。
代价：需显式开启匿名 Auth/CAPTCHA、处理匿名清理与 cookie/JWT、已支付 sessionId/cURL 更复杂。
本轮 agent review 已选择默认方案；除非实现证据证明 RPC 路径不可行，不在两天内切换身份体系。

### 乱序

默认：允许修改历史步骤，拒绝跨过前置步骤的未来写入。
备选：接受任意步骤后按 completed prefix 恢复。
理由：竞品和本题流程明确顺序，拒绝更易解释并验证。

### 数据库访问

默认：server-only `supabase-js` + 受限事务 RPC。
备选：Supabase pooled `DATABASE_URL` + typed SQL repository。
切换条件：RPC schema exposure/config 阻塞，或直接 SQL 能以更少权限稳定部署。

## Go/No-Go 检查（最终状态）

进入远端变更前必须：

- [x] review P0 清零。
- [x] GitHub 认证恢复且 remote owner/visibility 确认。
- [x] Docker/Supabase local test 栈可启动。
- [x] session ADR 最终冻结。
- [x] migration 已在空本地库通过。
- [x] 无真实健康数据或 secret 进入 seed/repo。
