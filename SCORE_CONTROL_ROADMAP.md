# 点差コントロール機能 実装ロードマップ

## 📋 機能概要

大会モードにおいて、検定員間の採点のバラつきを抑制するため、最高点と最低点の点差が設定値を超えた場合、主任検定員が得点を確定できないようにする機能。

---

## 🎯 要件定義

### 基本仕様

| 項目 | 内容 |
|-----|------|
| **対象モード** | 大会モードのみ（検定モード・研修モードは対象外） |
| **採点方式** | 3審3採（3人）、5審3採（5人） |
| **点差の定義** | 最高点 - 最低点（整数） |
| **点差の閾値** | N点（整数で設定可能、例: 2点、3点） |
| **制御内容** | 点差 > N点の場合、主任検定員の「この内容で送信する」ボタンを無効化 |

### 既存機能との連携

✅ **再採点指示機能**（実装済み）
- 主任検定員が個別の検定員に対して採点やり直しを指示
- 指示を受けた検定員の得点がデータベースから削除される
- 検定員は自動的に採点画面に遷移

🆕 **点差コントロール機能**（今回実装）
- 点差が閾値を超えた場合、確定ボタンを無効化
- 主任検定員に警告メッセージを表示
- 再採点指示を促す

---

## 🔍 現在の実装状況

### 採点フロー（大会モード）

```
1. 主任検定員が採点指示を出す
   ↓
2. 各検定員が採点する
   ↓
3. 採点完了後、ステータス画面に遷移
   ↓
4. 主任検定員が全員の得点を確認
   ↓
5. 必要なら再採点指示
   ↓
6. 全員の採点が揃ったら「この内容で送信する」で確定
```

### 現在の確定条件

```typescript
// src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.svelte:313
let canSubmit = false;
$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);
```

**現在**: 必要人数の採点が揃えば確定可能
**改善後**: 必要人数 + 点差条件をクリアした場合のみ確定可能

---

## 📐 技術設計

### 1. データベース設計

#### sessionsテーブルへのカラム追加

```sql
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS max_score_diff INTEGER DEFAULT NULL;

COMMENT ON COLUMN sessions.max_score_diff IS '大会モードでの最大許容点差（整数、NULL=制限なし）';
```

**デフォルト値**:
- NULL: 点差制限なし（既存セッションとの互換性）
- 例: 2（2点差まで許容）、3（3点差まで許容）

---

### 2. フロントエンド実装

#### A. 設定画面（セッション詳細ページ）

**ファイル**: `src/routes/session/[id]/details/+page.svelte`

大会モード設定セクションに点差制限の設定を追加：

```svelte
<!-- 大会設定セクション -->
<div class="setting-item">
  <label for="scoringMethod" class="form-label">採点方法</label>
  <select id="scoringMethod" name="scoringMethod" bind:value={currentScoringMethod}>
    <option value="3judges">3審3採（3人）</option>
    <option value="5judges">5審3採（5人）</option>
  </select>
</div>

<!-- 🆕 点差制限の設定 -->
<div class="setting-item">
  <span class="form-label">点差コントロール</span>
  <div class="score-diff-control">
    <input
      type="checkbox"
      id="enableScoreDiffControl"
      bind:checked={enableScoreDiffControl}
    />
    <label for="enableScoreDiffControl">点差制限を有効にする</label>
  </div>

  {#if enableScoreDiffControl}
    <div class="score-diff-input">
      <label for="maxScoreDiff">最大許容点差</label>
      <input
        type="number"
        id="maxScoreDiff"
        name="maxScoreDiff"
        min="1"
        max="10"
        step="1"
        bind:value={maxScoreDiff}
      />
      <span>点</span>
    </div>
    <p class="help-text">
      最高点と最低点の差がこの値を超えた場合、得点を確定できません。
    </p>
  {/if}
</div>
```

---

#### B. ステータス画面（確定画面）

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.svelte`

**変更箇所1**: 点差計算ロジックの追加

```typescript
// 点差を計算する関数（整数）
function calculateScoreDiff(scores: any[]): number | null {
  if (!scores || scores.length === 0) return null;

  const scoreValues = scores.map(s => parseFloat(s.score));
  const maxScore = Math.max(...scoreValues);
  const minScore = Math.min(...scoreValues);

  // 整数に丸める
  return Math.round(maxScore - minScore);
}

// 点差チェック
let scoreDiff: number | null = null;
let scoreDiffExceeded: boolean = false;

$: {
  if (data.isTournamentMode && scoreStatus?.scores) {
    scoreDiff = calculateScoreDiff(scoreStatus.scores);

    const maxAllowedDiff = data.sessionDetails?.max_score_diff;
    if (maxAllowedDiff !== null && scoreDiff !== null) {
      scoreDiffExceeded = scoreDiff > maxAllowedDiff;
    } else {
      scoreDiffExceeded = false;
    }
  }
}
```

**変更箇所2**: 確定条件の修正

```typescript
// 修正前
let canSubmit = false;
$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);

// 修正後
let canSubmit = false;
$: {
  const hasRequiredScores = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);
  const scoreDiffOk = !scoreDiffExceeded;

  canSubmit = hasRequiredScores && scoreDiffOk;
}
```

**変更箇所3**: UI表示の追加

```svelte
<!-- 得点一覧の下に点差情報を表示 -->
{#if data.isTournamentMode && scoreDiff !== null}
  <div class="score-diff-info" class:warning={scoreDiffExceeded}>
    <h4>点差情報</h4>
    <div class="diff-details">
      <span class="label">最高点 - 最低点:</span>
      <span class="value" class:exceeded={scoreDiffExceeded}>
        {scoreDiff}点
      </span>

      {#if data.sessionDetails?.max_score_diff !== null}
        <span class="limit">
          （上限: {data.sessionDetails.max_score_diff}点）
        </span>
      {/if}
    </div>

    {#if scoreDiffExceeded}
      <div class="warning-message">
        ⚠️ 点差が上限を超えています。
        検定員に再採点を指示してください。
      </div>
    {/if}
  </div>
{/if}

<!-- 確定ボタン -->
<NavButton
  variant="primary"
  type="submit"
  disabled={!canSubmit}
>
  {#if !hasRequiredScores}
    ({scoreStatus.requiredJudges || 1}人の採点が必要です)
  {:else if scoreDiffExceeded}
    点差が大きすぎます（{scoreDiff}点 > {data.sessionDetails?.max_score_diff}点）
  {:else}
    この内容で送信する
  {/if}
</NavButton>
```

---

### 3. バックエンド実装

#### A. セッション設定の保存

**ファイル**: `src/routes/session/[id]/details/+page.server.ts`

アクション `updateTournamentSettings` の拡張：

```typescript
updateTournamentSettings: async ({ request, params, locals: { supabase } }) => {
  const formData = await request.formData();
  const scoringMethod = formData.get('scoringMethod') as string;
  const excludeExtremes = scoringMethod === '5judges';

  // 🆕 点差制限の取得
  const enableScoreDiffControl = formData.get('enableScoreDiffControl') === 'on';
  const maxScoreDiffStr = formData.get('maxScoreDiff') as string;
  const maxScoreDiff = enableScoreDiffControl && maxScoreDiffStr
    ? parseInt(maxScoreDiffStr, 10)
    : null;

  // バリデーション
  if (enableScoreDiffControl && maxScoreDiff !== null) {
    if (maxScoreDiff < 1 || maxScoreDiff > 10) {
      return fail(400, {
        tournamentSettingsError: '点差制限は1〜10点の範囲で設定してください。'
      });
    }
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update({
      exclude_extremes: excludeExtremes,
      max_score_diff: maxScoreDiff  // 🆕 追加
    })
    .eq('id', params.id);

  if (updateError) {
    return fail(500, { tournamentSettingsError: '設定の更新に失敗しました。' });
  }

  return { tournamentSettingsSuccess: '採点方法を更新しました。' };
}
```

#### B. ステータス画面のデータ取得

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts`

loadフィールドに `max_score_diff` を追加：

```typescript
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
  // セッション情報の取得
  const { data: sessionDetails } = await supabase
    .from('sessions')
    .select('*, max_score_diff')  // 🆕 追加
    .eq('id', sessionId)
    .single();

  return {
    sessionDetails,
    isTournamentMode: sessionDetails.is_tournament_mode || sessionDetails.mode === 'tournament',
    // ... その他のデータ
  };
};
```

---

## 🗂️ ファイル変更一覧

### データベース

| ファイル | 変更内容 |
|---------|---------|
| `database/migrations/045_add_score_diff_control.sql` | 🆕 新規作成 - max_score_diffカラム追加 |

### フロントエンド

| ファイル | 変更内容 |
|---------|---------|
| `src/routes/session/[id]/details/+page.svelte` | 📝 修正 - 点差制限設定UIの追加 |
| `src/routes/session/[id]/details/+page.server.ts` | 📝 修正 - 設定保存処理の拡張 |
| `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.svelte` | 📝 修正 - 点差計算・表示・確定条件の追加 |
| `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts` | 📝 修正 - max_score_diffの取得 |

---

## 🚀 実装手順

### Phase 1: データベース準備
1. マイグレーションファイルの作成
2. `max_score_diff`カラムの追加（INTEGER型）
3. コメント・制約の設定

### Phase 2: セッション設定画面
1. 点差制限ON/OFFチェックボックスの追加
2. 最大許容点差の入力フィールド追加（整数のみ、1〜10点）
3. バリデーションロジックの実装
4. 保存処理の実装

### Phase 3: ステータス画面（確定画面）
1. 点差計算ロジックの実装（整数に丸める）
2. 点差情報の表示UI作成
3. 確定条件の修正（点差チェック追加）
4. 警告メッセージの実装

### Phase 4: テスト
1. 点差制限なしの場合の動作確認
2. 点差制限ありの場合の動作確認
3. 3審3採での動作確認
4. 5審3採での動作確認
5. 再採点指示との連携確認

### Phase 5: ドキュメント整備
1. ユーザーマニュアルの更新
2. FAQの追加

---

## ✅ 確認ポイント

### 機能要件
- [ ] 大会モードのみで動作する
- [ ] 点差制限のON/OFF切り替えが可能
- [ ] 点差の閾値を整数（1〜10点）で設定可能
- [ ] 点差が閾値を超えた場合、確定ボタンが無効化される
- [ ] 点差情報が視覚的にわかりやすく表示される
- [ ] 既存の再採点指示機能と併用可能

### 非機能要件
- [ ] 既存セッション（max_score_diff=NULL）との互換性
- [ ] パフォーマンスへの影響なし
- [ ] モバイル・デスクトップ両対応

### エッジケース
- [ ] 採点が1人しかいない場合の動作
- [ ] 全員が同じ点数の場合の動作
- [ ] 点差がちょうど閾値と同じ場合の動作（例: 閾値2点で点差2点）

---

## 📊 具体例

### 例1: 3審3採、点差制限2点

| 検定員 | 得点 |
|-------|------|
| A | 85点 |
| B | 87点 |
| C | 88点 |

- 最高点: 88点
- 最低点: 85点
- **点差: 3点** → 上限2点を超える ❌
- **結果**: 確定ボタン無効化、再採点指示を促す

### 例2: 5審3採、点差制限3点

| 検定員 | 得点 |
|-------|------|
| A | 82点 |
| B | 83点 |
| C | 84点 |
| D | 84点 |
| E | 85点 |

- 最高点: 85点
- 最低点: 82点
- **点差: 3点** → 上限3点と同じ ✅
- **結果**: 確定可能

---

## 📝 実装時の注意事項

### 1. 整数の扱い
- 採点自体は小数点を含む場合もある
- 点差計算時に `Math.round()` で整数に丸める
- 表示も整数のみ

### 2. パフォーマンス
- 点差計算はクライアント側で実行（リアルタイム）
- データベースへの負荷なし

### 3. UX配慮
- 点差が閾値を超えた場合、具体的な数値を表示
- エラーメッセージは具体的でわかりやすく
- 再採点指示との併用がスムーズに行える

### 4. 後方互換性
- 既存セッション（max_score_diff=NULL）は影響なし
- デフォルトは点差制限なし

---

## 🎯 成功指標

- [ ] 大会での採点バラつきが削減
- [ ] 再採点要求の回数が適正化
- [ ] 主任検定員の操作時間が短縮
- [ ] ユーザーからのフィードバックが良好

---

**作成日**: 2025-11-16
**最終更新**: 2025-11-16
**ステータス**: 設計完了・実装準備中
