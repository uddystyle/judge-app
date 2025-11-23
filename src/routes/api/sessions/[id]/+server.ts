import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// セッション削除（Soft Delete）
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
		// 1. セッション情報を取得
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('id, organization_id, name')
			.eq('id', sessionId)
			.is('deleted_at', null)
			.single();

		if (sessionError || !session) {
			return json({ error: 'セッションが見つかりません' }, { status: 404 });
		}

		// 2. 権限チェック: 実行ユーザーがセッションの組織の管理者かどうか確認
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

		// 3. Soft Delete実行
		const { error: deleteError } = await supabase
			.from('sessions')
			.update({
				deleted_at: new Date().toISOString(),
				deleted_by: user.id
			})
			.eq('id', sessionId);

		if (deleteError) {
			console.error('Delete error:', deleteError);
			return json({ error: 'セッションの削除に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'セッションを削除しました'
		});
	} catch (error: any) {
		console.error('Unexpected error:', error);
		return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
	}
};

// セッション復元
export const POST: RequestHandler = async ({ params, locals: { supabase } }) => {
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
			return json({ error: '削除されたセッションが見つかりません' }, { status: 404 });
		}

		// 2. 権限チェック: 実行ユーザーがセッションの組織の管理者かどうか確認
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

		// 3. 復元実行
		const { error: restoreError } = await supabase
			.from('sessions')
			.update({
				deleted_at: null,
				deleted_by: null
			})
			.eq('id', sessionId);

		if (restoreError) {
			console.error('Restore error:', restoreError);
			return json({ error: 'セッションの復元に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'セッションを復元しました'
		});
	} catch (error: any) {
		console.error('Unexpected error:', error);
		return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
	}
};
