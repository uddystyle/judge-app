import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { processScoreMutation, type ScoreMutationInput } from '$lib/server/scoreSync';
import { logger } from '$lib/server/logger';

/**
 * オフライン採点の同期 API（network-resilience-strategy.md Phase 2）
 *
 * リクエスト:  { mutations: ScoreMutationInput[] }（最大 50 件）
 * レスポンス:  { accepted: string[], rejected: [{ client_mutation_id, reason }] }
 *
 * 冪等: 同じ client_mutation_id の再送は記録済みの結果を返す。
 * rejected のうち RETRYABLE_REASONS（auth_required / save_failed）は
 * クライアント側でキューに保持して再送してよい（$lib/server/scoreSync.ts 参照）。
 */

const MAX_BATCH_SIZE = 50;

export const POST: RequestHandler = async ({ request, locals: { supabase, supabaseAdmin } }) => {
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	if (!supabaseAdmin) {
		logger.error('[sync/scores] supabaseAdmin が未設定です');
		return json({ error: 'サーバー設定エラー' }, { status: 500 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'リクエストボディが不正です' }, { status: 400 });
	}

	const mutations = (body as { mutations?: unknown })?.mutations;
	if (!Array.isArray(mutations) || mutations.length === 0) {
		return json({ error: 'mutations 配列が必要です' }, { status: 400 });
	}
	if (mutations.length > MAX_BATCH_SIZE) {
		return json({ error: `mutations は最大 ${MAX_BATCH_SIZE} 件です` }, { status: 400 });
	}

	const accepted: string[] = [];
	const rejected: { client_mutation_id: string; reason: string }[] = [];

	// 逐次処理（同一審判の連続採点が多く、並列化すると owner upsert が競合しやすいため）
	for (const raw of mutations) {
		const mutation = (raw ?? {}) as ScoreMutationInput;
		const id = typeof mutation.client_mutation_id === 'string' ? mutation.client_mutation_id : '';

		const outcome = await processScoreMutation(supabase, supabaseAdmin, mutation);

		if (outcome.accepted) {
			accepted.push(id);
		} else {
			rejected.push({ client_mutation_id: id, reason: outcome.reason });
		}
	}

	logger.debug('[sync/scores] 処理完了:', {
		total: mutations.length,
		accepted: accepted.length,
		rejected: rejected.length
	});

	return json({ accepted, rejected });
};
