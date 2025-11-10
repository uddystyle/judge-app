<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let confirmText = '';
	let isDeleting = false;

	$: canDelete = confirmText === data.organization.name;
</script>

<div class="container">
	<div class="page-header">
		<h1 class="page-title">組織の削除</h1>
	</div>

	{#if data.hasActiveSubscription}
		<div class="subscription-alert">
			<div class="alert-content">
				<h3 class="alert-title">有料プランのサブスクリプションがキャンセルされます</h3>
				<p class="alert-text">
					この組織には有料プラン（<strong>{data.organization.plan_type.toUpperCase()}</strong
					>）のアクティブなサブスクリプションがあります。
				</p>
				<p class="alert-text">
					組織を削除すると、<strong>Stripeのサブスクリプションが即座にキャンセル</strong
					>され、次回以降の請求は発生しません。
				</p>
				<p class="alert-note">※ 既にお支払いいただいた期間分の料金は返金されません</p>
			</div>
		</div>
	{/if}

	<div class="warning-section">
		<h2 class="warning-title">この操作は取り消せません</h2>
		<p class="warning-text">
			組織「<strong>{data.organization.name}</strong
			>」を削除すると、以下のデータがすべて失われます：
		</p>
		<ul class="warning-list">
			<li>組織情報</li>
			<li>メンバー情報</li>
			<li>すべてのセッション（先に削除が必要）</li>
			<li>セッションに関連するすべてのデータ</li>
		</ul>
	</div>

	{#if form?.error}
		<div class="error-container">
			<p class="error-message">{form.error}</p>
		</div>
	{/if}

	<form
		method="POST"
		action="?/delete"
		use:enhance={() => {
			isDeleting = true;
			return async ({ update }) => {
				await update();
				isDeleting = false;
			};
		}}
	>
		<div class="form-container">
			<div class="confirm-section">
				<label for="confirm-input" class="confirm-label">
					削除を確認するために、組織名「<strong>{data.organization.name}</strong
					>」を入力してください：
				</label>
				<input
					type="text"
					id="confirm-input"
					class="confirm-input"
					bind:value={confirmText}
					placeholder="組織名を入力"
				/>
			</div>

			<div class="nav-buttons">
				<button type="submit" class="delete-btn" disabled={!canDelete || isDeleting}>
					{isDeleting ? '削除中...' : '組織を削除'}
				</button>
			</div>
		</div>
	</form>

	<div class="nav-buttons" style="margin-top: 20px;">
		<NavButton on:click={() => goto(`/organization/${data.organization.id}`)}>キャンセル</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}
	.page-header {
		margin-bottom: 32px;
	}
	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: #dc3545;
		margin-bottom: 8px;
	}
	.warning-section {
		background: #fff5f5;
		border: 2px solid #dc3545;
		border-radius: 16px;
		padding: 24px;
		margin-bottom: 24px;
		text-align: left;
	}
	.warning-title {
		font-size: 20px;
		font-weight: 700;
		color: #dc3545;
		margin-bottom: 12px;
		text-align: center;
	}
	.warning-text {
		font-size: 15px;
		color: var(--text-primary);
		line-height: 1.6;
		margin-bottom: 16px;
	}
	.warning-list {
		list-style: none;
		padding-left: 0;
		margin: 0;
	}
	.warning-list li {
		padding: 8px 0;
		padding-left: 24px;
		position: relative;
		font-size: 14px;
		color: var(--text-primary);
	}
	.warning-list li::before {
		content: '•';
		position: absolute;
		left: 8px;
		color: #dc3545;
		font-weight: bold;
	}

	.subscription-alert {
		background: linear-gradient(135deg, #fff4e6 0%, #ffe8cc 100%);
		border: 3px solid var(--accent-primary);
		border-radius: 16px;
		padding: 24px;
		margin-bottom: 24px;
		display: flex;
		gap: 16px;
		align-items: flex-start;
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
	}

	.alert-content {
		flex: 1;
	}

	.alert-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--accent-primary);
		margin: 0 0 12px 0;
	}

	.alert-text {
		font-size: 15px;
		line-height: 1.6;
		color: var(--primary-text);
		margin: 0 0 8px 0;
	}

	.alert-note {
		font-size: 13px;
		color: var(--secondary-text);
		margin: 12px 0 0 0;
		font-style: italic;
	}

	.form-container {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.confirm-section {
		text-align: left;
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 12px;
		padding: 20px;
	}
	.confirm-label {
		display: block;
		font-size: 14px;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 12px;
		line-height: 1.5;
	}
	.confirm-input {
		width: 100%;
		background: var(--bg-primary);
		border: 2px solid var(--separator-gray);
		border-radius: 8px;
		padding: 12px;
		font-size: 16px;
		transition: all 0.2s;
	}
	.confirm-input:focus {
		outline: none;
		border-color: #dc3545;
		box-shadow: 0 0 0 3px rgba(255, 59, 48, 0.1);
	}
	.error-container {
		background: #fee;
		border: 2px solid #dc3545;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
		margin-bottom: 20px;
	}
	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin: 0;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.delete-btn {
		width: 100%;
		background: #dc3545;
		color: white;
		border: none;
		border-radius: 12px;
		padding: 16px;
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.delete-btn:hover:not(:disabled) {
		background: #d32f2f;
		box-shadow: 0 4px 16px rgba(255, 59, 48, 0.3);
	}
	.delete-btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.delete-btn:disabled {
		background: var(--separator-gray);
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* PC対応 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}
		.page-title {
			font-size: 32px;
		}
		.warning-section {
			padding: 32px;
		}
		.confirm-section {
			padding: 24px;
		}
	}
</style>
