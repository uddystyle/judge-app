#!/usr/bin/env node
/**
 * .env の Stripe Price ID と、アプリの表示価格（src/lib/plans.ts）を突き合わせる。
 *
 * 課金額は Stripe の Price で決まり、画面表示は ORG_PLANS の数値という別ソースから
 * 出ている。両者がズレると「表示より高く請求される」状態になるため、価格を触ったら
 * これを実行して一致を確認する。
 *
 *   npm run verify:stripe-prices
 *
 * 読み取り専用（GET のみ）。既定は .env の STRIPE_SECRET_KEY を使う。
 * 本番(live)を確認したい場合は環境変数で上書きする:
 *   STRIPE_SECRET_KEY=sk_live_... npm run verify:stripe-prices
 */
import { readFileSync } from 'node:fs';

function loadEnvFile(path = '.env') {
	try {
		return Object.fromEntries(
			readFileSync(path, 'utf8')
				.split('\n')
				.filter((l) => /^[A-Z_]+=/.test(l))
				.map((l) => {
					const i = l.indexOf('=');
					return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
				})
		);
	} catch {
		return {};
	}
}

const fileEnv = loadEnvFile();
const secretKey = process.env.STRIPE_SECRET_KEY || fileEnv.STRIPE_SECRET_KEY;

if (!secretKey) {
	console.error('STRIPE_SECRET_KEY が見つかりません（.env か環境変数で指定してください）');
	process.exit(2);
}

const mode = secretKey.startsWith('sk_live_') ? 'live' : 'test';

// plans.ts を実行せず数値だけ読む（SvelteKit の $lib エイリアスに依存しないため）
const plansSource = readFileSync('src/lib/plans.ts', 'utf8');
function readPlanPrices(planId) {
	const block = plansSource.split(`${planId}: {`)[1] ?? '';
	const monthly = Number(block.match(/monthlyPrice:\s*(\d+)/)?.[1]);
	const yearly = Number(block.match(/yearlyPrice:\s*(\d+)/)?.[1]);
	return { monthly, yearly };
}

const TARGETS = [
	['basic', 'STRIPE_PRICE_BASIC_MONTH', 'month'],
	['basic', 'STRIPE_PRICE_BASIC_YEAR', 'year'],
	['standard', 'STRIPE_PRICE_STANDARD_MONTH', 'month'],
	['standard', 'STRIPE_PRICE_STANDARD_YEAR', 'year'],
	['premium', 'STRIPE_PRICE_PREMIUM_MONTH', 'month'],
	['premium', 'STRIPE_PRICE_PREMIUM_YEAR', 'year']
];

console.log(`Stripe price 突合（mode=${mode}）\n`);

let failed = 0;

for (const [planId, envKey, interval] of TARGETS) {
	const priceId = process.env[envKey] || fileEnv[envKey];
	const label = `${planId}/${interval}`;

	if (!priceId) {
		console.log(`❌ ${label}: ${envKey} が未設定`);
		failed++;
		continue;
	}

	const res = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
		headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}` }
	});
	const price = await res.json();

	if (price.error) {
		console.log(`❌ ${label}: ${priceId} -> ${price.error.code}: ${price.error.message}`);
		failed++;
		continue;
	}

	const expected = readPlanPrices(planId)[interval === 'month' ? 'monthly' : 'yearly'];
	const problems = [];

	if (price.unit_amount !== expected) {
		problems.push(`金額 Stripe=${price.unit_amount} / 表示=${expected}`);
	}
	if (price.currency !== 'jpy') problems.push(`通貨=${price.currency}`);
	if (price.recurring?.interval !== interval) {
		problems.push(`間隔 Stripe=${price.recurring?.interval ?? 'one_time'} / 期待=${interval}`);
	}
	if (!price.active) problems.push('active=false');
	if (price.livemode !== (mode === 'live')) {
		problems.push(`livemode=${price.livemode}（鍵は ${mode}）`);
	}

	if (problems.length) {
		console.log(`❌ ${label}: ${problems.join(' / ')}`);
		failed++;
	} else {
		console.log(`✅ ${label}: ¥${price.unit_amount.toLocaleString()} / ${interval}`);
	}
}

console.log();
if (failed) {
	console.error(`${failed} 件の不一致があります。`);
	process.exit(1);
}
console.log('すべて一致しています。');
