import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// メンバー削除（Soft Delete）
export const DELETE: RequestHandler = async ({ params, locals: { supabase } }) => {
	const { id: orgId, memberId } = params;

	// ユーザー認証チェック
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	try {
		// 1. 権限チェック: 実行ユーザーが組織の管理者かどうか確認
		const { data: executorMembership, error: executorError } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', orgId)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.single();

		if (executorError || !executorMembership) {
			return json({ error: 'この組織のメンバーではありません' }, { status: 403 });
		}

		if (executorMembership.role !== 'admin') {
			return json({ error: '管理者権限が必要です' }, { status: 403 });
		}

		// 2. 削除対象のメンバー情報を取得
		const { data: targetMember, error: targetError } = await supabase
			.from('organization_members')
			.select('id, user_id, role')
			.eq('id', memberId)
			.eq('organization_id', orgId)
			.is('removed_at', null)
			.single();

		if (targetError || !targetMember) {
			return json({ error: 'メンバーが見つかりません' }, { status: 404 });
		}

		// 3. 自分自身を削除しようとしていないかチェック
		if (targetMember.user_id === user.id) {
			return json({ error: '自分自身を削除することはできません' }, { status: 400 });
		}

		// 4. 最後の管理者チェック
		if (targetMember.role === 'admin') {
			const { count: adminCount, error: countError } = await supabase
				.from('organization_members')
				.select('*', { count: 'exact', head: true })
				.eq('organization_id', orgId)
				.eq('role', 'admin')
				.is('removed_at', null);

			if (countError) {
				console.error('Admin count error:', countError);
				return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
			}

			if (adminCount === 1) {
				return json(
					{
						error: '最後の管理者は削除できません。別のメンバーを管理者に昇格させてから削除してください。'
					},
					{ status: 400 }
				);
			}
		}

		// 5. Soft Delete実行
		const { error: deleteError } = await supabase
			.from('organization_members')
			.update({
				removed_at: new Date().toISOString(),
				removed_by: user.id
			})
			.eq('id', memberId);

		if (deleteError) {
			console.error('Delete error:', deleteError);
			return json({ error: 'メンバーの削除に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'メンバーを削除しました'
		});
	} catch (error: any) {
		console.error('Unexpected error:', error);
		return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
	}
};

// メンバー復元（オプション機能）
export const POST: RequestHandler = async ({ params, locals: { supabase } }) => {
	const { id: orgId, memberId } = params;

	// ユーザー認証チェック
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	try {
		// 1. 権限チェック: 実行ユーザーが組織の管理者かどうか確認
		const { data: executorMembership, error: executorError } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', orgId)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.single();

		if (executorError || !executorMembership) {
			return json({ error: 'この組織のメンバーではありません' }, { status: 403 });
		}

		if (executorMembership.role !== 'admin') {
			return json({ error: '管理者権限が必要です' }, { status: 403 });
		}

		// 2. 復元対象のメンバー情報を取得（削除済みのみ）
		const { data: targetMember, error: targetError } = await supabase
			.from('organization_members')
			.select('id, user_id, role')
			.eq('id', memberId)
			.eq('organization_id', orgId)
			.not('removed_at', 'is', null)
			.single();

		if (targetError || !targetMember) {
			return json({ error: '削除されたメンバーが見つかりません' }, { status: 404 });
		}

		// 3. 復元実行
		const { error: restoreError } = await supabase
			.from('organization_members')
			.update({
				removed_at: null,
				removed_by: null
			})
			.eq('id', memberId);

		if (restoreError) {
			console.error('Restore error:', restoreError);
			return json({ error: 'メンバーの復元に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'メンバーを復元しました'
		});
	} catch (error: any) {
		console.error('Unexpected error:', error);
		return json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
	}
};
