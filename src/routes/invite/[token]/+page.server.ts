import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail, isRedirect, isHttpError } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SITE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * メールアドレスを正規化（小文字化 + トリム）
 * 大文字小文字の違いや前後の空白を吸収し、比較の一貫性を保つ
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

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

	// 組織所属チェック（軽量クエリ - カウントのみ）
	let hasOrganization = false;
	if (user) {
		const { count } = await supabaseAdmin
			.from('organization_members')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', user.id)
			.is('removed_at', null);

		hasOrganization = (count || 0) > 0;
	}

	return {
		invitation,
		organization: invitation.organizations,
		isLoggedIn: !!user,
		user,
		profile,
		hasOrganization
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

		// メールアドレスを正規化（大文字小文字、空白を統一）
		// signUp()にも正規化後のメールを渡すことで、データの一貫性を保つ
		const normalizedEmail = normalizeEmail(email);

		// 【セキュリティ】招待メールが指定されている場合、入力メールと一致するかチェック
		// 正規化して比較することで、大文字小文字の違いや空白による回避を防ぐ
		// メール確認フローを使用しているが、事前チェックとして招待メールとの一致も必須
		if (invitation.email && normalizeEmail(invitation.email) !== normalizedEmail) {
			console.warn('[Invite Signup] Email mismatch detected:', {
				invitationEmail: invitation.email,
				inputEmail: email,
				normalizedInvitation: normalizeEmail(invitation.email),
				normalizedInput: normalizedEmail,
				token
			});
			return fail(403, {
				error: 'この招待は別のメールアドレス宛です。招待されたメールアドレスを使用してください。'
			});
		}

		console.log('[Invite Signup] Email validation passed:', {
			hasInvitationEmail: !!invitation.email,
			originalEmail: email,
			normalizedEmail,
			token
		});

		try {
			// 【セキュリティ改善】通常のサインアップフローを使用してメール所有を確認
			// Supabase設定で "Confirm email" が有効な場合、session は null となりメール確認が必須
			// 正規化後のメールアドレスを使用することで、データの一貫性を保つ
			const { data: authData, error: authError } = await locals.supabase.auth.signUp({
				email: normalizedEmail,
				password,
				options: {
					data: {
						full_name: fullName,
						// 招待トークンをuser_metadataに保存（メール確認後に使用）
						invitation_token: token
					},
					// メール確認後、招待完了ページにリダイレクト
					emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/invite/${token}/complete`
				}
			});

			if (authError) {
				console.error('[Invite Signup] signUp error:', {
					code: authError.code,
					message: authError.message,
					status: (authError as any).status
				});

				// エラーコードベースの判定（文字列マッチングではなくコード判定）
				// Supabase Auth Error Codes: https://supabase.com/docs/guides/auth/debugging/error-codes
				if (authError.code === 'user_already_exists' ||
				    authError.code === 'email_exists') {
					// 既存ユーザー: メールアドレスが既に登録されている
					return fail(409, {
						error: 'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
					});
				}

				// その他のエラー
				console.error('[Invite Signup] Unexpected error code:', authError.code);
				return fail(500, { error: 'アカウントの作成に失敗しました' });
			}

			// Supabaseは既存ユーザーの場合、エラーなしで匿名化ユーザーを返す場合がある
			if (authData.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
				return fail(409, {
					error: 'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
				});
			}

			if (!authData.user) {
				return fail(500, { error: 'アカウントの作成に失敗しました' });
			}

			// 【セキュリティチェック】session が null であることを確認
			// session が存在する場合、Supabase設定でメール確認が無効になっている可能性がある
			if (authData.session) {
				console.error('[Invite Signup] SECURITY WARNING: Session was returned immediately after signup.', {
					userId: authData.user.id,
					email: authData.user.email,
					emailConfirmedAt: authData.user.email_confirmed_at,
					message: 'Supabase "Confirm email" setting may be disabled. Email ownership verification is required for security.'
				});
				return fail(500, {
					error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
				});
			}

			console.log('[Invite Signup] User created, email confirmation required:', {
				userId: authData.user.id,
				email: authData.user.email,
				hasSession: false,
				emailConfirmedAt: authData.user.email_confirmed_at
			});

			// メール確認ページにリダイレクト
			throw redirect(303, `/invite/${token}/check-email`);
		} catch (err: any) {
			if (isRedirect(err) || isHttpError(err)) {
				throw err;
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
			if (isRedirect(err) || isHttpError(err)) {
				throw err;
			}
			console.error('Join error:', err);
			return fail(500, { error: 'エラーが発生しました' });
		}
	}
};
