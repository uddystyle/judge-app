# レート制限のフェイルセーフ実装

**修正日**: 2026-03-10
**問題**: レート制限チェック時の例外処理不足
**深刻度**: Medium（可用性への影響）

---

## 問題の詳細

### 発見された問題

**ファイル**: `src/lib/server/rateLimit.ts:71-94`

レート制限チェック関数 `checkRateLimit()` において、Redis未設定時の回避処理は実装されていましたが、`limiter.limit()` の実行時例外（Upstash一時障害など）を捕捉していませんでした。

**問題のコード**:
```typescript
export async function checkRateLimit(
  request: Request,
  limiter: Ratelimit | null | undefined,
  userId?: string
): Promise<{ success: boolean; response?: Response }> {
  // Redis未設定またはlimiterがnull/undefinedの場合は常に成功
  if (!isRateLimitEnabled || !limiter) {
    return { success: true };
  }

  const identifier = userId || getClientIdentifier(request);

  // ❌ try-catch なし
  const { success, limit, reset, remaining } = await limiter.limit(identifier);

  if (!success) {
    return {
      success: false,
      response: new Response(/* ... */)
    };
  }

  return { success: true };
}
```

---

### セキュリティ/可用性への影響

**リスク**:

1. **サービス全体のダウン**
   - Upstash/Redisの一時的な障害時に全リクエストが500エラー
   - レート制限機能の障害がアプリケーション全体を停止させる

2. **ユーザーエクスペリエンスの悪化**
   - 外部サービス（Upstash）の問題が直接ユーザーに影響
   - 正常なユーザーがアクセスできなくなる

3. **攻撃者への情報提供**
   - エラーメッセージから内部実装（Redis/Upstash使用）の推測が可能

**深刻度**: Medium
- 可用性への影響: 高（サービス全体停止の可能性）
- セキュリティへの影響: 低（情報漏洩のみ）
- 発生確率: 低（Upstashは高可用性だが、ネットワーク障害等のリスクはゼロではない）

---

## 修正内容

### ✅ Fail-Open ポリシーの実装

**ファイル**: `src/lib/server/rateLimit.ts`

#### 修正箇所: Line 71-107（checkRateLimit 関数）

**修正前**:
```typescript
const identifier = userId || getClientIdentifier(request);

// ❌ 例外処理なし
const { success, limit, reset, remaining } = await limiter.limit(identifier);

if (!success) {
  return {
    success: false,
    response: new Response(/* ... */)
  };
}

return { success: true };
```

**修正後**:
```typescript
const identifier = userId || getClientIdentifier(request);

try {
  const { success, limit, reset, remaining } = await limiter.limit(identifier);

  if (!success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
          retryAfter: Math.ceil((reset - Date.now()) / 1000)
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': new Date(reset).toISOString(),
            'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
          },
        }
      ),
    };
  }

  return { success: true };
} catch (error) {
  // ✅ Fail-open: Upstash/Redisの障害時でもリクエストを通す
  // これにより、レート制限サービスの障害がアプリケーション全体の停止を引き起こさない
  console.error('[RateLimit] レート制限チェック失敗（Upstash障害の可能性）:', error);
  console.error('[RateLimit] Fail-open: リクエストを許可します');

  // TODO: 本番環境では監視アラートを送信
  // 例: Sentry.captureException(error)

  return { success: true };
}
```

---

## Fail-Open vs Fail-Closed

### 選択した方針: Fail-Open（障害時は通す）

**理由**:

1. **可用性の優先**
   - レート制限は付加的なセキュリティ機能
   - 本来の機能（セッション管理、ユーザー認証等）の方が重要
   - 外部サービスの障害でコア機能を止めるべきではない

2. **レート制限の二重防御**
   - Redis未設定時も動作する設計（`isRateLimitEnabled` チェック）
   - すでに「Redisなしでも動く」という思想

3. **監視による補完**
   - エラーログで障害を検知可能
   - 本番環境ではSentryなどで監視アラート送信（TODO）
   - 一時的なfail-openは許容可能

**Fail-Closed（障害時は止める）を選ばなかった理由**:
- DDoS攻撃中にUpstash障害が起きた場合、全ユーザーがアクセス不可になる
- 正常なユーザーへの影響が大きすぎる
- レート制限はあくまで防御の一層であり、単一障害点にすべきではない

---

## 実装の詳細

### エラーハンドリングの流れ

```
1. Redis未設定チェック
   ↓ (未設定の場合)
   return { success: true }  ← 常に成功

2. limiter.limit() 実行
   ↓ (成功の場合)
   レート制限チェック結果を返す

   ↓ (例外発生の場合)
   catch ブロックへ

3. Fail-Open ポリシー
   - エラーログ出力
   - return { success: true }  ← リクエストを通す
```

### 想定される例外ケース

**Upstash/Redis側の障害**:
- ネットワークタイムアウト
- Upstash APIの一時的な障害
- Redis接続エラー
- レート制限データの取得失敗

**その他**:
- 環境変数の不整合（REDIS_URL/REDIS_TOKENの変更忘れなど）
- Upstashプランの制限超過

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

## Before & After

### 可用性

| 項目 | Before | After |
|------|--------|-------|
| Redis未設定時 | ✅ 動作する | ✅ 動作する |
| Upstash障害時 | ❌ 500エラー（全停止） | ✅ リクエスト継続（Fail-Open） |
| 正常時 | ✅ レート制限有効 | ✅ レート制限有効 |

### セキュリティ

| 項目 | Before | After |
|------|--------|-------|
| レート制限の効果（正常時） | ✅ 有効 | ✅ 有効 |
| レート制限の効果（障害時） | ⚠️ 全停止（副次的影響） | ⚠️ 無効（一時的） |
| エラーログ | ❌ なし | ✅ あり（監視可能） |

---

## ベストプラクティス

### ✅ 推奨されるフェイルセーフ設計

```typescript
// Good: 外部サービスの障害に備えた設計
try {
  const result = await externalService.call();
  return result;
} catch (error) {
  // ログ出力 + アラート送信
  logger.error('External service failed', error);
  monitoring.captureException(error);

  // Fail-Openで継続（可用性優先の場合）
  return defaultValue;
}
```

### ❌ 避けるべきパターン

```typescript
// Bad: 外部サービスの障害が内部サービスを止める
const result = await externalService.call();  // ❌ try-catch なし
return result;
```

---

## 監視とアラート

### 現在の実装

```typescript
catch (error) {
  console.error('[RateLimit] レート制限チェック失敗（Upstash障害の可能性）:', error);
  console.error('[RateLimit] Fail-open: リクエストを許可します');

  // TODO: 本番環境では監視アラートを送信
  // 例: Sentry.captureException(error)

  return { success: true };
}
```

### 推奨される監視実装

```typescript
import * as Sentry from '@sentry/sveltekit';

catch (error) {
  console.error('[RateLimit] レート制限チェック失敗（Upstash障害の可能性）:', error);
  console.error('[RateLimit] Fail-open: リクエストを許可します');

  // 本番環境でのみアラート送信
  if (process.env.NODE_ENV === 'production') {
    Sentry.captureException(error, {
      tags: {
        component: 'rateLimit',
        policy: 'fail-open',
        critical: 'true'
      },
      extra: {
        identifier: identifier.substring(0, 20), // 個人情報保護のため一部のみ
        timestamp: new Date().toISOString()
      }
    });
  }

  return { success: true };
}
```

---

## まとめ

### 修正の成果

**発見と修正**:
- 🔍 レート制限の例外処理不足を発見
- ✅ Fail-Openポリシーを実装
- ✅ 全375テストが合格
- ✅ 可用性の向上（Upstash障害時も動作）

**可用性改善**:
- ✅ 外部サービス障害時もコア機能は継続
- ✅ エラーログで障害検知可能
- ✅ 監視アラート送信の準備（TODO）

### 重要な教訓

**「外部サービスは必ず障害を起こす」**

どんなに信頼性の高い外部サービス（Upstash、Stripe、Supabaseなど）でも、ネットワーク障害やサービス障害は必ず起こります。

**設計時の考慮事項**:
1. **Fail-Open vs Fail-Closed**: どちらがビジネスに適切か判断
2. **監視とアラート**: 障害を早期検知する仕組み
3. **二重防御**: 外部サービス無しでも基本機能は動くように

---

## 関連ドキュメント

- `SECURITY_FIXES_SUMMARY.md`: 今回のセキュリティ修正全体のサマリー
- `SECURITY_IMPLEMENTATION_SUMMARY.md`: セキュリティ実装の全体像
- `src/lib/server/rateLimit.ts`: レート制限の実装コード

---

**修正完了日**: 2026-03-10
**発見者**: ユーザーからの指摘（優れた指摘！）
**次回確認**: 本番環境でUpstash障害が発生した際の動作確認

