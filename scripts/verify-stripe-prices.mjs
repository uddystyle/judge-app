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
 *
 * 本番(live)を確認する場合の注意:
 * .env の price ID は**テストモードのオブジェクト**なので、live キーで引くと
 * resource_missing になる。本番の price ID を渡すか、渡さない場合は
 * live 上の active な定期課金 price を一覧して表示価格と突き合わせる。
 *
 *   # 本番の price ID が分かっている場合
 *   STRIPE_SECRET_KEY=sk_live_xxx STRIPE_PRICE_BASIC_MONTH=price_xxx ... npm run verify:stripe-prices
 *
 *   # 分からない場合（live の price を一覧して目視突合）
 *   STRIPE_SECRET_KEY=sk_live_xxx npm run verify:stripe-prices -- --list
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

const stripeGet = (path) =>
	fetch(`https://api.stripe.com/v1/${path}`, {
		headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}` }
	}).then((r) => r.json());

const listOnly = process.argv.includes('--list');

console.log(`Stripe price 突合（mode=${mode}）\n`);

/** live 上の active な定期課金 price を一覧し、表示価格と突き合わせる */
async function listActivePrices() {
	const res = await stripeGet('prices?active=true&limit=100&expand[]=data.product');
	if (res.error) {
		console.error(`price 一覧の取得に失敗: ${res.error.message}`);
		return 1;
	}

	const recurring = (res.data ?? []).filter((p) => p.recurring);
	if (!recurring.length) {
		console.log('active な定期課金 price がありません。');
		return 1;
	}

	// 表示価格（plans.ts）の全額を集合にしておき、一致するものに印を付ける
	const displayed = new Map();
	for (const id of ['basic', 'standard', 'premium']) {
		const { monthly, yearly } = readPlanPrices(id);
		displayed.set(`${monthly}:month`, `${id}/month`);
		displayed.set(`${yearly}:year`, `${id}/year`);
	}

	console.log(`${mode} 上の active な定期課金 price（${recurring.length}件）:\n`);
	const matched = new Set();

	for (const p of recurring.sort((a, b) => a.unit_amount - b.unit_amount)) {
		const key = `${p.unit_amount}:${p.recurring.interval}`;
		const hit = displayed.get(key);
		if (hit) matched.add(hit);
		const product = typeof p.product === 'object' ? p.product?.name : p.product;
		console.log(
			`${hit ? '✅' : '  '} ${p.id}  ¥${p.unit_amount?.toLocaleString()} / ${p.recurring.interval}` +
				`  ${product ?? ''}${hit ? `  → 表示価格 ${hit} と一致` : ''}`
		);
	}

	const missing = [...displayed.values()].filter((v) => !matched.has(v));
	console.log();
	if (missing.length) {
		console.log(`⚠️ 表示価格に対応する ${mode} price が見つからないもの: ${missing.join(', ')}`);
		console.log('   → 本番の請求額が画面表示と食い違っている可能性があります。');
		return 1;
	}
	console.log('表示価格はすべて、対応する price が存在します。');
	return 0;
}

if (listOnly) {
	process.exit(await listActivePrices());
}

let failed = 0;
let missingResource = 0;

for (const [planId, envKey, interval] of TARGETS) {
	const priceId = process.env[envKey] || fileEnv[envKey];
	const label = `${planId}/${interval}`;

	if (!priceId) {
		console.log(`❌ ${label}: ${envKey} が未設定`);
		failed++;
		continue;
	}

	const price = await stripeGet(`prices/${priceId}`);

	if (price.error) {
		const code = price.error.code ?? price.error.type ?? 'error';
		console.log(`❌ ${label}: ${priceId} -> ${code}: ${price.error.message}`);
		if (code === 'resource_missing') missingResource++;
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

// live キーで test の price ID を引くと必ず resource_missing になる。
// その場合は ID 指定なしでも判定できるよう、自動で一覧突合に切り替える。
if (missingResource === TARGETS.length) {
	console.log(
		`指定された price ID が ${mode} に存在しません（.env の ID は別モードのものと思われます）。`
	);
	console.log(`${mode} 上の price を一覧して突き合わせます。\n`);
	process.exit(await listActivePrices());
}

if (failed) {
	console.error(`${failed} 件の不一致があります。`);
	process.exit(1);
}
console.log('すべて一致しています。');
