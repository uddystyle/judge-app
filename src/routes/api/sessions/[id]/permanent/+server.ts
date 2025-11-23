import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// セッション完全削除（Premium限定）
export const DELETE: RequestHandler = async ({ params, locals: { supabase } }) => {
	const { id: sessionId } = params;

	// ユーザー認証チェック
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	try {
		// 1. 削除されたセッション情報を取得
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('id, organization_id, name')
			.eq('id', sessionId)
			.not('deleted_at', 'is', null)
			.single();

		if (sessionError || !session) {
			return json({ error: 'アーカイブされたセッションが見つかりません' }, { status: 404 });
		}

		// 2. 組織情報とプラン情報を取得
		const { data: organization, error: orgError } = await supabase
			.from('organizations')
			.select('id, name, plan_type')
			.eq('id', session.organization_id)
			.single();

		if (orgError || !organization) {
			return json({ error: '組織が見つかりません' }, { status: 404 });
		}

		// 3. Premium プランのチェック
		if (organization.plan_type !== 'premium') {
			return json(
				{ error: '完全削除機能はPremiumプランでのみご利用いただけます' },
				{ status: 403 }
			);
		}

		// 4. 権限チェック: 実行ユーザーがセッションの組織の管理者かどうか確認
		const { data: membership, error: membershipError } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', session.organization_id)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.single();

		if (membershipError || !membership) {
			return json({ error: 'この組織のメンバーではありません' }, { status: 403 });
		}

		if (membership.role !== 'admin') {
			return json({ error: '管理者権限が必要です' }, { status: 403 });
		}

		// 5. 関連データの削除（カスケード削除されないデータを手動で削除）
		// session_participants の削除
		const { error: participantsDeleteError } = await supabase
			.from('session_participants')
			.delete()
			.eq('session_id', sessionId);

		if (participantsDeleteError) {
			console.error('Participants delete error:', participantsDeleteError);
			return json({ error: '参加者データの削除に失敗しました' }, { status: 500 });
		}

		// scores の削除
		const { error: scoresDeleteError } = await supabase
			.from('scores')
			.delete()
			.eq('session_id', sessionId);

		if (scoresDeleteError) {
			console.error('Scores delete error:', scoresDeleteError);
			return json({ error: 'スコアデータの削除に失敗しました' }, { status: 500 });
		}

		// training_sessions の削除（存在する場合）
		const { error: trainingDeleteError } = await supabase
			.from('training_sessions')
			.delete()
			.eq('session_id', sessionId);

		// training_sessions はモードによっては存在しないのでエラーは無視

		// 6. セッション本体を完全削除
		const { error: deleteError } = await supabase
			.from('sessions')
			.delete()
			.eq('id', sessionId);

		if (deleteError) {
			console.error('Permanent delete error:', deleteError);
			return json({ error: 'セッションの完全削除に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'セッションを完全に削除しました'
		});
	} catch (error: any) {
		console.error('Unexpected error:', error);
		return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
	}
};
