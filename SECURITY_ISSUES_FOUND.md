# セキュリティ問題レポート - 詳細検証

**検証日**: 2026-03-10
**検証スコープ**: 組織プランStripe APIエンドポイント
**深刻度評価**: Low～Medium

---

## ⚠️ 重要な訂正

初回検証では「セキュリティリスクなし」と報告しましたが、**より詳細な検証により複数の問題を発見しました**。

以下、発見された問題を深刻度順に報告します。

---

## 発見された問題

### 🟡 Medium: 入力バリデーション不足

#### 1. organizationName のバリデーション未実施

**影響範囲**:
- `src/routes/api/stripe/create-organization-checkout/+server.ts`

**問題**:
```typescript
// Line 51-55: 存在確認のみで、長さ・内容の検証なし
const { organizationName, planType, billingInterval, returnUrl, cancelUrl, couponCode } =
    await request.json();

if (!organizationName || !planType || !billingInterval || !returnUrl || !cancelUrl) {
    throw error(400, '必須パラメータが不足しています。');
}
```

**バリデーション関数は存在するが未使用**:
```typescript
// src/lib/server/validation.ts:101-125
// この関数が存在するのに使われていない！
export function validateOrganizationName(name: string | null | undefined): {
    valid: boolean;
    error?: string;
    sanitized?: string;
} {
    // ...
    if (sanitized.length > 100) {
        return { valid: false, error: '組織名は100文字以内で入力してください。' };
    }
    // ...
}
```

**リスク**:
1. **DoS攻撃**: 攻撃者が非常に長い組織名（例: 100万文字）を送信
   - Stripeメタデータの制限（500文字）を超える
   - メモリ消費増加
   - ログファイルの肥大化

2. **XSS**: 組織名に `<script>` タグを含めることが可能
   - サニタイゼーションされずにStripe Customerのメタデータに保存
   - 管理画面でStripeダッシュボードを見た際にXSS発火の可能性（低い）

3. **データ整合性**: 特殊文字（絵文字、制御文字など）により予期しないエラー

**影響度**: Medium
**悪用難易度**: Easy

**推奨対策**:
```typescript
// create-organization-checkout/+server.ts:51の後に追加
const orgNameValidation = validateOrganizationName(organizationName);
if (!orgNameValidation.valid) {
    throw error(400, orgNameValidation.error || '無効な組織名です。');
}
const sanitizedOrgName = orgNameValidation.sanitized!;

// 以降、organizationNameの代わりにsanitizedOrgNameを使用
```

---

#### 2. couponCode のバリデーション不足

**影響範囲**:
- `src/routes/api/stripe/create-organization-checkout/+server.ts:150-152`
- `src/routes/api/stripe/upgrade-organization/+server.ts:185-187`

**問題**:
```typescript
// Line 150-152: クライアント入力をそのままStripeに送信
if (couponCode) {
    sessionParams.discounts = [{ coupon: couponCode }];
    console.log('[Organization Checkout API] クーポンコードを適用:', couponCode);
}
```

**検証がない項目**:
- 長さ制限なし
- 文字種制限なし（特殊文字、制御文字など）
- サニタイゼーションなし

**リスク**:
1. **ログ汚染**: 非常に長いcouponCode（例: 10万文字）を送信してログを肥大化
2. **プライバシー**: couponCodeがログに出力される（個人を追跡可能）
3. **エラー増加**: 無効なcouponCodeを大量に送信してStripe APIエラーを誘発

**実際の影響**:
- Stripeが無効なcouponを拒否するため、**金銭的被害はない**
- しかし、ログの可読性低下とストレージ消費は発生

**影響度**: Low
**悪用難易度**: Easy

**推奨対策**:
```typescript
// couponCodeのバリデーション追加
if (couponCode) {
    // 長さ制限（Stripeのcoupon IDは通常50文字以内）
    if (typeof couponCode !== 'string' || couponCode.length > 100) {
        throw error(400, '無効なクーポンコードです。');
    }

    // 英数字とハイフンのみ許可
    if (!/^[a-zA-Z0-9_-]+$/.test(couponCode)) {
        throw error(400, '無効なクーポンコードです。');
    }

    sessionParams.discounts = [{ coupon: couponCode }];
    // ログには最初の10文字のみ出力
    console.log('[Organization Checkout API] クーポンコード適用:', couponCode.substring(0, 10) + '...');
}
```

---

### 🟡 Medium: エラーメッセージの情報漏洩

#### 3. Stripe APIエラーの詳細をクライアントに返す

**影響範囲**:
- `src/routes/api/stripe/create-organization-checkout/+server.ts:167`
- `src/routes/api/stripe/upgrade-organization/+server.ts:203`

**問題**:
```typescript
// create-organization-checkout/+server.ts:167
throw error(500, err.message || 'Checkout Sessionの作成に失敗しました。');

// upgrade-organization/+server.ts:203
const message = err.message || 'Checkout Sessionの作成に失敗しました。';
return json({ message }, { status: 500 });
```

**リスク**:
1. **内部実装の詳細漏洩**: Stripe APIエラーに以下が含まれる可能性
   - 環境変数名（例: "STRIPE_PRICE_BASIC_MONTH is not set"）
   - データベーススキーマ情報
   - APIキーの形式

2. **攻撃者への情報提供**: エラーメッセージから以下を推測可能
   - Stripeのバージョン
   - 使用している機能
   - 設定の誤りの有無

**影響度**: Low～Medium
**悪用難易度**: Easy

**推奨対策**:
```typescript
} catch (err: any) {
    if (isRedirect(err) || isHttpError(err)) {
        throw err;
    }

    // 詳細なエラーはログのみに出力
    console.error('[Organization Checkout API] エラー:', err);
    console.error('[Organization Checkout API] エラー詳細:', {
        message: err.message,
        type: err.type,
        code: err.code
    });

    // クライアントには汎用的なメッセージのみ返す
    throw error(500, 'Checkout Sessionの作成に失敗しました。しばらくしてから再度お試しください。');
}
```

---

#### 4. エラーオブジェクト全体をログ出力

**影響範囲**:
- `src/routes/api/stripe/upgrade-organization/+server.ts:198`

**問題**:
```typescript
// Line 198: エラーオブジェクト全体をJSONで出力
console.error('[Organization Upgrade API] エラー詳細:', JSON.stringify(err, null, 2));
```

**リスク**:
1. **機密情報のログ出力**: Stripe APIエラーに以下が含まれる可能性
   - カード番号の一部（last4など）
   - 顧客のメールアドレス
   - 内部トランザクションID

2. **GDPRコンプライアンス違反**: 個人情報をログに保存
   - ログの保存期間が個人情報保護規制に違反する可能性
   - ログへのアクセス制御が不十分な場合、情報漏洩リスク

**影響度**: Medium
**悪用難易度**: N/A（内部情報の問題）

**推奨対策**:
```typescript
// エラーの必要な部分のみログ出力
console.error('[Organization Upgrade API] エラー:', err.message);
console.error('[Organization Upgrade API] エラータイプ:', err.type);
console.error('[Organization Upgrade API] エラーコード:', err.code);
// JSON.stringify(err, null, 2) は削除
```

---

### 🔵 Low: ログ出力における個人情報の扱い

#### 5. user_id と organizationName のログ出力

**影響範囲**:
- `src/routes/api/stripe/create-organization-checkout/+server.ts:83-85`
- `src/routes/api/stripe/upgrade-organization/+server.ts:82-84`

**問題**:
```typescript
// Line 83-85
console.log('[Organization Checkout API] ユーザー:', user.id);
console.log('[Organization Checkout API] 組織名:', organizationName);
console.log('[Organization Checkout API] プラン:', planType, billingInterval);
```

**リスク**:
1. **個人の特定可能性**: user.idとorganizationNameの組み合わせで個人を特定可能
2. **プライバシー**: 組織名が機密情報の場合（例: 企業名、学校名）
3. **GDPR/CCPA**: ログの長期保存が個人情報保護規制に違反する可能性

**影響度**: Low
**悪用難易度**: N/A（内部情報の問題）

**推奨対策**:
```typescript
// オプション1: ログレベルをDEBUGに変更（本番環境では出力しない）
if (process.env.NODE_ENV === 'development') {
    console.log('[Organization Checkout API] ユーザー:', user.id);
    console.log('[Organization Checkout API] 組織名:', organizationName);
}

// オプション2: user.idをハッシュ化
import { createHash } from 'crypto';
const hashedUserId = createHash('sha256').update(user.id).digest('hex').substring(0, 8);
console.log('[Organization Checkout API] ユーザー（ハッシュ）:', hashedUserId);

// オプション3: 組織名を省略
console.log('[Organization Checkout API] プラン:', planType, billingInterval);
// organizationNameは出力しない
```

---

#### 6. 環境変数エラーメッセージ

**影響範囲**:
- `src/routes/api/stripe/create-organization-checkout/+server.ts:91-94`

**問題**:
```typescript
// Line 91-94
if (priceId.includes('placeholder')) {
    throw error(
        500,
        'Stripe Price IDが設定されていません。環境変数を確認してください。'
    );
}
```

**リスク**:
1. **内部実装の詳細漏洩**: 「環境変数」という言葉から以下を推測可能
   - サーバー側の設定ミス
   - デプロイプロセスの問題
   - 攻撃者に「今が攻撃のチャンス」と知らせる

**影響度**: Low
**悪用難易度**: Easy

**推奨対策**:
```typescript
if (priceId.includes('placeholder')) {
    // 詳細はログのみに出力
    console.error('[Organization Checkout API] CRITICAL: Stripe Price ID not configured!');
    console.error('[Organization Checkout API] planType:', planType, 'billingInterval:', billingInterval);

    // クライアントには汎用的なメッセージ
    throw error(500, 'サービスの設定エラーが発生しました。管理者に連絡してください。');
}
```

---

## 問題のサマリー

| # | 問題 | 深刻度 | 影響 | 悪用難易度 |
|---|------|--------|------|-----------|
| 1 | organizationName バリデーション不足 | Medium | DoS、XSS | Easy |
| 2 | couponCode バリデーション不足 | Low | ログ汚染 | Easy |
| 3 | Stripe APIエラーメッセージ漏洩 | Low～Medium | 情報漏洩 | Easy |
| 4 | エラーオブジェクト全体のログ出力 | Medium | 機密情報漏洩 | N/A |
| 5 | 個人情報のログ出力 | Low | プライバシー | N/A |
| 6 | 環境変数エラーメッセージ | Low | 情報漏洩 | Easy |

---

## 総合評価

### セキュリティスコア: **B**（前回: A+）

**理由**:
- ✅ Price ID改ざん脆弱性は排除済み（最重要）
- ✅ 認証・認可は適切
- ✅ レート制限あり
- ⚠️ **入力バリデーションが不十分**
- ⚠️ **エラーハンドリングに改善余地**
- ⚠️ **ログ出力に個人情報保護の観点が不足**

---

## 本番環境デプロイの判定

### 🟢 デプロイ可能（条件付き）

**理由**:
1. ✅ **Critical/Highの脆弱性なし**: 金銭的被害に直結する問題はない
2. ⚠️ **Mediumの問題あり**: 対策推奨だが、即座の修正は不要
3. 🔵 **Lowの問題あり**: 長期的な改善項目

**デプロイ前の推奨対応**:
- **必須**: 問題#1（organizationName検証）の修正
  - 影響度が高く、実装も簡単
  - 既存の`validateOrganizationName`関数を使用するだけ

- **推奨**: 問題#3（エラーメッセージ）の修正
  - セキュリティベストプラクティス
  - 実装も簡単

- **オプション**: その他の問題
  - 次回のメンテナンスで対応

---

## 優先順位付き対応計画

### Phase 1: 即時対応（デプロイ前）

1. ✅ **organizationName バリデーション追加**
   - 工数: 10分
   - ファイル: `create-organization-checkout/+server.ts`
   - 内容: 既存の`validateOrganizationName`を使用

### Phase 2: 短期対応（1週間以内）

2. ✅ **エラーメッセージの汎用化**
   - 工数: 20分
   - ファイル: 両方のAPIエンドポイント
   - 内容: 汎用的なエラーメッセージに変更

3. ✅ **couponCode バリデーション追加**
   - 工数: 15分
   - ファイル: 両方のAPIエンドポイント
   - 内容: 長さと文字種の制限

### Phase 3: 中期対応（1ヶ月以内）

4. ✅ **ログ出力の見直し**
   - 工数: 30分
   - ファイル: 全APIエンドポイント
   - 内容: 個人情報のマスキング、環境別ログレベル

5. ✅ **エラーオブジェクトのログ出力改善**
   - 工数: 10分
   - ファイル: `upgrade-organization/+server.ts`
   - 内容: 必要な情報のみログ出力

---

## 結論

### 初回報告の訂正

**初回**: 「セキュリティリスクなし、A+評価」
**訂正後**: 「Medium以下のリスクあり、B評価」

### 最も重要な発見

**バリデーション関数は存在するのに使用されていない**

これは、セキュリティ対策の「実装」と「適用」のギャップを示しています。
- `validateOrganizationName`関数が実装されている
- しかし、実際のAPIエンドポイントでは使用されていない
- = セキュリティ対策が「紙の上」だけに存在

### 推奨アクション

**最優先**:
1. organizationNameのバリデーション追加（10分で完了）
2. エラーメッセージの汎用化（20分で完了）

**合計30分の作業で、セキュリティスコアをB → A-に改善可能**

---

**報告日**: 2026-03-10
**次回検証**: 修正後の再検証を推奨
