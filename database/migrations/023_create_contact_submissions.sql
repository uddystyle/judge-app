-- =============================================
-- お問い合わせ送信テーブルの作成
-- =============================================

-- お問い合わせ送信テーブル
CREATE TABLE IF NOT EXISTS contact_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    organization TEXT,
    subject TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('general', 'technical', 'billing', 'feature', 'other')),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,

    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_category ON contact_submissions(category);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_submitted_at ON contact_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email);

-- 更新日時の自動更新トリガー
CREATE OR REPLACE FUNCTION update_contact_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_contact_submissions_updated_at
    BEFORE UPDATE ON contact_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_submissions_updated_at();

-- RLS (Row Level Security) ポリシー
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

-- 誰でもお問い合わせを送信できる（INSERT）
CREATE POLICY "Anyone can submit contact form"
    ON contact_submissions
    FOR INSERT
    TO public
    WITH CHECK (true);

-- 管理者のみが全てのお問い合わせを閲覧・更新できる（将来の管理画面用）
-- 注: 現時点では管理者権限テーブルがないため、コメントアウトしておく
-- CREATE POLICY "Admins can view all contact submissions"
--     ON contact_submissions
--     FOR SELECT
--     TO authenticated
--     USING (
--         EXISTS (
--             SELECT 1 FROM admin_users
--             WHERE admin_users.user_id = auth.uid()
--         )
--     );

COMMENT ON TABLE contact_submissions IS 'お問い合わせフォームの送信データを保存するテーブル';
COMMENT ON COLUMN contact_submissions.id IS 'お問い合わせID（UUID）';
COMMENT ON COLUMN contact_submissions.name IS '送信者名';
COMMENT ON COLUMN contact_submissions.email IS '送信者メールアドレス';
COMMENT ON COLUMN contact_submissions.organization IS '組織名・団体名（任意）';
COMMENT ON COLUMN contact_submissions.subject IS '件名';
COMMENT ON COLUMN contact_submissions.category IS 'お問い合わせ種別（general/technical/billing/feature/other）';
COMMENT ON COLUMN contact_submissions.message IS 'お問い合わせ内容';
COMMENT ON COLUMN contact_submissions.status IS 'ステータス（new/in_progress/resolved/closed）';
COMMENT ON COLUMN contact_submissions.submitted_at IS '送信日時';
COMMENT ON COLUMN contact_submissions.updated_at IS '更新日時';
COMMENT ON COLUMN contact_submissions.notes IS '管理者用メモ（将来の管理画面用）';
