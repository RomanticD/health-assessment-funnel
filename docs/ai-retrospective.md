# AI collaboration retrospective

本次交付没有把 AI 当成“从提示词一次生成项目”的代码打印机，而是把它放进需求、实现、验证、反驳和独立审查的闭环。最终责任仍由工程不变量和可运行证据承担。

## AI 参与了什么

| 阶段        | AI 的作用                                                             | 接受前的验证                                             |
| ----------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| 竞品体验    | 用浏览器梳理 BetterMe 的单题节奏、进度感、针对性过渡与付费结果层次    | 实际操作页面；没有假装完整复刻竞品内部系统               |
| 需求拆解    | 把题面转成 traceability、API、DB、状态机、测试和交付矩阵              | 独立 planning review 对照原始要求找缺项                  |
| 数据建模    | 生成关系、约束、索引、RLS/ACL 和事务 RPC 候选                         | 空库 reset、SQL smoke、catalog 查询、Supabase advisors   |
| 类型与 API  | 起草 strict Zod contracts、Problem Details、ETag/幂等边界             | TypeScript typecheck、HTTP smoke、恶意/异常输入          |
| 算法        | 起草 BMI、Mifflin-St Jeor、活动系数、目标速率和 projection            | Decimal 明确舍入；独立手算 golden oracle；边界测试       |
| Mock 数据   | 组合正常、min/max、方向矛盾、不安全目标、未成年人等 synthetic fixture | 同时通过 Zod、DB CHECK/RPC 与预期错误 code               |
| 前端        | 从竞品节奏和 UI/UX 规则生成可访问的 funnel、错误状态和 paywall        | 真实浏览器、刷新恢复、键盘/焦点、移动断点、线上流程      |
| 测试        | 独立 agent 在功能完成后扩充 unit/integration/E2E 与 CI                | 主 agent 复核覆盖，不以 agent 自述代替命令结果           |
| Code review | 后端、数据库、前端由不同 agent 做专项审查                             | 只接受能指向具体代码/失败场景的发现；修复后重跑完整 gate |

## AI 如何提高两天效率

最明显的收益不是“少写几行代码”，而是并行展开不同风险面：一条线实现 API，一条线检查数据库事务/ACL，一条线完成可访问前端，主线持续集成和运行真实 smoke。规划文档提前冻结了命名、状态机、错误码、算法版本和结果权限，使不同 agent 不需要凭感觉发明不兼容接口。

AI 还适合机械扩展边界矩阵，例如 `min-ε / min / max / max+ε`、同幂等键同/不同 body、两个 stale ETag 并发写、非 owner UUID、preview 的递归敏感字段扫描。每个用例都必须对应一个可解释的不变量，避免为了覆盖率堆重复断言。

## 一次我明确否决的 AI 结果

算法规划初稿曾把 `female / 32 岁 / 165 cm / 68 kg` 的 BMI 写成 overweight，并给出 BMR 1380。实际计算：

```text
BMI raw = 68 / 1.65² ≈ 24.977（healthy_weight，不是 overweight）
BMR = 10×68 + 6.25×165 - 5×32 - 161 = 1390.25
```

如果让 AI 同时复制这组错误 expected value 到实现和测试，会出现“测试全绿但业务数字错误”的危险假象。我没有调小误差或改分类阈值来迁就用例，而是否决样例，换成边界不含糊且可人工复算的 `70 kg` golden case：BMI 25.7、BMR 1410、TDEE 1939、建议热量 1551。数据库 smoke 与 HTTP E2E 也使用同一公开输入，但 expected number 由独立公式先复核。

另一个被否决的常见建议是“先查询完整结果，再在 TypeScript 中 delete 会员字段”。它短期代码少，但一旦新增嵌套字段、日志或 cache，很容易在删除前泄漏。最终采用 basic/details 物理拆表与 preview/full 双 allowlist，测试递归断言保护字段在 preview 整个响应树中都不存在。

## 如何避免盲信 AI

- 数据库发现必须能落到 migration line、SQL 复现或 catalog/advisor 结果。
- 算法 expected value不能由被测函数本身生成；使用手算/独立 oracle。
- agent “已通过”之后，主线仍重跑 format、lint、typecheck、build、DB reset 和关键 E2E。
- 对安全建议按真实威胁与题目范围排序；在核心鉴权、BOLA、RLS、secret、CSRF 完成后，不继续无限扩张与交付无关的防御项目。
- 密钥从不进入 prompt 生成文件、Git、测试 snapshot 或日志；生产 secret 只写入托管平台 secret store。

## AI 没有替代的判断

产品节奏、健康免责声明、合理输入边界、哪些字段值得强类型、幂等与 revision 谁优先、preview 应该显示多少价值、何时停止安全强化转向完整交付，这些都需要工程取舍。AI 能提出方案和反例，但不能替项目承担数据泄漏、错误健康结论或无法上线的责任。
