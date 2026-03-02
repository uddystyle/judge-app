-- session_participants テーブルのスキーマを確認
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'session_participants'
ORDER BY ordinal_position;
