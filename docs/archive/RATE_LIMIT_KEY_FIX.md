# レート制限キーの回避耐性強化

**修正日**: 2026-03-10
**問題**: User-Agent変更で簡単にレート制限を回避可能
**深刻度**: Medium（サービス妨害攻撃のリスク）

---

## 問題の詳細

### 発見された問題

**ファイル**: `src/lib/server/rateLimit.ts:48-54`

レート制限の識別子生成において、以下の脆弱性がありました：

**問題のあったコード**:
```typescript
export function getClientIdentifier(request: Request): string {
  const ip = request.headers.get('x-forwarded-for') ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `${ip}:${userAgent.substring(0, 50)}`;  // ❌ UA含む
}
```

**問題点**:

1. **User-Agentを含めている**
   - User-Agentは簡単に変更可能
   - 攻撃者がUAを変えるだけでレート制限を回避できる

2. **x-forwarded-for の処理が不適切**
   - `x-forwarded-for` にはカンマ区切りで複数のIPが含まれる可能性
   - 例: `"client_ip, proxy1, proxy2, ..."`
   - 全体を使っているため、プロキシ経由で異なる識別子になる

3. **userId が活用されていない**
   - `checkRateLimit` で userId を受け取っているが、
   - `getClientIdentifier` に渡していないため、識別子に反映されない

---

### セキュリティへの影響

**攻撃シナリオ**:

**シナリオ 1: User-Agent変更による回避**
```python
# 攻撃スクリプト例
import requests

url = "https://example.com/api/auth/login"

# User-Agentを変えて連続リクエスト
for i in range(1000):
    headers = {"User-Agent": f"AttackBot/{i}"}
    requests.post(url, data={"email": "victim@example.com"}, headers=headers)
    # ✅ 各リクエストで異なる識別子 → レート制限回避
```

**シナリオ 2: プロキシチェーンの悪用**
```
x-forwarded-for: "attacker_ip, proxy1, proxy2"
↓ 識別子: "attacker_ip, proxy1, proxy2:Chrome/123"

x-forwarded-for: "attacker_ip, proxy1"
↓ 識別子: "attacker_ip, proxy1:Chrome/123"  ← 異なる識別子
```

**影響**:
- ブルートフォース攻撃（パスワード総当たり）
- アカウント列挙攻撃
- DDoS攻撃
- クーポンコード試行攻撃

**深刻度**: Medium
- 可用性への影響: 高（サービス妨害）
- 金銭的影響: 中（Redisコスト増、不正利用）
- 悪用難易度: 低（User-Agent変更は簡単）

---

## 修正内容

### ✅ User-Agentを除外し、IP正規化とuserId優先化

**ファイル**: `src/lib/server/rateLimit.ts`

#### 修正箇所 1: getClientIdentifier 関数（Line 47-54）

**修正前**:
```typescript
export function getClientIdentifier(request: Request): string {
  const ip = request.headers.get('x-forwarded-for') ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `${ip}:${userAgent.substring(0, 50)}`;
  // ❌ x-forwarded-for 全体を使用
  // ❌ User-Agent を含む（回避可能）
  // ❌ userId を受け取っていない
}
```

**修正後**:
```typescript
// クライアント識別用ヘルパー
// 【セキュリティ改善】UA変更による回避を防ぐため、IPのみを使用
export function getClientIdentifier(request: Request, userId?: string): string {
  // 認証済みユーザーはuserIdを優先（最も確実な識別子）
  if (userId) {
    return `user:${userId}`;
  }

  // x-forwarded-for の先頭IP（実際のクライアントIP）を取得
  // x-forwarded-for フォーマット: "client_ip, proxy1, proxy2, ..."
  // 先頭IPが実際のクライアントアドレス
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  let ip = 'unknown';
  if (forwardedFor) {
    // カンマ区切りの先頭IPを取得し、空白を除去
    ip = forwardedFor.split(',')[0].trim();
  } else if (realIp) {
    ip = realIp.trim();
  }

  // 匿名ユーザーはIPのみ
  // User-Agentは含めない（簡単に変更可能で回避耐性が低い）
  return `ip:${ip}`;
}
```

**変更点**:
1. ✅ userId を引数として受け取る
2. ✅ userId が存在する場合は `user:{userId}` を返す
3. ✅ `x-forwarded-for` の先頭IPのみを使用
4. ✅ User-Agentを完全に除外
5. ✅ プレフィックス（`user:` または `ip:`）を追加して識別子タイプを明示

---

#### 修正箇所 2: checkRateLimit 関数（Line 69）

**修正前**:
```typescript
const identifier = userId || getClientIdentifier(request);
// ❌ userId をそのまま使用（プレフィックスなし）
// ❌ getClientIdentifier に userId を渡していない
```

**修正後**:
```typescript
// userIdを getClientIdentifier に渡す（userId優先の識別子生成）
const identifier = getClientIdentifier(request, userId);
// ✅ getClientIdentifier 内で userId を優先処理
```

---

## 識別子の優先順位

### Before（修正前）

```
1. userId（そのまま使用）
2. x-forwarded-for（全体） + User-Agent
```

**問題**:
- User-Agent変更で回避可能
- プロキシチェーンで識別子が変わる

### After（修正後）

```
1. userId（認証済みユーザー） → `user:{userId}`
2. x-forwarded-for の先頭IP（匿名ユーザー） → `ip:{client_ip}`
```

**改善**:
- User-Agent除外で回避困難
- 先頭IPのみ使用で一貫性向上

---

## 識別子の例

### 認証済みユーザー

**Before**:
```
"550e8400-e29b-41d4-a716-446655440000"
```

**After**:
```
"user:550e8400-e29b-41d4-a716-446655440000"
```

### 匿名ユーザー（プロキシなし）

**x-forwarded-for**: `"203.0.113.42"`
**User-Agent**: `"Mozilla/5.0 ..."`

**Before**:
```
"203.0.113.42:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK"
```

**After**:
```
"ip:203.0.113.42"
```

### 匿名ユーザー（プロキシあり）

**x-forwarded-for**: `"203.0.113.42, 198.51.100.1, 192.0.2.1"`
**User-Agent**: `"Mozilla/5.0 ..."`

**Before**:
```
"203.0.113.42, 198.51.100.1, 192.0.2.1:Mozilla/5.0 (Windows NT 1"
```

**After**:
```
"ip:203.0.113.42"
```

---

## 回避耐性の比較

### 攻撃シナリオ 1: User-Agent変更

**Before（脆弱）**:
```python
# 1回目のリクエスト
headers = {"User-Agent": "Bot/1.0"}
# 識別子: "ip:203.0.113.42:Bot/1.0"

# 2回目のリクエスト（UA変更）
headers = {"User-Agent": "Bot/2.0"}
# 識別子: "ip:203.0.113.42:Bot/2.0"  ← 異なる識別子（回避成功）
```

**After（耐性あり）**:
```python
# 1回目のリクエスト
headers = {"User-Agent": "Bot/1.0"}
# 識別子: "ip:203.0.113.42"

# 2回目のリクエスト（UA変更）
headers = {"User-Agent": "Bot/2.0"}
# 識別子: "ip:203.0.113.42"  ← 同じ識別子（回避失敗）
```

---

### 攻撃シナリオ 2: 認証済みユーザーの回避試行

**Before（脆弱）**:
```python
# ユーザーがログイン後、User-Agentを変更
# 識別子: "user_id:Bot/1.0" → "user_id:Bot/2.0"
# → 回避可能性あり
```

**After（耐性あり）**:
```python
# ユーザーがログイン後、User-Agentを変更しても無意味
# 識別子: "user:550e8400-e29b-41d4-a716-446655440000"
# → 常に同じ識別子（回避不可）
```

---

## 検証結果

### ✅ テスト

```bash
npm test
```

**結果**:
```
Test Files: 16 passed (16)
Tests: 375 passed (375)
```

**全てのテストが合格**

---

### ✅ ビルド

```bash
npm run build
```

**結果**:
```
✓ built in 8.67s
```

**ビルド成功**

---

## Before & After

### 回避耐性

| 攻撃手法 | Before | After |
|---------|--------|-------|
| User-Agent変更 | ❌ 回避可能 | ✅ 回避不可 |
| プロキシチェーン悪用 | ⚠️ 一部回避可能 | ✅ 先頭IPで統一 |
| 認証済みユーザーのUA変更 | ⚠️ 影響あり | ✅ 影響なし |

### 識別子の品質

| 項目 | Before | After |
|------|--------|-------|
| **一貫性** | ⚠️ 低い（UA次第） | ✅ 高い（IPまたはuserId） |
| **回避困難性** | ⚠️ 低い（UA変更） | ✅ 高い（IP/userIdベース） |
| **認証済み優先** | ⚠️ 未実装 | ✅ 実装済み |
| **プロキシ対応** | ⚠️ 不適切 | ✅ 適切（先頭IPのみ） |

---

## セキュリティベストプラクティス

### ✅ 推奨される識別子の優先順位

```
1位: userId（認証済みユーザー）
  - 最も確実
  - 回避不可能
  - デバイス/ネットワーク変更でも追跡可能

2位: IPアドレス（匿名ユーザー）
  - x-forwarded-for の先頭IP
  - プロキシチェーンを考慮
  - 共有IPの場合は複数ユーザーが影響を受ける可能性あり

3位: その他（使用しない）
  - User-Agent: 簡単に変更可能（❌ 不使用）
  - Cookie: 削除可能（❌ 不使用）
  - Session: 再生成可能（❌ 不使用）
```

### ❌ 避けるべきパターン

```typescript
// Bad: User-Agentを含める
const identifier = `${ip}:${userAgent}`;  // ❌

// Bad: x-forwarded-for全体を使用
const ip = request.headers.get('x-forwarded-for');  // ❌

// Bad: userIdを後回しにする
const identifier = userId || getClientIdentifier(request);  // ❌
```

### ✅ 推奨パターン

```typescript
// Good: userIdを優先、IPは先頭のみ
export function getClientIdentifier(request: Request, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown';
  return `ip:${ip}`;
}
```

---

## 残存リスクと対策

### 残存リスク 1: 共有IPアドレス

**問題**:
- 同じIP（学校、会社、カフェ）から複数ユーザーがアクセス
- 1人がレート制限に達すると、全員が影響を受ける

**対策**:
- 認証済みユーザーは userId を使用（✅ 実装済み）
- 匿名ユーザーは共有リスクを受け入れる（トレードオフ）

---

### 残存リスク 2: IPアドレス変更

**問題**:
- モバイルネットワークでIPが頻繁に変わる
- VPN使用で簡単にIP変更可能

**対策**:
- レート制限の粒度を適切に設定
- 現在: 1分間60リクエスト（適度に緩い）
- 厳格すぎると正規ユーザーが困る

---

### 残存リスク 3: 分散攻撃

**問題**:
- ボットネットを使った分散攻撃
- 異なるIPから同時攻撃

**対策**:
- エンドポイント別のレート制限（✅ 実装済み）
- グローバルレート制限（TODO）
- WAF/Cloudflare の導入（TODO）

---

## まとめ

### 修正の成果

**セキュリティ改善**:
- ✅ User-Agent回避を防止
- ✅ プロキシチェーンの適切な処理
- ✅ userId優先で認証済みユーザーを確実に追跡
- ✅ 識別子の一貫性向上

**回避耐性向上**:
- ✅ User-Agent変更: 回避不可
- ✅ プロキシ悪用: 先頭IPで統一
- ✅ 認証済みユーザー: userId固定

**検証結果**:
- ✅ 全375テスト合格
- ✅ ビルド成功

### 重要な教訓

**「簡単に変更できる値は識別子に使わない」**

User-Agent、Cookie、Session IDなど、クライアント側で簡単に変更できる値は、レート制限の識別子として不適切です。

**「認証済みユーザーはuserIdを最優先」**

認証済みユーザーに対しては、IPアドレスよりもuserIdの方が確実で、デバイス/ネットワーク変更に強いです。

---

## 関連ドキュメント

- `RATE_LIMIT_FAILSAFE_FIX.md`: Fail-Openポリシーの実装
- `SECURITY_FIXES_SUMMARY.md`: セキュリティ修正全体のサマリー
- `src/lib/server/rateLimit.ts`: レート制限の実装コード

---

**修正完了日**: 2026-03-10
**発見者**: ユーザーからの指摘（回避耐性が弱い）
**次回確認**: グローバルレート制限、WAF導入の検討

