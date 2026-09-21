# 07 · 健康算法、边界与验证

## 定位与版本承诺

`health-v1` 是可解释、确定性的产品演示估算，不是诊断、治疗或个体化营养处方。UI/README 必须提示：孕期、哺乳期、饮食障碍、未成年人、慢性病、用药或极端身体指标应咨询合格专业人士。

本文件直接冻结 V1 的公式、常量、边界、舍入与不可用行为；实现时不再留下“约 15–20%”之类会使测试失去 oracle 的范围表述。

## 输入模型

```ts
type HealthInputV1 = {
  sexForCalorieEstimation: 'female' | 'male'
  primaryGoal: 'lose_weight' | 'maintain_weight' | 'gain_weight'
  ageYears: number
  heightCm: number
  weightKg: number
  targetWeightKg: number
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
}
```

字段名刻意不用模糊的 `gender` 驱动代谢公式。UI 说明它只是该估算公式要求的二选一参数，不代表完整性别认同。`improve_fitness` 不进入 V1：它没有明确体重/热量语义，可作为未来内容型目标而非硬塞进算法。

## 数值与舍入规则

- 运算使用十进制定点库（如 `decimal.js`）；数据库用 `numeric`，不用 binary float 保存最终值。
- 所有分类和边界判断使用**未舍入 raw value**。
- `ROUND_HALF_UP`：BMI 展示 1 位小数；BMR、TDEE、exact calories 展示/保存为整数；投影体重 1 位小数。
- 日期以注入的 UTC calendar date 计算；同一输入/clock/algorithmVersion 必须字节级确定。

## V1 公式

### BMI 与类别

```text
BMI_raw = weightKg / (heightCm / 100)^2
underweight     BMI_raw < 18.5
healthy_weight  18.5 <= BMI_raw < 25
overweight      25 <= BMI_raw < 30
obesity         BMI_raw >= 30
```

类别阈值在 raw value 上判断，避免 24.96 显示为 25.0 后被错误分到 overweight。

### BMR：Mifflin–St Jeor

```text
base = 10 × weightKg + 6.25 × heightCm − 5 × ageYears
female: BMR_raw = base − 161
male:   BMR_raw = base + 5
```

### TDEE

| Activity | Factor |
|---|---:|
| sedentary | 1.200 |
| light | 1.375 |
| moderate | 1.550 |
| active | 1.725 |
| very_active | 1.900 |

```text
TDEE_raw = BMR_raw × activityFactor
```

活动系数是产品估算假设，随 `health-v1` 版本冻结，不宣传为临床精确值。

### 每日摄入估算

```text
lose deficit = min(500, TDEE_raw × 0.20)
lose calories_raw = TDEE_raw − deficit

gain surplus = min(300, TDEE_raw × 0.12)
gain calories_raw = TDEE_raw + surplus

maintain calories_raw = TDEE_raw
```

安全包络：female `1200..4500` kcal/day，male `1500..4500` kcal/day。上限是本演示的保守产品 guard，不宣称为普遍医疗阈值。

- 若 `calories_raw` 在包络内：`calorieEstimateAvailable = true`，exact 使用 half-up 整数。
- 若在包络外：**不 silently clamp**；返回 `calorieEstimateAvailable = false`、`exactDailyCalories = null`、`calorieRange = null`、`targetDate = null`、空 projection，并附 `PROFESSIONAL_GUIDANCE_RECOMMENDED`。
- preview range（仅 available 时）：exact 先 half-up 到最近 100，区间为中心 ±100；下界不低于该 sex floor，上界不高于 4500。它是宽提示，不是另一个算法结果。

### 目标日期与曲线

```text
energyPerKg = 7700 kcal  // 明确标注为静态简化假设
rawWeeklyRate = abs(TDEE_raw - calories_raw) × 7 / energyPerKg

lossWeeklyRate = min(rawWeeklyRate, 0.907 kg, currentWeight × 0.01)
gainWeeklyRate = min(rawWeeklyRate, 0.454 kg, currentWeight × 0.005)
weeks = ceil(abs(currentWeight - targetWeight) / weeklyRate)
```

- `lose_weight` / `gain_weight` 仅在 calorie estimate available 且 `weeks <= 104` 时给日期/曲线。
- 超过 104 周：`targetDate = null`、空 curve、warning `PREDICTION_HORIZON_EXCEEDED`；不画看似精确的多年直线。
- 曲线包含 week 0，之后每 7 天一点，最后一点 clamp 到目标值；最多 105 点且单调不越界。
- `maintain_weight` 不伪造“到达”过程：目标在容差内时返回 `targetDate = null`、只含 week 0 的平坦基线点，并用 `MAINTENANCE_GOAL_NO_ARRIVAL_DATE` 解释维持目标没有到达日期。
- 这是线性静态模型；真实体重变化会随时间和代谢适应而变化，README 明确列为限制。

## 输入与跨字段边界

| 字段 | 接受 | 拒绝示例 |
|---|---|---|
| ageYears | integer 18..80 | 17、81、80.5、`"32"`、null |
| heightCm | finite 120..230 | 0、119.99、230.01、Infinity |
| weightKg | finite 35..300 | -1、34.99、300.01、NaN |
| targetWeightKg | finite 35..300 | 0、1000、数字字符串 |
| enum | 精确白名单 | 大小写变体、未知值、空串 |
| object | strict keys，body ≤16 KiB | `subscriptionStatus`、额外深层 payload |

JSON 本身不能表达 NaN/Infinity，但纯函数必须防御内部调用与性质测试注入。年龄上限 80 是 V1 的外推控制；超出范围不是说用户“不健康”，只是本公式演示不作估算。

跨字段规则：

- 任一目标的 `abs(target-current) <= current × 0.40`。
- `lose_weight`：target < current，且 target BMI raw ≥ 18.5。
- `gain_weight`：target > current，且 target BMI raw ≤ 40。
- `maintain_weight`：`abs(target-current) <= max(1 kg, current × 0.02)`。
- 等于 current 只允许 maintain；方向矛盾、超 40% 或越过目标 BMI guard 均 422 `UNREASONABLE_TARGET`。
- 当前 BMI 极端但仍在单字段范围内可产生 warning；不能靠结果替代医疗建议。

## 输出类型

```ts
type HealthResultV1 = {
  algorithmVersion: 'health-v1'
  bmiRaw: Decimal
  bmi: number
  bmiCategory: 'underweight' | 'healthy_weight' | 'overweight' | 'obesity'
  bmrKcal: number
  tdeeKcal: number
  calorieEstimateAvailable: boolean
  exactDailyCalories: number | null
  calorieRange: { min: number; max: number } | null
  targetDate: string | null
  weightProjection: Array<{ date: string; weightKg: number }>
  warnings: WarningCode[]
}
```

数据库同时保存 canonical input snapshot、输入 revision、中间 raw 数值/展示值、算法版本和 calculatedAt。warning 是稳定 code，展示文本可本地化。

## 可复算的黄金样例

输入：female、32 岁、165 cm、70 kg、目标 60 kg、light、lose_weight；clock=`2026-09-21`。

```text
BMI_raw = 70 / 1.65² = 25.7116... → 25.7, overweight
BMR_raw = 10×70 + 6.25×165 − 5×32 − 161 = 1410.25 → 1410
TDEE_raw = 1410.25 × 1.375 = 1939.09375 → 1939
deficit = min(500, 387.81875) = 387.81875
calories_raw = 1551.275 → exact 1551; preview 1500..1700
weeklyRate = 387.81875 × 7 / 7700 = 0.35256... kg
weeks = ceil(10 / 0.35256...) = 29
targetDate = 2026-09-21 + 203 days = 2027-04-12
```

此样例作为 API 文档、domain unit test 和 smoke fixture 的共同 oracle，避免示例与实现分叉。

## 自动化测试设计

### 表驱动

- 每种 sex × activity × goal 至少一个正常样例。
- BMI 18.5/25/30 的 `-epsilon / exact / +epsilon`，验证 raw 分类与 display rounding 分离。
- 每个字段 min/max、刚好越界、缺失、null、错误类型、未知字段。
- target 等于/略低/略高、40% exact/+epsilon、目标 BMI guard exact/+epsilon。
- calorie envelope 内、exact floor、floor 以下、exact ceiling、ceiling 以上。
- UTC 月末、闰年、跨年、104 周 exact 与 105 周。
- 所有 `.5` half-up 行为显式固定。

### 性质测试

- 有效输入的 BMI/BMR/TDEE 均 finite 且为正；nullable 输出只按规定 warning 出现。
- 同一 input/clock/version 完全确定。
- activity 增大时 TDEE 不下降。
- 同一合理减重目标下，目标差更大不会预测更早。
- projection 单调朝目标、不越界、每 7 天、点数 ≤105。
- preview serializer 对任意生成结果都不包含 protected key。

## 版本策略

- 公式、factor、边界、舍入、warnings 与不可用行为共同构成 `health-v1`。
- 修改任何影响结果的规则必须创建 `health-v2`。
- 旧结果继续按旧 snapshot 展示；不后台静默改算。
- 如需重算，显式创建新 assessment/result 并记录来源。

## 依据与诚实限制

- BMR 公式来源：[Mifflin et al., 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/)。
- BMI 分类阈值：[CDC Adult BMI Categories](https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html)。
- 减重速率上限参考 CDC 的渐进式 1–2 lb/week 建议：[CDC Steps for Losing Weight](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html)。
- 热量区间/缺口参考：[NHLBI Obesity Evidence Review](https://www.nhlbi.nih.gov/sites/default/files/media/docs/obesity-evidence-review.pdf)。
- 7700 kcal/kg 直线法只是简化；更严谨模型会模拟动态代谢变化：[NIDDK Body Weight Planner research](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner)。

这些来源用于确定演示边界与披露限制，不构成对个体结果准确性的医疗背书。
