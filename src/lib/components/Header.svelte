<script lang="ts">
	import { currentUser, currentSession } from '$lib/stores';

	$: user = $currentUser;
	$: session = $currentSession;
</script>

<div class="header">
	<p id="header-main-text">
		{#if user}
			ようこそ, {user.email}
		{:else}
			ようこそ
		{/if}
	</p>
	<div class="info-display">
		<span id="session-info">
			検定: {session ? session.name : '未選択'}
		</span>
	</div>
</div>

<style>
	.header {
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(10px);
		color: var(--primary-text);
		padding: 12px 20px;
		text-align: center;
		border-bottom: 1px solid var(--separator-gray);
	}
	.header p {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}
	.info-display {
		font-size: 12px;
		color: var(--secondary-text);
		margin-top: 4px;
	}
</style>
