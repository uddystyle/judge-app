import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail, isRedirect, isHttpError } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SITE_URL } from '$env/static/public';
import { validateEmail, validateName, validatePassword } from '$lib/server/validation';
import { checkCanAddMember } from '$lib/server/organizationLimits';
import { logger } from '$lib/server/logger';
import { joinOrRestoreMember } from '$lib/server/orgMembership';
import {
	getInvitationByToken,
	getInvitationInvalidReason,
	isInvitationEmailAllowed,
	normalizeEmail,
	claimInvitationUse,
	releaseInvitationUse
} from '$lib/server/invitations';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const load: PageServerLoad = async ({ params, locals }) => {
	const token = params.token!;

	// ⚠️ token はそのまま組織参加に使える資格情報。ログに出さない
	// （DB から平文を消した意味が無くなる）。追跡は招待IDで行う。
	logger.debug('[Invite Page] Loading invitation');

	// 招待情報を取得（RLSをバイパスするためsupabaseAdminを使用）
	const { invitation, error: inviteError } = await getInvitationByToken(supabaseAdmin, token);

	if (inviteError) {
		logger.error('[Invite Page] Error fetching invitation:', inviteError);
		throw error(404, '招待が見つかりません');
	}

	if (!invitation) {
		logger.error('[Invite Page] No invitation found for the presented token');
		throw error(404, '招待が見つかりません');
	}

	logger.debug('[Invite Page] Invitation found:', {
		invitationId: invitation.id,
		organizationId: invitation.organization_id,
		role: invitation.role
	});

	const invalidReason = getInvitationInvalidReason(invitation);
	if (invalidReason) {
		throw error(410, invalidReason);
	}

	// すでにログイン済みかチェック
	const {
		data: { user }
	} = await locals.supabase.auth.getUser();

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
		// 在籍中のみリダイレクト。退会済みは招待から再参加できるようにする
		// （removed_at で絞らないと、一度退会した人が招待を受諾できない）
		const { data: existingMembership } = await supabaseAdmin
			.from('organization_members')
			.select('id')
			.eq('organization_id', invitation.organizations.id)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.maybeSingle();

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
		const token = params.token!;
		const formData = await request.formData();
		const email = formData.get('email')?.toString();
		const password = formData.get('password')?.toString();
		const fullName = formData.get('fullName')?.toString();

		// バリデーション
		// 共通バリデーション関数を使用（XSS対策、長さチェック、形式チェック）
		const nameValidation = validateName(fullName);
		if (!nameValidation.valid) {
			return fail(400, { error: nameValidation.error });
		}

		const emailValidation = validateEmail(email);
		if (!emailValidation.valid) {
			return fail(400, { error: emailValidation.error });
		}

		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return fail(400, { error: passwordValidation.error });
		}

		// サニタイズされた値を使用（XSS対策）
		const sanitizedFullName = nameValidation.sanitized!;
		const sanitizedEmail = emailValidation.sanitized!;

		// 招待情報を取得
		const { invitation } = await getInvitationByToken(supabaseAdmin, token);

		const invalidReason = getInvitationInvalidReason(invitation);
		if (invalidReason) {
			return fail(400, { error: invalidReason });
		}

		// メールアドレスを正規化（大文字小文字、空白を統一）
		// signUp()にも正規化後のメールを渡すことで、データの一貫性を保つ
		const normalizedEmail = normalizeEmail(sanitizedEmail);

		// 【セキュリティ】招待メールが指定されている場合、入力メールと一致するかチェック
		// 正規化して比較することで、大文字小文字の違いや空白による回避を防ぐ
		// メール確認フローを使用しているが、事前チェックとして招待メールとの一致も必須
		if (invitation.email && normalizeEmail(invitation.email) !== normalizedEmail) {
			logger.warn('[Invite Signup] Email mismatch detected:', {
				invitationEmail: invitation.email,
				inputEmail: email,
				sanitizedEmail,
				normalizedInvitation: normalizeEmail(invitation.email),
				normalizedInput: normalizedEmail,
				invitationId: invitation.id
			});
			return fail(403, {
				error: 'この招待は別のメールアドレス宛です。招待されたメールアドレスを使用してください。'
			});
		}

		logger.debug('[Invite Signup] Email validation passed:', {
			hasInvitationEmail: !!invitation.email,
			originalEmail: email,
			sanitizedEmail,
			normalizedEmail,
			invitationId: invitation.id
		});

		try {
			// 【セキュリティ改善】通常のサインアップフローを使用してメール所有を確認
			// Supabase設定で "Confirm email" が有効な場合、session は null となりメール確認が必須
			// 正規化後のメールアドレスを使用することで、データの一貫性を保つ
			const { data: authData, error: authError } = await locals.supabase.auth.signUp({
				email: normalizedEmail,
				password: password!,
				options: {
					data: {
						full_name: sanitizedFullName,
						// 招待トークンをuser_metadataに保存（メール確認後に使用）
						invitation_token: token
					},
					// メール確認後、招待完了ページにリダイレクト
					emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/invite/${token}/complete`
				}
			});

			if (authError) {
				logger.error('[Invite Signup] signUp error:', {
					code: authError.code,
					message: authError.message,
					status: (authError as any).status
				});

				// エラーコードベースの判定（推奨）
				// Supabase Auth Error Codes: https://supabase.com/docs/guides/auth/debugging/error-codes
				if (authError.code === 'user_already_exists' || authError.code === 'email_exists') {
					// 既存ユーザー: メールアドレスが既に登録されている
					return fail(409, {
						error:
							'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
					});
				}

				// フォールバック: error.code が設定されていない場合、message で判定
				// code が設定されている場合は、このブロックは実行されない
				if (!authError.code || authError.code === '') {
					const message = authError.message?.toLowerCase() || '';

					// 既存ユーザーを示す具体的なメッセージパターン
					if (
						message.includes('already registered') ||
						message.includes('already exists') ||
						message.includes('already been registered')
					) {
						logger.warn(
							'[Invite Signup] Detected existing user via message fallback:',
							authError.message
						);
						return fail(409, {
							error:
								'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
						});
					}
				}

				// その他の予期しないエラー
				logger.error('[Invite Signup] Unexpected error code:', authError.code);
				return fail(500, { error: 'アカウントの作成に失敗しました' });
			}

			// Supabaseは既存ユーザーの場合、エラーなしで匿名化ユーザーを返す場合がある
			if (
				authData.user &&
				Array.isArray(authData.user.identities) &&
				authData.user.identities.length === 0
			) {
				return fail(409, {
					error:
						'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
				});
			}

			if (!authData.user) {
				return fail(500, { error: 'アカウントの作成に失敗しました' });
			}

			// 【セキュリティチェック】session が null であることを確認
			// session が存在する場合、Supabase設定でメール確認が無効になっている可能性がある
			if (authData.session) {
				logger.error(
					'[Invite Signup] SECURITY WARNING: Session was returned immediately after signup.',
					{
						userId: authData.user.id,
						email: authData.user.email,
						emailConfirmedAt: authData.user.email_confirmed_at,
						message:
							'Supabase "Confirm email" setting may be disabled. Email ownership verification is required for security.'
					}
				);
				return fail(500, {
					error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
				});
			}

			logger.debug('[Invite Signup] User created, email confirmation required:', {
				hasSession: false,
				emailConfirmedAt: authData.user.email_confirmed_at
				// userId と email は個人情報のため出力しない（GDPR/プライバシー保護）
			});

			// メール確認ページにリダイレクト
			throw redirect(303, `/invite/${token}/check-email`);
		} catch (err: any) {
			if (isRedirect(err) || isHttpError(err)) {
				throw err;
			}
			logger.error('Signup error:', err);
			return fail(500, { error: 'エラーが発生しました' });
		}
	},

	join: async ({ params, locals }) => {
		const token = params.token!;

		// 認証チェック
		const {
			data: { user },
			error: userError
		} = await locals.supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: 'ログインが必要です' });
		}

		// 招待情報を取得
		const { invitation } = await getInvitationByToken(supabaseAdmin, token);

		const invalidReason = getInvitationInvalidReason(invitation);
		if (invalidReason) {
			return fail(400, { error: invalidReason });
		}

		if (!isInvitationEmailAllowed(invitation, user.email)) {
			logger.warn('[Invite Join] Email mismatch detected:', {
				hasInvitationEmail: !!invitation.email,
				userId: user.id,
				invitationId: invitation.id
			});
			return fail(403, {
				error:
					'この招待は別のメールアドレス宛です。招待されたメールアドレスでログインしてください。'
			});
		}

		// 在籍中のみ弾く。退会済みは下の joinOrRestoreMember が復帰として扱う
		const { data: existingMembership } = await supabaseAdmin
			.from('organization_members')
			.select('id')
			.eq('organization_id', invitation.organization_id)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.maybeSingle();

		if (existingMembership) {
			throw redirect(303, `/organization/${invitation.organization_id}`);
		}

		// メンバー上限チェック（招待「作成」時だけでなく「受諾」時にも強制する。
		// complete フロー（メール確認経由）と同じガード）
		const memberLimitCheck = await checkCanAddMember(supabaseAdmin, invitation.organization_id);
		if (!memberLimitCheck.allowed) {
			logger.warn('[Invite Join] メンバー上限により参加拒否:', memberLimitCheck.reason);
			return fail(403, {
				error: memberLimitCheck.reason || '組織のメンバー数が上限に達しています。'
			});
		}

		try {
			// 組織メンバーとして追加（退会済みなら復帰）。
			// UNIQUE (organization_id, user_id) があるため単純な INSERT では
			// 再参加が一意制約違反になる。
			//
			// ⚠️ 復帰時の role は退会前の値を復活させない。招待の role をそのまま使う。
			// 復活させると、退会前に admin だった人が招待リンク経由で admin として戻り、
			// 招待した側が意図しない権限を与えてしまう。
			// 使用権はメンバー追加より**先**に確定する。後から数えると、
			// 上限を超えた参加が成立したあとで気づくことになる。
			const claim = await claimInvitationUse(supabaseAdmin, invitation);
			if (!claim.claimed) {
				return fail(400, { error: '招待の使用回数が上限に達しています' });
			}

			const memberResult = await joinOrRestoreMember(supabaseAdmin, {
				organizationId: invitation.organization_id,
				userId: user.id,
				role: invitation.role === 'admin' ? 'admin' : 'member'
			});

			if (!memberResult.ok) {
				// 使用権は追加より先に確定しているので、追加が成立しなかったら必ず戻す。
				// 「既に在籍中」もメンバーが増えていない以上は同じで、戻さないと
				// 残り回数だけが減る（complete 経路は戻しているので挙動を揃える）。
				await releaseInvitationUse(supabaseAdmin, invitation);

				if (!memberResult.alreadyMember) {
					return fail(500, { error: '組織への追加に失敗しました' });
				}
			}

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
			logger.error('Join error:', err);
			return fail(500, { error: 'エラーが発生しました' });
		}
	}
};
