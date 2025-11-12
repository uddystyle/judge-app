<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	export let data: PageData;

	$: sessionId = $page.params.id;
</script>

<Header />

<div class="container">
	<div class="instruction">大会設定</div>

	<p class="setup-info">この大会を始める前に設定してください。<br />後からでも変更できます。</p>

	<div class="setup-cards">
		<!-- 種目設定カード -->
		<div class="setup-card">
			<div class="card-content">
				<h3>種目設定</h3>
				<p class="card-description">種目を追加してください</p>
				<p class="card-status">({data.eventsCount}件登録済み)</p>
			</div>
			<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup/events`)}>
				種目を設定 →
			</NavButton>
		</div>

		<!-- 採点方式カード -->
		<div class="setup-card">
			<div class="card-content">
				<h3>採点方式</h3>
				<p class="card-description">3審3採 または 5審3採</p>
				<p class="card-status">
					{#if data.sessionDetails.exclude_extremes}
						(5審3採に設定済み)
					{:else}
						(3審3採に設定済み)
					{/if}
				</p>
			</div>
			<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup/scoring`)}>
				採点方式を設定 →
			</NavButton>
		</div>

		<!-- 参加者登録カード（オプション） -->
		<div class="setup-card optional">
			<div class="card-content">
				<h3>参加者情報 <span class="optional-badge">オプション</span></h3>
				<p class="card-description">エクスポート時に選手名・チーム名を含めたい場合に登録</p>
				<p class="card-status">({data.participantsCount}名登録済み)</p>
			</div>
			<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup/participants`)}>
				参加者を登録 →
			</NavButton>
		</div>
	</div>

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={() => goto('/dashboard')}>
			設定完了
		</NavButton>
		<NavButton on:click={() => goto('/dashboard')}>
			後で設定する
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
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 12px;
		color: var(--primary-text);
	}
	.setup-info {
		font-size: 15px;
		color: var(--secondary-text);
		margin-bottom: 28px;
		line-height: 1.6;
	}
	.setup-cards {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 28px;
	}
	.setup-card {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		text-align: left;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}
	.setup-card.optional {
		border-style: dashed;
		background: #f8f9fa;
	}
	.card-content h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 8px;
		color: var(--primary-text);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.optional-badge {
		font-size: 12px;
		font-weight: 500;
		color: var(--secondary-text);
		background: #e8e8ed;
		padding: 2px 8px;
		border-radius: 4px;
	}
	.card-description {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 4px;
		line-height: 1.4;
	}
	.card-status {
		font-size: 13px;
		color: var(--ios-blue);
		font-weight: 500;
		margin-bottom: 12px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
