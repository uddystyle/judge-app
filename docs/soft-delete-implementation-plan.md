# Soft Delete実装計画

## 概要

このドキュメントは、TENTOアプリケーションにおける組織メンバーとセッションのSoft Delete（論理削除）機能の実装計画をまとめたものです。

**最終更新日**: 2025-01-23

---

## 目次

1. [基本設計思想](#基本設計思想)
2. [組織メンバーの削除機能](#組織メンバーの削除機能)
3. [セッションのアーカイブ機能](#セッションのアーカイブ機能)
4. [サブスクリプションベースのデータ保持](#サブスクリプションベースのデータ保持)
5. [実装フェーズ](#実装フェーズ)
6. [クエリパターン](#クエリパターン)
7. [データ表示の方針](#データ表示の方針)
8. [セキュリティ・制限事項](#セキュリティ制限事項)
9. [技術的なメリット](#技術的なメリット)
10. [ビジネス上のメリット](#ビジネス上のメリット)

---

## 基本設計思想

### 論理削除（Soft Delete）の採用

物理削除（Hard Delete）を避け、論理削除（Soft Delete）を採用します。

**主な特徴:**
- データベースからレコードを削除せず、削除フラグ（`deleted_at`/`removed_at`）で管理
- 過去のデータ整合性を保持
- 監査証跡として履歴を記録
- 必要に応じて復元可能
- サブスクリプションプランに基づく自動削除機能

**削除の段階:**
1. **Soft Delete**: 削除フラグを立てる（復元可能）
2. **Hard Delete**: データベースから完全削除（復元不可）
   - 手動削除: Premiumプランの管理者のみ
   - 自動削除: プランの保持期間経過後

---

## 組織メンバーの削除機能

### データベーススキーマ

```sql
-- organization_members テーブルに追加
ALTER TABLE organization_members
ADD COLUMN removed_at TIMESTAMPTZ NULL,
ADD COLUMN removed_by UUID REFERENCES auth.users(id);

-- インデックス追加（パフォーマンス向上）
CREATE INDEX idx_organization_members_removed_at
ON organization_members(removed_at)
WHERE removed_at IS NULL;

-- コメント追加
COMMENT ON COLUMN organization_members.removed_at IS '組織から削除された日時。NULLの場合はアクティブなメンバー。';
COMMENT ON COLUMN organization_members.removed_by IS '削除を実行したユーザーのID。';
```

### 仕様

#### 削除条件
- ✅ 管理者のみが削除実行可能
- ✅ 最後の管理者は削除不可
- ✅ 削除前に確認ダイアログ表示

#### 削除後の動作
- アクティブなメンバーリストからは非表示
- 過去のセッション・得点データは保持
- セッション詳細ページでは「退会済み」として表示可能

#### メンバー数のカウント
- プラン制限チェックは `removed_at IS NULL` のメンバーのみカウント
- 削除されたメンバーは制限にカウントされない

#### 復元
- 必要に応じて復元可能（実装はオプション）

#### 自動削除
- プランの保持期間経過後、アクティブなセッションで参照されていないメンバーは自動削除

### API エンドポイント

```typescript
// DELETE /api/organization/[id]/members/[memberId]
export async function DELETE({ params, locals }) {
  const { id: orgId, memberId } = params;
  const { supabase, user } = locals;

  // 権限チェック: 管理者のみ
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .single();

  if (membership?.role !== 'admin') {
    return json({ error: '権限がありません' }, { status: 403 });
  }

  // 最後の管理者チェック
  const { count: adminCount } = await supabase
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .is('removed_at', null);

  const { data: targetMember } = await supabase
    .from('organization_members')
    .select('role')
    .eq('id', memberId)
    .single();

  if (targetMember?.role === 'admin' && adminCount === 1) {
    return json({ error: '最後の管理者は削除できません' }, { status: 400 });
  }

  // Soft Delete実行
  const { error } = await supabase
    .from('organization_members')
    .update({
      removed_at: new Date().toISOString(),
      removed_by: user.id
    })
    .eq('id', memberId);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ success: true });
}
```

### UI実装

#### 組織詳細ページ

```svelte
<!-- /routes/organization/[id]/+page.svelte -->
{#each data.members as member}
  <div class="member-card">
    <div class="member-info">
      <div class="member-name">{member.profiles?.full_name}</div>
      <span class="role-badge">{roleNames[member.role]}</span>
    </div>

    {#if isAdmin && member.user_id !== data.user.id}
      <button
        class="delete-member-btn"
        on:click={() => confirmDeleteMember(member)}
      >
        削除
      </button>
    {/if}
  </div>
{/each}
```

#### 確認ダイアログ

```svelte
<script>
  let showDeleteConfirm = false;
  let memberToDelete = null;

  function confirmDeleteMember(member) {
    memberToDelete = member;
    showDeleteConfirm = true;
  }

  async function deleteMember() {
    const response = await fetch(
      `/api/organization/${orgId}/members/${memberToDelete.id}`,
      { method: 'DELETE' }
    );

    if (response.ok) {
      // 成功通知とリロード
      showDeleteConfirm = false;
      location.reload();
    } else {
      const { error } = await response.json();
      alert(error);
    }
  }
</script>

{#if showDeleteConfirm}
  <div class="modal">
    <div class="modal-content">
      <h3>メンバーを削除しますか？</h3>
      <p>{memberToDelete?.profiles?.full_name} を組織から削除します。</p>
      <p class="warning">過去のセッションデータは保持されます。</p>

      <div class="modal-actions">
        <button on:click={() => showDeleteConfirm = false}>キャンセル</button>
        <button class="danger" on:click={deleteMember}>削除</button>
      </div>
    </div>
  </div>
{/if}
```

---

## セッションのアーカイブ機能

### データベーススキーマ

```sql
-- sessions テーブルに追加
ALTER TABLE sessions
ADD COLUMN deleted_at TIMESTAMPTZ NULL,
ADD COLUMN deleted_by UUID REFERENCES auth.users(id);

-- インデックス追加
CREATE INDEX idx_sessions_deleted_at
ON sessions(deleted_at)
WHERE deleted_at IS NULL;

-- コメント追加
COMMENT ON COLUMN sessions.deleted_at IS 'セッションが削除された日時。NULLの場合はアクティブなセッション。';
COMMENT ON COLUMN sessions.deleted_by IS '削除を実行したユーザーのID。';
```

### 削除の段階

#### 第1段階: Soft Delete（論理削除）
- セッションがダッシュボードから非表示になる
- アーカイブページで閲覧可能（管理者のみ）
- 復元可能
- プランの保持期間内は保存される

#### 第2段階: Hard Delete（物理削除）
以下のいずれかで完全削除：
1. **自動削除**: プランの保持期間経過後に自動的に完全削除
2. **手動削除**: 管理者による完全削除（2段階確認必須、Premiumプランのみ）

完全削除後は復元不可

### アーカイブページ

#### アクセス制限
- 組織の管理者のみアクセス可能

#### 機能一覧
1. 削除されたセッションの一覧表示
2. 削除日時・削除者の表示
3. 完全削除までの残り日数表示
4. セッション詳細の閲覧
5. セッションの復元
6. 完全削除（Premiumプランのみ、2段階確認）
7. フィルター・検索機能

#### ルート構造
```
/organization/[id]/archive
```

#### ページレイアウト

```svelte
<!-- /routes/organization/[id]/archive/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;

  const retentionDays = data.organization.plans.archived_data_retention_days;
  const isUnlimited = retentionDays === -1;

  function calculateDaysUntilDeletion(deletedAt: string, retentionDays: number) {
    if (retentionDays === -1) return null;
    const deleted = new Date(deletedAt);
    const expiry = new Date(deleted.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    return Math.floor((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }
</script>

<Header {...headerProps} />

<div class="container">
  <div class="page-header">
    <h1>📦 セッションアーカイブ</h1>
    <p class="subtitle">削除されたセッションの履歴を管理できます</p>
  </div>

  <!-- 保持期間の表示 -->
  {#if isUnlimited}
    <div class="retention-info premium">
      <span class="icon">♾️</span>
      <span>Premiumプラン: アーカイブは無期限で保存されます</span>
    </div>
  {:else}
    <div class="retention-info warning">
      <span class="icon">⏰</span>
      <span>削除から{retentionDays}日経過したデータは自動的に完全削除されます</span>
    </div>
  {/if}

  <!-- アーカイブ一覧 -->
  <div class="archive-list">
    {#each data.archivedSessions as session}
      {@const daysUntilDeletion = calculateDaysUntilDeletion(session.deleted_at, retentionDays)}

      <div
        class="archive-card"
        class:expiring-soon={daysUntilDeletion !== null && daysUntilDeletion <= 7 && daysUntilDeletion > 0}
      >
        <div class="session-info">
          <h3>{session.name}</h3>
          <div class="meta">
            <span>削除日: {formatDate(session.deleted_at)}</span>
            <span>削除者: {session.deleted_by_user?.profiles?.full_name}</span>

            {#if !isUnlimited && daysUntilDeletion !== null}
              {#if daysUntilDeletion > 0}
                <span class="expiry-warning">
                  あと{daysUntilDeletion}日で完全削除されます
                </span>
              {:else}
                <span class="expiry-warning urgent">
                  まもなく完全削除されます
                </span>
              {/if}
            {/if}
          </div>
        </div>

        <div class="actions">
          <button on:click={() => viewSession(session.id)}>
            詳細を見る
          </button>
          <button class="restore-btn" on:click={() => restoreSession(session.id)}>
            復元
          </button>
          {#if isUnlimited}
            <button class="danger-btn" on:click={() => permanentlyDelete(session.id)}>
              完全削除
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<Footer />
```

### API エンドポイント

#### セッション削除（Soft Delete）

```typescript
// DELETE /api/sessions/[id]
export async function DELETE({ params, locals }) {
  const { id: sessionId } = params;
  const { supabase, user } = locals;

  // 権限チェック: セッションの組織の管理者のみ
  const { data: session } = await supabase
    .from('sessions')
    .select('organization_id, organizations!inner(id)')
    .eq('id', sessionId)
    .single();

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', session.organization_id)
    .eq('user_id', user.id)
    .single();

  if (membership?.role !== 'admin') {
    return json({ error: '権限がありません' }, { status: 403 });
  }

  // Soft Delete実行
  const { error } = await supabase
    .from('sessions')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id
    })
    .eq('id', sessionId);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ success: true });
}
```

#### セッション復元

```typescript
// POST /api/sessions/[id]/restore
export async function POST({ params, locals }) {
  const { id: sessionId } = params;
  const { supabase, user } = locals;

  // 権限チェック（省略）

  // 復元実行
  const { error } = await supabase
    .from('sessions')
    .update({
      deleted_at: null,
      deleted_by: null
    })
    .eq('id', sessionId);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ success: true });
}
```

#### 完全削除（Premiumプランのみ）

```typescript
// DELETE /api/sessions/[id]/permanent
export async function DELETE({ params, locals }) {
  const { id: sessionId } = params;
  const { supabase, user } = locals;

  // 権限チェック + プランチェック
  const { data: session } = await supabase
    .from('sessions')
    .select('organization_id, organizations!inner(plan_type)')
    .eq('id', sessionId)
    .single();

  if (session.organizations.plan_type !== 'premium') {
    return json({ error: 'この機能はPremiumプランのみ利用可能です' }, { status: 403 });
  }

  // 完全削除実行
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ success: true });
}
```

---

## サブスクリプションベースのデータ保持

### プランテーブルの拡張

```sql
-- plans テーブルにデータ保持期間を追加
ALTER TABLE plans
ADD COLUMN archived_data_retention_days INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN plans.archived_data_retention_days IS
'アーカイブされたデータの保持期間（日数）。-1の場合は無期限。';

-- 各プランの保持期間を設定
UPDATE plans SET archived_data_retention_days = 30 WHERE plan_type = 'free';
UPDATE plans SET archived_data_retention_days = 90 WHERE plan_type = 'basic';
UPDATE plans SET archived_data_retention_days = 180 WHERE plan_type = 'standard';
UPDATE plans SET archived_data_retention_days = -1 WHERE plan_type = 'premium';
```

### プラン別データ保持期間

| プラン | 保持期間 | セッション自動削除 | メンバー自動削除 |
|--------|----------|-------------------|------------------|
| **Free** | 30日 | 削除から30日後 | 削除から30日後（※） |
| **Basic** | 90日 | 削除から90日後 | 削除から90日後（※） |
| **Standard** | 180日 | 削除から180日後 | 削除から180日後（※） |
| **Premium** | 無制限 | 自動削除なし | 自動削除なし |

**※メンバー削除の条件**: アクティブなセッションで参照されていない場合のみ

### 自動削除関数

```sql
-- 期限切れアーカイブデータの自動削除関数
CREATE OR REPLACE FUNCTION cleanup_expired_archived_data()
RETURNS TABLE(
  organization_id UUID,
  deleted_sessions_count INTEGER,
  deleted_members_count INTEGER
) AS $$
DECLARE
  org RECORD;
  retention_days INTEGER;
  session_count INTEGER;
  member_count INTEGER;
BEGIN
  -- 各組織について処理
  FOR org IN
    SELECT o.id, o.name, o.plan_type, p.archived_data_retention_days
    FROM organizations o
    JOIN plans p ON p.plan_type = o.plan_type
    WHERE p.archived_data_retention_days != -1  -- 無制限プランは除外
  LOOP
    retention_days := org.archived_data_retention_days;

    -- 期限切れのセッションを完全削除
    DELETE FROM sessions
    WHERE organization_id = org.id
      AND deleted_at IS NOT NULL
      AND deleted_at < NOW() - (retention_days || ' days')::INTERVAL
    RETURNING COUNT(*) INTO session_count;

    -- 期限切れのメンバー記録を完全削除
    -- ※ただし、アクティブなセッションで参照されている場合は削除しない
    DELETE FROM organization_members
    WHERE organization_id = org.id
      AND removed_at IS NOT NULL
      AND removed_at < NOW() - (retention_days || ' days')::INTERVAL
      AND NOT EXISTS (
        -- まだ参照されているか確認
        SELECT 1 FROM judges j
        JOIN sessions s ON s.id = j.session_id
        WHERE j.user_id = organization_members.user_id
          AND s.deleted_at IS NULL  -- アクティブなセッション
      )
    RETURNING COUNT(*) INTO member_count;

    -- 結果を返す
    RETURN QUERY SELECT org.id, session_count, member_count;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 実行権限の設定
GRANT EXECUTE ON FUNCTION cleanup_expired_archived_data() TO service_role;
```

### Cron Job設定

```sql
-- pg_cron を使用（Supabaseで利用可能）
-- 毎日午前3時に実行
SELECT cron.schedule(
  'cleanup-archived-data',
  '0 3 * * *',  -- 毎日午前3時
  $$
  SELECT cleanup_expired_archived_data();
  $$
);
```

### Supabase Edge Function（代替方法）

```typescript
// supabase/functions/cleanup-archived-data/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 自動削除関数を実行
    const { data, error } = await supabase.rpc('cleanup_expired_archived_data')

    if (error) throw error

    // 削除結果をログに記録
    console.log('Cleanup completed:', data)

    return new Response(
      JSON.stringify({
        success: true,
        results: data
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

---

## 実装フェーズ

### Phase 1: 組織メンバー削除機能

**目的**: 組織メンバーのSoft Delete機能を実装

**タスク:**
1. マイグレーションファイルの作成
   - `removed_at`, `removed_by` カラム追加
   - インデックス作成
2. RLSポリシーの更新
   - アクティブなメンバーのみアクセス可能
3. 削除API エンドポイント作成
   - `/api/organization/[id]/members/[memberId]` DELETE
4. 組織詳細ページにUI追加
   - メンバー一覧に「削除」ボタン
   - 確認ダイアログ
   - 最後の管理者チェック
5. セッション詳細ページの表示調整
   - 削除されたメンバーを「退会済み」表示

**完了条件:**
- ✅ 管理者がメンバーを削除できる
- ✅ 最後の管理者は削除不可
- ✅ 削除されたメンバーは一覧から非表示
- ✅ 過去のセッションでは「退会済み」として表示

---

### Phase 2: セッション削除（Soft Delete）

**目的**: セッションのSoft Delete機能を実装

**タスク:**
1. マイグレーションファイルの作成
   - `deleted_at`, `deleted_by` カラム追加
   - インデックス作成
2. RLSポリシーの更新
   - アクティブなセッションのみアクセス可能
3. 削除API エンドポイント作成
   - `/api/sessions/[id]` DELETE
4. ダッシュボードの更新
   - `deleted_at IS NULL` のフィルタ追加
5. セッション削除UIの追加
   - セッション詳細ページに「削除」ボタン
   - 確認ダイアログ

**完了条件:**
- ✅ 管理者がセッションを削除できる
- ✅ 削除されたセッションはダッシュボードから非表示
- ✅ 削除されたセッションもデータベースには保持

---

### Phase 3: セッションアーカイブページ

**目的**: 削除されたセッションの管理ページを実装

**タスク:**
1. アーカイブページの作成
   - `/organization/[id]/archive/+page.svelte`
   - `/organization/[id]/archive/+page.server.ts`
2. アーカイブ一覧の表示
   - 削除されたセッションのみ取得
   - 削除日時・削除者表示
   - 完全削除までの残り日数表示
3. 基本アクション実装
   - 詳細を見る
   - 復元ボタン
4. ダッシュボードにリンク追加
   - 管理者のみ表示される「アーカイブ」リンク

**完了条件:**
- ✅ 管理者がアーカイブページにアクセスできる
- ✅ 削除されたセッションの一覧が表示される
- ✅ セッションを復元できる

---

### Phase 4: 完全削除機能（Premiumプランのみ）

**目的**: Premiumプラン向けの手動完全削除機能を実装

**タスク:**
1. 完全削除API エンドポイント
   - `/api/sessions/[id]/permanent` DELETE
   - プランチェック（Premiumのみ）
2. 2段階確認ダイアログ
   - 確認1: 「本当に削除しますか？」
   - 確認2: 「"DELETE"と入力してください」
3. UI実装
   - アーカイブページに「完全削除」ボタン（Premiumのみ表示）

**完了条件:**
- ✅ Premiumプランの管理者のみ完全削除可能
- ✅ 2段階確認が機能する
- ✅ 完全削除後はデータベースから削除される

---

### Phase 5: データ保持期間管理機能

**目的**: サブスクリプションプランに基づく自動削除機能を実装

**タスク:**
1. マイグレーションファイルの作成
   - `plans.archived_data_retention_days` カラム追加
   - 各プランの保持期間設定
2. 自動削除関数の実装
   - `cleanup_expired_archived_data()` 関数作成
   - テスト実行
3. Cron Job設定
   - 毎日午前3時に自動実行
4. UI更新
   - アーカイブページに保持期間表示
   - 残り日数の警告表示
   - 期限切れ間近のハイライト表示
5. 通知機能（オプション）
   - 削除7日前に管理者へメール通知

**完了条件:**
- ✅ 各プランの保持期間が設定されている
- ✅ 期限切れデータが自動削除される
- ✅ UI上で残り日数が表示される

---

### Phase 6: 高度な機能（オプション）

**目的**: ユーザー体験向上のための追加機能

**タスク:**
1. フィルター・検索機能
   - モード別フィルター
   - セッション名検索
2. 削除されたメンバーのアーカイブページ
3. エクスポート機能
   - 完全削除前のバックアップ
4. 削除履歴レポート
   - 削除統計の表示

**完了条件:**
- ✅ アーカイブの検索・フィルタリングが可能
- ✅ データのエクスポートが可能

---

## クエリパターン

### アクティブなデータのみ取得

```typescript
// アクティブなメンバー
const { data: activeMembers } = await supabase
  .from('organization_members')
  .select('*')
  .eq('organization_id', orgId)
  .is('removed_at', null);

// アクティブなセッション
const { data: activeSessions } = await supabase
  .from('sessions')
  .select('*')
  .eq('organization_id', orgId)
  .is('deleted_at', null);
```

### 削除されたデータのみ取得

```typescript
// 削除されたメンバー
const { data: removedMembers } = await supabase
  .from('organization_members')
  .select('*')
  .eq('organization_id', orgId)
  .not('removed_at', 'is', null);

// 削除されたセッション（アーカイブ）
const { data: archivedSessions } = await supabase
  .from('sessions')
  .select(`
    *,
    deleted_by_user:deleted_by (
      profiles (full_name)
    )
  `)
  .eq('organization_id', orgId)
  .not('deleted_at', 'is', null)
  .order('deleted_at', { ascending: false });
```

### プラン情報と一緒に取得

```typescript
// 組織の保持期間を含めて取得
const { data: organization } = await supabase
  .from('organizations')
  .select(`
    *,
    plans (
      archived_data_retention_days
    )
  `)
  .eq('id', orgId)
  .single();

const retentionDays = organization.plans.archived_data_retention_days;
const isUnlimited = retentionDays === -1;
```

### すべてのデータ取得（履歴表示用）

```typescript
// 削除されたメンバーも含めて取得（セッション詳細ページ）
const { data: judges } = await supabase
  .from('judges')
  .select(`
    *,
    organization_members (
      user_id,
      role,
      removed_at,
      profiles (full_name)
    )
  `)
  .eq('session_id', sessionId);
// removed_at のフィルタを付けないことで、削除されたメンバーも取得
```

### メンバー数のカウント（プラン制限チェック）

```typescript
// アクティブなメンバーのみカウント
const { count: activeMemberCount } = await supabase
  .from('organization_members')
  .select('*', { count: 'exact', head: true })
  .eq('organization_id', orgId)
  .is('removed_at', null);

// プラン制限チェック
if (activeMemberCount >= organization.max_members) {
  throw new Error('メンバー数の上限に達しています');
}
```

---

## データ表示の方針

### 削除されたメンバーの表示

#### セッション詳細ページ

```svelte
<div class="judges-list">
  <h3>検定員</h3>
  {#each session.judges as judge}
    <div
      class="judge-card"
      class:removed={judge.organization_members.removed_at}
    >
      <span class="judge-name">
        {judge.organization_members.profiles.full_name}
      </span>
      <span class="judge-role">
        {judge.role === 'chief' ? '主任検定員' : '検定員'}
      </span>
      {#if judge.organization_members.removed_at}
        <span class="removed-badge">退会済み</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .judge-card.removed {
    opacity: 0.6;
    background: var(--bg-secondary);
  }

  .removed-badge {
    background: #999;
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
</style>
```

**表示例:**
```
検定員:
- 田中太郎 (主任検定員) [退会済み]  ← グレーアウト
- 佐藤花子 (検定員)
```

#### 得点詳細

```svelte
<div class="score-detail">
  <span class="athlete-name">{score.athlete_name}</span>
  <span class="score-value">{score.score}点</span>
  <span class="judge-name">
    (検定員: {score.judge.organization_members.profiles.full_name}
    {#if score.judge.organization_members.removed_at}
      [退会済み]
    {/if})
  </span>
</div>
```

**表示例:**
```
選手A: 8.5点 (検定員: 田中太郎 [退会済み])
選手A: 9.0点 (検定員: 佐藤花子)
```

### アーカイブの表示

#### 保持期間の警告

```
━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 セッションアーカイブ
━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ 削除から90日経過したデータは自動的に完全削除されます
```

#### アーカイブカード

```
┌─────────────────────────────┐
│ 🗃️ 検定セッション2025-01-10  │
│ 削除日: 2025-01-15          │
│ 削除者: 田中太郎            │
│ あと85日で完全削除されます   │  ← 残り日数表示
│                             │
│ [詳細を見る] [復元]         │
└─────────────────────────────┘
```

#### 期限切れ間近の警告

```
┌─────────────────────────────┐
│ ⚠️ 大会セッション2024-12-01  │  ← 背景色変更（オレンジ）
│ 削除日: 2024-12-25          │
│ あと3日で完全削除されます！  │  ← 強調表示
│                             │
│ [詳細を見る] [復元]         │
└─────────────────────────────┘
```

#### Premiumプランの表示

```
━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 セッションアーカイブ
━━━━━━━━━━━━━━━━━━━━━━━━━━

♾️ Premiumプラン: アーカイブは無期限で保存されます

┌─────────────────────────────┐
│ 🗃️ 検定セッション2024-06-01  │
│ 削除日: 2024-12-25          │
│ 削除者: 田中太郎            │
│                             │
│ [詳細] [復元] [完全削除]    │  ← 完全削除ボタンあり
└─────────────────────────────┘
```

---

## セキュリティ・制限事項

### アクセス制御

1. **最後の管理者保護**
   - 組織に管理者が1人しかいない場合は削除不可
   - エラーメッセージ: 「最後の管理者は削除できません」

2. **権限チェック**
   - メンバー削除: 管理者のみ
   - セッション削除: 管理者のみ
   - アーカイブ閲覧: 管理者のみ
   - セッション復元: 管理者のみ
   - 完全削除: Premiumプランの管理者のみ

3. **プラン別権限**
   - すべてのプラン: Soft Delete可能
   - Premiumのみ: 手動での完全削除が可能
   - その他: 保持期間経過後に自動削除

### データ保護

4. **監査ログ**
   - 削除実行者の記録（`removed_by`, `deleted_by`）
   - 削除日時の記録（`removed_at`, `deleted_at`）

5. **RLS (Row Level Security)**
   - 削除されたデータも適切なRLSで保護
   - アクティブなメンバーのみアクセス可能

6. **参照整合性**
   - アクティブなセッションで参照されているメンバーは自動削除されない
   - 外部キー制約を維持

### ユーザー保護

7. **確認ダイアログ**
   - メンバー削除: 1段階確認
   - セッション削除: 1段階確認
   - 完全削除: 2段階確認（「本当に削除しますか？」→「"DELETE"と入力」）

8. **復元機能**
   - Soft Delete後はプラン保持期間内であれば復元可能
   - 誤操作からの回復が可能

---

## 技術的なメリット

### データ整合性

1. ✅ **外部キー参照が壊れない**
   - 削除されたメンバーのレコードが残るため、過去のセッション・得点データとの関連が保持される
   - データベースの参照整合性が維持される

2. ✅ **履歴追跡が可能**
   - 過去のセッションで「誰が検定員だったか」が永続的に記録される
   - セッション詳細ページが正常に表示される

### 監査とコンプライアンス

3. ✅ **完全な監査証跡**
   - 誰が、いつ、何を削除したかが記録される
   - コンプライアンス要件に対応

4. ✅ **記録保持要件への対応**
   - 法的・業務上の記録保持期間に対応可能
   - プランによって保持期間をカスタマイズ

### 運用効率

5. ✅ **復元可能**
   - 誤削除から簡単に回復できる
   - ユーザーサポートの負担軽減

6. ✅ **段階的削除**
   - Soft Delete → Hard Delete の2段階で安全性向上
   - ユーザーに猶予期間を提供

### コスト最適化

7. ✅ **自動管理**
   - 期限切れデータの自動削除で手動運用不要
   - データベース容量の自動最適化

8. ✅ **プラン差別化**
   - 保持期間による価値提供
   - アップセル機会の創出

### パフォーマンス

9. ✅ **インデックス最適化**
   - 部分インデックス（`WHERE removed_at IS NULL`）でクエリ高速化
   - アクティブなデータのみを効率的に取得

10. ✅ **データ量の管理**
    - 不要データの自動削除でDB肥大化を防止
    - クエリパフォーマンスの維持

---

## ビジネス上のメリット

### プラン差別化

#### Free プラン (30日保存)
**ターゲット**: お試し利用、短期イベント
- 「まずは無料で試してみたい」ユーザー向け
- 短期的なイベント（1回限りのバッジテストなど）に最適

#### Basic プラン (90日保存)
**ターゲット**: シーズン単位の利用
- スキーシーズン（約3ヶ月）の記録保持
- 「シーズン中のデータは保持したい」ニーズに対応

#### Standard プラン (180日保存)
**ターゲット**: 半年〜年間通しての利用
- 半年間の記録保持で年間通しての活動に対応
- 「前シーズンとの比較」が可能

#### Premium プラン (無期限保存)
**ターゲット**: 長期的な記録管理が必要な組織
- 「いつでも過去データにアクセス可能」という安心感
- コンプライアンス対応が必要な公式団体
- 長期的な選手育成・評価に活用

### 価値訴求ポイント

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
プラン比較表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────┬────────┬────────┬──────────┬──────────┐
│ 機能     │ Free   │ Basic  │ Standard │ Premium  │
├──────────┼────────┼────────┼──────────┼──────────┤
│ 月額料金 │ 無料   │ 8,800円│ 24,800円 │ 49,800円 │
├──────────┼────────┼────────┼──────────┼──────────┤
│ メンバー │ 5名    │ 10名   │ 30名     │ 100名    │
├──────────┼────────┼────────┼──────────┼──────────┤
│ セッション│ 3回/月 │ 無制限 │ 無制限   │ 無制限   │
├──────────┼────────┼────────┼──────────┼──────────┤
│アーカイブ│ 30日   │ 90日   │ 180日    │ 無制限♾️ │
│保存期間  │        │        │          │          │
├──────────┼────────┼────────┼──────────┼──────────┤
│手動完全  │ ×     │ ×     │ ×       │ ✓        │
│削除      │        │        │          │          │
└──────────┴────────┴────────┴──────────┴──────────┘
```

### マーケティング施策

**アップセル機会:**
1. **保持期間警告での訴求**
   - 「あと7日で削除されます」→「Premiumなら無期限保存」
   - 期限切れ間近のタイミングでプランアップグレードを提案

2. **完全削除機能の価値**
   - 「手動でデータを完全削除したい」→「Premium限定機能」
   - データ管理の自由度を訴求

3. **安心感の訴求**
   - 「いつでも過去のデータにアクセス可能」
   - 「長期的な選手育成に最適」

---

## 参考リンク

- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [Soft Delete Best Practices](https://www.postgresql.org/docs/current/ddl-partitioning.html)

---

## 変更履歴

| 日付 | 変更内容 | 担当者 |
|------|----------|--------|
| 2025-01-23 | 初版作成 | Claude |

---

**次のステップ**: Phase 1の実装を開始する
