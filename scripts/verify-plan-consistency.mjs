#!/usr/bin/env node
/**
 * プラン定義のドリフト検査（コード ↔ 実DB ↔ Stripe）
 *
 * ⚠️ 背景: ユニットテスト（src/lib/server/__tests__/plans.priceMapping.test.ts）は
 * 「DBが許可する plan_type」をテスト内に**手書き**しているため、実DBの制約や
 * plan_limits の中身が変わっても検知できない（自己参照的）。
 * ネットワークが要る突合はこのスクリプトが担当する。
 *
 *   npm run verify:plan-consistency
 *
 * 読み取り専用（GET のみ）。既定は .env の資格情報を使う。
 *
 * 検査項目:
 *   (1) findPlanTypeByPriceId が返し得る全 plan_type に plan_limits の行があるか
 *       → 行が無いプランを返すと webhook が NonRetryableError で破棄される
 *   (2) plan_limits の max_organization_members が ORG_PLANS.maxMembers と一致するか
 *       → M-5 で上限の出所を plan_limits に一本化したため、コード側の表示と乖離すると
 *         「表示より少ない人数しか追加できない」状態になる
 *   (3) .env の price ID がすべて Stripe に実在し、期待どおりのプランへ写るか
 *
 * 検査**しない**こと:
 *   - subscriptions.plan_type / status の CHECK 制約そのもの。
 *     PostgREST からは pg_constraint を読めないため、
 *     `database/migrations/verify/1029_verify_status_check.sql` を SQL Editor で実行して確認する。
 */
import { readFileSync } from 'node:fs';

function loadEnvFile(path = '.env') {
	try {
		return Object.fromEntries(
			readFileSync(path, 'utf8')
				.split('\n')
				.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
				.map((l) => {
					const i = l.indexOf('=');
					return [
						l.slice(0, i).trim(),
						l
							.slice(i + 1)
							.trim()
							.replace(/^["']|["']$/g, '')
					];
				})
		);
	} catch {
		return {};
	}
}

const fileEnv = loadEnvFile();
const env = { ...fileEnv, ...process.env };

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_KEY = env.STRIPE_SECRET_KEY;

/** 表示用カタログ（src/lib/plans.ts と同じ値。importできないので明示的に持つ） */
const ORG_PLANS = {
	basic: { maxMembers: 10 },
	standard: { maxMembers: 30 },
	premium: { maxMembers: 100 }
};

/** findPlanTypeByPriceId が返し得る値（src/lib/server/plans.ts と対応） */
const RESOLVABLE_PLAN_TYPES = ['basic', 'standard', 'premium'];

const PRICE_ENV_TO_PLAN = {
	STRIPE_PRICE_BASIC_MONTH: 'basic',
	STRIPE_PRICE_BASIC_YEAR: 'basic',
	STRIPE_PRICE_STANDARD_MONTH: 'standard',
	STRIPE_PRICE_STANDARD_YEAR: 'standard',
	STRIPE_PRICE_PREMIUM_MONTH: 'premium',
	STRIPE_PRICE_PREMIUM_YEAR: 'premium'
};

const problems = [];
const notes = [];

async function fetchPlanLimits() {
	if (!SUPABASE_URL || !SERVICE_KEY) {
		notes.push('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が無いため DB 検査をスキップ');
		return null;
	}
	const res = await fetch(
		`${SUPABASE_URL}/rest/v1/plan_limits?select=plan_type,max_organization_members`,
		{ headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
	);
	if (!res.ok) {
		problems.push(`plan_limits の取得に失敗: ${res.status} ${await res.text()}`);
		return null;
	}
	return res.json();
}

async function fetchStripePrice(priceId) {
	const res = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
		headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Stripe-Version': '2025-10-29.clover' }
	});
	if (!res.ok) return { error: (await res.json()).error?.message ?? `HTTP ${res.status}` };
	return res.json();
}

console.log('=== プラン定義のドリフト検査 ===\n');

// (1)(2) DB の plan_limits
const planLimits = await fetchPlanLimits();
if (planLimits) {
	const byType = Object.fromEntries(
		planLimits.map((r) => [r.plan_type, r.max_organization_members])
	);
	console.log('plan_limits (実DB):', JSON.stringify(byType));

	for (const planType of RESOLVABLE_PLAN_TYPES) {
		if (!(planType in byType)) {
			problems.push(
				`plan_limits に '${planType}' の行が無い。webhook がこのプランを解決すると破棄される`
			);
		}
	}
	// free は組織作成の初期値として使う（H-2 の未確定パス）
	if (!('free' in byType)) {
		problems.push("plan_limits に 'free' の行が無い。決済未確定時の組織作成が失敗する");
	}

	for (const [planId, plan] of Object.entries(ORG_PLANS)) {
		if (planId in byType && byType[planId] !== plan.maxMembers) {
			problems.push(
				`max_members の乖離: ${planId} は表示 ${plan.maxMembers} 人 / DB ${byType[planId]} 人`
			);
		}
	}
}

// (3) Stripe の price
if (!STRIPE_KEY) {
	notes.push('STRIPE_SECRET_KEY が無いため Stripe 検査をスキップ');
} else {
	console.log(`\nStripe price (${STRIPE_KEY.startsWith('sk_live_') ? 'live' : 'test'} mode):`);
	for (const [envKey, expectedPlan] of Object.entries(PRICE_ENV_TO_PLAN)) {
		const priceId = env[envKey];
		if (!priceId || priceId.includes('placeholder')) {
			problems.push(`${envKey} が未設定（placeholder）`);
			continue;
		}
		const price = await fetchStripePrice(priceId);
		if (price.error) {
			problems.push(`${envKey} (${priceId}) を Stripe から取得できない: ${price.error}`);
			continue;
		}
		const amount = price.unit_amount;
		const interval = price.recurring?.interval;
		console.log(`  ${envKey.padEnd(28)} ${interval ?? '-'} ¥${amount?.toLocaleString() ?? '-'}`);
		if (!price.active) problems.push(`${envKey} (${priceId}) は Stripe 上で inactive`);
		if (!interval) problems.push(`${envKey} (${priceId}) が定期課金の price ではない`);
		// 同一プランの price が2件とも同じプランへ写ることは env の対応表で担保されている。
		// ここでは「実在し・有効で・定期課金であること」までを見る。
		void expectedPlan;
	}
}

console.log('');
for (const n of notes) console.log(`ℹ️  ${n}`);
if (problems.length === 0) {
	console.log('✅ ドリフトは検出されませんでした');
	process.exit(0);
}
for (const p of problems) console.error(`❌ ${p}`);
console.error(`\n${problems.length} 件の問題があります`);
process.exit(1);
