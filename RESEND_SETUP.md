# Resend メール通知設定ガイド

お問い合わせフォームからの通知を `support@tentoapp.com` に送信するための設定手順です。

## 1. Resendアカウントの作成

### 1-1. Resendに登録
1. [https://resend.com](https://resend.com) にアクセス
2. 「Sign Up」をクリックして無料アカウントを作成
3. メールアドレスで登録（GitHubアカウントでも登録可能）

### 1-2. APIキーの取得
1. Resendダッシュボードにログイン
2. 左メニューから「API Keys」を選択
3. 「Create API Key」をクリック
4. 名前を入力（例: `tento-production`）
5. Permissionは「Sending access」を選択
6. 「Add」をクリック
7. **表示されたAPIキーをコピー（後で確認できません！）**

形式: `re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## 2. ドメインの設定

### 2-1. ドメインを追加
1. Resendダッシュボードの左メニューから「Domains」を選択
2. 「Add Domain」をクリック
3. ドメイン名を入力: `tentoapp.com`
4. 「Add」をクリック

### 2-2. DNS設定の追加
Resendが表示するDNSレコードを、ドメインのDNS管理画面（Vercel、CloudFlare、お名前.comなど）に追加します。

**追加が必要なレコード:**

#### SPFレコード（TXTレコード）
```
Type: TXT
Name: @ または tentoapp.com
Value: v=spf1 include:amazonses.com ~all
```

#### DKIMレコード（TXTレコード）
```
Type: TXT
Name: resend._domainkey または resend._domainkey.tentoapp.com
Value: （Resendが表示する長い文字列）
```

#### DMARCレコード（TXTレコード）- 推奨
```
Type: TXT
Name: _dmarc または _dmarc.tentoapp.com
Value: v=DMARC1; p=none; rua=mailto:support@tentoapp.com
```

### 2-3. 認証確認
1. DNS設定を追加後、数分～24時間待つ（通常は15分程度）
2. Resendダッシュボードで「Verify」ボタンをクリック
3. ステータスが「Verified」になれば完了 ✅

## 3. 環境変数の設定

### 開発環境（ローカル）
`.env` ファイルに以下を追加:

```bash
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 本番環境（Vercel）
1. Vercelダッシュボードで該当プロジェクトを選択
2. 「Settings」→「Environment Variables」を選択
3. 以下を追加:

```
Name: RESEND_API_KEY
Value: re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
Environment: Production
```

4. 「Save」をクリック
5. **再デプロイが必要** - 「Deployments」タブから最新デプロイをRedeploy

## 4. 送信元アドレスの設定

### noreply@tentoapp.com の設定
現在のコードでは以下のアドレスから送信されます:

```typescript
from: 'TENTO <noreply@tentoapp.com>'
```

**このアドレスは自動的に利用可能になります。**
ドメイン認証が完了すれば、`@tentoapp.com` のすべてのアドレスから送信できます。

## 5. テスト送信

### 5-1. ローカル環境でテスト
1. 開発サーバーを起動: `npm run dev`
2. ブラウザで `http://localhost:5173/contact` にアクセス
3. お問い合わせフォームに入力して送信
4. ターミナルに `Contact notification email sent successfully` と表示されればOK
5. `support@tentoapp.com` にメールが届いているか確認

### 5-2. 本番環境でテスト
1. Vercelに環境変数を設定後、再デプロイ
2. 本番環境のお問い合わせフォームから送信
3. メール受信を確認

## 6. トラブルシューティング

### ドメイン認証が完了しない
- DNS設定が正しいか確認（特にNameの部分）
- DNSの反映を待つ（最大24時間）
- `nslookup` コマンドで確認:
  ```bash
  nslookup -type=TXT resend._domainkey.tentoapp.com
  ```

### メールが届かない
1. **Resendダッシュボードでログを確認**
   - 「Emails」タブで送信履歴を確認
   - エラーメッセージを確認

2. **迷惑メールフォルダを確認**
   - 初回送信は迷惑メール扱いになることがあります

3. **環境変数を確認**
   - Vercelで `RESEND_API_KEY` が正しく設定されているか
   - 再デプロイを実行したか

4. **ログを確認**
   - サーバーログに `Failed to send contact notification email` がないか確認

### APIキーエラー
```
Error: Missing API key
```
→ 環境変数 `RESEND_API_KEY` が設定されていません

```
Error: Invalid API key
```
→ APIキーが間違っています。Resendダッシュボードで再確認

## 7. 料金について

### 無料プラン
- 月間 3,000通まで無料
- お問い合わせ通知なら十分な容量

### 有料プラン
- $20/月 で 50,000通まで
- さらに大量配信が必要な場合のみ

## 8. セキュリティ

### APIキーの保護
- **絶対にGitにコミットしない**
- `.env` ファイルは `.gitignore` に含まれています
- Vercelの環境変数は暗号化されて保存されます

### SPF/DKIM/DMARC
- なりすましメール対策として重要
- ドメイン認証で自動的に設定されます

## 9. 今後の拡張

このResend設定は以下の用途にも使えます:

- パスワードリセットメール
- セッション招待メール
- 領収書送信
- システム通知

必要に応じて機能を追加できます。

## サポート

問題が解決しない場合:
- [Resend Documentation](https://resend.com/docs)
- [Resend Discord](https://resend.com/discord)
