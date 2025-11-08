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

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="container">
	<div class="page-header">
		<h1 class="page-title">組織の削除</h1>
	</div>

	<div class="warning-section">
		<div class="warning-icon">⚠️</div>
		<h2 class="warning-title">この操作は取り消せません</h2>
		<p class="warning-text">
			組織「<strong>{data.organization.name}</strong>」を削除すると、以下のデータがすべて失われます：
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

	<form method="POST" action="?/delete" use:enhance={() => {
		isDeleting = true;
		return async ({ update }) => {
			await update();
			isDeleting = false;
		};
	}}>
		<div class="form-container">
			<div class="confirm-section">
				<label for="confirm-input" class="confirm-label">
					削除を確認するために、組織名「<strong>{data.organization.name}</strong>」を入力してください：
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
				<button
					type="submit"
					class="delete-btn"
					disabled={!canDelete || isDeleting}
				>
					{isDeleting ? '削除中...' : '組織を削除'}
				</button>
			</div>
		</div>
	</form>

	<div class="nav-buttons" style="margin-top: 20px;">
		<NavButton on:click={() => goto(`/organization/${data.organization.id}`)}>
			キャンセル
		</NavButton>
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
		color: var(--ios-red);
		margin-bottom: 8px;
	}
	.warning-section {
		background: #fff5f5;
		border: 2px solid var(--ios-red);
		border-radius: 16px;
		padding: 24px;
		margin-bottom: 24px;
		text-align: left;
	}
	.warning-icon {
		font-size: 48px;
		text-align: center;
		margin-bottom: 16px;
	}
	.warning-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--ios-red);
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
		color: var(--ios-red);
		font-weight: bold;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.confirm-section {
		text-align: left;
		background: var(--bg-white);
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
		background: var(--bg-white);
		border: 2px solid var(--separator-gray);
		border-radius: 8px;
		padding: 12px;
		font-size: 16px;
		transition: all 0.2s;
	}
	.confirm-input:focus {
		outline: none;
		border-color: var(--ios-red);
		box-shadow: 0 0 0 3px rgba(255, 59, 48, 0.1);
	}
	.error-container {
		background: #fee;
		border: 2px solid var(--ios-red);
		border-radius: 12px;
		padding: 16px;
		text-align: center;
		margin-bottom: 20px;
	}
	.error-message {
		color: var(--ios-red);
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
		background: var(--ios-red);
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
