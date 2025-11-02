import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId } = params;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, 'セッションが見つかりません。');
	}

	// 研修モードでない場合はダッシュボードにリダイレクト
	if (sessionDetails.mode !== 'training') {
		throw redirect(303, '/dashboard');
	}

	// 作成者または主任検定員のみアクセス可能
	const isAuthorized =
		sessionDetails.created_by === user.id || sessionDetails.chief_judge_id === user.id;

	if (!isAuthorized) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// 参加者一覧を取得
	const { data: participants, error: participantsError } = await supabase
		.from('participants')
		.select('*')
		.eq('session_id', sessionId)
		.order('bib_number', { ascending: true });

	if (participantsError) {
		console.error('Error fetching participants:', participantsError);
		throw error(500, '参加者の取得に失敗しました。');
	}

	return {
		sessionDetails,
		participants: participants || []
	};
};

export const actions: Actions = {
	// CSVファイルから参加者を一括登録
	importCSV: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const csvFile = formData.get('csvFile') as File;

		if (!csvFile || csvFile.size === 0) {
			return fail(400, { error: 'CSVファイルを選択してください。' });
		}

		try {
			const csvText = await csvFile.text();
			const lines = csvText.split('\n').filter((line) => line.trim() !== '');

			if (lines.length === 0) {
				return fail(400, { error: 'CSVファイルが空です。' });
			}

			const participantsToInsert = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				const parts = line.split(',').map((part) => part.trim());

				// ヘッダー行をスキップ（ゼッケン番号が数字でない場合）
				if (i === 0 && isNaN(parseInt(parts[0]))) {
					continue;
				}

				if (parts.length < 2) {
					return fail(400, {
						error: `${i + 1}行目: 形式が正しくありません。ゼッケン番号,選手名,チーム名の形式で入力してください。`
					});
				}

				const bibNumber = parseInt(parts[0]);
				const athleteName = parts[1];
				const teamName = parts[2] || null;

				if (isNaN(bibNumber) || bibNumber <= 0) {
					return fail(400, {
						error: `${i + 1}行目: ゼッケン番号は正の整数である必要があります。`
					});
				}

				if (!athleteName) {
					return fail(400, { error: `${i + 1}行目: 選手名を入力してください。` });
				}

				participantsToInsert.push({
					session_id: params.id,
					bib_number: bibNumber,
					athlete_name: athleteName,
					team_name: teamName
				});
			}

			if (participantsToInsert.length === 0) {
				return fail(400, { error: 'インポートするデータがありません。' });
			}

			// 既存の参加者を削除してから新しいデータを挿入
			const { error: deleteError } = await supabase
				.from('participants')
				.delete()
				.eq('session_id', params.id);

			if (deleteError) {
				console.error('Error deleting existing participants:', deleteError);
				return fail(500, { error: '既存の参加者データの削除に失敗しました。' });
			}

			const { error: insertError } = await supabase
				.from('participants')
				.insert(participantsToInsert);

			if (insertError) {
				console.error('Error importing participants:', insertError);
				return fail(500, { error: '参加者のインポートに失敗しました。' });
			}

			return {
				success: true,
				message: `${participantsToInsert.length}件の参加者をインポートしました。`
			};
		} catch (err) {
			console.error('Error processing CSV:', err);
			return fail(500, { error: 'CSVファイルの処理中にエラーが発生しました。' });
		}
	},

	// 参加者を個別に追加
	addParticipant: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const bibNumber = parseInt(formData.get('bibNumber') as string);
		const athleteName = formData.get('athleteName') as string;
		const teamName = formData.get('teamName') as string;

		// バリデーション
		if (isNaN(bibNumber) || bibNumber <= 0) {
			return fail(400, { error: 'ゼッケン番号は正の整数である必要があります。' });
		}

		if (!athleteName || athleteName.trim() === '') {
			return fail(400, { error: '選手名を入力してください。' });
		}

		// 重複チェック
		const { data: existing } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', params.id)
			.eq('bib_number', bibNumber)
			.single();

		if (existing) {
			return fail(400, { error: 'このゼッケン番号は既に登録されています。' });
		}

		const { error: insertError } = await supabase.from('participants').insert({
			session_id: params.id,
			bib_number: bibNumber,
			athlete_name: athleteName.trim(),
			team_name: teamName?.trim() || null
		});

		if (insertError) {
			console.error('Error adding participant:', insertError);
			return fail(500, { error: '参加者の追加に失敗しました。' });
		}

		return { success: true, message: '参加者を追加しました。' };
	},

	// 参加者を編集
	updateParticipant: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const participantId = formData.get('participantId') as string;
		const bibNumber = parseInt(formData.get('bibNumber') as string);
		const athleteName = formData.get('athleteName') as string;
		const teamName = formData.get('teamName') as string;

		// バリデーション
		if (!participantId) {
			return fail(400, { error: '参加者IDが指定されていません。' });
		}

		if (isNaN(bibNumber) || bibNumber <= 0) {
			return fail(400, { error: 'ゼッケン番号は正の整数である必要があります。' });
		}

		if (!athleteName || athleteName.trim() === '') {
			return fail(400, { error: '選手名を入力してください。' });
		}

		// 重複チェック（自分以外）
		const { data: existing } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', params.id)
			.eq('bib_number', bibNumber)
			.neq('id', participantId)
			.single();

		if (existing) {
			return fail(400, { error: 'このゼッケン番号は既に登録されています。' });
		}

		const { error: updateError } = await supabase
			.from('participants')
			.update({
				bib_number: bibNumber,
				athlete_name: athleteName.trim(),
				team_name: teamName?.trim() || null
			})
			.eq('id', participantId)
			.eq('session_id', params.id);

		if (updateError) {
			console.error('Error updating participant:', updateError);
			return fail(500, { error: '参加者の更新に失敗しました。' });
		}

		return { success: true, message: '参加者を更新しました。' };
	},

	// 参加者を削除
	deleteParticipant: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const participantId = formData.get('participantId') as string;

		if (!participantId) {
			return fail(400, { error: '参加者IDが指定されていません。' });
		}

		const { error: deleteError } = await supabase
			.from('participants')
			.delete()
			.eq('id', participantId)
			.eq('session_id', params.id);

		if (deleteError) {
			console.error('Error deleting participant:', deleteError);
			return fail(500, { error: '参加者の削除に失敗しました。' });
		}

		return { success: true, message: '参加者を削除しました。' };
	}
};
