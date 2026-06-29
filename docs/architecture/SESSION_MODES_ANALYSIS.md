# 3つのセッションモード完全分析

## 目次
1. モード概要
2. 主要特徴の比較
3. 複数検定員モード設定
4. 採点方法の違い
5. 参加者の扱い方
6. データベーススキーマの違い

---

## 1. モード概要

### 1.1 検定モード (certification)
- **概要**: 既定の種目・既定のレベルで検定を実施
- **用途**: 公式検定試験、標準的な採点基準を使用する場合
- **種目**: 事前定義された「events」テーブルから選択
- **主な特徴**: シンプルで標準的、カスタマイズ不可

### 1.2 大会モード (tournament)
- **概要**: カスタム種目・採点方式・スコアボードに対応
- **用途**: スポーツ大会、競技会、カスタマイズが必要な場合
- **種目**: 自由に作成可能（custom_eventsテーブル）
- **主な特徴**: 高度なカスタマイズ、複数検定員(5審3採等)、詳細な採点設定

### 1.3 研修モード (training)
- **概要**: 最大100名の検定員による採点訓練
- **用途**: 審判員育成、採点スキル向上トレーニング
- **種目**: 自由に作成可能（training_eventsテーブル）
- **主な特徴**: 個別採点表示(集計なし)、複数検定員モード対応、採点比較機能

---

## 2. 主要特徴の比較

### 2.1 セッション属性
| 項目 | 検定 | 大会 | 研修 |
|------|------|------|------|
| モード値 | 'certification' | 'tournament' | 'training' |
| is_tournament_mode | false | true | false |
| 専用テーブル | sessions | sessions + custom_events | sessions + training_* |
| 複数検定員対応 | is_multi_judgeで制御 | 常にtrue | is_multi_judgeで制御 |

### 2.2 種目管理
```
検定モード:
- events テーブル（固定）
- discipline + level + event_name で管理
- 例: "体操" + "初級" + "鉄棒"

大会モード:
- custom_events テーブル（カスタマイズ可能）
- discipline + level + event_name + display_order で管理
- 例: "体操大会2025" + "共通" + "鉄棒"

研修モード:
- training_events テーブル（カスタマイズ可能）
- name + order_index + min/max_score で管理
- 例: "基礎採点練習"
```

### 2.3 採点データ構造
```
検定モード:
- results テーブル
- 検定員1人の採点結果を記録

大会モード:
- results テーブル
- 複数検定員の採点結果（is_tournament_modeで識別）

研修モード:
- training_scores テーブル（独立）
- event_id + judge_id + athlete_id で一意制約
- 個別採点表示用（集計なし）
```

### 2.4 参加者管理
```
検定モード:
- session_participants（通常ユーザー/ゲスト）
- participantsテーブル不使用

大会モード:
- participants テーブル（必須）
- session_participants（検定員）
- bib_number + athlete_name + team_name を管理

研修モード:
- participants テーブル（検定員として使用）
- session_participants（セッション参加者）
- ゼッケン番号は検定員IDとして機能
```

---

## 3. 複数検定員モード設定

### 3.1 設定フロー

#### 検定モード・研修モードの場合
```typescript
// sessions テーブルの is_multi_judge カラムで制御
// training_sessions.is_multi_judge（研修モードのみ）

検定モード:
- is_multi_judge = false: 各検定員が独立して採点（複数検定員OFF）
- is_multi_judge = true: 主任検定員が指示（複数検定員ON）

研修モード:
- is_multi_judge = false: 各検定員が自由に採点（デフォルト）
- is_multi_judge = true: 主任検定員が採点指示（リアルタイム採点用）
```

#### 大会モードの場合
```typescript
// 常に is_multi_judge = true（変更不可）
// 理由: 大会モードでは常に複数検定員での採点が前提
```

### 3.2 主任検定員(Chief Judge)の役割

#### 検定モード
```
is_multi_judge = true の場合:
1. scoring_prompts テーブルで採点指示を作成
2. 各検定員に「次に採点すべき選手」を指示
3. 順序的採点を強制
4. 主任以外のアクセスを制限

is_multi_judge = false の場合:
- 主任検定員の特別な役割なし
- 全員が自由に採点可能
```

#### 大会モード
```
常に主任検定員は以下を管理:
1. custom_events（種目）の作成・編集
2. participants（選手）の管理
3. scoring_prompts（採点指示）の発行
4. exclude_extremes 設定（5審3採等）
```

#### 研修モード
```
is_multi_judge = true の場合:
1. training_events（種目）の管理
2. scoring_prompts で採点指示（大会モード同様）
3. 主任検定員を participants.id で管理
4. training_sessions.chief_judge_id に参照

is_multi_judge = false の場合:
- 主任検定員は設定のみ（training_sessions）
- 採点指示なし、自由採点
```

### 3.3 複数検定員モード設定ページ

**セッション詳細ページ (`/session/[id]/details`)**
```typescript
// 検定・研修モード共通
isMultiJudge: boolean = sessionDetails.is_multi_judge || false

// 研修モードのみ
trainingSession?.is_multi_judge: boolean

// 大会モード
// 常に true（設定項目なし）
```

更新アクション:
```typescript
updateSettings (検定・研修共通):
- isMultiJudge: boolean
- requiredJudges?: number（複数検定員ONの場合）

updateTrainingSettings (研修モードのみ):
- isMultiJudge: boolean
- 独立した training_sessions.is_multi_judge カラム

updateTournamentSettings (大会モードのみ):
- scoringMethod: '3judges' | '5judges'
- exclude_extremes: boolean（5審3採で最大・最小を除外）
```

---

## 4. 採点方法の違い

### 4.1 採点式の種類

#### 検定モード
```
score_calculation: 'average' (デフォルト)

複数検定員OFF (is_multi_judge = false):
- 単一検定員が採点
- 単純な数値記録

複数検定員ON (is_multi_judge = true):
- 複数検定員の平均値を採用
- 例: 85点, 88点, 87点 → 平均 86.67点
```

#### 大会モード
```
score_calculation: 'sum' (固定)
exclude_extremes: boolean

3審3採 (exclude_extremes = false):
- 3人の検定員の平均点を採用
- 例: 85点, 88点, 87点 → (85+88+87)/3 = 86.67点

5審3採 (exclude_extremes = true):
- 5人の検定員から最高・最低を除外し、3人の平均
- 例: 90, 88, 85, 82, 80 → (88+85+82)/3 = 85点
- 極端な採点を排除
```

### 4.2 採点データフロー

```
検定・大会モード:
User → scoring_prompts（採点指示）→ results テーブル
                          ↓
                    集計・計算処理
                          ↓
                      最終スコア

研修モード:
User → training_scores テーブル
                          ↓
              個別採点表示（集計なし）
                          ↓
              採点比較・偏差分析用
```

### 4.3 点差制御 (Score Diff Control)

**大会モードのみ対応**
```typescript
sessions テーブル:
- max_score_diff?: number (1〜10)

機能:
- 検定員の採点が大きく異なる場合、警告または修正
- 採点の統一を促進
- 信頼性の高い結果を実現

例: max_score_diff = 3
- 最高点 90, 最低点 87 → OK (差は3以内)
- 最高点 90, 最低点 86 → NG (差は4で許容超過)
```

---

## 5. 参加者の扱い方

### 5.1 参加者の種類と役割

#### 検定モード
```
session_participants テーブルのみ:
- user_id: 検定員のユーザーID
- is_guest: ゲスト検定員フラグ
- guest_name, guest_identifier: ゲスト情報

特徴:
- participants テーブル不使用（採点対象者がない）
- 検定員（ユーザー）の管理のみ
```

#### 大会モード
```
2つのテーブルで管理:
1. participants:
   - 競技選手（採点対象者）
   - bib_number: ゼッケン番号（キー）
   - athlete_name: 選手名
   - team_name: チーム名

2. session_participants:
   - 検定員（採点者）
   - user_id: 検定員ユーザーID
   - is_guest: ゲスト検定員フラグ

例: サッカー大会
- participants: 20人の選手
- session_participants: 5人の審判員
```

#### 研修モード
```
participants テーブル:
- 検定員（採点者として使用）
- bib_number: 検定員の ID（ゼッケン番号形式で使用）
- athlete_name: 検定員名
- team_name: 所属（オプション）

特徴:
- 検定員は「採点者」かつ「採点対象」（相互評価）
- training_scores.judge_id + athlete_id で相互採点を管理
- 最大100名の検定員に対応

例: 審判員育成訓練
- 10人の審判員が参加
- 各審判員が他の審判員の採点を評価
- 個別採点表示で比較検討
```

### 5.2 参加者の追加方法

#### 検定モード
```
セッション作成時:
- 作成者が自動参加

招待:
- invitation テーブルで招待リンク生成
- ゲスト招待にも対応
```

#### 大会モード
```
参加者管理ページ (/session/[id]/tournament-setup/participants):

1. CSV一括インポート
   形式: ゼッケン番号, 選手名, チーム名
   例:
   1, 山田太郎, Aチーム
   2, 佐藤花子, Bチーム

2. 個別追加
   - ゼッケン番号, 選手名, チーム名を入力

3. 個別編集・削除
   - 各選手情報を編集可能
```

#### 研修モード
```
参加者管理ページ (/session/[id]/training-setup/participants):

1. CSV一括インポート
   形式: ゼッケン番号, 検定員名, 所属

2. 個別追加
   - ゼッケン番号, 検定員名, 所属を入力

3. 個別編集・削除

特別: 主任検定員の設定
- participants.id を traininng_sessions.chief_judge_id に設定
```

### 5.3 ゲスト参加者への対応

```
検定・大会・研修モード共通:

session_participants.is_guest = true:
- ユーザー登録不要
- guest_identifier で一意識別
- guest_name で表示名管理

RLS (Row Level Security):
- guest_identifier をパラメータで検証
- ゲスト招待トークンから自動生成
- 特定セッションのみアクセス可能
```

---

## 6. データベーススキーマの違い

### 6.1 テーブル使用マトリックス

| テーブル | 検定 | 大会 | 研修 |
|----------|------|------|------|
| sessions | ✓ | ✓ | ✓ |
| events | ✓ | ✗ | ✗ |
| custom_events | ✗ | ✓ | ✗ |
| training_events | ✗ | ✗ | ✓ |
| participants | ✗ | ✓(選手) | ✓(検定員) |
| session_participants | ✓ | ✓(検定員) | ✓ |
| results | ✓ | ✓ | ✗ |
| training_scores | ✗ | ✗ | ✓ |
| training_sessions | ✗ | ✗ | ✓ |
| scoring_prompts | ✓ | ✓ | ✓ |

### 6.2 セッションテーブルのスキーマ

```sql
sessions:
  id: bigserial PRIMARY KEY
  
  -- 基本情報
  name: text
  mode: text DEFAULT 'certification' 
        CHECK (mode IN ('certification', 'tournament', 'training'))
  
  -- アクセス制御
  created_by: uuid REFERENCES auth.users
  chief_judge_id: uuid (検定員ID、モード別に意味が異なる)
  organization_id: uuid REFERENCES organizations
  
  -- 複数検定員制御
  is_multi_judge: boolean DEFAULT false
  required_judges: integer (複数検定員ONの場合の最少人数)
  
  -- 大会モード固有
  is_tournament_mode: boolean DEFAULT false (後方互換性)
  score_calculation: text DEFAULT 'average' 
                     ('average' for 検定, 'sum' for 大会)
  exclude_extremes: boolean DEFAULT false (5審3採用)
  max_score_diff: integer (点差制御, 1-10)
  
  -- 状態管理
  is_active: boolean
  is_accepting_participants: boolean
  status: text ('active', 'ended')
  active_prompt_id: bigint REFERENCES scoring_prompts
  
  -- その他
  join_code: text (参加コード)
  created_at, updated_at: timestamp
```

### 6.3 大会モード専用テーブル

```sql
custom_events:
  id: bigserial PRIMARY KEY
  session_id: bigint REFERENCES sessions(id)
  discipline: text
  level: text
  event_name: text
  display_order: int
  created_at, updated_at: timestamp
  INDEX: (session_id), (session_id, discipline, level)

participants (大会モード):
  id: bigserial PRIMARY KEY
  session_id: bigint REFERENCES sessions(id)
  bib_number: int
  athlete_name: text
  team_name: text (NULL可)
  created_at, updated_at: timestamp
  UNIQUE(session_id, bib_number)
  INDEX: (session_id), (session_id, bib_number)
```

### 6.4 研修モード専用テーブル

```sql
training_sessions:
  id: bigserial PRIMARY KEY
  session_id: bigint REFERENCES sessions(id) UNIQUE
  chief_judge_id: bigint REFERENCES participants(id) (研修モード用)
  
  -- 表示設定
  show_individual_scores: boolean DEFAULT true
  show_score_comparison: boolean DEFAULT true
  show_deviation_analysis: boolean DEFAULT false
  
  -- 複数検定員制御（研修モード専用）
  is_multi_judge: boolean DEFAULT false
  
  -- 制限
  max_judges: integer DEFAULT 100
  
  created_at, updated_at: timestamp
  INDEX: (session_id), (chief_judge_id)

training_events:
  id: bigserial PRIMARY KEY
  session_id: bigint REFERENCES sessions(id)
  name: text
  order_index: integer
  min_score: numeric DEFAULT 0
  max_score: numeric DEFAULT 100
  score_precision: integer DEFAULT 1 (小数点以下桁数)
  status: text DEFAULT 'pending' 
          CHECK (status IN ('pending', 'in_progress', 'completed'))
  current_athlete_id: bigint REFERENCES participants(id) (リアルタイム採点)
  created_at, updated_at: timestamp
  INDEX: (session_id), (session_id, order_index), (status), (current_athlete_id)

training_scores:
  id: bigserial PRIMARY KEY
  event_id: bigint REFERENCES training_events(id)
  judge_id: bigint REFERENCES participants(id)
  athlete_id: bigint REFERENCES participants(id)
  score: numeric NOT NULL
  is_finalized: boolean DEFAULT false
  note: text (オプション)
  created_at, updated_at: timestamp
  UNIQUE(event_id, judge_id, athlete_id)
  INDEX: (event_id), (judge_id), (athlete_id), (event_id, judge_id, athlete_id)
```

### 6.5 共通テーブル

```sql
session_participants:
  session_id: bigint
  user_id: uuid (通常ユーザー)
  is_guest: boolean DEFAULT false
  guest_identifier: text (ゲストID)
  guest_name: text (ゲスト用表示名)
  
  特徴:
  - 検定: 検定員リスト
  - 大会: 審判員リスト
  - 研修: セッション参加者（検定員も含む）

scoring_prompts (採点指示):
  id: bigserial PRIMARY KEY
  session_id: bigint
  discipline: text
  level: text
  event_name: text
  bib_number: int (次に採点すべき選手)
  
  用途:
  - 複数検定員MONでの順序制御
  - sessions.active_prompt_id で現在の指示を参照

results (検定・大会モードの採点結果):
  id: bigserial PRIMARY KEY
  session_id: bigint
  discipline: text
  level: text
  event_name: text
  bib_number: int
  judge_id: uuid (検定員)
  score: numeric
  is_tournament_mode: boolean (大会用フラグ)
  created_at, updated_at: timestamp
```

### 6.6 RLS (Row Level Security) ポリシー差異

```
検定モード:
- session_participants でアクセス制御
- results は session_participants で参加確認

大会モード:
- session_participants (検定員)
- custom_events (作成者・主任検定員のみ編集)
- participants (作成者・主任検定員のみ編集)
- results (session_participants で確認)

研修モード:
- session_participants (セッション参加者)
- training_events (作成者・主任検定員のみ編集)
- training_scores (
    SELECT: session_participants で確認
    INSERT: judge_id は participants で確認
    UPDATE/DELETE: judge_id で自分の採点のみ変更
  )
```

---

## 7. セッション作成フロー

### 7.1 セッション作成ページ (`/session/create`)

```typescript
フォーム入力:
1. セッション名
2. 所属組織（複数組織対応）
3. モード選択:
   - 検定モード
   - 大会モード
   - 研修モード
4. 研修モード専用:
   - 最大検定員数（1-100）

バリデーション:
- セッション名: XSS対策, 255文字以内
- 組織ID: UUID形式, ユーザーが所属確認
- モード: 'kentei', 'tournament', 'training'のみ
- 最大検定員数: 1-100の範囲

プラン制限チェック:
- 組織の subscription プランで利用可能モード判定
- Freeプラン: 検定モードのみ
- Proプラン: 検定 + 大会
- Enterpriseプラン: 全モード
```

### 7.2 セッション作成処理

```typescript
検定モード:
1. sessions テーブルに挿入
   - mode: 'certification'
   - is_tournament_mode: false
   - score_calculation: 'average'
   - chief_judge_id: 作成者ID
2. session_participants に作成者を追加
3. ダッシュボードへリダイレクト

大会モード:
1. sessions テーブルに挿入
   - mode: 'tournament'
   - is_tournament_mode: true
   - score_calculation: 'sum'
   - chief_judge_id: 作成者ID
2. session_participants に作成者を追加
3. /session/[id]/tournament-setup へリダイレクト
4. 参加者・種目・採点方式の設定が必要

研修モード:
1. sessions テーブルに挿入
   - mode: 'training'
   - is_tournament_mode: false
   - chief_judge_id: 作成者ID
2. session_participants に作成者を追加
3. training_sessions テーブルに挿入
   - max_judges: フォーム入力値（デフォルト100）
   - show_individual_scores: true
   - show_score_comparison: true
   - show_deviation_analysis: false
   - is_multi_judge: false (デフォルト)
4. /session/[id]/training-setup へリダイレクト
5. 参加者・種目・採点設定が必要
```

---

## 8. まとめ表

### 8.1 実装の主要違い

| 側面 | 検定 | 大会 | 研修 |
|------|------|------|------|
| 種目 | 固定 | カスタム | カスタム |
| 採点結果テーブル | results | results | training_scores |
| 選手管理 | なし | participants | participants(検定員) |
| 複数検定員 | オプション | 必須 | オプション |
| 採点式 | 平均 | 平均/合計 | 個別表示 |
| 集計 | あり | あり | なし |
| 最大参加者数 | 無制限 | 無制限 | 100名 |
| 主要設定ページ | details | tournament-setup | training-setup |

### 8.2 データフローの違い

```
検定:
モード選択 → セッション作成 → 参加者加入 → 採点 → 結果集計

大会:
モード選択 → セッション作成 → 参加者登録 → 種目設定 
→ 採点方式設定 → 採点指示発行 → 採点 → 結果集計

研修:
モード選択 → セッション作成 → 最大検定員設定 → 参加者登録 
→ 種目設定 → 複数検定員モード設定 → 採点 → 個別表示
```

---

## 9. 主要ファイルリスト

### セッション作成
- `/src/routes/session/create/+page.server.ts`
- `/src/routes/session/create/+page.svelte`

### セッション詳細・管理
- `/src/routes/session/[id]/details/+page.server.ts`
- `/src/routes/session/[id]/+page.server.ts`

### セットアップページ
- `/src/routes/session/[id]/tournament-setup/+page.server.ts`
- `/src/routes/session/[id]/tournament-setup/participants/+page.server.ts`
- `/src/routes/session/[id]/tournament-setup/scoring/+page.server.ts`
- `/src/routes/session/[id]/training-setup/+page.server.ts`
- `/src/routes/session/[id]/training-setup/participants/+page.server.ts`

### 採点
- `/src/routes/session/[id]/score/[modeType]/[eventId]/+page.server.ts`
- `/src/routes/session/[id]/score/score/+page.server.ts`

### データベーススキーマ
- `/database/migrations/001_add_tournament_mode.sql` (大会モード)
- `/database/migrations/004_add_training_mode.sql` (研修モード)
- `/database/migrations/005_add_multi_judge_to_training.sql` (複数検定員)

