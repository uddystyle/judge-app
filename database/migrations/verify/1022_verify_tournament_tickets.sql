-- ============================================================
-- Verification Script for 1022 (tournament_tickets + トリガー強制)
-- ============================================================
-- 何も書き換えずに全文をそのまま SQL Editor で一発実行する。
-- 検証に使う組織は自動選択（最新の組織）され、結果は最後に表形式で出る。
-- 検証データ（セッション・チケット）はスクリプト内で自動削除される。
-- 期待結果: (0)〜(5) が全て ✅。❌ / ⚠️ が出た行は要調査。
--
-- 補足: 「既存セッションの大会化を authenticated が拒否される」検証
-- （trg_prevent_tournament_mode_escalation）は SQL Editor（postgres 権限）では
-- 再現できない。アプリの JWT で PostgREST に mode='tournament' の PATCH を
-- 送って拒否されることを確認する（通常は不要。トリガー存在確認は 1022 末尾で済み）。

do $$
declare
  v_org uuid;
  v_org_name text;
  v_ticket uuid;
  v_session bigint;
  v_used timestamptz;
  v_sid bigint;
begin
  drop table if exists verify_1022_results;
  create temp table verify_1022_results (step text, result text);

  -- (0) 検証に使う組織を自動選択（最新の組織）
  select id, name into v_org, v_org_name
  from organizations order by created_at desc limit 1;

  if v_org is null then
    insert into verify_1022_results values ('(0) 組織選択', '❌ organizations にデータがありません');
    return;
  end if;
  insert into verify_1022_results values ('(0) 組織選択', '✅ 使用組織: ' || v_org_name || ' (' || v_org || ')');

  -- (1) チケット0枚で大会作成 → 拒否されるべき
  begin
    insert into sessions (name, join_code, mode, is_tournament_mode, score_calculation, organization_id, status, is_active)
    values ('1022検証-拒否', 'VRFY0001', 'tournament', true, 'sum', v_org, 'active', true);
    insert into verify_1022_results values ('(1) チケット0で大会作成', '❌ 拒否されず作成できてしまった');
  exception when others then
    if sqlerrm like '%TOURNAMENT_TICKET_REQUIRED%' then
      insert into verify_1022_results values ('(1) チケット0で大会作成', '✅ 期待どおり拒否');
    else
      insert into verify_1022_results values ('(1) チケット0で大会作成', '⚠️ 想定外エラー: ' || sqlerrm);
    end if;
  end;

  -- (2) チケット付与 → 大会作成成功・チケット消費
  begin
    insert into tournament_tickets (organization_id, note)
    values (v_org, '1022検証チケット') returning id into v_ticket;

    insert into sessions (name, join_code, mode, is_tournament_mode, score_calculation, organization_id, status, is_active)
    values ('1022検証-成功', 'VRFY0002', 'tournament', true, 'sum', v_org, 'active', true)
    returning id into v_session;

    select used_at, session_id into v_used, v_sid
    from tournament_tickets where id = v_ticket;

    if v_used is not null and v_sid = v_session then
      insert into verify_1022_results values ('(2) チケットありで大会作成', '✅ 作成成功・チケット消費を確認');
    else
      insert into verify_1022_results values ('(2) チケットありで大会作成',
        '❌ 消費が記録されていない (used_at=' || coalesce(v_used::text, 'null') || ', session_id=' || coalesce(v_sid::text, 'null') || ')');
    end if;
  exception when others then
    insert into verify_1022_results values ('(2) チケットありで大会作成', '⚠️ 想定外エラー: ' || sqlerrm);
  end;

  -- (3) 残0で再作成 → 再び拒否されるべき
  begin
    insert into sessions (name, join_code, mode, is_tournament_mode, score_calculation, organization_id, status, is_active)
    values ('1022検証-2枚目拒否', 'VRFY0003', 'tournament', true, 'sum', v_org, 'active', true);
    insert into verify_1022_results values ('(3) 残0で再作成', '❌ 拒否されず作成できてしまった');
  exception when others then
    if sqlerrm like '%TOURNAMENT_TICKET_REQUIRED%' then
      insert into verify_1022_results values ('(3) 残0で再作成', '✅ 期待どおり拒否');
    else
      insert into verify_1022_results values ('(3) 残0で再作成', '⚠️ 想定外エラー: ' || sqlerrm);
    end if;
  end;

  -- (4) 検定モードはチケット不要で作成できるべき
  begin
    insert into sessions (name, join_code, mode, is_tournament_mode, organization_id, status, is_active)
    values ('1022検証-検定', 'VRFY0004', 'certification', false, v_org, 'active', true);
    insert into verify_1022_results values ('(4) 検定モード作成', '✅ チケット無しで作成成功');
  exception when others then
    insert into verify_1022_results values ('(4) 検定モード作成', '⚠️ 想定外エラー: ' || sqlerrm);
  end;

  -- (5) クリーンアップ
  delete from sessions where name like '1022検証-%';
  delete from tournament_tickets where note = '1022検証チケット';
  insert into verify_1022_results values ('(5) クリーンアップ', '✅ 検証データ削除済み');
end $$;

select step, result from verify_1022_results;
