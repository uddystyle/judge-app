<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	// サーバーアクションから返されるデータ（エラーメッセージなど）を保持
	export let form: ActionData;
	export let data: PageData;
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.hasOrganization}
	pageOrganizations={data.organizations}
/>

<div class="container">
	<div class="instruction">組織に参加</div>

	<form method="POST" action="?/join" use:enhance>
		<div class="form-container">
			<input
				type="text"
				name="joinCode"
				id="join-code-input"
				placeholder="6桁の招待コード"
				maxlength="6"
				style="text-transform: uppercase;"
				value={form?.joinCode ?? ''}
			/>

			{#if form?.error}
				<p class="error-message">{form.error}</p>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">参加</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/onboarding/create-organization')}>戻る</NavButton>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 80px 20px 60px;
		text-align: center;
		max-width: 400px;
		margin: 0 auto;
		min-height: calc(100vh - 140px);
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.form-container input {
		background: #fff;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 15px;
		font-size: 16px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.error-message {
		color: #dc3545;
		font-size: 14px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 100px 40px 80px;
			max-width: 600px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.form-container input {
			padding: 18px;
			font-size: 20px;
			letter-spacing: 0.1em;
		}
		.error-message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
