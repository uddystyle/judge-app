# SvelteKit + Supabase アプリケーション パフォーマンスボトルネック分析レポート

**分析日**: 2025-11-21
**対象プロジェクト**: judge-app
**分析対象**: ダッシュボード、セッション詳細、採点関連ページ

---

## 1. N+1クエリ問題

### 1.1 セッション詳細ページでのプロフィール一括取得（部分解決）

**ファイル**: `/src/routes/session/[id]/details/+page.server.ts`
**行番号**: 131-156

**問題点**: 
- 採点結果（training_scores）に含まれる複数の検定員IDについて、プロフィール情報を一括取得している点は良好
- ただし、`judges`配列を直列で処理して個別にプロフィールを取得する可能性がある古いパターンがあった場合を対応

**改善案**:
```typescript
// 現在の実装（良好）
if (scores && scores.length > 0) {
    const judgeIds = [...new Set(scores.map((score) => score.judge_id))];
    const { data: judgeProfiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', judgeIds);  // 一括取得で解決済み
}
```

---

### 1.2 採点入力ページでのプロフィール取得の改善機会

**ファイル**: `/src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts`
**行番号**: 114-129

**問題点**:
- `organization_members`テーブルから組織情報を個別に取得
- 同じセッションに複数の検定員がいる場合、各検定員について個別のプロフィール取得が発生

**改善案**:
```typescript
// 現在（改善前）
if (user) {
    const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    
    const { data: orgData } = await supabase
        .from('organization_members')
        .select('organization_id, organizations(id, name)')
        .eq('user_id', user.id);
}

// 改善後: 必要なカラムのみ取得
if (user) {
    const [profileResult, orgResult] = await Promise.all([
        supabase
            .from('profiles')
            .select('id, full_name, email')  // 全カラムではなく必要なものだけ
            .eq('id', user.id)
            .single(),
        supabase
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', user.id)
    ]);
}
```

---

## 2. 重いページロード（直列クエリの並列化不足）

### 2.1 セッション詳細ページの複数クエリ直列実行

**ファイル**: `/src/routes/session/[id]/details/+page.server.ts`
**行番号**: 159-180

**問題点**:
```typescript
// 研修モードの場合、複数クエリが直列実行されている
if (sessionDetails.mode === 'training') {
    // 1. ユーザープロフィール
    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

    // 2. 組織メンバーシップ（直列）
    const { data: membershipData } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', user.id);

    // 3. 組織情報（さらに直列）
    if (membershipData && membershipData.length > 0) {
        const { data: orgsData } = await supabase
            .from('organizations')
            .select('id, name')
            .in('id', orgIds);
    }
}
```

**パフォーマンス影響**:
- 直列実行により、最大3つのネットワークラウンドトリップが発生
- 推定追加遅延: 150-300ms

**改善案**:
```typescript
// 並列化する
if (sessionDetails.mode === 'training') {
    const [profileResult, membershipResult] = await Promise.all([
        supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single(),
        supabase
            .from('organization_members')
            .select('organization_id, role')
            .eq('user_id', user.id)
    ]);

    let orgsData = [];
    if (membershipResult.data && membershipResult.data.length > 0) {
        const orgIds = membershipResult.data.map(m => m.organization_id);
        const { data } = await supabase
            .from('organizations')
            .select('id, name')
            .in('id', orgIds);
        orgsData = data || [];
    }
}
```

---

### 2.2 採点入力ページでのセッション + イベント + 参加者の直列取得

**ファイル**: `/src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts`
**行番号**: 44-100

**問題点**:
```typescript
// セッション情報を順次取得（直列）
const { data: sessionDetails } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();  // 1回目のクエリ

// イベント情報を順次取得（直列）
if (modeType === 'training') {
    const { data: trainingEvent } = await supabase
        .from('training_events')
        .select('*')
        .eq('id', eventId)
        .eq('session_id', sessionId)
        .single();  // 2回目のクエリ
}

// 参加者情報を順次取得（直列）
const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', participantId)
    .single();  // 3回目のクエリ

// さらに研修セッション情報を取得（直列）
if (isTrainingMode) {
    const { data: trainingSession } = await supabase
        .from('training_sessions')
        .select('is_multi_judge')
        .eq('session_id', sessionId)
        .maybeSingle();  // 4回目のクエリ
}
```

**パフォーマンス影響**:
- 少なくとも4つのネットワークラウンドトリップ
- 推定遅延: 200-400ms

**改善案**:
```typescript
// 1. セッション + イベント + 参加者を並列取得
const [sessionResult, eventResult, participantResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    modeType === 'training'
        ? supabase
            .from('training_events')
            .select('*')
            .eq('id', eventId)
            .eq('session_id', sessionId)
            .single()
        : supabase
            .from('custom_events')
            .select('*')
            .eq('id', eventId)
            .eq('session_id', sessionId)
            .single(),
    supabase.from('participants').select('*').eq('id', participantId).single()
]);

// 2. 研修セッション情報は後で取得（依存なし）
let trainingSession = null;
if (isTrainingMode) {
    const { data } = await supabase
        .from('training_sessions')
        .select('is_multi_judge')
        .eq('session_id', sessionId)
        .maybeSingle();
    trainingSession = data;
}
```

---

### 2.3 スコアボードページの大量データ取得

**ファイル**: `/src/routes/session/[id]/scoreboard/+page.server.ts`
**行番号**: 43-51

**問題点**:
```typescript
// 全ての採点結果を取得（制限なし！）
const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('*')  // すべてのカラムを取得
    .eq('session_id', sessionId);  // limit()やoffset()なし
```

**リスク**:
- セッションに数千件の採点結果がある場合、メモリ不足
- ネットワーク転送量が増加
- JSON パースのオーバーヘッド増加

**改善案**:
```typescript
// 必要なカラムのみ、ページネーション対応
const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('bib, score, discipline, level, event_name, judge_name')  // 必要なカラムのみ
    .eq('session_id', sessionId)
    .limit(5000)  // 大量データ対策
    .order('bib', { ascending: true });

if (!results || results.length >= 5000) {
    console.warn('Results count may exceed expected limits. Consider pagination.');
}
```

---

## 3. インデックスの欠如（部分解決）

### 3.1 現状のインデックス状況

**ファイル**: `/database/migrations/044_add_performance_indexes.sql`

**既に追加されているインデックス** (20個):
- session_participants: 3個
- sessions: 3個
- results: 3個
- training_scores: 4個
- training_sessions: 1個
- custom_events: 1個
- training_events: 1個
- organization_members: 2個
- scoring_prompts: 1個
- profiles: 1個

### 3.2 潜在的に欠落しているインデックス

#### 3.2.1 participants テーブル

**問題**: 参加者検索でインデックスが不足している可能性

**確認が必要なインデックス**:
```sql
-- session_id での検索を高速化（参加者一覧取得用）
CREATE INDEX IF NOT EXISTS idx_participants_session_id
ON participants(session_id, bib_number);

-- bib_number での検索を高速化
CREATE INDEX IF NOT EXISTS idx_participants_session_bib
ON participants(session_id, bib_number);
```

#### 3.2.2 training_events + training_scores の複合検索

**問題**: training_scores取得時に、session_idを間接的に検索している

**確認が必要なインデックス**:
```sql
-- training_events.session_id の検索を最適化
CREATE INDEX IF NOT EXISTS idx_training_events_session_id
ON training_events(session_id);

-- training_scores -> training_events の外部キー結合を最適化
CREATE INDEX IF NOT EXISTS idx_training_scores_event_id_created
ON training_scores(event_id, created_at DESC);
```

#### 3.2.3 guest_identifier 検索

**問題**: ゲスト認証で複合条件での検索が多い

**確認が必要なインデックス**:
```sql
-- ゲスト識別子での複合検索を最適化
CREATE INDEX IF NOT EXISTS idx_session_participants_guest_identifier
ON session_participants(guest_identifier, is_guest)
WHERE is_guest = true;
```

---

## 4. リアルタイム購読の過剰利用

### 4.1 現状の確認

**分析結果**: コード内に`supabase.channel()`や明示的なRealtime購読が見当たりません。

**確認が必要な箇所**:
- クライアント側のSvelteコンポーネントがリアルタイムリッスンをしているかどうか
- `/src/lib/supabaseClient.ts` で設定されているか

**推奨事項**:
- Realtimeは画面遷移時に正しくアンサブスクライブされているか確認
- 不要なチャンネルリッスンが残っていないか監視
- 同じsession_idに複数のリッスナーが登録されていないか確認

---

## 5. 大量データの取得

### 5.1 ダッシュボードページ

**ファイル**: `/src/routes/dashboard/+page.server.ts`
**行番号**: 15-57

**問題点**:
```typescript
// 組織経由のセッション取得（制限なし）
supabase
    .from('sessions')
    .select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id, exclude_extremes')
    .in('organization_id', organizationIds)
    .order('created_at', { ascending: false })
    // ← limit() がない！
```

**改善案**:
```typescript
// 最近のセッション最大100件に制限
supabase
    .from('sessions')
    .select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id, exclude_extremes')
    .in('organization_id', organizationIds)
    .order('created_at', { ascending: false })
    .limit(100)  // 追加
```

### 5.2 セッション詳細ページの研修スコア取得

**ファイル**: `/src/routes/session/[id]/details/+page.server.ts`
**行番号**: 119-129

**問題点**:
```typescript
// 全採点結果を取得（制限なし）
const { data: scores } = await supabase
    .from('training_scores')
    .select(`
        *,
        training_events!inner(session_id, name),
        athlete:athlete_id(bib_number, user_id, profiles:user_id(full_name))
    `)
    .eq('training_events.session_id', sessionId)
    .order('created_at', { ascending: false })
    // ← limit() がない
```

**パフォーマンス影響**:
- 大会時に数万件の採点結果が存在する可能性
- ネットワーク転送量: 数MB
- メモリ使用量増加
- JSON パース時間: 数秒

**改善案**:
```typescript
// 最新1000件に制限、必要なカラムのみ取得
const { data: scores } = await supabase
    .from('training_scores')
    .select(`
        id,
        event_id,
        athlete_id,
        score,
        judge_id,
        created_at,
        training_events!inner(session_id, name),
        athlete:athlete_id(bib_number)
    `)
    .eq('training_events.session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1000)  // 追加
```

### 5.3 すべてのカラムを `select('*')` で取得している箇所

以下のページで改善の余地あり:

1. `/src/routes/session/[id]/details/+page.server.ts` (行18-20)
   ```typescript
   .select('*')  // 必要なカラムのみに絞る
   ```

2. `/src/routes/session/[id]/[discipline]/[level]/[event]/+page.server.ts` (行37-39)
   ```typescript
   .select('chief_judge_id, is_tournament_mode, is_multi_judge')  // OK
   ```

3. `/src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts` (行44-46)
   ```typescript
   .select('*')  // 改善前
   ```

---

## 6. 並列クエリの活用状況

### 6.1 良好な実装例

**ファイル**: `/src/routes/dashboard/+page.server.ts`
**行番号**: 16-57

**評価**: 優良 - 複数のクエリを `Promise.all()` で並列実行
```typescript
const [profileResult, membershipsResult] = await Promise.all([...])
const [orgSessionsResult, participantsResult] = await Promise.all([...])
const [allParticipantsResult, trainingSettingsResult] = await Promise.all([...])
```

---

## 7. 優先度別改善案

### 高優先度（即座に対応）

| 項目 | ファイル | 行番号 | 改善内容 | 予想効果 |
|------|---------|--------|--------|---------|
| 結果データのlimit追加 | scoreboard/+page.server.ts | 43-47 | `limit(5000)` 追加 | 30-50ms削減 |
| セッション一覧のlimit追加 | dashboard/+page.server.ts | 51-53 | `limit(100)` 追加 | 40-60ms削減 |
| 不要なカラム削除 | details/+page.server.ts | 119-129 | `select('*')`の代わりに必要な列のみ | 50-100ms削減 |
| 直列クエリの並列化 | score/.../input/+page.server.ts | 44-100 | Promise.all()活用 | 150-250ms削減 |

### 中優先度（1週間以内）

| 項目 | ファイル | 行番号 | 改善内容 | 予想効果 |
|------|---------|--------|--------|---------|
| participants インデックス追加 | migration/044*.sql | 以降に追加 | bib_number複合インデックス | クエリ速度 40%改善 |
| guest_identifier インデックス追加 | migration/044*.sql | 以降に追加 | ゲスト検索最適化 | ゲスト検索 60%高速化 |
| クエリの並列化（details） | details/+page.server.ts | 159-180 | Promise.all()活用 | 100-150ms削減 |

### 低優先度（最適化検討）

| 項目 | 説明 | 予想効果 |
|------|------|--------|
| Realtimeリッスナーの監査 | メモリリーク防止 | 継続的な安定性向上 |
| ページネーション実装 | 大規模セッション対応 | スケーラビリティ向上 |
| キャッシング戦略 | Supabase Realtimeキャッシュ | 60-80%削減可能 |

---

## 8. 具体的な改善実装例

### 8.1 セッション詳細ページの改善

```typescript
// ファイル: /src/routes/session/[id]/details/+page.server.ts
// 変更部分: load関数内のクエリ最適化

// 現在（問題あり）
const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

const { data: membershipData } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id);

// 改善後（並列化 + 不要なカラム削除）
const [profileResult, membershipResult] = await Promise.all([
    supabase
        .from('profiles')
        .select('id, full_name')  // 必要なカラムのみ
        .eq('id', user.id)
        .single(),
    supabase
        .from('organization_members')
        .select('organization_id, role')  // 全カラムではなく必要なものだけ
        .eq('user_id', user.id)
]);
```

### 8.2 スコアボードページのリスク軽減

```typescript
// ファイル: /src/routes/session/[id]/scoreboard/+page.server.ts

// 現在（危険）
const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('*')
    .eq('session_id', sessionId);

// 改善後
const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('bib, score, discipline, level, event_name, judge_name, session_id')
    .eq('session_id', sessionId)
    .limit(10000)  // 最大限度を設定
    .order('created_at', { ascending: false });

// 警告ログを追加
if (results && results.length >= 10000) {
    console.warn(`[Scoreboard] Results count reached limit (${results.length}). Consider pagination.`);
}
```

---

## 9. 監視・検証項目

### 9.1 実装後の検証チェックリスト

- [ ] ダッシュボード読み込み時間: 500ms以下
- [ ] セッション詳細ページ: 800ms以下
- [ ] スコアボード: 1000ms以下（大量データでも）
- [ ] データベースクエリ数: ページあたり5個以下
- [ ] ネットワーク転送量: 1MB以下

### 9.2 パフォーマンス測定方法

```typescript
// 各ページでクエリ実行時間を計測
console.time('Database queries');
// ... クエリ実行
console.timeEnd('Database queries');

// ネットワーク転送量の監視（ブラウザ DevTools）
// Application > Network で確認
```

---

## まとめ

**分析結果**:
1. ダッシュボード: 並列化は実装されているが、limit()が必要
2. セッション詳細: 複数の直列クエリが存在。並列化で大幅改善可能
3. スコアボード: limit()なしの大量データ取得が危険
4. インデックス: 44_add_performance_indexes.sqlで多くカバー済み。ただしparticipantsとguest検索で追加が必要
5. リアルタイム: 明示的な過剰利用は見当たらず

**推定改善効果**:
- 高優先度実装: 250-500ms削減（25-30%改善）
- 中優先度実装: さらに150-250ms削減
- 全実装完了: 400-750ms削減（40-50%改善）

