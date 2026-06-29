# Plan3.md - TENTO 組織ベース完全再設計

## 概要

すべてのセッションを組織に属させる設計に完全移行します。
個人ユーザーも「1人組織」として扱い、データモデルを統一します。

## 設計思想

```
すべてのユーザーは必ず組織に所属する
├─ フリープランユーザー → 1人だけの組織
├─ 有料プランユーザー → 複数メンバーの組織
└─ すべてのセッションは organization_id NOT NULL
```

## プラン設計

### フリープラン（無料）- 個人試用
- **対象**: 個人での試用・小規模検定
- **組織メンバー数**: 1人（本人のみ）
- **セッションあたりの検定員数**: 3人
- **セッション作成**: 月3回
- **大会モード**: ❌
- **研修モード**: ❌
- **データ保持期間**: 3ヶ月
- **サポート**: コミュニティサポートのみ

### Basicプラン（¥8,800/月）- 小規模クラブ向け
- **対象**: 小規模スキークラブ・スキー学校
- **組織メンバー数**: 10人（1人あたり¥880/月）
- **セッションあたりの検定員数**: 15人
- **セッション作成**: 無制限
- **大会モード**: ✅
- **研修モード**: ✅（最大20人）
- **データ保持期間**: 12ヶ月
- **サポート**: メールサポート

### Standardプラン（¥24,800/月）- 中規模組織向け
- **対象**: 中規模スキークラブ・複数拠点のスキー学校
- **組織メンバー数**: 30人（1人あたり¥827/月）
- **セッションあたりの検定員数**: 50人
- **セッション作成**: 無制限
- **大会モード**: ✅
- **研修モード**: ✅（最大50人）
- **データ保持期間**: 24ヶ月
- **サポート**: メールサポート
- **追加機能**: データエクスポート機能

### Premiumプラン（¥49,800/月）- 大規模組織向け
- **対象**: 大規模スキークラブ・地域連盟・都道府県連盟
- **組織メンバー数**: 100人（1人あたり¥498/月）
- **セッションあたりの検定員数**: 100人
- **セッション作成**: 無制限
- **大会モード**: ✅
- **研修モード**: ✅（最大100人）
- **データ保持期間**: 無制限
- **サポート**: メールサポート（優先対応）
- **追加機能**:
  - データエクスポート機能
  - カスタムレポート機能
  - API連携
  - オンボーディング支援

### 年間契約割引（オプション）
年間契約で2ヶ月分無料（約17%割引）
- **Basic**: ¥88,000/年（月額換算¥7,333）
- **Standard**: ¥248,000/年（月額換算¥20,667）
- **Premium**: ¥498,000/年（月額換算¥41,500）

## ユーザーフロー

### 1. 新規登録（未登録ユーザー）

```
1. メールアドレス + パスワードで登録
   ↓
2. プロフィール設定（氏名）
   ↓
3. 組織作成画面（必須）
   - 組織名を入力
   - 自動的にフリープランの組織が作成される
   - ユーザーは管理者として登録される
   ↓
4. ダッシュボード
```

### 2. セッション作成フロー

```
1. ダッシュボード → 「セッション作成」
   ↓
2. セッション作成画面
   - セッション名
   - モード選択（検定/大会/研修）
   - ※組織は自動選択（ユーザーが所属する組織）
   ↓
3. セッション詳細画面
```

### 3. 検定員招待フロー

**パターンA: 組織メンバーとして招待（恒久的）**
```
1. 組織管理画面 → 「メンバー招待」
   ↓
2. 招待URL生成
   ↓
3. 招待されたユーザーが招待URLにアクセス
   ↓
4. ログイン/登録後、組織メンバーとして追加
   ↓
5. その組織のすべてのセッションに自動アクセス可能
```

**パターンB: ゲスト検定員として招待（一時的）**
```
1. セッション詳細画面 → 「検定員コード」を表示
   ↓
2. 検定員コードを共有
   ↓
3. ゲストユーザーが検定員コードを入力
   ↓
4. そのセッションのみ参加可能
```

## データベース再設計

### Phase 0: 既存データのクリーンアップ

#### 0-1. 既存データの削除（本番環境未稼働のため実行可能）
```sql
-- セッション関連データを削除
TRUNCATE TABLE session_participants CASCADE;
TRUNCATE TABLE sessions CASCADE;

-- サブスクリプションデータを削除
TRUNCATE TABLE subscriptions CASCADE;

-- 組織データを削除（すでに作成されている場合）
TRUNCATE TABLE organization_members CASCADE;
TRUNCATE TABLE invitations CASCADE;
TRUNCATE TABLE invitation_uses CASCADE;
TRUNCATE TABLE organizations CASCADE;
```

#### 0-2. テーブル構造の修正準備
- 制約の見直し
- インデックスの最適化

### Phase 1: データベース構造の再構築

#### 1-1. organizations テーブルの修正

**現在の構造**:
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL,  -- 'basic', 'standard', 'enterprise'
  max_members INTEGER NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**変更点**:
- `plan_type`に`'free'`を追加
- デフォルト値の設定

```sql
ALTER TABLE organizations
ALTER COLUMN plan_type DROP CONSTRAINT organizations_plan_type_check;

ALTER TABLE organizations
ADD CONSTRAINT organizations_plan_type_check
CHECK (plan_type IN ('free', 'basic', 'standard', 'premium'));
```

#### 1-2. sessions テーブルの修正

**変更点**:
- `organization_id`を`NOT NULL`に変更
- `join_code`は引き続き保持（ゲスト検定員用）

```sql
-- 既存のNULLデータがないことを確認
SELECT COUNT(*) FROM sessions WHERE organization_id IS NULL;

-- organization_idをNOT NULLに変更
ALTER TABLE sessions
ALTER COLUMN organization_id SET NOT NULL;
```

#### 1-3. plan_limits テーブルの拡張

**追加カラム**:
```sql
ALTER TABLE plan_limits
ADD COLUMN IF NOT EXISTS max_organization_members INTEGER NOT NULL DEFAULT -1,
ADD COLUMN IF NOT EXISTS max_judges_per_session INTEGER NOT NULL DEFAULT -1;
```

**プランデータの更新**:
```sql
-- フリープランを追加
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'free',
  3,           -- 月3セッション
  -1,          -- 選手数無制限
  3,           -- 検定員3人まで
  1,           -- 組織メンバー1人
  false,       -- 大会モードなし
  false,       -- 研修モードなし
  false,       -- スコアボードなし
  3            -- データ保持3ヶ月
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  data_retention_months = EXCLUDED.data_retention_months;

-- Basicプランを更新（¥8,800/月）
UPDATE plan_limits SET
  max_sessions_per_month = -1,
  max_judges_per_session = 15,
  max_organization_members = 10,
  has_tournament_mode = true,
  has_training_mode = true,
  data_retention_months = 12
WHERE plan_type = 'basic';

-- Standardプランを更新（¥24,800/月）
UPDATE plan_limits SET
  max_sessions_per_month = -1,
  max_judges_per_session = 50,
  max_organization_members = 30,
  has_tournament_mode = true,
  has_training_mode = true,
  data_retention_months = 24
WHERE plan_type = 'standard';

-- Premiumプランを追加（¥49,800/月 - 最上位プラン）
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'premium',
  -1,          -- 無制限
  -1,          -- 選手数無制限
  100,         -- 検定員100人まで
  100,         -- 組織メンバー100人
  true,        -- 大会モードあり
  true,        -- 研修モードあり
  true,        -- スコアボードあり
  -1           -- データ保持無制限
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  data_retention_months = EXCLUDED.data_retention_months;
```

#### 1-4. subscriptions テーブルの修正

**現在の構造**:
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  organization_id UUID REFERENCES organizations(id),
  ...
);
```

**変更点**:
- `organization_id`を`NOT NULL`に変更
- `user_id`は削除または`NULL`許容（組織ベースのサブスクリプション）

```sql
-- サブスクリプションは組織に紐付く
ALTER TABLE subscriptions
ALTER COLUMN organization_id SET NOT NULL;

-- user_idは後方互換性のため残すが、NULLを許容
-- （将来的に削除予定）
```

### Phase 2: 初回登録フローの実装

#### 2-1. 組織作成画面の実装

**新規ファイル**: `/src/routes/onboarding/create-organization/+page.svelte`
```svelte
<script lang="ts">
  // 組織名入力フォーム
  // 自動的にフリープランの組織を作成
</script>
```

**新規ファイル**: `/src/routes/onboarding/create-organization/+page.server.ts`
```typescript
// 組織作成処理
// - organizationsテーブルにレコード作成（plan_type: 'free'）
// - organization_membersにユーザーを管理者として追加
// - ダッシュボードにリダイレクト
```

#### 2-2. 登録フローの修正

**修正ファイル**: `/src/routes/auth/callback/+server.ts`
```typescript
// ログイン後のリダイレクト処理を修正
// 1. ユーザーが組織に所属しているかチェック
// 2. 所属していない場合 → /onboarding/create-organization
// 3. 所属している場合 → /dashboard
```

### Phase 3: セッション作成フローの修正

#### 3-1. セッション作成画面の簡略化

**修正ファイル**: `/src/routes/session/create/+page.svelte`
- 組織選択UIを削除
- ユーザーの所属組織を自動選択

**修正ファイル**: `/src/routes/session/create/+page.server.ts`
```typescript
export const load: PageServerLoad = async ({ locals }) => {
  const user = await getUser(locals.supabase);

  // ユーザーの所属組織を取得
  const { data: membership } = await locals.supabase
    .from('organization_members')
    .select('organization_id, organizations(*)')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    throw redirect(303, '/onboarding/create-organization');
  }

  return {
    organization: membership.organizations
  };
};
```

#### 3-2. セッション作成時の組織ID自動設定

**修正ファイル**: `/src/routes/session/create/+page.server.ts`
```typescript
create: async ({ request, locals: { supabase } }) => {
  const user = await getUser(supabase);

  // ユーザーの組織を取得
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return fail(403, { error: '組織に所属していません。' });
  }

  // セッション作成
  const { data: session } = await supabase
    .from('sessions')
    .insert({
      name: sessionName,
      organization_id: membership.organization_id,  // 自動設定
      created_by: user.id,
      ...
    })
    .select()
    .single();

  ...
};
```

### Phase 4: プラン制限チェックの実装

#### 4-1. 組織メンバー数制限チェック

**新規関数**: `/src/lib/server/organizationLimits.ts`
```typescript
export async function checkCanAddMember(
  supabase: SupabaseClient,
  organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
  // 1. 組織のプランタイプを取得
  const { data: org } = await supabase
    .from('organizations')
    .select('plan_type')
    .eq('id', organizationId)
    .single();

  // 2. プラン制限を取得
  const { data: limits } = await supabase
    .from('plan_limits')
    .select('max_organization_members')
    .eq('plan_type', org.plan_type)
    .single();

  // 3. 現在のメンバー数を取得
  const { count } = await supabase
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  // 4. 制限チェック
  if (limits.max_organization_members !== -1 && count >= limits.max_organization_members) {
    return {
      allowed: false,
      reason: `組織メンバー数の上限（${limits.max_organization_members}人）に達しています。`,
      upgradeUrl: '/settings/billing'
    };
  }

  return { allowed: true };
}
```

#### 4-2. セッション検定員数制限チェック

**新規関数**: `/src/lib/server/organizationLimits.ts`
```typescript
export async function checkCanAddJudgeToSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. セッションの組織とプランを取得
  const { data: session } = await supabase
    .from('sessions')
    .select('organization_id, organizations(plan_type)')
    .eq('id', sessionId)
    .single();

  // 2. プラン制限を取得
  const { data: limits } = await supabase
    .from('plan_limits')
    .select('max_judges_per_session')
    .eq('plan_type', session.organizations.plan_type)
    .single();

  // 3. 現在の検定員数を取得
  const { count } = await supabase
    .from('session_participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  // 4. 制限チェック
  if (limits.max_judges_per_session !== -1 && count >= limits.max_judges_per_session) {
    return {
      allowed: false,
      reason: `セッションの検定員数上限（${limits.max_judges_per_session}人）に達しています。`
    };
  }

  return { allowed: true };
}
```

#### 4-3. 招待機能での制限チェック適用

**修正ファイル**: `/src/routes/organizations/[id]/invite/+page.server.ts`
```typescript
import { checkCanAddMember } from '$lib/server/organizationLimits';

export const actions = {
  createInvitation: async ({ params, locals: { supabase } }) => {
    const organizationId = params.id;

    // メンバー数制限チェック
    const memberCheck = await checkCanAddMember(supabase, organizationId);
    if (!memberCheck.allowed) {
      return fail(403, {
        error: memberCheck.reason,
        upgradeUrl: memberCheck.upgradeUrl
      });
    }

    // 招待URL生成処理
    ...
  }
};
```

### Phase 5: ダッシュボードとUIの調整

#### 5-1. ダッシュボードの修正

**修正ファイル**: `/src/routes/dashboard/+page.server.ts`
```typescript
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
  const user = await getUser(supabase);

  // ユーザーの組織を取得
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(*)')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    throw redirect(303, '/onboarding/create-organization');
  }

  // 組織のセッション一覧を取得（organization_idで絞り込み）
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('organization_id', membership.organization_id)
    .order('created_at', { ascending: false });

  return {
    organization: membership.organizations,
    userRole: membership.role,
    sessions: sessions || []
  };
};
```

#### 5-2. ダッシュボードUIの更新

**修正ファイル**: `/src/routes/dashboard/+page.svelte`
```svelte
<script lang="ts">
  export let data;
  const { organization, userRole, sessions } = data;
</script>

<!-- 組織情報を表示 -->
<div class="organization-header">
  <h2>{organization.name}</h2>
  <p>プラン: {organization.plan_type}</p>
  {#if userRole === 'admin'}
    <a href="/organizations/{organization.id}/manage">組織設定</a>
  {/if}
</div>

<!-- セッション一覧 -->
<div class="sessions-list">
  {#each sessions as session}
    <a href="/session/{session.id}">
      {session.name}
    </a>
  {/each}
</div>
```

### Phase 6: RLSポリシーの見直し

#### 6-1. sessions テーブルのRLSポリシー更新

```sql
-- 古いポリシーを削除
DROP POLICY IF EXISTS "Users can view sessions they participate in" ON sessions;
DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;

-- 新しいポリシー: 組織メンバーは組織のセッションを閲覧可能
CREATE POLICY "Organization members can view organization sessions"
  ON sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- セッション作成: 組織メンバーが作成可能
CREATE POLICY "Organization members can create sessions"
  ON sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- セッション更新: 主任検定員または組織管理者が更新可能
CREATE POLICY "Chief judge or admin can update sessions"
  ON sessions FOR UPDATE
  USING (
    chief_judge_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );
```

#### 6-2. session_participants テーブルのRLSポリシー

```sql
-- 組織メンバーとゲストが参加者として登録可能
CREATE POLICY "Organization members and guests can be participants"
  ON session_participants FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM sessions
      JOIN organization_members ON organization_members.organization_id = sessions.organization_id
      WHERE sessions.id = session_participants.session_id
        AND organization_members.user_id = auth.uid()
    )
  );
```

## 実装ロードマップ

### Week 1: データベース再構築
- [ ] Phase 0: 既存データクリーンアップ
- [ ] Phase 1-1: organizationsテーブル修正
- [ ] Phase 1-2: sessionsテーブル修正
- [ ] Phase 1-3: plan_limitsテーブル拡張
- [ ] Phase 1-4: subscriptionsテーブル修正

### Week 2: 初回登録フロー実装
- [ ] Phase 2-1: 組織作成画面実装
- [ ] Phase 2-2: 登録フロー修正
- [ ] 動作確認・テスト

### Week 3: セッション作成フロー修正
- [ ] Phase 3-1: セッション作成画面簡略化
- [ ] Phase 3-2: 組織ID自動設定実装
- [ ] 動作確認・テスト

### Week 4: プラン制限実装
- [ ] Phase 4-1: 組織メンバー数制限チェック
- [ ] Phase 4-2: セッション検定員数制限チェック
- [ ] Phase 4-3: 招待機能での制限適用
- [ ] 動作確認・テスト

### Week 5: UI調整・RLS見直し
- [ ] Phase 5-1: ダッシュボード修正
- [ ] Phase 5-2: ダッシュボードUI更新
- [ ] Phase 6-1: RLSポリシー見直し
- [ ] Phase 6-2: session_participantsポリシー更新

### Week 6: 統合テスト・リリース準備
- [ ] 全体統合テスト
- [ ] パフォーマンステスト
- [ ] ドキュメント作成
- [ ] リリース

## マイグレーション戦略

### 既存ユーザーの扱い（本番稼働後の場合）

本番稼働前のため、既存データは削除可能です。
将来的に本番稼働後にデータ移行が必要な場合は、以下の戦略を使用：

```sql
-- 1. 既存ユーザーに個人組織を自動作成
INSERT INTO organizations (id, name, plan_type, max_members, created_at)
SELECT
  uuid_generate_v4(),
  profiles.full_name || 'の組織',
  'free',
  1,
  NOW()
FROM auth.users
LEFT JOIN profiles ON profiles.id = auth.users.id
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members
  WHERE organization_members.user_id = auth.users.id
);

-- 2. 既存ユーザーを組織の管理者として追加
INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
SELECT
  uuid_generate_v4(),
  o.id,
  u.id,
  'admin',
  NOW()
FROM auth.users u
JOIN organizations o ON o.name = (
  SELECT profiles.full_name || 'の組織'
  FROM profiles
  WHERE profiles.id = u.id
)
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members
  WHERE organization_members.user_id = u.id
);

-- 3. 既存セッションに組織IDを設定
UPDATE sessions
SET organization_id = (
  SELECT organization_members.organization_id
  FROM organization_members
  WHERE organization_members.user_id = sessions.created_by
  LIMIT 1
)
WHERE organization_id IS NULL;
```

## 成功指標

- [ ] すべてのユーザーが組織に所属している
- [ ] すべてのセッションにorganization_idが設定されている
- [ ] プラン制限が正しく機能している
- [ ] 新規登録フローがスムーズに動作している
- [ ] RLSポリシーが正しく機能している

## リスクと対策

### リスク1: 既存ユーザーの混乱
**対策**: 明確なオンボーディングフローとヘルプドキュメント

### リスク2: データ整合性の問題
**対策**: マイグレーションスクリプトの十分なテスト

### リスク3: パフォーマンス低下
**対策**: 適切なインデックス設定とクエリ最適化

## 次のステップ

1. Plan3.mdのレビューと承認
2. データベース再構築の開始（Phase 0, Phase 1）
3. 初回登録フローの実装（Phase 2）
4. 順次実装を進める
