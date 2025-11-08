<script lang="ts">
	import { currentUser, currentSession, userProfile, currentDiscipline, currentLevel, currentEvent, currentBib } from '$lib/stores';
	import { goto } from '$app/navigation';

	// Props
	export let showAppName = false; // 料金プランページなどで使用
	export let pageUser: any = null; // ページから渡されるユーザー情報（料金ページなど）
	export let pageProfile: any = null; // ページから渡されるプロフィール情報

	$: user = pageUser || $currentUser;
	$: session = $currentSession;
	$: profile = pageProfile || $userProfile;
	$: discipline = $currentDiscipline;
	$: level = $currentLevel;
	$: event = $currentEvent;
	$: bib = $currentBib;

	// 表示する情報を構築
	$: infoText = buildInfoText(session, discipline, level, event, bib);

	function buildInfoText(session: any, discipline: string | null, level: string | null, event: string | null, bib: number | null): string {
		const parts: string[] = [];

		if (session?.name) {
			parts.push(session.name);
		}

		if (discipline) {
			parts.push(discipline);
		}

		// 大会モード（discipline='大会', level='共通'）の場合は級を表示しない
		if (level && !(discipline === '大会' && level === '共通')) {
			parts.push(level);
		}

		if (event) {
			parts.push(event);
		}

		if (bib) {
			parts.push(`No.${bib}`);
		}

		return parts.length > 0 ? parts.join(' / ') : '未選択';
	}

	function handleAppNameClick() {
		// pageUserかstoreのuserを使ってログイン状態を判定
		const currentUser = pageUser || user;
		if (currentUser) {
			goto('/dashboard');
		} else {
			goto('/');
		}
	}
</script>

<div class="header">
	<div class="header-content">
		<div class="info-display">
			{#if showAppName}
				<button class="app-name-button" on:click={handleAppNameClick}>
					TENTO
				</button>
			{:else}
				<span id="session-info">
					{infoText}
				</span>
			{/if}
		</div>
		<button class="account-button" on:click={() => goto('/account')}>
			{profile?.full_name || 'アカウント'}
		</button>
	</div>
</div>

<style>
	.header {
		background: var(--bg-cream);
		backdrop-filter: blur(10px);
		color: var(--text-primary);
		padding: 12px 20px;
		border-bottom: 2px solid var(--border-light);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}
	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		max-width: 1200px;
		margin: 0 auto;
	}
	.info-display {
		font-size: 14px;
		color: var(--text-secondary);
		font-weight: 500;
		flex: 1;
		text-align: left;
	}
	.app-name-button {
		background: transparent;
		border: none;
		font-size: 20px;
		font-weight: 800;
		font-family: 'M PLUS Rounded 1c', sans-serif;
		color: #2d2d2d;
		letter-spacing: 0.05em;
		cursor: pointer;
		padding: 0;
		transition: all 0.2s;
	}
	.app-name-button:hover {
		color: #ff6b35;
		transform: scale(1.02);
	}
	.app-name-button:active {
		transform: scale(0.98);
	}
	.account-button {
		background: var(--bg-white);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
		border-radius: 20px;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.account-button:hover {
		border-color: var(--primary-orange);
		background: var(--primary-orange-hover);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
	}
	.account-button:active {
		transform: scale(0.98);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.header {
			padding: 16px 40px;
		}
		.info-display {
			font-size: 16px;
		}
		.app-name-button {
			font-size: 28px;
		}
		.account-button {
			font-size: 16px;
			padding: 10px 20px;
			border-radius: 24px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.app-name-button {
			font-size: 32px;
		}
		.account-button {
			font-size: 18px;
			padding: 12px 24px;
		}
	}
</style>
