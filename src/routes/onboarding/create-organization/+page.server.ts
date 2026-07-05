import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { validateOrganizationName } from '$lib/server/validation';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 複数組織対応: 組織作成制限を削除
	// ユーザーは複数の組織を作成・所属できる

	// プラン一覧を取得
	const { data: plans } = await supabase
		.from('plan_limits')
		.select('*')
		.order('max_organization_members', { ascending: true });

	// ユーザーのプロフィール情報を取得
	const { data: profile, error: profileError } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.maybeSingle();

	// プロフィールがまだ作成されていない場合は作成
	if (profileError || !profile) {
		logger.debug('[onboarding/load] プロフィールが存在しないため作成します:', user.id);
		const { error: createProfileError } = await supabase.from('profiles').insert({
			id: user.id,
			full_name: user.user_metadata?.full_name || ''
		});

		// エラーコード23505（unique constraint violation）は無視（既にプロフィールが存在する場合）
		if (createProfileError && createProfileError.code !== '23505') {
			logger.error('[onboarding/load] プロフィール作成エラー:', createProfileError);
		}
	}

	// 組織所属チェック（軽量クエリ - カウントのみ）
	const { count } = await supabase
		.from('organization_members')
		.select('*', { count: 'exact', head: true })
		.eq('user_id', user.id)
		.is('removed_at', null);

	const hasOrganization = (count || 0) > 0;

	return {
		user,
		profile: profile || { full_name: user.user_metadata?.full_name || '' },
		plans: plans || [],
		hasOrganization
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { supabase, supabaseAdmin } = locals;
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const organizationNameRaw = formData.get('organizationName') as string;
		const planType = (formData.get('planType') as string) || 'free';
		const couponCode = formData.get('couponCode') as string | null;

		// バリデーション（XSS対策を含む）
		const validation = validateOrganizationName(organizationNameRaw);
		if (!validation.valid) {
			return fail(400, {
				organizationName: organizationNameRaw || '',
				error: validation.error || '組織名が無効です。'
			});
		}

		const organizationName = validation.sanitized!;

		// プランタイプのバリデーション（SQLインジェクション対策）
		const validPlanTypes = ['free', 'basic', 'standard', 'premium'];
		if (!validPlanTypes.includes(planType)) {
			return fail(400, {
				organizationName,
				error: '無効なプランが選択されました。'
			});
		}

		// 選択されたプランの制限値を取得
		const { data: planLimits, error: planError } = await supabase
			.from('plan_limits')
			.select('max_organization_members')
			.eq('plan_type', planType)
			.single();

		if (planError || !planLimits) {
			logger.error('Failed to fetch plan limits:', planError);
			return fail(400, {
				organizationName,
				error: 'プラン情報の取得に失敗しました。'
			});
		}

		// 組織を作成
		// NOTE: 有料プランの場合、upgrade画面でプランを変更する可能性があるため、
		// 一旦freeプランとして作成し、Stripe決済完了後のwebhookで正しいプランに更新される
		// 作成直後は呼び出し元がまだ membership を持たないため、organizations の member スコープ
		// RLS（1016）では INSERT...RETURNING(.select()) を読み戻せない。service role で作成する。
		if (!supabaseAdmin) {
			logger.error(
				'[Create Org] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
			);
			return fail(500, {
				organizationName,
				error: 'サーバー設定エラーにより組織を作成できませんでした。管理者に連絡してください。'
			});
		}
		const { data: organization, error: orgError } = await supabaseAdmin
			.from('organizations')
			.insert({
				name: organizationName,
				plan_type: 'free',
				max_members: planType === 'free' ? planLimits.max_organization_members : 1
			})
			.select()
			.single();

		if (orgError) {
			logger.error('Failed to create organization:', orgError);
			return fail(500, {
				organizationName,
				error: `サーバーエラー: 組織の作成に失敗しました。[${orgError.code}] ${orgError.message}`
			});
		}

		// ユーザーを組織の管理者として追加
		const { error: memberError } = await supabase.from('organization_members').insert({
			organization_id: organization.id,
			user_id: user.id,
			role: 'admin'
		});

		if (memberError) {
			logger.error('Failed to add organization member:', memberError);
			return fail(500, {
				organizationName,
				error: `サーバーエラー: 組織への参加に失敗しました。[${memberError.code}] ${memberError.message}`
			});
		}

		logger.debug('[create] 組織作成完了:', organization.id, planType);

		// プランに応じてリダイレクト
		if (planType === 'free') {
			// フリープランの場合はダッシュボードへ
			throw redirect(303, '/dashboard');
		} else {
			// 有料プランの場合はアップグレード画面へ（選択したプランとクーポンをURLパラメータで渡す）
			let upgradeUrl = `/organization/${organization.id}/upgrade?plan=${planType}`;
			if (couponCode) {
				upgradeUrl += `&coupon=${encodeURIComponent(couponCode)}`;
			}
			throw redirect(303, upgradeUrl);
		}
	}
};
