import { error, fail, redirect } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateSession } from '$lib/server/sessionAuth';

/**
 * tournament-setup / training-setup 配下の participants・events ページの共通実装
 *
 * 2つのモードのページはモードガードとテーブル/カラム名以外は同一。
 * 挙動は setup-pages.characterization.test.ts で固定されている。
 */

export type SetupMode = 'tournament' | 'training';

interface SetupLoadEvent {
	params: { id: string };
	locals: { supabase: SupabaseClient };
}

interface SetupActionEvent extends SetupLoadEvent {
	request: Request;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = Record<string, any>;

const MODE_CONFIG: Record<
	SetupMode,
	{ sessionNotFoundMessage: string; isMode: (session: SessionRow) => boolean }
> = {
	tournament: {
		sessionNotFoundMessage: '検定が見つかりません。',
		isMode: (session) => !!session.is_tournament_mode
	},
	training: {
		sessionNotFoundMessage: 'セッションが見つかりません。',
		isMode: (session) => session.mode === 'training'
	}
};

/**
 * セットアップページ共通の認証・認可ガード
 * - ログインユーザー専用（authenticateSession）
 * - モード不一致 → /dashboard
 * - 作成者・主任検定員以外 → /session/[id]
 */
async function authorizeSetupAccess(supabase: SupabaseClient, sessionId: string, mode: SetupMode) {
	const config = MODE_CONFIG[mode];

	const { user } = await authenticateSession(supabase, sessionId, null);

	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, config.sessionNotFoundMessage);
	}

	if (!config.isMode(sessionDetails)) {
		throw redirect(303, '/dashboard');
	}

	const isAuthorized =
		sessionDetails.created_by === user.id || sessionDetails.chief_judge_id === user.id;

	if (!isAuthorized) {
		throw redirect(303, `/session/${sessionId}`);
	}

	return { user, sessionDetails };
}

async function fetchProfile(supabase: SupabaseClient, userId: string) {
	const { data: profileData } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', userId)
		.single();

	return profileData;
}

async function requireActionUser(supabase: SupabaseClient) {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return null;
	}

	return user;
}

// ============================================================
// participants ページ（モード間で完全に同一の挙動）
// ============================================================

export async function loadSetupParticipants(
	{ params, locals: { supabase } }: SetupLoadEvent,
	mode: SetupMode
) {
	const { id: sessionId } = params;

	const { user, sessionDetails } = await authorizeSetupAccess(supabase, sessionId, mode);

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

	const profile = await fetchProfile(supabase, user.id);

	return {
		user,
		profile,
		sessionDetails,
		participants: participants || []
	};
}

export const participantsSetupActions = {
	// CSVファイルから参加者を一括登録
	importCSV: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
		const user = await requireActionUser(supabase);
		if (!user) {
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
	addParticipant: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
		const user = await requireActionUser(supabase);
		if (!user) {
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
	updateParticipant: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
		const user = await requireActionUser(supabase);
		if (!user) {
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
	deleteParticipant: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
		const user = await requireActionUser(supabase);
		if (!user) {
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

// ============================================================
// events ページ（テーブル/カラム/insert ペイロードだけがモードで異なる）
// ============================================================

const EVENTS_CONFIG: Record<
	SetupMode,
	{
		table: string;
		nameColumn: string;
		orderColumn: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		insertPayload: (sessionId: string, eventName: string, nextOrder: number) => Record<string, any>;
	}
> = {
	tournament: {
		table: 'custom_events',
		nameColumn: 'event_name',
		orderColumn: 'display_order',
		// discipline, levelは固定値
		insertPayload: (sessionId, eventName, nextOrder) => ({
			session_id: sessionId,
			discipline: '大会',
			level: '共通',
			event_name: eventName,
			display_order: nextOrder
		})
	},
	training: {
		table: 'training_events',
		nameColumn: 'name',
		orderColumn: 'order_index',
		insertPayload: (sessionId, eventName, nextOrder) => ({
			session_id: sessionId,
			name: eventName,
			order_index: nextOrder,
			min_score: 0,
			max_score: 100,
			score_precision: 1,
			status: 'pending'
		})
	}
};

export async function loadSetupEvents(
	{ params, locals: { supabase } }: SetupLoadEvent,
	mode: SetupMode
) {
	const { id: sessionId } = params;
	const config = EVENTS_CONFIG[mode];

	const { user, sessionDetails } = await authorizeSetupAccess(supabase, sessionId, mode);

	// 種目の一覧を取得
	const { data: events, error: eventsError } = await supabase
		.from(config.table)
		.select('*')
		.eq('session_id', sessionId)
		.order(config.orderColumn, { ascending: true });

	if (eventsError) {
		console.error('Error fetching events:', eventsError);
		throw error(500, '種目の取得に失敗しました。');
	}

	const profile = await fetchProfile(supabase, user.id);

	return {
		user,
		profile,
		sessionDetails,
		events: events || []
	};
}

export function createSetupEventsActions(mode: SetupMode) {
	const config = EVENTS_CONFIG[mode];

	return {
		// 種目を追加
		addEvent: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
			const user = await requireActionUser(supabase);
			if (!user) {
				return fail(401, { error: '認証が必要です。' });
			}

			const formData = await request.formData();
			const eventName = formData.get('eventName') as string;

			// バリデーション
			if (!eventName) {
				return fail(400, { error: '種目名を入力してください。' });
			}

			// 現在の最大表示順を取得
			const { data: maxOrderData } = await supabase
				.from(config.table)
				.select(config.orderColumn)
				.eq('session_id', params.id)
				.order(config.orderColumn, { ascending: false })
				.limit(1)
				.single();

			const nextOrder = (maxOrderData?.[config.orderColumn] || 0) + 1;

			// 種目を追加
			const { error: insertError } = await supabase
				.from(config.table)
				.insert(config.insertPayload(params.id, eventName.trim(), nextOrder));

			if (insertError) {
				console.error('Error adding event:', insertError);
				return fail(500, { error: '種目の追加に失敗しました。' });
			}

			return { success: true, message: '種目を追加しました。' };
		},

		// 種目を削除
		deleteEvent: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
			const user = await requireActionUser(supabase);
			if (!user) {
				return fail(401, { error: '認証が必要です。' });
			}

			const formData = await request.formData();
			const eventId = formData.get('eventId') as string;

			if (!eventId) {
				return fail(400, { error: '種目IDが指定されていません。' });
			}

			// 種目を削除
			const { error: deleteError } = await supabase
				.from(config.table)
				.delete()
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (deleteError) {
				console.error('Error deleting event:', deleteError);
				return fail(500, { error: '種目の削除に失敗しました。' });
			}

			return { success: true, message: '種目を削除しました。' };
		},

		// 種目を編集
		updateEvent: async ({ request, params, locals: { supabase } }: SetupActionEvent) => {
			const user = await requireActionUser(supabase);
			if (!user) {
				return fail(401, { error: '認証が必要です。' });
			}

			const formData = await request.formData();
			const eventId = formData.get('eventId') as string;
			const eventName = formData.get('eventName') as string;

			// バリデーション
			if (!eventId || !eventName) {
				return fail(400, { error: '種目名を入力してください。' });
			}

			// 種目を更新
			const { error: updateError } = await supabase
				.from(config.table)
				.update({ [config.nameColumn]: eventName.trim() })
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (updateError) {
				console.error('Error updating event:', updateError);
				return fail(500, { error: '種目の更新に失敗しました。' });
			}

			return { success: true, message: '種目を更新しました。' };
		}
	};
}
