import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// ゲストユーザーの情報を保持
	let guestParticipant = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
	} else if (userError || !user) {
		throw redirect(303, '/login');
	}

	// セッション情報を取得して、主任検定員かどうかを確認
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('chief_judge_id, is_multi_judge')
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

	return {
		isChief,
		isMultiJudge: sessionDetails.is_multi_judge,
		user,
		guestIdentifier,
		guestParticipant
	};
};
