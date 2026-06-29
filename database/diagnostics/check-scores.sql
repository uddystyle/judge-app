-- 山田大輔の得点が削除されたか確認
SELECT
  judge_name,
  score,
  session_id,
  bib,
  discipline,
  level,
  event_name
FROM results
WHERE
  session_id = '8e54b3ad-e3b8-45ba-9b99-db24d1c49ebb'
  AND bib = '15'
  AND discipline = 'スキー'
  AND level = '１級（70点）'
  AND event_name = '小回り不整地'
ORDER BY judge_name;
