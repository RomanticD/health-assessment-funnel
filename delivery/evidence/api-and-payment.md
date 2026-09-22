# API 与付费证据

## 服务端差异化

`GET /api/v1/assessments/{assessmentId}/result` 先由 session digest 解析 owner，再实时查询 subscription entitlement：

- preview allowlist：`access`、BMI、BMI category、有限 calorie range、warning、`upgradeRequired`、`lockedFeatures`。
- full allowlist：在 basic 结果上增加 `bmrKcal`、`tdeeKcal`、`exactDailyCalories`、`targetDate`、`weightProjection`、算法版本。
- preview payload 中不会出现受保护字段；`tests/integration/access-payment-api.test.ts` 对响应树递归扫描锁定字段。

## 浏览器闭环

```text
完成 15 题 → submit → preview
    ↓ Explore my full summary
UpgradeDialog（DEMO CHECKOUT · $0）
    ↓ Unlock my summary — free demo
POST /api/v1/pay
    ↓ 重新 GET result
Your full summary + 完整 energy/timeline
```

`src/components/results/result-experience.tsx` 的 `PreviewResult` 将入口放在结果页首段之后，`UpgradeDialog` 负责可访问的 focus trap、Escape、取消与重试。付款失败时仍保留 preview，不伪造成功。

## 可重放 cURL

```bash
BASE_URL=https://health-assessment-funnel.vercel.app
SESSION_ID='<a new session returned by POST /sessions>'
ASSESSMENT_ID='<the completed assessment for that session>'

curl --fail-with-body "$BASE_URL/api/v1/assessments/$ASSESSMENT_ID/result" \
  -H "Authorization: Bearer $SESSION_ID" | jq '.data.access, .data.lockedFeatures'

curl --fail-with-body -X POST "$BASE_URL/api/v1/pay" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://health-assessment-funnel.vercel.app' \
  -H 'Idempotency-Key: demo-pay-20260922-01' \
  --data '{"assessmentId":"'"$ASSESSMENT_ID"'","planCode":"demo_monthly"}' | jq

curl --fail-with-body "$BASE_URL/api/v1/assessments/$ASSESSMENT_ID/result" \
  -H "Authorization: Bearer $SESSION_ID" | jq '.data.access, .data.weightProjection'
```

新 session 必须先完成并提交 assessment；固定 paid fixture 的读取命令见 [delivery/README.md](../README.md)。
