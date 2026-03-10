import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { checkCanAddJudgeToSession } from '$lib/server/organizationLimits';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

export const actions: Actions = {
	// 'join'アクションは、フォームが送信されたときに呼び出される
	join: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.auth);
		if (!rateLimitResult.success) {
			return rateLimitResult.response;
		}

		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const formData = await request.formData();
		const joinCode = (formData.get('joinCode') as string)?.trim().toUpperCase();
		const guestName = formData.get('guestName') as string;
		const isGuestMode = formData.get('isGuest') === 'true';

		// ゲストモードの場合は名前が必須、認証ユーザーの場合はユーザー情報が必須
		if (isGuestMode) {
			if (!guestName || guestName.trim().length === 0) {
				return fail(400, { joinCode, guestName, error: 'お名前を入力してください。' });
			}
		} else {
			if (userError || !user) {
				throw redirect(303, '/login');
			}
		}

		// バリデーション
		if (!joinCode) {
			return fail(400, { joinCode: '', guestName, error: '参加コードを入力してください。' });
		}

		if (joinCode.length !== 8) {
			return fail(400, { joinCode, guestName, error: '参加コードは8桁です。' });
		}

		// 英数字のみ許可
		if (!/^[A-Z0-9]{8}$/.test(joinCode)) {
			return fail(400, { joinCode, guestName, error: '参加コードは英数字8桁で入力してください。' });
		}

		// 参加コードに一致するセッションをデータベースから検索
		console.log('[Join Session] 参加コードでセッション検索:', joinCode);
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('id, is_accepting_participants, organization_id, failed_join_attempts, is_locked, join_code')
			.eq('join_code', joinCode)
			.maybeSingle();

		console.log('[Join Session] セッション検索結果:', { sessionData, error: sessionError });

		if (sessionError) {
			console.error('[Join Session] セッション検索エラー:', sessionError);
			return fail(500, { joinCode, error: `セッションの検索に失敗しました。${sessionError.message || ''}` });
		}

		if (!sessionData) {
			console.log('[Join Session] 参加コードに一致するセッションが見つかりません');
			return fail(404, { joinCode, error: '無効な参加コードです。' });
		}

		// セッションがロックされているかチェック
		if (sessionData.is_locked) {
			console.log('[Join Session] ロックされたセッションへのアクセス試行:', { sessionId: sessionData.id });
			return fail(423, {
				joinCode,
				guestName,
				error: '不正なアクセスが検出されたため、このセッションはロックされました。'
			});
		}

		// 参加コードが正しいことを確認（念のため）
		if (sessionData.join_code !== joinCode) {
			// 失敗回数をインクリメント
			const newFailedAttempts = (sessionData.failed_join_attempts || 0) + 1;

			console.log('[Join Session] 参加コード不一致。失敗回数:', newFailedAttempts);

			// 10回失敗でロック
			if (newFailedAttempts >= 10) {
				await supabase
					.from('sessions')
					.update({
						is_locked: true,
						failed_join_attempts: newFailedAttempts
					})
					.eq('id', sessionData.id);

				console.log('[Join Session] セッションをロックしました:', { sessionId: sessionData.id });

				return fail(423, {
					joinCode,
					guestName,
					error: '不正なアクセスが検出されたため、このセッションはロックされました。'
				});
			}

			// 失敗回数のみ更新
			await supabase
				.from('sessions')
				.update({ failed_join_attempts: newFailedAttempts })
				.eq('id', sessionData.id);

			return fail(401, { joinCode, guestName, error: '参加コードが正しくありません。' });
		}

		// セッションが参加受付中かチェック
		if (!sessionData.is_accepting_participants) {
			return fail(400, { joinCode, guestName, error: 'このセッションは参加受付を終了しています。' });
		}

		// 検定員数制限チェック（認証ユーザーの場合のみ）
		if (!isGuestMode) {
			console.log('[Join Session] 検定員数制限チェック開始:', {
				sessionId: sessionData.id,
				organizationId: sessionData.organization_id
			});
			const judgeCheck = await checkCanAddJudgeToSession(supabase, sessionData.id);
			console.log('[Join Session] 検定員数制限チェック結果:', judgeCheck);

			if (!judgeCheck.allowed) {
				console.log('[Join Session] 検定員数制限により参加拒否:', judgeCheck.reason);
				return fail(403, {
					joinCode,
					guestName,
					error: judgeCheck.reason || 'セッションの検定員数上限に達しています。',
					upgradeUrl: judgeCheck.upgradeUrl
				});
			}
		}

		// ゲストユーザーの場合
		if (isGuestMode) {
			console.log('[Join Session] ゲストとして参加:', {
				sessionId: sessionData.id,
				guestName: guestName.trim()
			});

			const guestIdentifier = crypto.randomUUID();

			const { error: insertError } = await supabase.from('session_participants').insert({
				session_id: sessionData.id,
				is_guest: true,
				guest_name: guestName.trim(),
				guest_identifier: guestIdentifier
			});

			if (insertError) {
				console.error('[Join Session] ゲスト参加者追加エラー:', insertError);
				return fail(500, {
					joinCode,
					guestName,
					error: `検定への参加に失敗しました。${insertError.message || ''}`
				});
			}

			console.log('[Join Session] ゲスト参加成功。リダイレクト先:', `/session/${sessionData.id}?guest=${guestIdentifier}`);
			throw redirect(303, `/session/${sessionData.id}?guest=${guestIdentifier}`);
		}

		// 認証ユーザーの場合
		console.log('[Join Session] 参加者追加を実行:', {
			sessionId: sessionData.id,
			userId: user.id
		});

		const { error: joinError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: user.id
		});

		console.log('[Join Session] 参加者追加結果:', { error: joinError });

		// 23505はunique_violationエラー（既にメンバーである場合）。
		// このエラーは無視して成功とみなす。それ以外のエラーは失敗として処理。
		if (joinError && joinError.code !== '23505') {
			console.error('[Join Session] 参加者追加エラー:', joinError);
			return fail(500, {
				joinCode,
				guestName,
				error: `検定への参加に失敗しました。${joinError.message || ''}`
			});
		}

		console.log('[Join Session] 参加成功。リダイレクト先:', `/session/${sessionData.id}`);
		// 成功したら、セッション待機画面へリダイレクト
		throw redirect(303, `/session/${sessionData.id}`);
	}
};
