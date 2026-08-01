# tento.app ネットワーク耐性・オフライン対応戦略

作成日: 2026-07-31
更新日: 2026-08-01（コードベース・公式ドキュメントとの突き合わせ検証を反映）

## 目的

tento.app は野外・山岳・会場Wi-Fi混雑環境で使われる可能性があるため、ネットワークが不安定でも採点業務が止まらない設計が必要である。

本ドキュメントでは、現在の実装との差分、Supabase/Vercel 継続時の対応方針、PowerSync 等の追加技術候補、ネイティブ化時の理想構成を整理する。

## 結論

短期的には、現在の Supabase + Vercel + SvelteKit 構成を維持し、採点データのローカル保存と後同期を追加するのが最も現実的である。

推奨方針:

```text
短期:
  SvelteKit PWA + IndexedDB/Dexie + 冪等な同期API

中期:
  Supabase/Postgres を正本DBにしたまま PowerSync をPoC

長期:
  現地採点用途が強くなるなら SwiftUI / Kotlin ネイティブ化
```

最優先で改善すべき UX は Realtime ではなく、「採点が端末に確実に残ること」である。

## 現在の実装の状態

確認した範囲では、現在の実装はオンライン前提の会場利用には比較的強い。

既にある対策:

- Supabase Realtime を利用
- Realtime のバックオフ再購読
- Realtime 失敗時の polling fallback
- 待機画面・status・complete 画面の取りこぼし対策
- 採点保存時のサーバー側バリデーション
- 権限、参加者、bib、score range、重複の検証

ただし、Realtime についてはテーブルごとの差がある。

- 主要画面で使う `training_scores` / `results` / `sessions` は realtime publication 済み
- `dashboard` が購読している `session_participants` は現状 publication に含まれておらず、イベントを受信できない
- そのため「オンライン前提では比較的強い」は、採点・待機・スコアボードの主要導線に限定した評価である

実 DB の publication はリポジトリからは確認できないため、`database/diagnostics/realtime_setup_check.sql` を dev/prod で実行して実測確認する。`session_participants` は「publication に追加する」か「dashboard の購読を削除する」かをロードマップ Step 0 で決める。

なお Supabase Realtime / Postgres Changes は、採点正本の確実配送やクライアント別の未受信キューとして扱うべきではない。切断・再接続後の状態はポーリング/再取得で補う現行実装の方針が妥当である。

一方で、以下はまだ見当たらない。

- IndexedDB / Dexie による採点のローカル永続化
- 未同期キュー
- `client_mutation_id` による冪等同期
- Service Worker / PWA オフラインキャッシュ
- 採点画面での「端末保存済み」「未同期」「同期済み」表示

現在の採点フローは概ね以下。

```text
点数入力
  ↓
SvelteKit form action へ POST
  ↓
Supabase に保存
  ↓
成功したら status / complete へ遷移
```

この構造では、POST が失敗すると「保存完了」にならない。山・野外ではここが最大のUXリスクになる。

## ネットワーク対策によるUX改善見込み

ネットワーク対策の主な効果は、即時性の向上ではなく、採点業務の継続性と安心感の向上である。

| 状況           | 現在                                       | 対策後                         |
| -------------- | ------------------------------------------ | ------------------------------ |
| 電波良好       | ほぼ問題なし                               | 状態表示により安心感が増える   |
| 一瞬の切断     | Realtime系は耐えるが、採点POSTは失敗し得る | 採点は端末保存され、復帰後同期 |
| 数分間の圏外   | 採点送信できず進行が止まり得る             | 採点を継続できる               |
| 送信中に圏外化 | 保存失敗・再入力リスク                     | ローカル保存済みとして扱える   |
| 会場Wi-Fi混雑  | POST遅延・失敗で不安                       | 未同期表示で運用継続           |
| 審判の心理     | 保存されたか不安                           | 端末保存済みが明示される       |

体感改善の目安:

- 電波良好な屋内: 10〜20%
- 野外イベント: 40〜60%
- 山・圏外混在: 70〜90%
- 完全圏外を含む運用: 現状は成立しにくいが、対策後は成立可能

## 基本設計

採点アプリでは、サーバー保存より先に端末保存を完了させる。

```text
点数入力
  ↓
端末ローカルDBに即保存
  ↓
UI上は「端末保存済み・未同期」
  ↓
通信可能時に同期APIへ送信
  ↓
Supabase/Postgres に保存
  ↓
UI上は「同期済み」
```

重要なのは「保存」と「同期」を分けること。

- 保存: 端末に残った状態
- 同期: サーバー正本に反映された状態

## 優先実装

### Phase 1: 採点のローカル保存

目的: 圏外でも採点入力を失わない。

実装候補:

- `dexie` を追加
- IndexedDB に `pending_score_mutations` を作る
- 採点確定時はまず IndexedDB へ保存
- IndexedDB 保存成功時点で UI に「端末保存済み」と表示
- 既存の SvelteKit action POST は同期処理へ移行

例:

```text
pending_score_mutations
  id
  client_mutation_id
  client_id
  client_sequence
  session_id
  mode_type
  event_id
  participant_id
  bib_number
  score
  judge_id
  guest_identifier
  created_at_local
  sync_status
  last_error
  retry_count
```

### Phase 2: 冪等な同期API

目的: 復帰時の二重送信・連打・リトライに耐える。

既存DBには、judge×対象の重複防止は既に存在する。

| 対象                         | 既存制約/インデックス                                                                   | 役割                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 大会結果 `results`           | `results_unique_owner_auth` / `results_unique_owner_guest`（migration 1009）            | 同一 owner が同一対象へ複数行を作ることを防ぐ                  |
| 研修スコア `training_scores` | `idx_training_scores_unique_auth` / `idx_training_scores_unique_guest`（migration 041） | 同一 judge/guest が同一 athlete/event へ複数行を作ることを防ぐ |

ただし、これらは「採点結果の重複防止」であり、「同じクライアント操作をリトライで何度送っても1回だけ処理する」ための冪等性とは別である。

オフライン同期では、judge×対象の unique 制約に加えて、`client_mutation_id` の一意性が必要になる。

必要な設計:

- `client_mutation_id` を必須にする
- サーバー側で同じ mutation は1回だけ処理
- `client_mutation_id` の処理済み記録をDBに保存する
- 既存の権限・参加者・bib・score range・重複の検証は維持
- active prompt 照合は、既存の multi-judge 非主任・非ゲスト向け採点 action にある検証を共通化して同期 API でも維持する
- 主任・ゲスト・遅延同期時に active prompt の扱いをどうするかを明示する
- 古い prompt に対する同期をどう扱うかを明示する

必要なスキーマ変更例:

```text
score_mutations
  id
  client_mutation_id unique
  client_id
  client_sequence
  session_id
  mode_type
  event_id
  participant_id
  bib_number
  score
  judge_id
  guest_identifier
  active_prompt_id
  active_prompt_sequence
  created_at_local
  created_at_server
  status
  rejection_reason
```

または、既存の `results` / `training_scores` に `client_mutation_id` を直接持たせる案もある。ただし、監査・リトライ・拒否理由の記録まで考えると、mutation log テーブルを分ける方が扱いやすい。

同期API例:

```text
POST /api/sync/scores

{
  "mutations": [
    {
      "client_mutation_id": "...",
      "session_id": "...",
      "event_id": "...",
      "participant_id": "...",
      "bib_number": 12,
      "score": 85
    }
  ]
}
```

サーバー応答例:

```text
{
  "accepted": ["..."],
  "rejected": [
    {
      "client_mutation_id": "...",
      "reason": "active_prompt_changed"
    }
  ]
}
```

### Phase 3: 同期状態UI

目的: 現場の不安を減らす。

表示すべき状態:

- オンライン / オフライン
- 端末保存済み
- 未同期件数
- 同期中
- 同期済み
- 同期失敗
- 最終同期時刻

重要な文言:

```text
端末に保存済みです。通信が復帰すると自動同期されます。
```

避けるべき文言:

```text
保存に失敗しました
```

ネットワークが原因の場合、端末保存に成功しているなら「保存失敗」ではなく「未同期」である。

### Phase 4: 事前ダウンロード

目的: 現地で必要な情報を通信なしで表示する。

対象:

- sessions
- session_participants
- participants
- training_events
- custom_events
- scoring_prompts
- 採点ルール
- 緊急連絡先
- 必要なら地図・資料

イベント開始前に「このイベントをオフライン利用可能にする」導線を用意する。

### Phase 5: PWA / Service Worker

目的: アプリ本体の読み込み失敗を減らす。

対象:

- JS/CSS
- 主要ページ shell
- アイコン
- 静的文言
- オフライン時の fallback page

ただし、Service Worker は採点データの正本管理には使わない。採点データは IndexedDB / 同期キューで扱う。

## iOS Safari の制約（戦略の前提として重要）

「採点が端末に確実に残る」という本戦略の根幹には、iOS Safari 固有の制約が直接影響する（2026-08 時点、WebKit 公式ドキュメント・MDN で確認済み）。

1. **ITP による7日削除**: ホーム画面に追加していない Web サイトは、最終利用から7日で
   IndexedDB を含むスクリプト書き込みストレージが削除されうる。免除されるのは
   **ホーム画面に追加した場合のみ**。`navigator.storage.persist()` は iOS では
   削除免除の効果が公式に確認されていない（Android Chrome では有効）。
2. **バックグラウンド同期不可**: Background Sync API / Periodic Background Sync は
   iOS では未実装（ホーム画面 PWA でも同じ）。同期はアプリがフォアグラウンドの間のみ。

含意:

- iOS では**ホーム画面追加（PWA インストール）の誘導が実質必須**。PWA 対応は
  Phase 5 に置いているが、iOS の永続性確保の観点では Phase 1 と並行して
  「ホーム画面追加の案内」だけでも先行させる価値がある。
- 「端末保存済み」の表示は、iOS 非インストール利用では「7日以内の同期が前提」で
  あることを運用上理解しておく（大会当日〜翌日同期なら実害はない）。
- 同期はフォアグラウンド時に自動実行する設計とし、バックグラウンド同期には依存しない。

## Supabase 継続前提の技術判断

tento.app では Firestore は採用しない。正本DB、認証、権限、集計は Supabase/Postgres を前提にする。

Supabase/Postgres を維持する理由:

- SQL集計
- RLS
- 組織・権限管理
- 採点制約
- エクスポート
- 既存実装の継続

この前提では、ネットワーク耐性は Firestore への移行ではなく、Supabase の外側にローカル保存・同期キュー・同期基盤を追加して実現する。

判断:

```text
短期:
  Supabase + IndexedDB が妥当

中期:
  Supabase + PowerSync を検証

長期:
  Supabase/Postgres を正本DBにしたまま、現地採点アプリをネイティブ化
```

## PowerSync の位置付け

PowerSync は、Supabase/Postgres を正本DBとして維持しながら、端末側にローカル SQLite を持たせる同期基盤である。

役割:

- サーバーからクライアントへの同期
- クライアント側 SQLite へのローカル読み書き
- ローカル書き込みの upload queue
- 復帰時の同期処理

構成:

```text
アプリ
  ↓ 読み書き
ローカルSQLite
  ↓ upload queue
PowerSync Backend Connector / API
  ↓
Supabase Postgres
```

PowerSync が担当するのは主にサーバーからクライアントへの read path。クライアントからサーバーへの write path は `uploadData()` に実装する。Supabase 連携の公式標準は `uploadData()` 内で supabase-js により Postgres へ直接書き込む構成（RLS が守る）で、**自前 API は必須ではなく選択肢**。tento.app は mutation log・冪等性・active prompt 検証を挟みたいため、自前の同期 API 経由を選ぶ。

Web では PowerSync のローカル SQLite は WASM SQLite として動作し、VFS によって IndexedDB または OPFS に永続化される。デフォルトは IndexedDB ベースで、Safari/iOS やマルチタブ要件では OPFS 系 VFS の選定が重要になる。

運用面では、PowerSync Cloud Free プランは PoC には使いやすいが、非アクティブ期間が続くとインスタンスが停止/非アクティブ化される。長めのPoCや関係者レビューでは、再開手順または有料プランへの切り替えを事前に決めておく。

Self-host は PowerSync Open Edition を無料で利用できる。ただし、Docker 等で PowerSync Service を運用する必要があり、監視、アップグレード、障害対応は自前になる。

tento.app での PoC 最小スコープ:

1. 1つの session を端末へ同期
2. participants / events / scoring config をローカル表示
3. 圏外で score を入力
4. 復帰後に Supabase へ同期
5. スコアボードへ反映
6. 二重送信が起きないことを確認

注意点:

- Sync Streams の設計が必要（Sync Rules はレガシー扱いで、新規は Sync Streams が公式推奨）
- RLS と同期対象条件を揃える必要がある（read path のレプリケーションは RLS を通らないため、Sync Streams 側で RLS と同等の絞り込みを定義する）
- 書き込みAPIの冪等性が必要
- `client_mutation_id` を保存するためのスキーマ変更が必要
- 競合解決ルールが必要
- PowerSync Cloud または self-host の運用判断が必要

## Pokémon GO など野外ゲームから学べること

野外ゲームは、通信をすべて同じ重要度で扱わない。

主な対策:

- アセット事前ダウンロード
- ローカルキャッシュ
- 重要データと一時データの通信分離
- OSのバックグラウンド機能活用
- サーバー権威型の検証
- 差分通信
- 通信状態のUX表示
- 位置情報の誤差前提

tento.app への適用:

| ゲームの考え方       | tento.app での適用                           |
| -------------------- | -------------------------------------------- |
| アセット事前取得     | イベントデータ・地図・資料の事前ダウンロード |
| 重要度で通信を分ける | 採点は確実保存、スコアボードは遅延許容       |
| サーバー権威型       | 最終採点・権限・active prompt はサーバー検証 |
| 差分通信             | score mutation だけ同期                      |
| UX表示               | 未同期件数・最終同期時刻を表示               |

採点データは「落としてはいけない」。スコアボードやオンライン人数は「遅れてもよい」。この分離が重要。

## ネイティブ化時の理想構成

長期的に山岳利用が強い場合、現地採点アプリはネイティブ化が有利。

推奨構成:

```text
管理画面:
  SvelteKit + Vercel

正本DB:
  Supabase/Postgres

同期基盤:
  PowerSync

iOS:
  SwiftUI + Swift

Android:
  Kotlin + Jetpack Compose

ローカルDB:
  SQLite

ファイル:
  Supabase Storage
```

ネイティブ化の価値:

- バックグラウンド同期
- GPS
- 端末ストレージ
- 通知
- カメラ・添付
- 低電力制御
- OSごとのネットワーク状態制御

ただし、最初からネイティブ化する必要はない。まず Web/PWA 側で同期APIとデータモデルを固める方が安全。

## 実装時の重要な設計判断

### 採点を上書き型にするか、mutation log 型にするか

推奨は mutation log 型。

理由:

- 二重送信に強い
- 監査ログになる
- 復帰時同期を説明しやすい
- 古い採点の扱いをサーバーで判断できる

### 古い採点をどう扱うか

例:

- 主任が次の bib に進める前に入力されたが、同期だけ遅れた採点: 受け付ける
- 主任が次の bib に進めた後に新規入力された採点: 拒否
- 同じ審判が同じ対象に複数回入力: 最新を採用、または修正扱い

この判断には `created_at_local` だけでなく、active prompt の version / sequence を持たせるとよい。

### ゲスト（匿名認証）とオフラインの相互作用

ゲスト検定員は Supabase の匿名認証 JWT でセッションに紐づく。現行実装は JWT 失効
（SIGNED_OUT）を検知するとセッション再参加画面へ誘導する（`$lib/supabaseClient` の
onAuthStateChange）。

オフライン運用では「圏外の間に JWT が失効し、未同期キューだけが端末に残る」ケースが
起きる。同期 API の設計では以下を明示する必要がある。

- 失効した匿名 JWT での同期要求の扱い（再参加 → 新しい guest_identifier になるのか、
  元の identifier を引き継ぐのか）
- 未同期キューと guest_identifier の対応関係の保持
- 再参加後に旧キューを新しい認証で送信してよいかのサーバー側判定

### 端末時刻を信用しすぎない

端末時刻はずれる。最終判断はサーバー時刻と server-side state で行う。

端末時刻は UX と監査補助として使う。

## 推奨ロードマップ

### Step 0

実 DB の realtime publication を `database/diagnostics/realtime_setup_check.sql` で
実測確認し、`session_participants` を「publication に追加する」か「dashboard の
購読を削除する」か決める。

### Step 1

採点画面に IndexedDB 保存を追加する。あわせて iOS 向けにホーム画面追加の案内を
検討する（ITP の7日削除対策。上記「iOS Safari の制約」参照）。

### Step 2

同期APIを追加し、既存 `submitScore` action のサーバー検証ロジックを再利用・共通化する。

### Step 3

未同期UIを追加する。

### Step 4

イベントデータの事前ダウンロードを追加する。

### Step 5

PWA / Service Worker を追加する。

### Step 6

PowerSync PoC を1セッション・1採点フローに限定して実施する。

### Step 7

現地利用が増える場合、SwiftUI / Kotlin ネイティブ版を検討する。

## 参考資料

- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Supabase Realtime database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase Storage resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [PowerSync Supabase integration](https://docs.powersync.com/integrations/supabase/guide)
- [PowerSync Service architecture](https://docs.powersync.com/architecture/powersync-service)
- [PowerSync client-side backend connector](https://docs.powersync.com/configuration/app-backend/client-side-integration)
- [PowerSync RLS and Sync Streams](https://docs.powersync.com/integrations/supabase/rls-and-sync-streams)
- [PowerSync Supabase Auth](https://docs.powersync.com/configuration/auth/supabase-auth)
- [Pokémon GO Download All Assets](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/3589-download-all-assets/)
- [Pokémon GO Adventure Sync](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/3265-adventure-sync/)
- [Niantic Lightship networking](https://lightship.dev/ja/docs/ardk/multiplayer/multiplayer_experience.html)
- [Niantic Shared AR debugging](https://lightship.dev/docs/ardk/how-to/shared_ar/debug_shared_ar/)
