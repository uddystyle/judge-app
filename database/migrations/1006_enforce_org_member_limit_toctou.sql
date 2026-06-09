-- Migration: Enforce organization member limit atomically (TOCTOU fix)
-- Date: 2026-06-09
--
-- 背景（堅牢性監査 limits-3）:
--   checkCanAddMember は「count(*) → 上限比較 → INSERT」を非アトミックに行うため、
--   ちょうど上限境界で同時受諾（招待リンク/invite_code の同時クリック）が起きると、
--   双方が「上限未満」を通過して両方 INSERT し、上限を超過しうる（TOCTOU レース）。
--
-- 対応:
--   organization_members への BEFORE INSERT トリガーで、対象組織の行を FOR UPDATE で
--   ロックしてから現在数を再カウントし、上限超過なら例外を投げて INSERT を拒否する。
--   行ロックにより同一組織への同時 INSERT が直列化され、レースが解消する。
--   アプリ層の checkCanAddMember はそのまま残し（通常時のクリーンなエラーメッセージ用）、
--   本トリガーは「レース時の最後の砦」として DB レベルで上限を保証する。
--
-- 注意:
--   * 上限は organizations.max_members（webhook / 作成RPC がプラン値と同期）を使用。
--     -1 または NULL は「無制限」として扱う（レガシー組織を壊さないため fail-open）。
--   * service role / anon / authenticated すべての INSERT に適用される（テーブルトリガーのため）。
--   * 組織作成時の作成者(admin)追加は count=0 < max のため通過する。
--   * レース敗者の INSERT は check_violation 例外となり、呼び出し側は汎用エラーを返す（稀なケース）。

CREATE OR REPLACE FUNCTION enforce_org_member_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_max INT;
  v_count INT;
BEGIN
  -- 対象組織の行をロックして、同一組織への同時 INSERT を直列化（TOCTOU 回避）
  SELECT max_members INTO v_max
  FROM organizations
  WHERE id = NEW.organization_id
  FOR UPDATE;

  -- 組織が存在しない、または無制限(-1 / NULL)なら制限しない
  IF v_max IS NULL OR v_max = -1 THEN
    RETURN NEW;
  END IF;

  -- 退会済み(removed_at)を除いた現在のメンバー数
  SELECT count(*) INTO v_count
  FROM organization_members
  WHERE organization_id = NEW.organization_id
    AND removed_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'organization member limit reached (max %)', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_org_member_limit ON organization_members;
CREATE TRIGGER trg_enforce_org_member_limit
  BEFORE INSERT ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_org_member_limit();

DO $$
BEGIN
  RAISE NOTICE '1006 completed: organization_members の上限を DB トリガーでアトミックに強制（TOCTOU解消）';
END $$;
