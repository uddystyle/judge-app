<script lang="ts">
	import { goto } from '$app/navigation';
	import Footer from '$lib/components/Footer.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>TENTO - スキー・スノーボード検定・大会採点アプリ</title>
	<meta name="description" content="スキー・スノーボード検定・大会のための採点管理システム。組織単位で複数の検定員が協力してリアルタイムで採点を行える、シンプルで使いやすいクラウドアプリケーション。" />
	<meta name="keywords" content="スキー,スノーボード,検定,大会,採点,アプリ,管理システム,リアルタイム,クラウド" />
	<meta property="og:title" content="TENTO - スキー・スノーボード検定・大会採点アプリ" />
	<meta property="og:description" content="組織単位で複数の検定員が協力してリアルタイムで採点を行える、シンプルで使いやすいクラウドアプリケーション。" />
	<meta property="og:type" content="website" />
	<link rel="canonical" href="https://tento.vercel.app/" />
</svelte:head>

<div class="page">
	<div class="hero">
		<div class="hero-content">
			<h1 class="title">TENTO</h1>
			<p class="subtitle">
				スキー・スノーボード<br class="mobile-br" />検定・大会のための<br class="mobile-br" />採点管理システム
			</p>
			<p class="description">
				組織単位で複数の検定員が協力して<br class="mobile-br" />リアルタイムで採点を行える、<br />
				シンプルで使いやすい<br class="mobile-br" />クラウドアプリケーションです。
			</p>

			<div class="cta-buttons">
				{#if data.user}
					<!-- ログイン済みの場合 -->
					<button class="btn btn-primary" on:click={() => goto('/dashboard')}>
						ダッシュボードに戻る
					</button>
				{:else}
					<!-- 未ログインの場合 -->
					<button class="btn btn-primary" on:click={() => goto('/signup')}>
						新規登録して始める
					</button>
					<button class="btn btn-secondary" on:click={() => goto('/login')}>ログイン</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="features" id="features">
		<div class="container">
			<h2 class="section-title">主な機能</h2>

			<div class="feature-grid">
				<div class="feature-card">
					<h3 class="feature-title">組織管理</h3>
					<p class="feature-description">
						スキークラブやスクールなど、組織単位で検定員を管理。メンバーを招待してチームで運営できます。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">検定モード</h3>
					<p class="feature-description">
						バッジテストやプライズテストなど、スキー・スノーボード検定を効率的に管理・採点できます。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">大会モード</h3>
					<p class="feature-description">
						複数種目のスコアを集計し、総合ランキングを自動生成。公開リンクでリアルタイムに結果を共有できます。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">研修モード</h3>
					<p class="feature-description">
						検定員の研修に最適。複数の検定員が同じ演技を採点し、採点基準のばらつきを確認・改善できます。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">複数検定員対応</h3>
					<p class="feature-description">
						3審3採や5審3採など、複数の検定員による採点をリアルタイムで同期。主任検定員が最終確認を行えます。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">モバイル対応</h3>
					<p class="feature-description">
						スマートフォンやタブレットから快適に操作可能。現場での採点作業に最適化されたUIです。
					</p>
				</div>
			</div>
		</div>
	</div>

	<div class="how-it-works" id="how-it-works">
		<div class="container">
			<h2 class="section-title">使い方</h2>

			<div class="steps">
				<div class="step">
					<div class="step-number">1</div>
					<div class="step-content">
						<h3 class="step-title">組織を作成</h3>
						<p class="step-description">スキークラブやスクールなど、あなたの組織を作成します。個人での利用も可能です。</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">2</div>
					<div class="step-content">
						<h3 class="step-title">セッションを作成</h3>
						<p class="step-description">検定・大会・研修のセッションを作成し、参加コードを発行します。</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">3</div>
					<div class="step-content">
						<h3 class="step-title">検定員が参加して採点</h3>
						<p class="step-description">
							参加コードを共有し、各検定員がそれぞれの端末から採点。結果は自動的に同期されます。
						</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">4</div>
					<div class="step-content">
						<h3 class="step-title">結果の確認・共有</h3>
						<p class="step-description">
							採点結果を自動集計、Excel形式でエクスポート。大会モードではスコアボードを公開できます。
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="pricing-section">
		<div class="container">
			<h2 class="section-title">料金プラン</h2>
			<p class="pricing-intro">個人利用から組織利用まで、<br class="mobile-br" />ニーズに合わせたプランをご用意</p>

			<div class="pricing-grid">
				<div class="pricing-card">
					<h3 class="plan-name">フリー</h3>
					<p class="plan-subtitle">個人利用</p>
					<div class="plan-price">¥0<span class="price-unit">/月</span></div>
					<ul class="plan-features">
						<li>組織メンバー: 1名</li>
						<li>検定員: 3名まで</li>
						<li>月間セッション: 3個まで</li>
						<li>検定モードのみ</li>
						<li>Excelエクスポート</li>
					</ul>
				</div>

				<div class="pricing-card">
					<h3 class="plan-name">Basic</h3>
					<p class="plan-subtitle">小規模クラブ向け</p>
					<div class="plan-price">¥8,800<span class="price-unit">/月</span></div>
					<ul class="plan-features">
						<li>組織メンバー: 10名まで</li>
						<li>検定員: 15名まで</li>
						<li>月間セッション: 無制限</li>
						<li>検定・大会・研修モード</li>
						<li>Excelエクスポート</li>
					</ul>
				</div>

				<div class="pricing-card recommended">
					<div class="recommended-badge">おすすめ</div>
					<h3 class="plan-name">Standard</h3>
					<p class="plan-subtitle">中規模組織向け</p>
					<div class="plan-price">¥24,800<span class="price-unit">/月</span></div>
					<ul class="plan-features">
						<li>組織メンバー: 30名まで</li>
						<li>検定員: 50名まで</li>
						<li>月間セッション: 無制限</li>
						<li>検定・大会・研修モード</li>
						<li>Excelエクスポート</li>
					</ul>
				</div>

				<div class="pricing-card">
					<h3 class="plan-name">Premium</h3>
					<p class="plan-subtitle">大規模組織向け</p>
					<div class="plan-price">¥49,800<span class="price-unit">/月</span></div>
					<ul class="plan-features">
						<li>組織メンバー: 100名まで</li>
						<li>検定員: 100名まで</li>
						<li>月間セッション: 無制限</li>
						<li>検定・大会・研修モード</li>
						<li>Excelエクスポート</li>
						<li>優先サポート</li>
					</ul>
				</div>
			</div>

			<div class="pricing-cta">
				<button class="btn btn-secondary" on:click={() => goto('/pricing')}>
					詳しい料金プランを見る
				</button>
			</div>
		</div>
	</div>

	{#if !data.user}
		<!-- 未ログインユーザーのみCTAセクションを表示 -->
		<div class="cta-section">
			<div class="container">
				<h2 class="cta-title">今すぐ始めましょう</h2>
				<p class="cta-description">
					無料でアカウントを作成して、<br class="mobile-br" />組織を立ち上げ、<br class="mobile-br" />
					スキー・スノーボード検定・大会の<br class="mobile-br" />採点を効率化しませんか？
				</p>
				<button class="btn btn-primary btn-large" on:click={() => goto('/signup')}> 無料で始める </button>
			</div>
		</div>
	{/if}
</div>

<Footer />

<style>
	:global(body) {
		margin: 0;
		background: var(--bg-secondary);
	}

	.page {
		min-height: 100vh;
	}

	.hero {
		background: var(--bg-primary);
		color: var(--text-primary);
		padding: 80px 20px;
		text-align: center;
		border-bottom: 1px solid var(--border-light);
	}

	.hero-content {
		max-width: 800px;
		margin: 0 auto;
		position: relative;
		z-index: 1;
	}

	.title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 56px;
		font-weight: 800;
		margin-bottom: 20px;
		letter-spacing: 0.05em;
		color: var(--text-primary);
	}

	.subtitle {
		font-size: 28px;
		font-weight: 600;
		margin-bottom: 20px;
		color: var(--text-secondary);
	}

	.description {
		font-size: 19px;
		line-height: 1.6;
		color: var(--text-secondary);
		margin-bottom: 40px;
		letter-spacing: -0.01em;
	}

	.cta-buttons {
		display: flex;
		gap: 16px;
		justify-content: center;
		flex-wrap: wrap;
	}

	.btn {
		padding: 14px 32px;
		font-size: 17px;
		font-weight: 500;
		border-radius: 8px;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		letter-spacing: -0.01em;
	}

	.btn-primary {
		background: var(--accent-primary);
		color: white;
		border: 1.5px solid var(--accent-primary);
	}

	.btn-primary:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
		transform: translateY(-2px);
	}

	.btn-secondary {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1.5px solid var(--border-medium);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
		border-color: var(--border-dark);
		transform: translateY(-2px);
	}

	.btn-large {
		padding: 18px 48px;
		font-size: 20px;
	}

	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 20px;
	}

	.features {
		padding: 80px 20px;
		background: var(--bg-secondary);
	}

	.section-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 42px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 60px;
		color: var(--text-primary);
		letter-spacing: -0.01em;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 32px;
	}

	.feature-card {
		background: var(--bg-primary);
		border: 1px solid var(--border-light);
		border-radius: 12px;
		padding: 36px;
		text-align: center;
		transition: all 0.2s ease;
	}

	.feature-card:hover {
		transform: translateY(-4px);
		border-color: var(--border-dark);
	}

	.feature-title {
		font-size: 22px;
		font-weight: 600;
		margin-bottom: 12px;
		color: var(--text-primary);
	}

	.feature-description {
		font-size: 16px;
		line-height: 1.6;
		color: var(--text-secondary);
		letter-spacing: -0.01em;
	}

	.how-it-works {
		padding: 80px 20px;
		background: var(--bg-primary);
	}

	.steps {
		max-width: 800px;
		margin: 0 auto;
	}

	.step {
		display: flex;
		gap: 24px;
		margin-bottom: 40px;
		align-items: flex-start;
	}

	.step-number {
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		background: var(--accent-primary);
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		font-weight: 700;
	}

	.step-content {
		flex: 1;
	}

	.step-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 10px;
		color: var(--text-primary);
	}

	.step-description {
		font-size: 17px;
		line-height: 1.6;
		color: var(--text-secondary);
		letter-spacing: -0.01em;
	}

	.pricing-section {
		padding: 80px 20px;
		background: var(--bg-secondary);
	}

	.pricing-intro {
		text-align: center;
		font-size: 18px;
		color: var(--text-secondary);
		margin-bottom: 48px;
		letter-spacing: -0.01em;
	}

	.pricing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 24px;
		max-width: 1200px;
		margin: 0 auto 40px;
	}

	.pricing-card {
		background: var(--bg-primary);
		border: 1px solid var(--border-light);
		border-radius: 12px;
		padding: 32px 24px;
		text-align: center;
		transition: all 0.2s ease;
		position: relative;
	}

	.pricing-card:hover {
		transform: translateY(-4px);
		border-color: var(--border-dark);
	}

	.pricing-card.recommended {
		border-color: var(--accent-primary);
		border-width: 2px;
	}

	.recommended-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--accent-primary);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 13px;
		font-weight: 600;
	}

	.plan-name {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 8px;
		color: var(--text-primary);
	}

	.plan-subtitle {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 16px;
	}

	.plan-price {
		font-size: 42px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 24px;
	}

	.price-unit {
		font-size: 18px;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		text-align: left;
	}

	.plan-features li {
		padding: 10px 0;
		font-size: 15px;
		color: var(--text-primary);
		border-bottom: 1px solid var(--border-light);
		letter-spacing: -0.01em;
	}

	.plan-features li:last-child {
		border-bottom: none;
	}

	.plan-features li::before {
		content: '✓';
		color: var(--accent-primary);
		font-weight: bold;
		margin-right: 8px;
	}

	.pricing-cta {
		text-align: center;
		margin-top: 64px;
		padding-top: 24px;
	}

	.cta-section {
		padding: 80px 20px;
		background: var(--bg-secondary);
		text-align: center;
	}

	.cta-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 40px;
		font-weight: 700;
		margin-bottom: 20px;
		color: var(--text-primary);
		letter-spacing: -0.01em;
	}

	.cta-description {
		font-size: 19px;
		color: var(--text-secondary);
		margin-bottom: 32px;
		letter-spacing: -0.01em;
	}

	/* モバイルのみ表示される改行 */
	.mobile-br {
		display: inline;
	}

	@media (min-width: 768px) {
		/* タブレット以上では改行を非表示 */
		.mobile-br {
			display: none;
		}
		.hero {
			padding: 120px 40px;
		}

		.title {
			font-size: 80px;
		}

		.subtitle {
			font-size: 32px;
		}

		.description {
			font-size: 21px;
		}

		.features,
		.how-it-works,
		.pricing-section,
		.cta-section {
			padding: 100px 40px;
		}

		.section-title {
			font-size: 48px;
		}

		.cta-title {
			font-size: 48px;
		}

		.cta-description {
			font-size: 21px;
		}

		.feature-grid {
			gap: 40px;
		}

		.pricing-grid {
			gap: 32px;
		}

		.pricing-intro {
			font-size: 20px;
		}
	}
</style>
