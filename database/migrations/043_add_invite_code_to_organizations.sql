-- ============================================================
-- Add invite_code to organizations table
-- ============================================================
-- 実行日: 2025-01-22
-- 説明: 組織に6桁の招待コードを追加
-- ============================================================

-- 1. invite_code カラムを追加
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- 2. 招待コード生成関数（セッションのjoin_codeと同じロジック）
CREATE OR REPLACE FUNCTION generate_organization_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
  code_exists BOOLEAN := TRUE;
BEGIN
  -- ユニークなコードが見つかるまでループ
  WHILE code_exists LOOP
    result := '';
    -- 6桁のランダムコードを生成
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    -- コードの重複チェック
    SELECT EXISTS(SELECT 1 FROM organizations WHERE invite_code = result) INTO code_exists;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 3. 既存の組織に招待コードを設定
UPDATE organizations
SET invite_code = generate_organization_invite_code()
WHERE invite_code IS NULL;

-- 4. 新しい組織作成時に自動的に招待コードを生成するトリガー
CREATE OR REPLACE FUNCTION set_organization_invite_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invite_code IS NULL THEN
    NEW.invite_code := generate_organization_invite_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_organization_invite_code ON organizations;
CREATE TRIGGER trigger_set_organization_invite_code
  BEFORE INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION set_organization_invite_code();

-- 5. invite_code カラムに NOT NULL 制約を追加（既存データに値が設定された後）
ALTER TABLE organizations
ALTER COLUMN invite_code SET NOT NULL;

-- 6. インデックスを追加（既にUNIQUE制約があるので自動的にインデックスは作成されるが、明示的に追加）
CREATE INDEX IF NOT EXISTS idx_organizations_invite_code ON organizations(invite_code);

-- ============================================================
-- 完了
-- ============================================================
