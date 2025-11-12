<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import NavButton from '$lib/components/NavButton.svelte';

	export let data: PageData;
	export let form: ActionData;

	let guestName = '';
	let isSubmitting = false;
</script>

<Header showAppName={true} />

<div class="container">
	{#if data.error}
		<!-- エラー表示 -->
		<div class="error-container">
			<h1 class="error-title">招待リンクが無効です</h1>
			<p class="error-message">{data.error}</p>
			<div class="nav-buttons">
				<NavButton variant="primary" on:click={() => window.location.href = '/'}>
					トップページへ戻る
				</NavButton>
			</div>
		</div>
	{:else if data.session}
		<!-- セッション情報と参加フォーム -->
		<div class="invite-container">
			<div class="session-info">
				<h1 class="session-title">{data.session.name}</h1>
				<div class="session-details">
					<div class="detail-item">
						<span class="detail-label">主催:</span>
						<span class="detail-value">{data.session.organizations?.name || '組織名不明'}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">モード:</span>
						<span class="detail-value">
							{#if data.session.is_tournament_mode || data.session.mode === 'tournament'}
								大会モード
							{:else if data.session.mode === 'training'}
								研修モード
							{:else}
								検定モード
							{/if}
						</span>
					</div>
				</div>
			</div>

			<div class="join-form-container">
				<h2 class="form-title">ゲストとして参加</h2>
				<p class="form-description">
					アカウント登録なしで、このセッションに参加できます。<br />
					お名前を入力してください。
				</p>

				<form method="POST" action="?/join" use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
						isSubmitting = false;
					};
				}}>
					<div class="input-group">
						<label for="guestName">お名前</label>
						<input
							type="text"
							id="guestName"
							name="guestName"
							bind:value={guestName}
							placeholder="山田 太郎"
							required
							maxlength="50"
							disabled={isSubmitting}
						/>
					</div>

					{#if form?.error}
						<div class="error-message">
							{form.error}
						</div>
					{/if}

					<div class="form-actions">
						<button type="submit" class="join-btn" disabled={isSubmitting || !guestName.trim()}>
							{isSubmitting ? '参加中...' : 'セッションに参加'}
						</button>
					</div>
				</form>

				<div class="info-note">
					<p><strong>ゲスト参加の特徴:</strong></p>
					<ul>
						<li>アカウント登録は不要です</li>
						<li>このセッションで採点を行えます</li>
						<li>セッション終了後も結果を確認できます</li>
					</ul>
				</div>

				<div class="login-link">
					<p>既にアカウントをお持ちですか？</p>
					<a href="/login">ログインして参加</a>
				</div>
			</div>
		</div>
	{/if}
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
		min-height: calc(100vh - 120px);
	}

	.error-container {
		text-align: center;
		padding: 40px 20px;
	}

	.error-title {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 16px;
	}

	.error-message {
		font-size: 16px;
		color: var(--text-secondary);
		margin-bottom: 32px;
	}

	.invite-container {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}

	.session-info {
		background: white;
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 24px;
	}

	.session-title {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 16px;
		text-align: center;
	}

	.session-details {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.detail-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid var(--border-light);
	}

	.detail-item:last-child {
		border-bottom: none;
	}

	.detail-label {
		font-size: 14px;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.detail-value {
		font-size: 15px;
		color: var(--text-primary);
		font-weight: 600;
	}

	.join-form-container {
		background: white;
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 24px;
	}

	.form-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
		text-align: center;
	}

	.form-description {
		font-size: 14px;
		color: var(--text-secondary);
		text-align: center;
		line-height: 1.6;
		margin-bottom: 24px;
	}

	.input-group {
		margin-bottom: 20px;
	}

	.input-group label {
		display: block;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.input-group input {
		width: 100%;
		padding: 14px 16px;
		font-size: 16px;
		border: 2px solid var(--border-medium);
		border-radius: 10px;
		transition: all 0.2s;
		font-family: inherit;
	}

	.input-group input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.1);
	}

	.input-group input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		background: var(--bg-secondary);
	}

	.error-message {
		background: #fee;
		border: 2px solid #dc3545;
		border-radius: 8px;
		padding: 12px 16px;
		color: #dc3545;
		font-size: 14px;
		margin-bottom: 20px;
		text-align: center;
	}

	.form-actions {
		margin-bottom: 24px;
	}

	.join-btn {
		width: 100%;
		padding: 16px;
		font-size: 16px;
		font-weight: 600;
		color: white;
		background: var(--accent-primary);
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.join-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.join-btn:active:not(:disabled) {
		transform: translateY(0);
	}

	.join-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.info-note {
		background: var(--bg-secondary);
		border-radius: 10px;
		padding: 16px;
		margin-bottom: 20px;
	}

	.info-note p {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.info-note ul {
		list-style-position: inside;
		padding-left: 0;
		margin: 0;
	}

	.info-note li {
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 4px;
	}

	.login-link {
		text-align: center;
		padding-top: 16px;
		border-top: 1px solid var(--border-light);
	}

	.login-link p {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.login-link a {
		font-size: 15px;
		font-weight: 600;
		color: var(--accent-primary);
		text-decoration: none;
		transition: opacity 0.2s;
	}

	.login-link a:hover {
		opacity: 0.8;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 24px;
	}

	/* PC対応 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 600px;
		}

		.session-info,
		.join-form-container {
			padding: 32px;
		}

		.session-title {
			font-size: 28px;
		}

		.form-title {
			font-size: 22px;
		}

		.input-group input {
			padding: 16px 18px;
			font-size: 18px;
		}

		.join-btn {
			padding: 18px;
			font-size: 18px;
		}
	}
</style>
