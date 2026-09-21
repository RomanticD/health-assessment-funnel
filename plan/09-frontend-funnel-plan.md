# 09 · 前端漏斗与基础体验

## 目标

UI 不做像素级竞品复刻，但必须让真实用户愿意走完：清楚、轻、可信、随时可恢复，并诚实说明 demo 支付和算法限制。

## 路由

```text
/                       产品价值与开始按钮
/quiz/[stepKey]         单题流程
/quiz/review            提交前回顾
/result/[assessmentId]  preview/full 结果与 paywall
/privacy                数据与隐私说明
/methodology            公式与限制
```

访问 `/quiz` 时先恢复 current assessment，再由服务端 `nextStep` redirect，不能只信 URL。

## 交互节奏

1. Landing：一句明确承诺、约 2 分钟、数据会保存、非医疗说明。
2. 单题页：一个问题、简短解释、清晰选项、键盘可用。
3. 自动推进只用于明确单选；多选/数字输入要求用户确认。
4. 顶部显示真实步骤进度与返回按钮。
5. 中途插入 1–2 个轻量解释/信任页面，不复制竞品营销文案。
6. Review：展示 canonical 值，可回到历史步骤修改。
7. 计算：短暂、可访问的 loading；实际失败显示可重试，不伪造进度。
8. Result preview：先提供 BMI/分类和宽范围价值，再展示被锁内容。
9. Paywall：明确“模拟支付，不会扣款”；列出将解锁的具体字段。
10. 支付后重新请求服务端结果，展示完整曲线与算法说明。

## 保存状态

| 状态 | UI |
|---|---|
| idle | 正常输入 |
| saving | 按钮/选项显示非阻塞保存指示 |
| saved | 短暂“已保存”，随后推进 |
| retryable error | 保留输入、解释网络问题、提供重试 |
| validation error | 字段旁消息 + summary，焦点移动 |
| revision conflict | 提示其他标签页已更新，重新加载最新数据 |
| session expired | 解释旧身份已过期；健康答案不跨身份落本地，用户明确重新开始 |

## 表单与单位

- 内部 API 始终 cm/kg。
- UI 可切换 metric/imperial，但转换后再校验；切换不重复舍入污染数据。
- `inputmode="decimal"` / `numeric` 优化移动键盘。
- 数字输入不在每个 keypress 强制格式化，避免光标跳动。
- 明确单位、允许范围与示例；错误不只靠颜色。

## 信任与文案

- “你的进度已安全保存”只在 API 成功后显示。
- 解释为什么需要身体数据、如何使用、保存多久。
- 不写“保证减重”“医学认可”等无法证明声明。
- 结果日期标记为估算，不制造虚假精确性。
- 支付按钮写清 `Unlock demo result — no real charge`。
- FAQ 覆盖数据删除/过期、算法、订阅模拟、隐私。

## 无障碍最低标准

- 语义 `fieldset/legend` 或等价可访问名称。
- 所有交互键盘可操作，有明显 focus ring。
- 进度和保存状态使用适当 live region，但避免频繁打扰。
- 错误与字段通过 `aria-describedby` 关联。
- 颜色对比达到 WCAG AA 基础要求。
- 支持 `prefers-reduced-motion`；不让动画阻止填写。

## 响应式与视觉

- mobile-first，主要内容窄列、触控目标 ≥ 44px。
- 中性温暖背景、一个主强调色、清晰标题层级。
- 卡片选项、足够留白、轻量进度线；避免廉价倒计时和暗黑模式诱导。
- 图表仅 full 显示，带文本摘要，不以颜色作为唯一编码。

## 前端数据原则

- server response 是权威；年龄、身高、体重、目标和答案不进入 localStorage/sessionStorage，未保存字符只留组件内存。
- localStorage 只允许非敏感的单位/展示偏好或路由提示。
- 不在客户端保存 subscription truth 或自行拼 full result。
- 受保护字段从 API 不返回，因此前端 bundle/HTML 中也不存在。
- Result page 和个性化 API 禁止静态生成/共享缓存。
- 埋点若时间允许只记录匿名步骤事件，不带体重等健康 payload；默认不接第三方 analytics。

## 验收

- 正常流程、刷新恢复、返回修改、错误重试、preview/pay/full 全部可演示。
- 移动 viewport 无横向滚动、按钮不被键盘遮挡。
- Playwright 覆盖主流程；人工检查文案、层级、焦点和基本视觉一致性。
