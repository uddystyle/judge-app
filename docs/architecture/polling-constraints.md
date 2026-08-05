# ポーリング／Realtime の設計上の制約

> 2026-08-05 の realtime 監査と、それに対する3回のレビューで確定した制約をまとめる。
> 新しくポーリング処理を追加する前に読むこと。

## 1. 錠を持つ機構には必ず期限を入れる

`createSerializedAsync` は「同時に1本だけ実行する」ための錠を持つ。**期限（`timeoutMs`）を
付けないと、対象の Promise が解決しない限り錠が解放されない**。通信が一度ハングしただけで
その画面のポーリングが永久に止まり、復旧手段が再読み込みしかなくなる。

既定値は `DEFAULT_POLL_TIMEOUT_MS`（15秒）。個別に事情がある場合だけ上書きする。

現在の使用箇所（全て期限あり）:

| 箇所 | 用途 |
|---|---|
| `realtime.ts` | フォールバック／ヘルスポーリング、セッション監視 |
| `scoreStatusManager.ts` | 採点状況の取得 |
| `scoreboardRefresh.ts` | スコアボードの再読込 |
| `dashboard/+page.svelte` | セッション一覧の同期 |
| `score/status/+page.svelte` | 次滑走者ナビ |

## 2. 期限だけでは「常に1件」は保証されない

期限で錠を解放しても、**元の処理が止まる保証はない**。止めるには `AbortSignal` を
末端の通信まで届ける必要がある。

- supabase-js: `.abortSignal(signal)`
- fetch: `fetch(url, { signal })`

ポーリング経路から呼ばれる関数は、signal を引数で受けて下位へ渡すこと。
**1本目のクエリだけ通して満足しないこと**（実際に、関数の2本目以降が漏れる事故を繰り返した）。

### 保証できない既知の箇所

`scoreboardRefresh` は SvelteKit の `invalidateAll()` を使う。これは `AbortSignal` を
受け付けないため、**期限切れ後に重複したサーバーリクエストが走り得る**。

- 保証すること: ハング後も更新が再開する（停止しない）
- 保証しないこと: 常に1件だけ実行する

厳密に1件へ抑えるには `invalidateAll` を signal 付き fetch へ置き換える必要があるが、
スコアボードの `load` は認可モデルが2種類ある。

| ページ | 認可 | 取得 |
|---|---|---|
| `/scoreboard/[sessionId]` | 公開（認証不要） | `supabaseAdmin`（service role で RLS 迂回） |
| `/session/[id]/scoreboard` | 認証必須 | ユーザークライアント（RLS）＋10秒キャッシュ |

API 化すると **公開エンドポイントで service role を露出**させ、認可を二重管理することに
なる。重複リクエスト1本を避ける対価としては見合わないと判断し、制約を明記して運用する。
要件が「重複通信を絶対に起こさない」に変わった場合は再検討すること。

## 3. Realtime の DELETE は特別扱いする

Supabase 公式ドキュメント:

> RLS policies are not applied to `DELETE` statements, because there is no way for Postgres
> to verify that a user has access to a deleted record. When RLS is enabled and
> `replica identity` is set to `full` on a table, the `old` record contains only the primary key(s).

したがって:

- **`payload.old` の非主キー列を当てにしない**。`REPLICA IDENTITY FULL` にしても届かない
  （`FULL` が効くのは UPDATE の old）
- 購読フィルタは DELETE では評価できない。**無関係な DELETE も全クライアントに届く**前提で書く
- DELETE を受けたら payload に頼らず**正規状態を再取得**する。ただし連続分はまとめる
  （`scoreStatusManager` は 300ms でデバウンス）

## 4. 監査するときの注意

同じ欠陥は1箇所ではなく同じ形の全箇所に存在する。着手前に対象の全件表を作ること。

**やってはいけない絞り込み**: 「既に `abortSignal` を含むファイル」で grep する。
signal を一切使っていないファイルが丸ごと視界から漏れる（実際に
`sessionNavigationMonitor.ts` を見落とした）。ポーリングの**入口**
（`pollingFn:` / `onPollingData:` / `createSerializedAsync(`）から呼び出しグラフを辿ること。
