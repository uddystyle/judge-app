# CSPナビゲーション問題の修正

**修正日**: 2026-03-10
**問題**: 一度クリックでページ遷移したら、その後クリックができなくなる
**原因**: Nonce-based CSP実装の不備
**深刻度**: Critical（全ユーザーに影響）

---

## 問題の詳細

### 発見された問題

**症状**:
- 初回ページロード後、最初のリンククリックは成功
- その後のクリックナビゲーションが全て動作しない
- JavaScriptエラーはコンソールに表示されない（CSPでブロックされているため）

**原因**:
`hooks.server.ts` でNonce-based CSPを実装したが、SvelteKitが生成するクライアントサイドナビゲーション用のスクリプトにnonceが適用されていなかったため、すべてブロックされた。

```typescript
// 問題のあった設定（hooks.server.ts）
const cspNonce = randomBytes(16).toString('base64');
event.locals.cspNonce = cspNonce;

const scriptSrc = isDevelopment
    ? "'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com"
    : `'self' 'nonce-${cspNonce}' https://js.stripe.com`;  // ❌ SvelteKitスクリプトにnonce未適用
```

---

## 根本原因

### SvelteKitのCSP実装要件

SvelteKitでNonce-based CSPを正しく実装するには、以下のいずれかが必要:

1. **svelte.config.js での設定**
```javascript
// svelte.config.js
export default {
    kit: {
        csp: {
            mode: 'auto',  // 動的ページ:nonce、プリレンダリング:hash
            directives: {
                'script-src': ['self', 'https://js.stripe.com']
            }
        }
    }
};
```

2. **app.html での %sveltekit.nonce% プレースホルダー使用**
```html
<script nonce="%sveltekit.nonce%">
  // カスタムスクリプト
</script>
```

### なぜ動作しなかったのか

**問題のフロー**:
1. `hooks.server.ts` でCSPヘッダーに `nonce-abc123` を設定
2. SvelteKitが生成するスクリプトタグには nonce属性なし: `<script src="/_app/..."></script>`
3. ブラウザがCSPヘッダーをチェック: "nonceがないスクリプトは実行拒否"
4. クライアントサイドナビゲーションが動作しない

---

## 修正内容

### ✅ 緊急修正: unsafe-inline の再追加

**方針**:
- `unsafe-eval` は削除（eval使用なし）
- `unsafe-inline` は許可（SvelteKitのクライアントサイドナビゲーション用）
- 厳格なホワイトリストで外部リソースを制限

**修正後のコード（hooks.server.ts）**:
```typescript
// Content Security Policy (CSP)
// Google Fonts、Supabase、Stripe を許可
//
// NOTE: SvelteKitでNonce-based CSPを実装するには svelte.config.js の kit.csp 設定が必要
// 現時点では安全性とユーザビリティのバランスを取り、以下の方針を採用:
// - unsafe-inline は許可（SvelteKitのクライアントサイドナビゲーション用）
// - unsafe-eval は削除（eval使用なし）
// - 厳格なホワイトリストで外部リソースを制限
const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",  // SvelteKit hydration用に unsafe-inline 必要
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.supabase.co https://api.stripe.com wss://*.supabase.co",
    "frame-src https://js.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
    "block-all-mixed-content"
].join('; ');
response.headers.set('Content-Security-Policy', cspDirectives);
```

**変更点**:
1. ✅ `unsafe-inline` を再追加（SvelteKitのhydration用）
2. ✅ `unsafe-eval` は削除したまま（セキュリティ向上）
3. ✅ Nonce生成コードを削除（正しい実装まで保留）
4. ✅ 環境判定を削除（シンプル化）

---

### 📝 将来の改善計画を追加

**svelte.config.js にコメントを追加**:
```javascript
kit: {
    // Content Security Policy
    // NOTE: 現在は hooks.server.ts で手動設定しているため、ここではコメントアウト
    // 将来的にはこちらに移行してNonce-based CSPを実装する予定
    // csp: {
    //     mode: 'auto',
    //     directives: {
    //         'script-src': ['self', 'https://js.stripe.com'],
    //         ...
    //     }
    // }
}
```

---

## セキュリティへの影響

### Before & After

| 項目 | 初期状態 | CSP強化後（バグあり） | 修正後 |
|------|----------|---------------------|--------|
| unsafe-inline | ✅ 許可 | ❌ 削除 | ✅ 許可 |
| unsafe-eval | ✅ 許可 | ❌ 削除 | ❌ 削除 |
| ナビゲーション | ✅ 動作 | ❌ 動作しない | ✅ 動作 |
| XSS対策（inline） | ❌ なし | ✅ あり | ❌ なし |
| XSS対策（eval） | ❌ なし | ✅ あり | ✅ あり |

### セキュリティスコアの変化

**初期状態（CSP強化前）**:
- `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com`
- スコア: ⚠️ Medium

**CSP強化後（バグあり）**:
- `script-src 'self' 'nonce-...' https://js.stripe.com`
- スコア: ✅ High（ただしアプリ動作せず）

**修正後（現在）**:
- `script-src 'self' 'unsafe-inline' https://js.stripe.com`
- スコア: ⚠️ Medium-High（evalは防御、inlineは許可）

### 実質的なセキュリティ改善

**削減されたリスク**:
- ✅ `eval()` や `new Function()` によるコードインジェクション攻撃
- ✅ 外部リソースの厳格なホワイトリスト化

**残存リスク**:
- ⚠️ インラインスクリプトによるXSS攻撃（ただし入力バリデーション・サニタイゼーションで防御）

---

## 検証結果

### ✅ ビルド

```bash
npm run build
```

**結果**:
```
✓ built in 8.32s
```

**ビルド成功**

---

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

### ✅ ナビゲーション確認

**確認項目**:
1. 初回ページロード → ✅ 動作
2. リンククリック → ✅ 動作
3. 2回目以降のクリック → ✅ 動作
4. ブラウザバック/フォワード → ✅ 動作

---

## 教訓

### 1. CSP実装は段階的に行う

**正しいアプローチ**:
```
Phase 1: unsafe-eval のみ削除
  ↓ テスト・検証
Phase 2: unsafe-inline 削除の計画
  ↓ SvelteKit CSP設定の調査
Phase 3: Nonce-based CSP実装
  ↓ テスト・検証
Phase 4: 本番デプロイ
```

**今回の失敗**:
```
Phase 1: unsafe-inline と unsafe-eval を同時削除
  ↓ テスト不足
Phase 2: 本番環境でバグ発見
  ↓ ロールバック
```

---

### 2. SvelteKitのCSP実装パターン

**推奨される方法**:

**Option 1: svelte.config.js で設定（推奨）**
```javascript
// svelte.config.js
export default {
    kit: {
        csp: {
            mode: 'auto',
            directives: {
                'script-src': ['self', 'https://js.stripe.com']
            }
        }
    }
};
```

**メリット**:
- SvelteKitが自動的にnonceを生成・適用
- プリレンダリングページにはhash、動的ページにはnonceを自動選択
- `%sveltekit.nonce%` プレースホルダーが使える

**Option 2: hooks.server.ts で手動設定（現在の方法）**
```typescript
// hooks.server.ts
const cspDirectives = [
    "script-src 'self' 'unsafe-inline' https://js.stripe.com"
].join('; ');
response.headers.set('Content-Security-Policy', cspDirectives);
```

**メリット**:
- 柔軟性が高い
- 他のヘッダーと一緒に管理可能

**デメリット**:
- Nonce実装が複雑
- SvelteKitの自動生成スクリプトへのnonce適用が困難

---

### 3. テスト戦略

**CSP変更時のテストチェックリスト**:
- [ ] ビルドが成功するか
- [ ] ユニットテストが通るか
- [ ] **ブラウザでのE2Eテスト**（最重要）
  - [ ] 初回ロード
  - [ ] ナビゲーション（複数回）
  - [ ] フォーム送信
  - [ ] 外部スクリプト（Stripe等）
- [ ] ブラウザコンソールにCSPエラーがないか
- [ ] 開発環境と本番環境の両方で確認

**今回の反省**:
- ビルドとユニットテストは通ったが、ブラウザでのE2Eテストを怠った
- CSP変更は必ずブラウザでの動作確認が必要

---

## 今後の計画

### Phase 1: 現状維持（✅ 完了）
- `unsafe-inline` 許可
- `unsafe-eval` 削除
- 安定動作の確保

### Phase 2: SvelteKit CSP移行の調査（TODO）
**調査項目**:
1. `svelte.config.js` の `kit.csp` 設定方法
2. `mode: 'auto'` の挙動確認
3. Stripe.js との互換性確認
4. Supabase Auth との互換性確認

### Phase 3: Nonce-based CSP実装（TODO）
**実装手順**:
1. 開発環境で `kit.csp` を有効化
2. ブラウザでナビゲーション確認
3. Stripe決済フローの動作確認
4. 段階的に本番展開

### Phase 4: CSP Reporting（TODO）
**目的**: CSP違反を監視
```typescript
const cspDirectives = [
    // ... existing directives
    "report-uri /api/csp-violation"
].join('; ');
```

---

## まとめ

### 修正の成果

**問題の解決**:
- ✅ ナビゲーション動作の復旧
- ✅ `unsafe-eval` 削除によるセキュリティ向上
- ✅ 全375テスト合格
- ✅ ビルド成功

**セキュリティ改善**:
- ✅ `eval()` によるコードインジェクション防御
- ✅ 外部リソースの厳格なホワイトリスト化
- ⚠️ `unsafe-inline` は一時的に許可（将来的に削除予定）

### 重要な教訓

**「動作しないセキュリティは意味がない」**

セキュリティ強化は重要ですが、ユーザーがアプリを使えなくなっては本末転倒です。段階的なアプローチと十分なテストが必要です。

**「フレームワークの実装パターンを理解する」**

SvelteKitには独自のCSP実装方法があります。手動実装する前に、フレームワークが提供する機能を調査すべきでした。

---

## 関連ドキュメント

### 本プロジェクト
- `CSP_HARDENING_FIX.md`: 初期CSP強化の試み（バグあり）
- `SECURITY_FIXES_SUMMARY.md`: セキュリティ修正全体のサマリー

### 外部リソース
- [SvelteKit Configuration - CSP](https://svelte.dev/docs/kit/configuration)
- [Creating Content Security Policy in SvelteKit — Hugo Sum](https://hugosum.com/blog/creating-content-security-policy-in-sveltekit)
- [SvelteKit Content Security Policy: CSP for XSS Protection](https://rodneylab.com/sveltekit-content-security-policy/)

---

**修正完了日**: 2026-03-10
**発見者**: ユーザーからの報告（クリックができなくなった）
**次のステップ**: SvelteKit公式CSP実装への移行計画

