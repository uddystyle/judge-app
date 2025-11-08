<script lang="ts">
	import { goto } from '$app/navigation';
	import Footer from '$lib/components/Footer.svelte';
</script>

<svelte:head>
	<title>TENTO - スキー・スノーボード検定・大会採点アプリ</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="page">
	<div class="hero">
		<div class="hero-content">
			<h1 class="title">TENTO</h1>
			<p class="subtitle">スキー・スノーボード検定・大会のための採点管理システム</p>
			<p class="description">
				組織単位で複数の検定員が協力してリアルタイムで採点を行える、<br />
				シンプルで使いやすいクラウドアプリケーションです。
			</p>

			<div class="cta-buttons">
				<button class="btn btn-primary" on:click={() => goto('/signup')}>
					新規登録して始める
				</button>
				<button class="btn btn-secondary" on:click={() => goto('/login')}>ログイン</button>
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
			<p class="pricing-intro">個人利用から組織利用まで、ニーズに合わせたプランをご用意</p>

			<div class="pricing-grid">
				<div class="pricing-card">
					<h3 class="plan-name">フリー</h3>
					<p class="plan-subtitle">個人利用</p>
					<div class="plan-price">¥0<span class="price-unit">/月</span></div>
					<ul class="plan-features">
						<li>組織メンバー: 1名</li>
						<li>検定員: 3名まで</li>
						<li>月間セッション: 3回まで</li>
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
						<li>大会モード・研修モード</li>
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
						<li>すべての機能</li>
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

	<div class="cta-section">
		<div class="container">
			<h2 class="cta-title">今すぐ始めましょう</h2>
			<p class="cta-description">
				無料でアカウントを作成して、組織を立ち上げ、<br />
				スキー・スノーボード検定・大会の採点を効率化しませんか？
			</p>
			<button class="btn btn-primary btn-large" on:click={() => goto('/signup')}> 無料で始める </button>
		</div>
	</div>
</div>

<Footer />

<style>
	:global(body) {
		margin: 0;
		background: #f5f1e8;
	}

	.page {
		min-height: 100vh;
	}

	.hero {
		background: #fefaf5;
		color: #2d2d2d;
		padding: 80px 20px;
		text-align: center;
		position: relative;
		overflow: hidden;
	}

	.hero::before {
		content: '';
		position: absolute;
		top: -50%;
		right: -10%;
		width: 500px;
		height: 500px;
		background: rgba(255, 140, 66, 0.08);
		border-radius: 50%;
		filter: blur(60px);
	}

	.hero::after {
		content: '';
		position: absolute;
		bottom: -30%;
		left: -5%;
		width: 400px;
		height: 400px;
		background: rgba(255, 107, 53, 0.06);
		border-radius: 50%;
		filter: blur(50px);
	}

	.hero-content {
		max-width: 800px;
		margin: 0 auto;
		position: relative;
		z-index: 1;
	}

	.title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 48px;
		font-weight: 800;
		margin-bottom: 16px;
		letter-spacing: 0.05em;
	}

	.subtitle {
		font-size: 24px;
		font-weight: 500;
		margin-bottom: 20px;
		color: #5d5d5d;
	}

	.description {
		font-size: 18px;
		line-height: 1.6;
		color: #6e6e73;
		margin-bottom: 40px;
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
		border-radius: 10px;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.btn-primary {
		background: white;
		color: #ff6b35;
		box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
	}

	.btn-primary:hover {
		background: #fffbf7;
		transform: translateY(-2px);
		box-shadow: 0 8px 25px rgba(255, 107, 53, 0.3);
	}

	.btn-secondary {
		background: transparent;
		color: #ff6b35;
		border: 2px solid #ff6b35;
	}

	.btn-secondary:hover {
		background: #fff5f0;
		transform: translateY(-2px);
		box-shadow: 0 4px 15px rgba(255, 107, 53, 0.2);
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
		background: #f5f1e8;
	}

	.section-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 36px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 60px;
		color: #1d1d1f;
		position: relative;
		padding-bottom: 16px;
	}

	.section-title::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 60px;
		height: 4px;
		background: linear-gradient(90deg, #ff6b35 0%, #ff8c42 100%);
		border-radius: 2px;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 32px;
	}

	.feature-card {
		background: white;
		border: 2px solid #f0e6d8;
		border-radius: 20px;
		padding: 36px;
		text-align: center;
		transition: all 0.3s;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.feature-card:hover {
		transform: translateY(-6px);
		box-shadow: 0 12px 32px rgba(255, 107, 53, 0.15);
		border-color: #ff6b35;
	}

	.feature-title {
		font-size: 20px;
		font-weight: 600;
		margin-bottom: 12px;
		color: #1d1d1f;
	}

	.feature-description {
		font-size: 15px;
		line-height: 1.6;
		color: #6e6e73;
	}

	.how-it-works {
		padding: 80px 20px;
		background: #fefaf5;
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
		background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%);
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		font-weight: 700;
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
	}

	.step-content {
		flex: 1;
	}

	.step-title {
		font-size: 22px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1d1d1f;
	}

	.step-description {
		font-size: 16px;
		line-height: 1.6;
		color: #6e6e73;
	}

	.pricing-section {
		padding: 80px 20px;
		background: #f5f1e8;
	}

	.pricing-intro {
		text-align: center;
		font-size: 18px;
		color: #6e6e73;
		margin-bottom: 48px;
	}

	.pricing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 24px;
		max-width: 1200px;
		margin: 0 auto 40px;
	}

	.pricing-card {
		background: white;
		border: 2px solid #f0e6d8;
		border-radius: 20px;
		padding: 32px 24px;
		text-align: center;
		transition: all 0.3s;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		position: relative;
	}

	.pricing-card:hover {
		transform: translateY(-6px);
		box-shadow: 0 12px 32px rgba(255, 107, 53, 0.15);
		border-color: #ff6b35;
	}

	.pricing-card.recommended {
		border-color: #ff6b35;
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.15);
	}

	.recommended-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 13px;
		font-weight: 600;
		box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
	}

	.plan-name {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 8px;
		color: #1d1d1f;
	}

	.plan-subtitle {
		font-size: 14px;
		color: #6e6e73;
		margin-bottom: 16px;
	}

	.plan-price {
		font-size: 42px;
		font-weight: 700;
		color: #ff6b35;
		margin-bottom: 24px;
	}

	.price-unit {
		font-size: 18px;
		font-weight: 500;
		color: #6e6e73;
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
		color: #1d1d1f;
		border-bottom: 1px solid #f0e6d8;
	}

	.plan-features li:last-child {
		border-bottom: none;
	}

	.plan-features li::before {
		content: '✓';
		color: #ff6b35;
		font-weight: bold;
		margin-right: 8px;
	}

	.pricing-cta {
		text-align: center;
	}

	.cta-section {
		padding: 80px 20px;
		background: #f5f1e8;
		text-align: center;
	}

	.cta-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 36px;
		font-weight: 700;
		margin-bottom: 16px;
		color: #1d1d1f;
	}

	.cta-description {
		font-size: 18px;
		color: #6e6e73;
		margin-bottom: 32px;
	}

	@media (min-width: 768px) {
		.hero {
			padding: 120px 40px;
		}

		.title {
			font-size: 72px;
		}

		.subtitle {
			font-size: 28px;
		}

		.description {
			font-size: 20px;
		}

		.features,
		.how-it-works,
		.pricing-section,
		.cta-section {
			padding: 100px 40px;
		}

		.section-title {
			font-size: 42px;
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
