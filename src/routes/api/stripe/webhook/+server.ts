import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY } from '$env/static/private';
import { logger } from '$lib/server/logger';
import { RetryableError, NonRetryableError } from '$lib/server/stripeWebhook/shared';
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
		event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);

		logger.debug('[Webhook] イベント受信:', event.type, 'ID:', event.id);
	} catch (err: any) {
		logger.error('[Webhook] 署名検証エラー:', err.message);
		throw error(400, `Webhook署名検証エラー: ${err.message}`);
	}

	// T14: livemode検証 - 環境とイベントのlivemode不一致を検出
	// event.livemodeが明示的に存在する場合のみチェック（テストモック互換性のため）
	if (event.livemode !== undefined) {
		const expectedLivemode = STRIPE_SECRET_KEY.startsWith('sk_live_');
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

			case 'invoice.payment_succeeded': {
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

		return json({ received: true });
	} catch (err: any) {
		logger.error('[Webhook] イベント処理エラー:', err);

		// エラーの種類に応じて適切なHTTPステータスコードを返す
		if (err instanceof NonRetryableError) {
			// 400番台: リトライ不要なエラー（データ不正、必須データなしなど）
			logger.error('[Webhook] リトライ不要なエラー:', err.message);
			throw error(400, `リトライ不要なエラー: ${err.message}`);
		} else if (err instanceof RetryableError) {
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
