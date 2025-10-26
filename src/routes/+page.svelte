<script lang="ts">
	import { goto } from '$app/navigation';
</script>

<svelte:head>
	<title>JudgeApp - スキー・スノーボード検定・大会採点アプリ</title>
</svelte:head>

<div class="page">
	<div class="hero">
		<div class="hero-content">
			<h1 class="title">JudgeApp</h1>
			<p class="subtitle">スキー・スノーボード検定・大会のための採点管理システム</p>
			<p class="description">
				リアルタイムで複数の検定員が協力して採点を行える、<br />
				シンプルで使いやすいアプリケーションです。
			</p>

			<div class="cta-buttons">
				<button class="btn btn-primary" on:click={() => goto('/signup')}>
					新規登録して始める
				</button>
				<button class="btn btn-secondary" on:click={() => goto('/login')}>ログイン</button>
			</div>
		</div>
	</div>

	<div class="features">
		<div class="container">
			<h2 class="section-title">主な機能</h2>

			<div class="feature-grid">
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

				<div class="feature-card">
					<h3 class="feature-title">リアルタイム同期</h3>
					<p class="feature-description">
						全検定員の採点状況をリアルタイムで共有。待ち時間を削減し、スムーズな検定運営を実現します。
					</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">結果の集計・エクスポート</h3>
					<p class="feature-description">
						採点結果を自動集計し、CSV形式でエクスポート可能。報告書作成もスムーズに行えます。
					</p>
				</div>
			</div>
		</div>
	</div>

	<div class="how-it-works">
		<div class="container">
			<h2 class="section-title">使い方</h2>

			<div class="steps">
				<div class="step">
					<div class="step-number">1</div>
					<div class="step-content">
						<h3 class="step-title">検定・大会を作成</h3>
						<p class="step-description">セッションを作成し、参加コードを発行します。</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">2</div>
					<div class="step-content">
						<h3 class="step-title">検定員が参加</h3>
						<p class="step-description">他の検定員は参加コードを入力してセッションに参加します。</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">3</div>
					<div class="step-content">
						<h3 class="step-title">リアルタイムで採点</h3>
						<p class="step-description">
							各検定員がそれぞれの端末から採点。結果は自動的に同期されます。
						</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">4</div>
					<div class="step-content">
						<h3 class="step-title">結果の確認・共有</h3>
						<p class="step-description">
							採点結果を確認し、エクスポート。大会モードではスコアボードを公開できます。
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="cta-section">
		<div class="container">
			<h2 class="cta-title">今すぐ始めましょう</h2>
			<p class="cta-description">
				無料でアカウントを作成して、スキー・スノーボード検定・大会の採点を効率化しませんか？
			</p>
			<button class="btn btn-primary btn-large" on:click={() => goto('/signup')}> 新規登録 </button>
		</div>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f5f5f7;
	}

	.page {
		min-height: 100vh;
	}

	.hero {
		background: linear-gradient(135deg, #0071e3 0%, #0051a8 100%);
		color: white;
		padding: 80px 20px;
		text-align: center;
	}

	.hero-content {
		max-width: 800px;
		margin: 0 auto;
	}

	.title {
		font-size: 48px;
		font-weight: 700;
		margin-bottom: 16px;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 24px;
		font-weight: 500;
		margin-bottom: 20px;
		opacity: 0.95;
	}

	.description {
		font-size: 18px;
		line-height: 1.6;
		opacity: 0.9;
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
		color: #0071e3;
	}

	.btn-primary:hover {
		background: #f5f5f7;
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.2);
		color: white;
		border: 1px solid white;
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.3);
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
		background: white;
	}

	.section-title {
		font-size: 36px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 60px;
		color: #1d1d1f;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 32px;
	}

	.feature-card {
		background: #f5f5f7;
		border-radius: 16px;
		padding: 32px;
		text-align: center;
		transition: all 0.3s;
	}

	.feature-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
	}

	.feature-icon {
		font-size: 48px;
		margin-bottom: 20px;
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
		background: #f5f5f7;
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
		background: #0071e3;
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

	.cta-section {
		padding: 80px 20px;
		background: white;
		text-align: center;
	}

	.cta-title {
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
			font-size: 64px;
		}

		.subtitle {
			font-size: 28px;
		}

		.description {
			font-size: 20px;
		}

		.features,
		.how-it-works,
		.cta-section {
			padding: 100px 40px;
		}

		.section-title {
			font-size: 42px;
		}

		.feature-grid {
			gap: 40px;
		}
	}
</style>
