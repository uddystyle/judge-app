<script lang="ts">
	import { currentUser, currentSession, userProfile } from '$lib/stores';

	$: user = $currentUser;
	$: session = $currentSession;
	$: profile = $userProfile;
</script>

<div class="header">
	<p id="header-main-text">
		{#if profile?.full_name}
			ようこそ, {profile.full_name}
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
		background: var(--bg-cream);
		backdrop-filter: blur(10px);
		color: var(--text-primary);
		padding: 12px 20px;
		text-align: center;
		border-bottom: 2px solid var(--border-light);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}
	.header p {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.info-display {
		font-size: 12px;
		color: var(--text-secondary);
		margin-top: 4px;
	}
</style>
