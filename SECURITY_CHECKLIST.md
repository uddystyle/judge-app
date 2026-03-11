# Realtime セキュリティチェックリスト

## 🚨 必須: デプロイ前の確認事項

Supabase Realtimeを使用したアプリケーションをデプロイする前に、以下のセキュリティチェックを実施してください。

---

## チェックリスト

### 1. RLS（Row Level Security）設定

#### ✅ training_scores テーブル

- [ ] RLSが有効化されている
- [ ] Authenticated users: セッション参加者のみ閲覧可能（SELECT）
- [ ] Authenticated users: 自分のスコアのみ挿入可能（INSERT）
- [ ] Authenticated users: 自分のスコアのみ更新可能（UPDATE）
- [ ] Anonymous users: ゲスト参加セッションのみ閲覧可能（SELECT）
- [ ] Anonymous users: 有効なguest_identifierでのみ挿入可能（INSERT）
- [ ] Anonymous users: 自分のスコアのみ更新可能（UPDATE）
- [ ] **危険なポリシーがない**: `USING (true)` ポリシーが存在しない

#### ✅ results テーブル

- [ ] RLSが有効化されている
- [ ] Authenticated users: 参加セッションのみ閲覧可能（SELECT）
- [ ] Authenticated users: 参加セッションにのみ挿入可能（INSERT）
- [ ] Authenticated users: 自分のスコアのみ更新可能（UPDATE）
- [ ] Authenticated users: 主任検定員のみ削除可能（DELETE）
- [ ] Anonymous users: ゲスト参加セッションのみ閲覧可能（SELECT）
- [ ] Anonymous users: 有効なguest_nameでのみ挿入可能（INSERT）
- [ ] Anonymous users: 自分のスコアのみ更新可能（UPDATE）
- [ ] **危険なポリシーがない**: `USING (true)` ポリシーが存在しない

#### ✅ sessions テーブル

- [ ] RLSが有効化されている
- [ ] Authenticated users: 参加セッションのみ閲覧可能（SELECT）
- [ ] Anonymous users: ゲスト参加セッションのみ閲覧可能（SELECT）
- [ ] **危険なポリシーがない**: `USING (true)` ポリシーが存在しない

### 2. Realtime Publication設定

- [ ] `training_scores` がpublicationに含まれている
- [ ] `results` がpublicationに含まれている
- [ ] `sessions` がpublicationに含まれている

### 3. Replica Identity設定

- [ ] `training_scores` が `FULL` に設定されている
- [ ] `results` が `FULL` に設定されている
- [ ] `sessions` が `FULL` に設定されている

### 4. クライアント側の実装

- [ ] Realtimeフィルター条件が適切に設定されている
- [ ] エラーハンドリングが実装されている（CHANNEL_ERROR, TIMED_OUT）
- [ ] 自動再接続機構が実装されている
- [ ] フォールバックポーリングが実装されている
- [ ] チャンネルのクリーンアップ（onDestroy）が実装されている

### 5. セキュリティテスト

- [ ] **クロスセッションアクセステスト**: 他セッションのデータが見えないことを確認
- [ ] **ゲスト隔離テスト**: ゲストAが他セッションのゲストBのデータを見れないことを確認
- [ ] **認証ユーザー隔離テスト**: セッション参加者以外がデータを見れないことを確認
- [ ] **Realtimeイベント隔離**: 他セッションのINSERT/UPDATE/DELETEイベントが届かないことを確認

---

## 実施方法

### 自動検証スクリプト

```bash
# RLSセキュリティを自動検証
psql $DATABASE_URL -f scripts/verify-rls-security.sql
```

**出力例**:
```
Security Score: 18 / 20 (90.0 %)
=================================================================
✅ Excellent: Your RLS security is well configured!
```

### 手動検証

#### 1. Supabase Dashboard

1. **Database** > **Replication** > **Publications**
   - `supabase_realtime` に`training_scores`, `results`, `sessions`が含まれていることを確認

2. **Database** > **Tables** > **training_scores**
   - "RLS enabled" が有効になっていることを確認
   - "Policies" タブで全ポリシーを確認

3. **Database** > **SQL Editor**
   - `scripts/verify-rls-security.sql` を実行

#### 2. クロスセッションアクセステスト

**テストシナリオ**:
```
1. Session A (judge_1, guest_A)
2. Session B (judge_2, guest_B)
3. judge_1でSession BのRealtimeに接続を試みる
4. → イベントが届かないことを確認（RLSで保護）
```

**テストコード**:
```typescript
// judge_1でSession BのRealtimeに接続
const channel = supabase
  .channel('test-cross-session')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'training_scores',
    filter: `event_id=eq.${sessionB_eventId}`
  }, (payload) => {
    console.error('❌ SECURITY BREACH:', payload);
    // このログが出たら問題あり
  })
  .subscribe();

// Session BでINSERTを実行
// → judge_1にイベントが届かなければOK
```

#### 3. ゲスト隔離テスト

**テストシナリオ**:
```
1. Session Aにguest_Aを招待（anon認証）
2. Session Bにguest_Bを招待（anon認証）
3. guest_A（anon）でSession BのデータにRealtimeアクセス
4. → イベントが届かないことを確認
```

---

## 修正手順

### 問題が見つかった場合

#### Step 1: マイグレーション実行

```bash
# Supabase CLI使用
supabase db push

# または直接SQL実行
psql $DATABASE_URL -f database/migrations/999_fix_rls_realtime_security.sql
```

#### Step 2: 検証再実行

```bash
psql $DATABASE_URL -f scripts/verify-rls-security.sql
```

#### Step 3: クロスセッションテスト

上記の「クロスセッションアクセステスト」を実施

---

## 緊急対応

### 本番環境で脆弱性が見つかった場合

**即座に実施**:

1. **Realtimeを一時停止**（オプション）
   ```sql
   -- テーブルをpublicationから削除
   ALTER PUBLICATION supabase_realtime DROP TABLE training_scores;
   ALTER PUBLICATION supabase_realtime DROP TABLE results;
   ```

2. **RLSポリシーを修正**
   ```bash
   psql $DATABASE_URL -f database/migrations/999_fix_rls_realtime_security.sql
   ```

3. **Realtimeを再開**
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
   ALTER PUBLICATION supabase_realtime ADD TABLE results;
   ```

4. **全ユーザーに再ログインを要求**（オプション）
   - セッションをリセット
   - クライアント側のキャッシュをクリア

---

## 参考ドキュメント

- [REALTIME_SECURITY.md](./REALTIME_SECURITY.md) - 詳細なセキュリティガイド
- [database/migrations/999_fix_rls_realtime_security.sql](./database/migrations/999_fix_rls_realtime_security.sql) - RLS修正マイグレーション
- [scripts/verify-rls-security.sql](./scripts/verify-rls-security.sql) - 自動検証スクリプト

---

## セキュリティ連絡先

セキュリティ上の問題を発見した場合:

1. **即座に報告**（GitHub Issuesは使用しない）
2. プライベートメッセージで報告
3. 詳細情報を提供:
   - 影響範囲
   - 再現手順
   - 発見日時

---

**最終更新**: 2026-03-11
**重要度**: 🚨 CRITICAL
**対象**: 本番デプロイ前の必須チェック
