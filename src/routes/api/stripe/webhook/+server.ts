import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY } from '$env/static/private';
import { logger } from '$lib/server/logger';
import { RetryableError, NonRetryableError } from '$lib/server/stripeWebhook/shared';
import {
	claimStripeEvent,
	completeStripeEvent,
	dropStripeEvent,
	releaseStripeEvent
} from '$lib/server/stripeWebhook/idempotency';
import { handleCheckoutCompleted } from '$lib/server/stripeWebhook/checkout';
import {
	handleSubscriptionCreated,
	handleSubscriptionUpdated,
	handleSubscriptionDeleted
} from '$lib/server/stripeWebhook/subscription';
import { handlePaymentSucceeded, handlePaymentFailed } from '$lib/server/stripeWebhook/invoice';

// イベント別の処理本体は $lib/server/stripeWebhook/ に分割されている。
// このファイルは署名検証・livemode検証・ディスパッチ・エラー分類のみを担う。

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');

	if (!signature) {
		logger.error('[Webhook] Stripe署名がありません');
		throw error(400, 'Stripe署名がありません。');
	}

	let event;

	try {
		// 1. リクエストボディを取得
		const body = await request.text();

		// 2. Webhook署名を検証
		// 同期版 constructEvent は Node の同期 crypto に依存するため、edge/worker ランタイム
		// （SubtleCrypto は非同期のみ）では実行時に throw する。現在は nodejs20.x で動くが、
		// async 版は Node でも挙動が同一で移植性があるためこちらを使う。
		event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);

		logger.debug('[Webhook] イベント受信:', event.type, 'ID:', event.id);
	} catch (err: any) {
		logger.error('[Webhook] 署名検証エラー:', err.message);
		throw error(400, `Webhook署名検証エラー: ${err.message}`);
	}

	// T14: livemode検証 - 環境とイベントのlivemode不一致を検出
	// event.livemodeが明示的に存在する場合のみチェック（テストモック互換性のため）
	if (event.livemode !== undefined) {
		// M-6: 制限付きAPIキー（rk_）も本番キーになり得る。
		// sk_ 前置詞だけを見ていると、Stripe 推奨の rk_live_ へ移行した瞬間に
		// 本番イベントが「テスト鍵の環境に本番イベント」と誤判定され、
		// 本番 webhook が全て 503 になる。
		const expectedLivemode = /^(sk|rk)_live_/.test(STRIPE_SECRET_KEY);
		const eventLivemode = event.livemode;

		if (expectedLivemode !== eventLivemode) {
			const envType = expectedLivemode ? '本番' : 'テスト';
			const eventType = eventLivemode ? '本番' : 'テスト';
			// 構成ミス検知のため高重大度で記録（warn ではなく error）
			logger.error(
				`[Webhook] T14: livemode不一致を検出 - 環境: ${envType}, イベント: ${eventType}, event.id: ${event.id}`
			);
			// TODO: 監視アラート（Sentry等）を送信

			// 危険な方向: テスト鍵の環境に「本番」イベントが届いている。
			// 200 で握り潰すと本物の課金イベントが恒久ドロップされるため、非2xxで再送させ、
			// Stripe ダッシュボード上にエラーとして可視化する（構成ミスを検知可能にする）。
			if (!expectedLivemode && eventLivemode) {
				throw error(
					503,
					`livemode不一致: テスト鍵の環境に本番イベントが届いています（event.id: ${event.id}）。STRIPE_SECRET_KEY を確認してください。`
				);
			}

			// 逆方向（本番環境にテストイベント）は無害なのでスキップ（200で再送させない）
			logger.warn('[Webhook] T14: 本番環境のテストイベントをスキップします');
			return json({ received: true, skipped: true, reason: 'livemode_mismatch' });
		}
	}

	// M-2: 冪等化。同一 event.id の再送・重複配信は本処理に入る前に弾く。
	// Stripe は「少なくとも1回」配信で順序保証も無く、2xx以外は最大3日間再送されるため、
	// 同一イベントが複数回届くのは通常運用。
	const claim = await claimStripeEvent(event.id, event.type);
	if (claim.alreadyProcessed) {
		return json({ received: true, duplicate: true });
	}

	// 3. イベントタイプに応じて処理
	try {
		logger.debug('[Webhook] 処理開始 - イベントタイプ:', event.type);
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as any;
				logger.debug('[Webhook] checkout.session.completed - Session ID:', session.id);
				logger.debug('[Webhook] Metadata:', session.metadata);
				await handleCheckoutCompleted(session);
				break;
			}

			case 'customer.subscription.created': {
				const subscription = event.data.object as any;
				await handleSubscriptionCreated(subscription);
				break;
			}

			case 'customer.subscription.updated': {
				const subscription = event.data.object as any;
				await handleSubscriptionUpdated(subscription);
				break;
			}

			case 'customer.subscription.deleted': {
				const subscription = event.data.object as any;
				await handleSubscriptionDeleted(subscription);
				break;
			}

			// 請求成立。有償と無償（100%割引など）でイベント名が変わるため両方を受ける。
			//
			// ⚠️ 請求額が ¥0 だと Stripe は決済を行わないため `invoice.payment_succeeded` を
			// **送らず**、`invoice.paid` だけを送る（テストモードで実測確認済み）。
			// `invoice.payment_succeeded` しか購読していないと、クーポンで無償提供した
			// アカウントの current_period_end が初回のまま永久に更新されない。
			//
			// 有償の場合は両方が届くが、event.id が違うので冪等化では弾けない。
			// handlePaymentSucceeded 側のリプレイ防御（同一 period_end かつ同一内容なら
			// DB 更新を省略）が二重反映を防ぐ。
			//
			// 注意: Stripe ダッシュボードのエンドポイント設定でも `invoice.paid` の
			// 購読を有効にしないと、ここには届かない。
			case 'invoice.payment_succeeded':
			case 'invoice.paid': {
				const invoice = event.data.object as any;
				await handlePaymentSucceeded(invoice);
				break;
			}

			case 'invoice.payment_failed': {
				const invoice = event.data.object as any;
				await handlePaymentFailed(invoice);
				break;
			}

			default:
				logger.debug('[Webhook] 未処理のイベントタイプ:', event.type);
		}

		// M-2: ここまで到達して初めて「処理済み」として確定する。
		// 開始時点で確定させると、途中でプロセスが死んだイベントが永久に失われる。
		await completeStripeEvent(event.id);

		return json({ received: true });
	} catch (err: any) {
		logger.error('[Webhook] イベント処理エラー:', err);

		// エラーの種類に応じて適切なHTTPステータスコードを返す
		if (err instanceof NonRetryableError) {
			// M-1: Stripe は 2xx 以外を一律で最大3日間再送する（4xx/5xx を区別しない）。
			// 再送しても永久に成功しない種類のエラーで非2xxを返すと、リトライ嵐になり
			// 最終的にエンドポイントが自動無効化されて「本当に処理すべきイベント」まで失う。
			// よって 200 を返して再送を止め、代わりに error ログで可視化する。
			// TODO: 監視アラート（Sentry等）を送信
			logger.error(
				'[Webhook] 処理不能なイベントを破棄しました（再送しても成功しないため200を返す）:',
				`event.id=${event.id}`,
				`type=${event.type}`,
				err.message
			);
			// 破棄理由を dead-letter レコードとして残す。
			// payload は保存しないが、event_id から stripe.events.retrieve() で再取得できる。
			// 運用では `select * from stripe_events where status='dropped'` を監視すること。
			await dropStripeEvent(event.id, err.message);
			return json({ received: true, dropped: true, reason: err.message });
		}

		// M-2: 再送で処理し直す必要があるため、処理済み記録を取り消す。
		// これを怠ると再送が「処理済み」と判定され、イベントが恒久的に失われる。
		await releaseStripeEvent(event.id);

		if (err instanceof RetryableError) {
			// 500番台: リトライすべきエラー（DB障害、Stripe API障害など）
			logger.error('[Webhook] リトライ可能なエラー:', err.message);
			throw error(500, `リトライ可能なエラー: ${err.message}`);
		} else {
			// デフォルト: 不明なエラーは500を返す（安全側に倒す）
			logger.error('[Webhook] 不明なエラー:', err.message);
			throw error(500, `イベント処理エラー: ${err.message}`);
		}
	}
};
