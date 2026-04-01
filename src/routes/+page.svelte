<script lang="ts">
	import { goto } from '$app/navigation';
	import Footer from '$lib/components/Footer.svelte';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages.js';

	export let data: PageData;
</script>

<svelte:head>
	<title>{m.landing_metaTitle()}</title>
	<meta name="description" content={m.landing_metaDescription()} />
	<meta property="og:title" content={m.landing_metaTitle()} />
	<meta property="og:description" content={m.landing_metaDescription()} />
	<meta property="og:type" content="website" />
	<link rel="canonical" href="https://tento.vercel.app/" />
</svelte:head>

<div class="page">
	<div class="hero">
		<div class="hero-content">
			<h1 class="title">{m.landing_title()}</h1>
			<p class="subtitle">
				{m.landing_subtitle()}
			</p>
			<p class="description">
				{m.landing_description()}
			</p>

			<div class="cta-buttons">
				{#if data.user}
					<button class="btn btn-primary" on:click={() => goto('/dashboard')}>
						{m.landing_backToDashboard()}
					</button>
				{:else}
					<button class="btn btn-primary" on:click={() => goto('/signup')}>
						{m.auth_signup()}
					</button>
					<button class="btn btn-secondary" on:click={() => goto('/login')}>{m.common_login()}</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="features" id="features">
		<div class="container">
			<h2 class="section-title">{m.landing_featuresTitle()}</h2>

			<div class="feature-grid">
				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureOrgTitle()}</h3>
					<p class="feature-description">{m.landing_featureOrgDesc()}</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureCertTitle()}</h3>
					<p class="feature-description">{m.landing_featureCertDesc()}</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureCompTitle()}</h3>
					<p class="feature-description">{m.landing_featureCompDesc()}</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureTrainingTitle()}</h3>
					<p class="feature-description">{m.landing_featureTrainingDesc()}</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureMultiJudgeTitle()}</h3>
					<p class="feature-description">{m.landing_featureMultiJudgeDesc()}</p>
				</div>

				<div class="feature-card">
					<h3 class="feature-title">{m.landing_featureMobileTitle()}</h3>
					<p class="feature-description">{m.landing_featureMobileDesc()}</p>
				</div>
			</div>
		</div>
	</div>

	<div class="how-it-works" id="how-it-works">
		<div class="container">
			<h2 class="section-title">{m.landing_howItWorksTitle()}</h2>

			<div class="steps">
				<div class="step">
					<div class="step-number">1</div>
					<div class="step-content">
						<h3 class="step-title">{m.landing_step1Title()}</h3>
						<p class="step-description">{m.landing_step1Desc()}</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">2</div>
					<div class="step-content">
						<h3 class="step-title">{m.landing_step2Title()}</h3>
						<p class="step-description">{m.landing_step2Desc()}</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">3</div>
					<div class="step-content">
						<h3 class="step-title">{m.landing_step3Title()}</h3>
						<p class="step-description">{m.landing_step3Desc()}</p>
					</div>
				</div>

				<div class="step">
					<div class="step-number">4</div>
					<div class="step-content">
						<h3 class="step-title">{m.landing_step4Title()}</h3>
						<p class="step-description">{m.landing_step4Desc()}</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="pricing-section">
		<div class="container">
			<h2 class="section-title">{m.landing_pricingTitle()}</h2>
			<p class="pricing-intro">{m.landing_pricingIntro()}</p>

			<div class="pricing-grid">
				<div class="pricing-card">
					<h3 class="plan-name">{m.landing_planFree()}</h3>
					<p class="plan-subtitle">{m.landing_planFreeSubtitle()}</p>
					<div class="plan-price">¥0<span class="price-unit">{m.landing_perMonth()}</span></div>
					<ul class="plan-features">
						<li>{m.landing_orgMembers({ count: '1' })}</li>
						<li>{m.landing_judges({ count: '3' })}</li>
						<li>{m.landing_monthlySessions({ count: '3' })}</li>
						<li>{m.landing_certModeOnly()}</li>
						<li>{m.landing_excelExport()}</li>
					</ul>
				</div>

				<div class="pricing-card">
					<h3 class="plan-name">{m.landing_planBasic()}</h3>
					<p class="plan-subtitle">{m.landing_planBasicSubtitle()}</p>
					<div class="plan-price">¥8,800<span class="price-unit">{m.landing_perMonth()}</span></div>
					<ul class="plan-features">
						<li>{m.landing_orgMembers({ count: '10' })}</li>
						<li>{m.landing_judges({ count: '15' })}</li>
						<li>{m.landing_unlimitedSessions()}</li>
						<li>{m.landing_allModes()}</li>
						<li>{m.landing_excelExport()}</li>
					</ul>
				</div>

				<div class="pricing-card recommended">
					<div class="recommended-badge">{m.landing_recommended()}</div>
					<h3 class="plan-name">{m.landing_planStandard()}</h3>
					<p class="plan-subtitle">{m.landing_planStandardSubtitle()}</p>
					<div class="plan-price">¥24,800<span class="price-unit">{m.landing_perMonth()}</span></div>
					<ul class="plan-features">
						<li>{m.landing_orgMembers({ count: '30' })}</li>
						<li>{m.landing_judges({ count: '50' })}</li>
						<li>{m.landing_unlimitedSessions()}</li>
						<li>{m.landing_allModes()}</li>
						<li>{m.landing_excelExport()}</li>
					</ul>
				</div>

				<div class="pricing-card">
					<h3 class="plan-name">{m.landing_planPremium()}</h3>
					<p class="plan-subtitle">{m.landing_planPremiumSubtitle()}</p>
					<div class="plan-price">¥49,800<span class="price-unit">{m.landing_perMonth()}</span></div>
					<ul class="plan-features">
						<li>{m.landing_orgMembers({ count: '100' })}</li>
						<li>{m.landing_judges({ count: '100' })}</li>
						<li>{m.landing_unlimitedSessions()}</li>
						<li>{m.landing_allModes()}</li>
						<li>{m.landing_excelExport()}</li>
						<li>{m.landing_prioritySupport()}</li>
					</ul>
				</div>
			</div>

			<div class="pricing-cta">
				<button class="btn btn-secondary" on:click={() => goto('/pricing')}>
					{m.landing_viewPricingDetails()}
				</button>
			</div>
		</div>
	</div>

	{#if !data.user}
		<div class="cta-section">
			<div class="container">
				<h2 class="cta-title">{m.landing_ctaTitle()}</h2>
				<p class="cta-description">{m.landing_ctaDescription()}</p>
				<button class="btn btn-primary btn-large" on:click={() => goto('/signup')}>{m.landing_ctaButton()}</button>
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
		font-family: 'M PLUS Rounded 1c', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif;
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
		background: linear-gradient(135deg, #404040 0%, #262626 100%);
		color: white;
		border: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.btn-primary:hover {
		background: linear-gradient(135deg, #525252 0%, #404040 100%);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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
		font-family: 'M PLUS Rounded 1c', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif;
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
		font-family: 'M PLUS Rounded 1c', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif;
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

	@media (min-width: 768px) {
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
