-- お問い合わせ送信データを保存するテーブル
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- インデックスを追加（検索用）
CREATE INDEX IF NOT EXISTS contact_submissions_email_idx ON contact_submissions(email);
CREATE INDEX IF NOT EXISTS contact_submissions_status_idx ON contact_submissions(status);
CREATE INDEX IF NOT EXISTS contact_submissions_submitted_at_idx ON contact_submissions(submitted_at DESC);

-- RLS（Row Level Security）を有効化
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

-- 管理者のみがすべてのデータを閲覧・編集できるポリシー
-- 注: 実際の管理者ロールに応じて調整が必要
CREATE POLICY "管理者のみアクセス可能" ON contact_submissions
  FOR ALL
  USING (auth.role() = 'service_role');
