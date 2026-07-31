# 大会チケット（スポット販売）運用手順

大会モードは月額プランに含まれず、**大会1回 = セッション1つ = チケット1枚**のスポット販売（2026-07-30 移行）。
価格は完全非公示で、問い合わせ（`/contact?category=tournament_quote`）→ 個別見積り → 手動請求 → チケット付与のフローで運用する。

## 全体フロー

1. **見積依頼を受領**: 問い合わせフォームの「大会利用のお見積り」（contact_submissions.category = `tournament_quote`）。
   規模（参加人数・検定員数・開催日）が不足していればメールで確認する。
2. **見積り合意**: 金額・支払期日・大会中止時の扱いを明記して合意を取る。
3. **請求**: Stripe ダッシュボードから Invoice（または Payment Link）を手動発行。
4. **チケット付与**: 入金確認後（または合意したタイミングで）、下記 SQL を **本番 Supabase の SQL Editor** で実行。
5. **顧客に案内**: セッション作成画面（`/session/create`）で大会モードを選ぶとチケット残数が表示され、作成時に1枚消費される。

## チケット付与 SQL（service role / SQL Editor）

```sql
-- 組織 ID は organizations から名前で検索
select id, name, plan_type from organizations where name ilike '%<組織名>%';

-- 付与（note には請求の突合情報を必ず書く）
insert into tournament_tickets (organization_id, note)
values ('<ORG_ID>', '<大会名> / Stripe Invoice <番号> / <金額>円 / 付与者: uchida');
```

複数大会分をまとめて付与する場合は行を増やす（1大会 = 1行）。

## 状態確認 SQL

```sql
-- 組織のチケット一覧（未使用 = used_at IS NULL）
select id, note, granted_at, used_at, session_id
from tournament_tickets
where organization_id = '<ORG_ID>'
order by granted_at desc;

-- 消費済みチケットとセッションの突合
select t.note, t.used_at, s.id as session_id, s.name as session_name
from tournament_tickets t
left join sessions s on s.id = t.session_id
where t.organization_id = '<ORG_ID>' and t.used_at is not null;
```

## 返却・訂正（運用ポリシー）

- **soft delete（セッション削除）ではチケットは返却しない**（削除→復元による無償再利用を防ぐため。DB もそう実装されている）。
- 大会中止等で返却する場合は、**新しいチケットを付与**する（過去行の used_at は監査のため書き換えない）。

```sql
insert into tournament_tickets (organization_id, note)
values ('<ORG_ID>', '中止振替: 元チケット <ID> / <大会名>');
```

- **組織削除**: チケット行（未使用・消費済みとも）が残る組織は FK restrict により削除できない
  （アプリは「お手続きが必要」と案内する）。削除依頼が来たら、下記でチケット行を控えてから
  service role で行を削除し、その後に組織削除を案内する。

```sql
-- 控え（メール等に貼って保全してから削除）
select * from tournament_tickets where organization_id = '<ORG_ID>';
delete from tournament_tickets where organization_id = '<ORG_ID>';
```

- 誤付与の取り消しは未使用行の削除で行う:

```sql
delete from tournament_tickets where id = '<TICKET_ID>' and used_at is null;
```

## 実装の要点（トラブルシュート用）

- **消費は DB トリガー**（`trg_consume_tournament_ticket`、migration 1022）が `sessions` の INSERT 時に原子的に実行。
  アプリ層（`session/create`）の残数チェックは案内用の事前チェックにすぎない。
- service role や SQL Editor から大会セッションを直接 INSERT してもチケットが必要（意図的）。検証時は先に付与すること。
- 既存セッションの大会化（mode/is_tournament_mode の UPDATE）は authenticated からは拒否される
  （`trg_prevent_tournament_mode_escalation`）。運営が必要な場合のみ service role / SQL Editor で可能。
- 大会セッションは**月間セッション数上限・検定員数上限の対象外**（チケットで対価取得済みのため）。
- データ保持は組織プラン準拠（Free は削除後約30日で自動物理削除）。見積り時に「大会終了後は Excel エクスポート推奨」を案内する。
- 残数表示はセッション作成画面の大会モード選択時のみ。RLS 上、組織メンバーは自組織のチケットを SELECT できる（書き込みは service role のみ）。
