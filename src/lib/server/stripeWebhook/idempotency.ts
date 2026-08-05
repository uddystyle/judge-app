import { supabaseAdmin, RetryableError } from './shared';
import { logger } from '$lib/server/logger';

/**
 * M-2: Stripe Webhook の冪等化
 *
 * Stripe はイベントを「少なくとも1回」配信し、順序も保証しない。
 * さらに 2xx 以外は最大3日間再送されるため、同一 event.id が複数回届くのは通常運用。
 * ハンドラの多くは UPSERT で冪等だが、組織アップグレード経路は Stripe 側の
 * `subscriptions.list()` → `cancel()` を伴い純粋な冪等ではない。
 *
 * ⚠️ **「処理を始めた」と「処理を終えた」を区別すること。**
 * 最初の実装（migration 1030 時点）は本処理の前に INSERT し、その瞬間から
 * 同じ event.id を処理済みと判定していた。失敗時は catch で行を消す作りだったため、
 * **catch を通らない終了**では記録だけが残る:
 *   INSERT 成功 → 本処理中に Vercel の maxDuration(10s) 超過 / プロセス強制終了 /
 *   デプロイによる入れ替え → Stripe が再送 → 「処理済み」と判定 →
 *   **そのイベントは二度と処理されない**（＝課金イベントの永久消失）。
 * とくに組織アップグレード経路は list + 複数 cancel を伴い 10 秒に迫りやすい。
 *
 * そこで状態とリース期限を持たせ、**永久スキップするのは completed と dropped だけ**にした。
 * processing のままリースが切れた行は、異常終了とみなして再取得できる。
 *
 * 記録先の `stripe_events` は RLS 有効・ポリシー無し＝service role 専用
 * （migration 1030 で作成、1031 で status / claimed_at / failure_reason を追加）。
 */

/** PostgreSQL の一意制約違反 */
const UNIQUE_VIOLATION = '23505';
/** PostgreSQL の undefined_table（migration 未適用） */
const UNDEFINED_TABLE = '42P01';

/**
 * 処理権の有効期間。
 *
 * Vercel の maxDuration は 10 秒（svelte.config.js）なので、実行中の処理が
 * リース切れになることはあり得ない。ハード上限の数倍を取って 60 秒とする。
 * maxDuration を伸ばす場合はここも必ず見直すこと。
 */
export const LEASE_MS = 60_000;

export type EventClaim = { alreadyProcessed: boolean };

const SKIP: EventClaim = { alreadyProcessed: true };
const PROCEED: EventClaim = { alreadyProcessed: false };

/**
 * イベントの処理権を獲得する。
 *
 * INSERT の成否で判定するため、同時に複数の配信が届いても実際に処理するのは1つだけになる
 * （SELECT してから INSERT する方式と違い競合しない）。
 *
 * @returns alreadyProcessed=true なら処理をスキップすること
 */
export async function claimStripeEvent(eventId: string, eventType: string): Promise<EventClaim> {
	const { error } = await supabaseAdmin.from('stripe_events').insert({
		event_id: eventId,
		event_type: eventType,
		status: 'processing',
		claimed_at: new Date().toISOString()
	});

	if (!error) return PROCEED;

	// テーブル未作成（migration 未適用）でも課金処理は止めない。
	// 冪等性は失われるので error で可視化する。
	if (error.code === UNDEFINED_TABLE) {
		logger.error(
			'[Webhook] stripe_events テーブルがありません（migration 1030/1031 未適用）。冪等化なしで続行します:',
			eventId
		);
		return PROCEED;
	}

	if (error.code !== UNIQUE_VIOLATION) {
		// 一時障害の可能性が高い。再送させる。
		logger.error('[Webhook] stripe_events への記録に失敗:', error);
		throw new RetryableError(`イベント記録エラー: ${error.message}`);
	}

	// --- ここから先は「既に行がある」ケース ---
	const { data: existing, error: fetchError } = await supabaseAdmin
		.from('stripe_events')
		.select('status, claimed_at')
		.eq('event_id', eventId)
		.maybeSingle();

	if (fetchError) {
		logger.error('[Webhook] stripe_events の状態取得に失敗:', fetchError);
		throw new RetryableError(`イベント状態取得エラー: ${fetchError.message}`);
	}

	// 行が消えている（別プロセスが release した直後）なら、次の再送に任せる
	if (!existing) {
		logger.debug('[Webhook] 記録が見つからないため再送に任せます:', eventId);
		return SKIP;
	}

	// 完了済み・破棄確定は永久スキップしてよい
	if (existing.status === 'completed' || existing.status === 'dropped') {
		logger.debug('[Webhook] 処理済みイベントのためスキップ:', eventId, existing.status);
		return SKIP;
	}

	// processing: リースが生きていれば別配信が処理中なのでスキップ
	const claimedAt = new Date(existing.claimed_at).getTime();
	const leaseExpired = Number.isFinite(claimedAt) && Date.now() - claimedAt > LEASE_MS;

	if (!leaseExpired) {
		logger.debug('[Webhook] 別の配信が処理中のためスキップ:', eventId);
		return SKIP;
	}

	// リース切れ = 前回の処理が catch を通らずに死んだ。処理権を奪い直す。
	// 条件付き UPDATE なので、同時に複数が奪いに来ても1つしか成功しない。
	const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
	const { data: reclaimed, error: reclaimError } = await supabaseAdmin
		.from('stripe_events')
		.update({ claimed_at: new Date().toISOString() })
		.eq('event_id', eventId)
		.eq('status', 'processing')
		.lt('claimed_at', cutoff)
		.select('event_id');

	if (reclaimError) {
		logger.error('[Webhook] リース奪取に失敗:', reclaimError);
		throw new RetryableError(`イベント再取得エラー: ${reclaimError.message}`);
	}

	if (!reclaimed || reclaimed.length === 0) {
		// 他プロセスが一瞬先に奪った
		logger.debug('[Webhook] 他の配信がリースを取得したためスキップ:', eventId);
		return SKIP;
	}

	logger.error(
		'[Webhook] リース切れのイベントを再取得しました（前回の処理が異常終了した可能性）:',
		eventId,
		eventType
	);
	return PROCEED;
}

/** 正常終了。以後この event.id は永久にスキップしてよい。 */
export async function completeStripeEvent(eventId: string): Promise<void> {
	const { error } = await supabaseAdmin
		.from('stripe_events')
		.update({ status: 'completed', processed_at: new Date().toISOString() })
		.eq('event_id', eventId);

	if (error) {
		// 完了を記録できなくても課金処理自体は済んでいる。
		// リース切れ後に再処理される可能性はあるが、ハンドラは冪等なので実害は限定的。
		logger.error('[Webhook] 完了の記録に失敗:', eventId, error);
	}
}

/**
 * 再送しても成功しないイベントの破棄を記録する（dead-letter）。
 *
 * payload そのものは保存しないが、event_id があれば Stripe API
 * （`stripe.events.retrieve(event_id)`）から内容を再取得して再処理できる。
 * 運用では `select * from stripe_events where status = 'dropped'` を監視すること。
 */
export async function dropStripeEvent(eventId: string, reason: string): Promise<void> {
	const { error } = await supabaseAdmin
		.from('stripe_events')
		.update({
			status: 'dropped',
			failure_reason: reason,
			processed_at: new Date().toISOString()
		})
		.eq('event_id', eventId);

	if (error) {
		logger.error('[Webhook] 破棄の記録に失敗:', eventId, error);
	}
}

/**
 * 処理権を手放す。再送で処理し直させたい失敗（Retryable / 不明な例外）で使う。
 *
 * 削除に失敗しても例外は投げない。リース期限で回収されるため、
 * ここで throw して本来返すべき 500 を上書きする方が有害。
 */
export async function releaseStripeEvent(eventId: string): Promise<void> {
	const { error } = await supabaseAdmin.from('stripe_events').delete().eq('event_id', eventId);
	if (error) {
		logger.error('[Webhook] 処理権の解放に失敗（リース切れで回収されます）:', eventId, error);
	}
}
