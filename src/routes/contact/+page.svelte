<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';

	export let data: PageData;
	export let form: ActionData;

	let isSubmitting = false;
</script>

<svelte:head>
	<title>お問い合わせ - TENTO</title>
</svelte:head>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="header-section">
		<h1 class="title">お問い合わせ</h1>
		<p class="subtitle">
			ご質問やご要望がございましたら、<br class="mobile-br" />お気軽にお問い合わせください。<br />
			通常、1-2営業日以内に返信いたします。
		</p>
	</div>

	{#if form?.success}
		<div class="success-message">
			<div class="success-icon">✓</div>
			<h2>お問い合わせを受け付けました</h2>
			<p>ご連絡ありがとうございます。担当者より折り返しご連絡いたします。</p>
			<button class="back-btn" on:click={() => goto('/')}>トップページに戻る</button>
		</div>
	{:else}
		<div class="form-container">
			<form
				method="POST"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
						isSubmitting = false;
					};
				}}
			>
				<div class="form-group">
					<label for="name" class="label">お名前 <span class="required">*</span></label>
					<input
						type="text"
						id="name"
						name="name"
						class="input"
						class:error={form?.errors?.name}
						value={form?.name || ''}
						required
						placeholder="山田 太郎"
					/>
					{#if form?.errors?.name}
						<p class="error-text">{form.errors.name}</p>
					{/if}
				</div>

				<div class="form-group">
					<label for="email" class="label">メールアドレス <span class="required">*</span></label>
					<input
						type="email"
						id="email"
						name="email"
						class="input"
						class:error={form?.errors?.email}
						value={form?.email || ''}
						required
						placeholder="example@example.com"
					/>
					{#if form?.errors?.email}
						<p class="error-text">{form.errors.email}</p>
					{/if}
				</div>

				<div class="form-group">
					<label for="organization" class="label">組織名・団体名（任意）</label>
					<input
						type="text"
						id="organization"
						name="organization"
						class="input"
						value={form?.organization || ''}
						placeholder="〇〇スキークラブ"
					/>
				</div>

				<div class="form-group">
					<label for="subject" class="label">件名 <span class="required">*</span></label>
					<input
						type="text"
						id="subject"
						name="subject"
						class="input"
						class:error={form?.errors?.subject}
						value={form?.subject || ''}
						required
						placeholder="例：料金プランについて"
					/>
					{#if form?.errors?.subject}
						<p class="error-text">{form.errors.subject}</p>
					{/if}
				</div>

				<div class="form-group">
					<label for="category" class="label"
						>お問い合わせ種別 <span class="required">*</span></label
					>
					<select
						id="category"
						name="category"
						class="input select"
						class:error={form?.errors?.category}
						required
					>
						<option value="">選択してください</option>
						<option value="general" selected={form?.category === 'general'}>一般的な質問</option>
						<option value="technical" selected={form?.category === 'technical'}>技術的な問題</option
						>
						<option value="billing" selected={form?.category === 'billing'}
							>料金・請求について</option
						>
						<option value="feature" selected={form?.category === 'feature'}>機能に関する要望</option
						>
						<option value="other" selected={form?.category === 'other'}>その他</option>
					</select>
					{#if form?.errors?.category}
						<p class="error-text">{form.errors.category}</p>
					{/if}
				</div>

				<div class="form-group">
					<label for="message" class="label">お問い合わせ内容 <span class="required">*</span></label
					>
					<textarea
						id="message"
						name="message"
						class="input textarea"
						class:error={form?.errors?.message}
						rows="8"
						required
						placeholder="お問い合わせ内容を詳しくご記入ください">{form?.message || ''}</textarea
					>
					{#if form?.errors?.message}
						<p class="error-text">{form.errors.message}</p>
					{/if}
				</div>

				{#if form?.error}
					<div class="error-message">
						{form.error}
					</div>
				{/if}

				<div class="button-group">
					<button type="submit" class="submit-btn" disabled={isSubmitting}>
						{isSubmitting ? '送信中...' : '送信する'}
					</button>
					<button type="button" class="cancel-btn" on:click={() => goto('/')}> キャンセル </button>
				</div>
			</form>
		</div>

		<div class="info-section">
			<h2 class="info-title">その他のお問い合わせ方法</h2>
			<div class="info-cards">
				<div class="info-card">
					<h3>メールでのお問い合わせ</h3>
					<p>support@tentoapp.com</p>
					<p class="info-note">営業時間: 平日 9:00-18:00</p>
				</div>
				<div class="info-card">
					<h3>よくある質問</h3>
					<p>よくある質問ページで解決できる<br />場合があります</p>
					<button class="info-link" on:click={() => goto('/faq')}>FAQを見る</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 800px;
		margin: 0 auto;
		min-height: calc(100vh - 200px);
	}

	.header-section {
		text-align: center;
		margin-bottom: 48px;
	}

	.title {
		font-size: 32px;
		font-weight: 700;
		margin-bottom: 16px;
		color: var(--primary-text);
	}

	.subtitle {
		font-size: 16px;
		color: var(--secondary-text);
		line-height: 1.7;
	}

	.success-message {
		background: white;
		border-radius: 16px;
		padding: 48px 32px;
		text-align: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.success-icon {
		width: 80px;
		height: 80px;
		background: #2d7a3e;
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 48px;
		margin: 0 auto 24px;
	}

	.success-message h2 {
		font-size: 24px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.success-message p {
		font-size: 16px;
		color: var(--secondary-text);
		margin-bottom: 32px;
		line-height: 1.6;
	}

	.form-container {
		background: white;
		border-radius: 16px;
		padding: 32px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		margin-bottom: 48px;
	}

	.form-group {
		margin-bottom: 24px;
	}

	.label {
		display: block;
		font-size: 15px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.required {
		color: var(--accent-primary);
	}

	.input {
		width: 100%;
		padding: 12px 16px;
		border: 2px solid var(--separator-gray);
		border-radius: 10px;
		font-size: 16px;
		transition: all 0.2s;
		font-family: inherit;
		background: white;
	}

	.input:focus {
		outline: none;
		border-color: var(--ios-blue);
	}

	.input.error {
		border-color: var(--accent-primary);
	}

	.select {
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 16px center;
		padding-right: 40px;
	}

	.textarea {
		resize: vertical;
		min-height: 120px;
		line-height: 1.6;
	}

	.error-text {
		color: var(--accent-primary);
		font-size: 14px;
		margin-top: 6px;
	}

	.error-message {
		background: #fee;
		color: #c33;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}

	.button-group {
		display: flex;
		gap: 12px;
		margin-top: 32px;
	}

	.submit-btn {
		flex: 1;
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.submit-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cancel-btn {
		background: white;
		color: var(--secondary-text);
		border: 2px solid var(--separator-gray);
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-btn:hover {
		background: var(--bg-secondary);
	}

	.back-btn {
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.back-btn:hover {
		opacity: 0.85;
	}

	.info-section {
		margin-top: 48px;
	}

	.info-title {
		font-size: 24px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 28px;
		color: var(--primary-text);
	}

	.info-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 24px;
	}

	.info-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 16px;
		padding: 32px 24px;
		text-align: center;
		transition: all 0.3s;
	}

	.info-card:hover {
		border-color: var(--ios-blue);
		box-shadow: 0 4px 16px rgba(0, 122, 255, 0.15);
	}

	.info-card h3 {
		font-size: 18px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.info-card p {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.6;
		margin-bottom: 8px;
	}

	.info-note {
		font-size: 13px;
		color: var(--secondary-text);
	}

	.info-link {
		background: var(--bg-secondary);
		color: var(--ios-blue);
		border: 2px solid var(--ios-blue);
		border-radius: 8px;
		padding: 10px 20px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		margin-top: 16px;
	}

	.info-link:hover {
		background: var(--ios-blue);
		color: white;
	}

	/* モバイルのみ表示される改行 */
	.mobile-br {
		display: inline;
	}

	@media (min-width: 768px) {
		.mobile-br {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.form-container {
			padding: 24px 20px;
		}

		.button-group {
			flex-direction: column;
		}

		.info-cards {
			grid-template-columns: 1fr;
		}
	}
</style>
