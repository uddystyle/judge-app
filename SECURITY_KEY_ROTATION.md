# 🔐 キーローテーション手順書

このドキュメントでは、セキュリティ上重要な認証情報のローテーション（更新）手順を説明します。

## 📋 現状の評価

### ✅ 良好な点
- `.env`ファイルはGit履歴に含まれていません
- `.gitignore`に`.env`が正しく設定されています
- 機密情報が外部に漏洩していません

### ⚠️ 推奨事項
念のため、本番環境のキーは定期的にローテーションすることを推奨します。

---

## 🔄 ローテーション手順

### 1. Supabaseキーのローテーション

#### 手順：
1. [Supabaseダッシュボード](https://supabase.com/dashboard)にログイン
2. プロジェクト `kbxlukbvhlxponcentyp` を選択
3. 左メニューから「Settings」→「API」を選択
4. 「Service Role Key」セクションで「Reset」をクリック
5. 新しいキーをコピーして`.env`ファイルを更新

#### 更新が必要なキー：
```bash
SUPABASE_SERVICE_ROLE_KEY="新しいキーに置き換え"
```

#### 注意点：
- `PUBLIC_SUPABASE_ANON_KEY`は公開用なので通常はローテーション不要
- `SUPABASE_SERVICE_ROLE_KEY`は管理者権限のため重要

---

### 2. Stripeキーのローテーション

#### 手順：
1. [Stripeダッシュボード](https://dashboard.stripe.com/)にログイン
2. 左上で「テストモード」か「本番モード」を確認
3. 「開発者」→「APIキー」を選択
4. 既存のシークレットキーを削除
5. 「シークレットキーを作成」をクリック
6. 新しいキーをコピーして`.env`ファイルを更新

#### 更新が必要なキー：
```bash
STRIPE_SECRET_KEY="新しいキーに置き換え"
```

#### 注意点：
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`は公開用なので通常は問題なし
- キーをローテーションすると既存のAPIリクエストが失敗するため、ダウンタイムに注意

---

### 3. Stripe Webhookシークレットのローテーション

#### 手順：
1. [Stripeダッシュボード](https://dashboard.stripe.com/)の「開発者」→「Webhook」を選択
2. 既存のWebhookエンドポイントをクリック
3. 「署名シークレット」セクションで「ローリング」をクリック
4. 新しいシークレットをコピーして`.env`ファイルを更新

#### 更新が必要なキー：
```bash
STRIPE_WEBHOOK_SECRET="新しいシークレットに置き換え"
```

#### 注意点：
- Webhookシークレットを変更すると、既存のWebhookイベントの検証が失敗します
- サーバーを再起動して新しいシークレットを適用してください

---

## 🚨 緊急時のローテーション

もしキーが漏洩した疑いがある場合：

### 即座に実行：
1. **Supabase**: サービスロールキーをリセット
2. **Stripe**: 既存のシークレットキーを削除して新規作成
3. **Webhook**: Webhookシークレットをローリング
4. `.env`ファイルを更新
5. アプリケーションを再起動

### 確認事項：
```bash
# 環境変数が正しく読み込まれているか確認
npm run dev

# ログで以下を確認：
# - Supabase接続成功
# - Stripe初期化成功
```

---

## 📝 定期メンテナンス

### 推奨スケジュール：
- **テスト環境**: 6ヶ月ごと
- **本番環境**: 3ヶ月ごと（またはセキュリティインシデント時）

### チェックリスト：
- [ ] Supabaseサービスロールキーをローテーション
- [ ] Stripeシークレットキーをローテーション
- [ ] Webhook シークレットをローテーション
- [ ] `.env`ファイルを更新
- [ ] アプリケーションを再起動
- [ ] 動作確認（ログイン、決済処理、Webhookイベント）
- [ ] 古いキーを安全に削除

---

## 🔒 追加のセキュリティ対策

### 1. 環境変数の分離
本番環境とテスト環境で異なるキーを使用：
```bash
# 開発環境
.env.development

# 本番環境
.env.production
```

### 2. キー管理サービスの利用
大規模なチームでは以下の利用を検討：
- AWS Secrets Manager
- Google Cloud Secret Manager
- HashiCorp Vault

### 3. アクセス制限
- Supabase: IPホワイトリスト設定
- Stripe: Webhook署名検証の徹底
- サーバー: 環境変数へのアクセスログ記録

---

## 📞 問い合わせ

キーローテーションに関する質問や問題が発生した場合：

- **Supabase**: https://supabase.com/docs/guides/platform/going-into-prod#api-keys
- **Stripe**: https://stripe.com/docs/keys

---

**最終更新**: 2025-11-08
