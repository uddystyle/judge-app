import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const { id: sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	// セッション情報を取得して、主任検定員かどうかを確認
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

	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

	// プロフィール情報を取得（認証ユーザーの場合のみ）
	let profile = null;

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;
	}

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

		// 1. bib のバリデーション（部分パース防止 + NaN チェック）
		// 正規表現で文字列全体が正の整数かチェック
		if (!bibRaw || !/^\d+$/.test(bibRaw.trim())) {
			console.error('[submitScore/inspection] bib が不正な形式:', bibRaw);
			return fail(400, { error: 'ゼッケン番号は正の整数で入力してください。' });
		}

		const bib = Number(bibRaw);

		if (isNaN(bib) || bib <= 0 || !Number.isInteger(bib)) {
			console.error('[submitScore/inspection] bib が無効:', bib);
			return fail(400, { error: 'ゼッケン番号は正の整数である必要があります。' });
		}

		// 2. score のバリデーション（部分パース防止 + NaN・Infinity・整数チェック）
		// 正規表現で文字列全体が数値（整数または小数）かチェック
		if (!scoreRaw || !/^-?\d+(\.\d+)?$/.test(scoreRaw.trim())) {
			console.error('[submitScore/inspection] score が不正な形式:', scoreRaw);
			return fail(400, { error: '得点は数値で入力してください。' });
		}

		const score = Number(scoreRaw);

		if (isNaN(score)) {
			console.error('[submitScore/inspection] score が NaN です');
			return fail(400, { error: '得点は数値で入力してください。' });
		}

		if (!isFinite(score)) {
			console.error('[submitScore/inspection] score が無限大です:', score);
			return fail(400, { error: '得点が無効です。' });
		}

		// UI仕様が整数前提なので整数チェック
		if (!Number.isInteger(score)) {
			console.error('[submitScore/inspection] score が整数ではありません:', score);
			return fail(400, { error: '得点は整数で入力してください。' });
		}

		// 3. ゼッケン番号の存在確認
		const { data: participant, error: participantError } = await supabase
			.from('participants')
			.select('id, bib_number')
			.eq('session_id', sessionId)
			.eq('bib_number', bib)
			.single();

		if (participantError || !participant) {
			console.error('[submitScore/inspection] ゼッケン番号が存在しません:', {
				bib,
				error: participantError
			});
			return fail(400, {
				error: '指定されたゼッケン番号の参加者が見つかりません。'
			});
		}

		console.log('[submitScore/inspection] 参加者確認成功:', participant);

		// 4. 得点範囲チェック（検定モードは0～99の固定範囲）
		const minScore = 0;
		const maxScore = 99;

		if (score < minScore || score > maxScore) {
			console.error('[submitScore/inspection] 得点範囲外:', { score, minScore, maxScore });
			return fail(400, {
				error: `得点は${minScore}～${maxScore}の範囲で入力してください。`
			});
		}

		console.log('[submitScore/inspection] バリデーション完了。得点を保存します。');

		// 検定員名を取得（通常ユーザーまたはゲストユーザー）
		let judgeName: string;
		if (guestParticipant) {
			judgeName = guestParticipant.guest_name;
			console.log('[submitScore/inspection] Using guest name:', judgeName);
		} else if (user) {
			const { data: profile } = await supabase
				.from('profiles')
				.select('full_name')
				.eq('id', user.id)
				.single();
			judgeName = profile?.full_name || user.email || 'Unknown';
			console.log('[submitScore/inspection] Using user name:', judgeName);
		} else {
			console.error('[submitScore/inspection] Neither user nor guest found!');
			return fail(401, { error: '認証が必要です。' });
		}

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
