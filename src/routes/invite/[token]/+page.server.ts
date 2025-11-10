import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const load: PageServerLoad = async ({ params, locals }) => {
	const token = params.token;

	console.log('[Invite Page] Loading invitation with token:', token);

	// 招待情報を取得（RLSをバイパスするためsupabaseAdminを使用）
	const { data: invitation, error: inviteError} = await supabaseAdmin
		.from('invitations')
		.select(
			`
			*,
			organizations!organization_id (
				id,
				name,
				plan_type
			)
		`
		)
		.eq('token', token)
		.single();

	if (inviteError) {
		console.error('[Invite Page] Error fetching invitation:', inviteError);
		throw error(404, '招待が見つかりません');
	}

	if (!invitation) {
		console.error('[Invite Page] No invitation found for token:', token);
		throw error(404, '招待が見つかりません');
	}

	console.log('[Invite Page] Invitation found:', invitation);

	// 有効期限チェック
	if (new Date(invitation.expires_at) < new Date()) {
		throw error(410, '招待の有効期限が切れています');
	}

	// 使用制限チェック
	if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
		throw error(410, '招待の使用回数が上限に達しています');
	}

	// すでにログイン済みかチェック
	const { data: { user } } = await locals.supabase.auth.getUser();

	// ユーザーのプロフィール情報を取得（ログイン済みの場合のみ）
	let profile = null;
	if (user) {
		const { data: profileData } = await supabaseAdmin
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		profile = profileData;

		// ログイン済みの場合、すでに組織のメンバーかチェック
		const { data: existingMembership } = await supabaseAdmin
			.from('organization_members')
			.select('id')
			.eq('organization_id', invitation.organizations.id)
			.eq('user_id', user.id)
			.single();

		if (existingMembership) {
			throw redirect(303, `/organization/${invitation.organizations.id}`);
		}
	}

	return {
		invitation,
		organization: invitation.organizations,
		isLoggedIn: !!user,
		user,
		profile
	};
};

export const actions: Actions = {
	signup: async ({ request, params, locals }) => {
		const token = params.token;
		const formData = await request.formData();
		const email = formData.get('email')?.toString();
		const password = formData.get('password')?.toString();
		const fullName = formData.get('fullName')?.toString();

		// バリデーション
		if (!email || !password || !fullName) {
			return fail(400, { error: 'すべてのフィールドを入力してください' });
		}

		// 招待情報を取得
		const { data: invitation } = await supabaseAdmin
			.from('invitations')
			.select('*, organizations(*)')
			.eq('token', token)
			.single();

		if (!invitation || new Date(invitation.expires_at) < new Date()) {
			return fail(400, { error: '無効な招待です' });
		}

		try {
			// ユーザーアカウントを作成
			const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
				email,
				password,
				email_confirm: true
			});

			if (authError || !authData.user) {
				console.error('Error creating user:', authError);
				return fail(500, { error: 'アカウントの作成に失敗しました' });
			}

			const userId = authData.user.id;

			// プロフィールを作成
			const { error: profileError } = await supabaseAdmin.from('profiles').insert({
				id: userId,
				email,
				full_name: fullName
			});

			if (profileError) {
				console.error('Error creating profile:', profileError);
			}

			// 組織メンバーとして追加
			const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
				organization_id: invitation.organization_id,
				user_id: userId,
				role: invitation.role
			});

			if (memberError) {
				console.error('Error adding member:', memberError);
				return fail(500, { error: '組織への追加に失敗しました' });
			}

			// 招待の使用回数を更新
			await supabaseAdmin
				.from('invitations')
				.update({ used_count: invitation.used_count + 1 })
				.eq('id', invitation.id);

			// 招待使用履歴を記録
			await supabaseAdmin.from('invitation_uses').insert({
				invitation_id: invitation.id,
				user_id: userId
			});

			// ログイン処理
			const { error: signInError } = await locals.supabase.auth.signInWithPassword({
				email,
				password
			});

			if (signInError) {
				console.error('Error signing in:', signInError);
				return fail(500, { error: 'ログインに失敗しました' });
			}

			// 組織ページにリダイレクト
			throw redirect(303, `/organization/${invitation.organization_id}`);
		} catch (err: any) {
			if (err.status === 303) {
				throw err; // リダイレクトはそのまま投げる
			}
			console.error('Signup error:', err);
			return fail(500, { error: 'エラーが発生しました' });
		}
	},

	join: async ({ params, locals }) => {
		const token = params.token;

		// 認証チェック
		const {
			data: { user },
			error: userError
		} = await locals.supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: 'ログインが必要です' });
		}

		// 招待情報を取得
		const { data: invitation } = await supabaseAdmin
			.from('invitations')
			.select('*')
			.eq('token', token)
			.single();

		if (!invitation || new Date(invitation.expires_at) < new Date()) {
			return fail(400, { error: '無効な招待です' });
		}

		// すでにメンバーかチェック
		const { data: existingMembership } = await supabaseAdmin
			.from('organization_members')
			.select('id')
			.eq('organization_id', invitation.organization_id)
			.eq('user_id', user.id)
			.single();

		if (existingMembership) {
			throw redirect(303, `/organization/${invitation.organization_id}`);
		}

		try {
			// 組織メンバーとして追加
			const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
				organization_id: invitation.organization_id,
				user_id: user.id,
				role: invitation.role
			});

			if (memberError) {
				console.error('Error adding member:', memberError);
				return fail(500, { error: '組織への追加に失敗しました' });
			}

			// 招待の使用回数を更新
			await supabaseAdmin
				.from('invitations')
				.update({ used_count: invitation.used_count + 1 })
				.eq('id', invitation.id);

			// 招待使用履歴を記録
			await supabaseAdmin.from('invitation_uses').insert({
				invitation_id: invitation.id,
				user_id: user.id
			});

			// 組織ページにリダイレクト
			throw redirect(303, `/organization/${invitation.organization_id}`);
		} catch (err: any) {
			if (err.status === 303) {
				throw err;
			}
			console.error('Join error:', err);
			return fail(500, { error: 'エラーが発生しました' });
		}
	}
};
