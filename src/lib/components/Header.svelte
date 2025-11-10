<script lang="ts">
	import { currentUser, currentSession, userProfile, currentDiscipline, currentLevel, currentEvent, currentBib } from '$lib/stores';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// Props
	export let showAppName = false; // 料金プランページなどで使用
	export let pageUser: any = null; // ページから渡されるユーザー情報（料金ページなど）
	export let pageProfile: any = null; // ページから渡されるプロフィール情報
	export let hasOrganization = false; // 組織に属しているかどうか
	export let pageOrganizations: any[] = []; // ページから渡される組織情報

	const supabase = getContext<SupabaseClient>('supabase');

	$: user = pageUser || $currentUser;
	$: session = $currentSession;
	$: profile = pageProfile || $userProfile;
	$: discipline = $currentDiscipline;
	$: level = $currentLevel;
	$: event = $currentEvent;
	$: bib = $currentBib;

	// ドロップダウンメニューの表示状態
	let showMenu = false;

	// ログアウト確認ダイアログの表示状態
	let showLogoutDialog = false;

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

	function toggleMenu() {
		showMenu = !showMenu;
	}

	function handleMenuClick(path: string) {
		showMenu = false;
		goto(path);
	}

	function handleLogout() {
		showMenu = false;
		showLogoutDialog = true;
	}

	async function confirmLogout() {
		await supabase.auth.signOut();
		goto('/login');
	}

	// メニュー外をクリックしたときに閉じる
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.account-menu-wrapper')) {
			showMenu = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

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
		<div class="account-menu-wrapper">
			<button class="account-button" on:click={toggleMenu}>
				{#if hasOrganization}
					<span class="org-badge">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<circle cx="8" cy="8" r="7.5" stroke="currentColor" stroke-width="1"/>
							<path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</span>
				{/if}
				{profile?.full_name || 'アカウント'}
				<span class="menu-icon" class:rotated={showMenu}>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</span>
			</button>

			{#if showMenu}
				<div class="dropdown-menu">
					<button class="menu-item" on:click={() => handleMenuClick('/account')}>
						<span class="menu-label">プロフィール</span>
					</button>
					<button class="menu-item" on:click={() => handleMenuClick('/pricing')}>
						<span class="menu-label">プランの確認</span>
					</button>
					{#if pageOrganizations.length > 0}
						<button class="menu-item" on:click={() => handleMenuClick(`/organization/${pageOrganizations[0].id || pageOrganizations[0].organization_id}/change-plan`)}>
							<span class="menu-label">プランの変更</span>
						</button>
					{/if}
					<button class="menu-item" on:click={() => handleMenuClick('/organizations')}>
						<span class="menu-label">組織</span>
					</button>
					<button class="menu-item" on:click={() => handleMenuClick('/dashboard')}>
						<span class="menu-label">セッション</span>
					</button>
					{#if user}
						<div class="menu-divider"></div>
						<button class="menu-item logout" on:click={handleLogout}>
							<span class="menu-label">ログアウト</span>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<ConfirmDialog
	bind:isOpen={showLogoutDialog}
	title="ログアウト"
	message="ログアウトしますか？"
	confirmText="ログアウト"
	cancelText="キャンセル"
	on:confirm={confirmLogout}
/>

<style>
	.header {
		background: var(--bg-primary);
		color: var(--text-primary);
		padding: 12px 20px;
		border-bottom: 1px solid var(--border-light);
		box-shadow: none;
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
		letter-spacing: -0.01em;
	}
	.app-name-button {
		background: transparent;
		border: none;
		font-size: 20px;
		font-weight: 800;
		font-family: 'M PLUS Rounded 1c', sans-serif;
		color: var(--text-primary);
		letter-spacing: 0.05em;
		cursor: pointer;
		padding: 0;
		transition: all 0.15s ease;
	}
	.app-name-button:hover {
		color: var(--text-secondary);
		transform: scale(1.02);
	}
	.app-name-button:active {
		transform: scale(0.98);
	}
	.account-button {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1.5px solid var(--border-medium);
		border-radius: 8px;
		padding: 10px 16px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		box-shadow: none;
		letter-spacing: -0.01em;
		min-height: 44px;
	}
	.account-button:hover {
		background: var(--bg-hover);
		border-color: var(--border-dark);
	}
	.account-button:active {
		transform: scale(0.98);
		background: var(--gray-200);
	}
	.menu-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.menu-icon.rotated {
		transform: rotate(180deg);
	}
	.menu-icon svg {
		display: block;
	}
	.account-menu-wrapper {
		position: relative;
	}
	.dropdown-menu {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		background: var(--bg-primary);
		border: 1px solid var(--border-medium);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		min-width: 200px;
		z-index: 1000;
		overflow: hidden;
	}
	.menu-item {
		width: 100%;
		background: transparent;
		border: none;
		padding: 14px 16px;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
	}
	.menu-item:hover {
		background: var(--bg-hover);
	}
	.menu-item:active {
		background: var(--gray-200);
	}
	.menu-item.logout {
		color: #dc3545;
	}
	.menu-item.logout:hover {
		background: #fff5f5;
	}
	.menu-label {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.01em;
	}
	.menu-item.logout .menu-label {
		color: #dc3545;
	}
	.menu-divider {
		height: 1px;
		background: var(--border-light);
		margin: 4px 0;
	}
	.org-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent-primary);
	}
	.org-badge svg {
		display: block;
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
