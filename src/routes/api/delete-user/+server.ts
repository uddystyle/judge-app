import { createClient } from '@supabase/supabase-js';
import { json, error as svelteError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { stripe } from '$lib/server/stripe';
import { computeOwnershipReassign } from '$lib/server/sessionOwnership';

// 稼働中とみなすサブスクリプションのステータス
const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

export async function POST({ request }) {
	// レート制限チェックを最初に実行
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.expensive);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	// Initialize the Supabase Admin Client
	const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		throw svelteError(500, 'サーバー設定エラー: Supabase環境変数が設定されていません。');
	}

	const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

	const { userToken } = await request.json();
	if (!userToken) {
		throw svelteError(401, '認証トークンが必要です。');
	}

	// Get the user object from the provided token（トークン所有者=削除対象を検証）
	const {
		data: { user },
		error: userError
	} = await supabaseAdmin.auth.getUser(userToken);

	if (userError || !user) {
		throw svelteError(404, 'ユーザーが見つかりません。');
	}

	// ============================================================
	// ガード: 稼働中の有料サブスクを持つ組織の「唯一の管理者」は削除をブロック
	// （アカウント削除が組織を孤児化し、解約できないまま課金が継続するのを防ぐ）
	// ============================================================
	const { data: adminMemberships, error: adminError } = await supabaseAdmin
		.from('organization_members')
		.select('organization_id')
		.eq('user_id', user.id)
		.eq('role', 'admin')
		.is('removed_at', null);

	if (adminError) {
		console.error('[delete-user] 管理メンバーシップ取得エラー:', adminError.message);
		throw svelteError(500, 'アカウント情報の確認に失敗しました。');
	}

	const adminOrgIds = (adminMemberships ?? []).map((m) => m.organization_id);

	if (adminOrgIds.length > 0) {
		// 管理対象組織のうち、稼働中サブスクを持つものを特定
		const { data: activeOrgSubs, error: orgSubError } = await supabaseAdmin
			.from('subscriptions')
			.select('organization_id')
			.in('organization_id', adminOrgIds)
			.in('status', ACTIVE_SUB_STATUSES);

		if (orgSubError) {
			console.error('[delete-user] 組織サブスク取得エラー:', orgSubError.message);
			throw svelteError(500, 'アカウント情報の確認に失敗しました。');
		}

		const billingActiveOrgIds = Array.from(
			new Set((activeOrgSubs ?? []).map((s) => s.organization_id).filter(Boolean))
		);

		const blockingOrgNames: string[] = [];
		for (const orgId of billingActiveOrgIds) {
			// この組織の有効な管理者数を数える
			const { count: adminCount, error: countError } = await supabaseAdmin
				.from('organization_members')
				.select('id', { count: 'exact', head: true })
				.eq('organization_id', orgId)
				.eq('role', 'admin')
				.is('removed_at', null);

			if (countError) {
				console.error('[delete-user] 管理者数カウントエラー:', countError.message);
				throw svelteError(500, 'アカウント情報の確認に失敗しました。');
			}

			// 自分が唯一の管理者の場合のみブロック対象
			if ((adminCount ?? 0) <= 1) {
				const { data: org } = await supabaseAdmin
					.from('organizations')
					.select('name')
					.eq('id', orgId)
					.single();
				blockingOrgNames.push(org?.name || orgId);
			}
		}

		if (blockingOrgNames.length > 0) {
			// 409 Conflict: ユーザーに先に解約/管理者委譲を促す（破壊的処理は行わない）
			throw svelteError(
				409,
				`有料プランの組織（${blockingOrgNames.join('、')}）の唯一の管理者であるため、アカウントを削除できません。` +
					`先に該当組織のプランを解約するか、別のメンバーを管理者に設定してから再度お試しください。`
			);
		}
	}

	// ============================================================
	// 個人サブスクリプション（組織に紐づかないもの）を Stripe で解約
	// （DB行は auth.users 削除でカスケードされるが、Stripe 側は別途解約が必要）
	// ============================================================
	const { data: personalSubs, error: personalSubError } = await supabaseAdmin
		.from('subscriptions')
		.select('stripe_subscription_id, status')
		.eq('user_id', user.id)
		.is('organization_id', null)
		.in('status', ACTIVE_SUB_STATUSES)
		.not('stripe_subscription_id', 'is', null);

	if (personalSubError) {
		console.error('[delete-user] 個人サブスク取得エラー:', personalSubError.message);
		throw svelteError(500, 'アカウント情報の確認に失敗しました。');
	}

	for (const sub of personalSubs ?? []) {
		if (!sub.stripe_subscription_id) continue;
		try {
			await stripe.subscriptions.cancel(sub.stripe_subscription_id);
			console.log('[delete-user] 個人サブスクを解約:', sub.stripe_subscription_id);
		} catch (err: any) {
			// 既に解約済み/存在しない場合は成功扱いで継続
			if (err?.code === 'resource_missing') {
				console.warn(
					'[delete-user] サブスクは既に存在しません（解約済み扱い）:',
					sub.stripe_subscription_id
				);
				continue;
			}
			// それ以外の Stripe エラーは削除を中断（課金継続を防ぐため）
			console.error('[delete-user] サブスク解約失敗:', err?.message);
			throw svelteError(
				500,
				'サブスクリプションの解約に失敗したため、アカウントを削除できませんでした。時間をおいて再度お試しください。'
			);
		}
	}

	// ============================================================
	// セッションの所有権（主任検定員 / 作成者）を残存メンバーへ引き継ぐ
	// 削除済みユーザーの UUID が sessions.chief_judge_id / created_by にダングリングで残り、
	// 採点制御・検定員管理が不能になるのを防ぐ（best-effort: 失敗しても削除は継続）。
	// ============================================================
	try {
		const { data: ownedSessions, error: ownedError } = await supabaseAdmin
			.from('sessions')
			.select('id, chief_judge_id, created_by')
			.or(`chief_judge_id.eq.${user.id},created_by.eq.${user.id}`);

		if (ownedError) {
			console.error('[delete-user] 所有セッション取得エラー:', ownedError.message);
		} else {
			for (const session of ownedSessions ?? []) {
				// 残存する非ゲストメンバーを1名（引き継ぎ先）
				const { data: replacement } = await supabaseAdmin
					.from('session_participants')
					.select('user_id')
					.eq('session_id', session.id)
					.eq('is_guest', false)
					.neq('user_id', user.id)
					.not('user_id', 'is', null)
					.order('id', { ascending: true })
					.limit(1)
					.maybeSingle();

				const update = computeOwnershipReassign(session, user.id, replacement?.user_id ?? null);

				if (Object.keys(update).length > 0) {
					const { error: reassignError } = await supabaseAdmin
						.from('sessions')
						.update(update)
						.eq('id', session.id);
					if (reassignError) {
						console.error('[delete-user] 所有権引き継ぎエラー:', session.id, reassignError.message);
					}
				}
			}
		}
	} catch (err) {
		// best-effort: 引き継ぎ失敗でアカウント削除はブロックしない
		console.error(
			'[delete-user] 所有権引き継ぎ処理で例外:',
			err instanceof Error ? err.message : String(err)
		);
	}

	// ============================================================
	// ユーザーを削除（関連データは FK の ON DELETE CASCADE で削除される）
	// ============================================================
	const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

	if (deleteError) {
		console.error('Supabase delete user error:', deleteError.message);
		throw svelteError(500, 'アカウントの削除に失敗しました。');
	}

	return json({ success: true, message: 'アカウントが正常に削除されました。' });
}
