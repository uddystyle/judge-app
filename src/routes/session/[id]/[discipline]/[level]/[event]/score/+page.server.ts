import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	isChiefJudge,
	getJudgeName
} from '$lib/server/sessionHelpers';
import { validateBib, validateScoreInput, validateScoreRange } from '$lib/server/validation';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const { id: sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('id, name, chief_judge_id, is_multi_judge, session_date')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		console.error('Failed to fetch session details:', sessionError);
		return {
			isChief: false,
			isMultiJudge: false
		};
	}

	const isChief = isChiefJudge(user, sessionDetails);
	const profile = await fetchUserProfile(supabase, user);

	return {
		isChief,
		isMultiJudge: sessionDetails.is_multi_judge,
		sessionDetails,
		user,
		profile,
		guestIdentifier,
		guestParticipant
	};
};

export const actions: Actions = {
	submitScore: async ({ request, params, url, locals: { supabase } }) => {
		console.log('[submitScore/inspection] Action called');

		const guestIdentifier = url.searchParams.get('guest');
		console.log('[submitScore/inspection] Guest identifier from URL:', guestIdentifier);

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			console.error('[submitScore/inspection] Authentication failed');
			return fail(401, { error: '認証が必要です。' });
		}

		const { user, guestParticipant } = authResult;
		console.log('[submitScore/inspection] User check:', {
			hasUser: !!user,
			hasGuest: !!guestParticipant
		});

		if (guestParticipant) {
			console.log('[submitScore/inspection] Guest authenticated:', guestParticipant.guest_name);
		}

		const formData = await request.formData();
		const scoreRaw = formData.get('score') as string;
		const bibRaw = formData.get('bib') as string;

		const { id: sessionId, discipline, level, event: eventName } = params;

		console.log('[submitScore/inspection] Score submission (raw):', {
			scoreRaw,
			bibRaw,
			sessionId,
			discipline,
			level,
			eventName,
			hasUser: !!user,
			hasGuest: !!guestParticipant,
			guestName: guestParticipant?.guest_name
		});

		// ============================================================
		// バリデーション
		// ============================================================

		// 1. bib のバリデーション
		const bibResult = validateBib(bibRaw);
		if (!bibResult.success) {
			console.error('[submitScore/inspection] bib が不正:', bibRaw);
			return fail(400, { error: bibResult.error });
		}
		const bib = bibResult.value;

		// 2. score のバリデーション
		const scoreResult = validateScoreInput(scoreRaw);
		if (!scoreResult.success) {
			console.error('[submitScore/inspection] score が不正:', scoreRaw);
			return fail(400, { error: scoreResult.error });
		}
		const score = scoreResult.value;

		// 3. ゼッケン番号の存在確認（なければ自動作成）
		let participant: { id: string; bib_number: number } | null = null;

		const { data: existingParticipant, error: participantError } = await supabase
			.from('participants')
			.select('id, bib_number')
			.eq('session_id', sessionId)
			.eq('bib_number', bib)
			.maybeSingle();

		if (existingParticipant) {
			participant = existingParticipant;
		} else {
			// 検定モードでは参加者が事前登録されていない場合、自動作成する
			console.log('[submitScore/inspection] 参加者が存在しないため自動作成:', { sessionId, bib });
			const { data: newParticipant, error: createError } = await supabase
				.from('participants')
				.insert({
					session_id: sessionId,
					bib_number: bib,
					athlete_name: `選手${bib}`
				})
				.select('id, bib_number')
				.single();

			if (createError || !newParticipant) {
				console.error('[submitScore/inspection] 参加者の自動作成に失敗:', createError);
				return fail(500, {
					error: '参加者の登録に失敗しました。'
				});
			}
			participant = newParticipant;
		}

		console.log('[submitScore/inspection] 参加者確認成功:', participant);

		// 4. 得点範囲チェック（検定モードは0～99の固定範囲）
		const minScore = 0;
		const maxScore = 99;

		const rangeResult = validateScoreRange(score, minScore, maxScore);
		if (!rangeResult.success) {
			console.error('[submitScore/inspection] 得点範囲外:', { score, minScore, maxScore });
			return fail(400, { error: rangeResult.error });
		}

		console.log('[submitScore/inspection] バリデーション完了。得点を保存します。');

		// 検定員名を取得（通常ユーザーまたはゲストユーザー）
		const judgeName = await getJudgeName(supabase, user, guestParticipant);
		if (!judgeName) {
			console.error('[submitScore/inspection] Neither user nor guest found!');
			return fail(401, { error: '認証が必要です。' });
		}
		console.log('[submitScore/inspection] Using judge name:', judgeName);

		console.log('[submitScore/inspection] Inserting result:', {
			session_id: sessionId,
			bib,
			score,
			judge_name: judgeName,
			discipline,
			level,
			event_name: eventName
		});

		const { error: insertError } = await supabase.from('results').upsert(
			{
				session_id: sessionId,
				bib: bib,
				score: score,
				judge_name: judgeName,
				discipline: discipline,
				level: level,
				event_name: eventName
			},
			{
				onConflict: 'session_id, bib, discipline, level, event_name, judge_name'
			}
		);

		if (insertError) {
			console.error('[submitScore/inspection] Error saving score:', insertError);
			console.error('[submitScore/inspection] Error details:', {
				code: insertError.code,
				message: insertError.message,
				details: insertError.details,
				hint: insertError.hint
			});
			return fail(500, { error: `採点の保存に失敗しました。${insertError.message || ''}` });
		}

		console.log('[submitScore/inspection] Score saved successfully');

		return {
			success: true,
			score,
			bib
		};
	}
};
