import * as m from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';

export type ExportSessionResult = { ok: true } | { ok: false; reason: 'no-data' | 'error' };

/**
 * セッションの採点結果を Excel でエクスポートする（details ページから抽出）
 *
 * - /api/export/[sessionId] から結果を取得し、表示ロケールで列名を付けて xlsx 化
 * - モバイル（幅 768px 未満 & Web Share API 対応）は共有シート、それ以外はダウンロード
 * - xlsx は重い（~1MB）ため、エクスポート実行時にだけ遅延ロードする
 *
 * アラート表示は呼び出し側の責務（戻り値の reason で分岐する）。
 */
export async function exportSessionResults(
	sessionId: number | string,
	sessionName: string
): Promise<ExportSessionResult> {
	try {
		// 1. サーバーエンドポイントから結果を取得
		const response = await fetch(`/api/export/${sessionId}`);
		const jsonData = await response.json();

		if (!response.ok || !jsonData.results || jsonData.results.length === 0) {
			return { ok: false, reason: 'no-data' };
		}

		// 2. Excel シート用にデータを整形
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const exportData = jsonData.results.map((item: any) => ({
			[m.details_exportDateTime()]: new Date(item.created_at).toLocaleString(getLocale()),
			[m.details_exportBib()]: item.bib,
			[m.details_exportScore()]: item.score,
			[m.details_exportDiscipline()]: item.discipline,
			[m.details_exportLevel()]: item.level,
			[m.details_exportEvent()]: item.event_name,
			[m.details_exportJudge()]: item.judge_name
		}));

		// 3. ブラウザ上で Excel ファイルを生成
		const XLSX = await import('xlsx');
		const worksheet = XLSX.utils.json_to_sheet(exportData);
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, worksheet, m.details_exportSheetName());

		const fileName = `${sessionName}_${m.details_exportSheetName()}.xlsx`;

		// 4. モバイル環境かどうかを判定（Web Share API対応 & 画面幅768px未満）
		const isMobile = window.innerWidth < 768;
		const canShare = navigator.share !== undefined;

		if (isMobile && canShare) {
			// モバイル環境: Web Share APIで共有
			const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
			const blob = new Blob([excelBuffer], {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			});
			const file = new File([blob], fileName, {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			});

			await navigator.share({
				title: m.details_exportShareTitle(),
				text: m.details_exportShareText({ name: sessionName }),
				files: [file]
			});
		} else {
			// PC環境: ダウンロード
			XLSX.writeFile(workbook, fileName);
		}

		return { ok: true };
	} catch (err) {
		console.error('Export failed:', err);
		return { ok: false, reason: 'error' };
	}
}
