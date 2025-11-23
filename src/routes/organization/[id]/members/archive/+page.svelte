<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import NavButton from '$lib/components/NavButton.svelte';

	export let data: PageData;

	// 役割名のマッピング
	const roleNames: Record<string, string> = {
		admin: '管理者',
		member: 'メンバー'
	};

	function formatDate(dateString: string) {
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// フィルター/検索の状態
	let searchQuery = '';
	let selectedRole: 'all' | 'admin' | 'member' = 'all';
	let sortBy: 'removed_date' | 'joined_date' | 'name' = 'removed_date';

	// フィルタリング済みメンバー
	$: filteredMembers = (data.removedMembers || [])
		.filter((member) => {
			// 検索クエリでフィルタ
			const memberName = member.profile?.full_name || '';
			const matchesSearch =
				searchQuery === '' || memberName.toLowerCase().includes(searchQuery.toLowerCase());

			// 役割でフィルタ
			const matchesRole = selectedRole === 'all' || member.role === selectedRole;

			return matchesSearch && matchesRole;
		})
		.sort((a, b) => {
			// ソート
			if (sortBy === 'removed_date') {
				return new Date(b.removed_at).getTime() - new Date(a.removed_at).getTime();
			} else if (sortBy === 'joined_date') {
				return new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
			} else {
				// name
				const nameA = a.profile?.full_name || '';
				const nameB = b.profile?.full_name || '';
				return nameA.localeCompare(nameB);
			}
		});
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={true}
	pageOrganizations={[data.organization]}
/>

<div class="container">
	<div class="page-header">
		<h1 class="page-title">削除されたメンバー</h1>
		<p class="subtitle">{data.organization.name} の削除されたメンバー一覧</p>
	</div>

	<!-- フィルター/検索バー -->
	{#if data.removedMembers && data.removedMembers.length > 0}
		<div class="filter-section">
			<div class="search-box">
				<input
					type="text"
					class="search-input"
					placeholder="メンバー名で検索..."
					bind:value={searchQuery}
				/>
			</div>

			<div class="filter-controls">
				<div class="filter-group">
					<label for="role-filter" class="filter-label">役割:</label>
					<select id="role-filter" class="filter-select" bind:value={selectedRole}>
						<option value="all">すべて</option>
						<option value="admin">管理者</option>
						<option value="member">メンバー</option>
					</select>
				</div>

				<div class="filter-group">
					<label for="sort-filter" class="filter-label">並び替え:</label>
					<select id="sort-filter" class="filter-select" bind:value={sortBy}>
						<option value="removed_date">削除日（新しい順）</option>
						<option value="joined_date">参加日（新しい順）</option>
						<option value="name">名前（A-Z）</option>
					</select>
				</div>
			</div>

			<div class="result-count">
				{filteredMembers.length} 人のメンバー
				{#if filteredMembers.length !== data.removedMembers.length}
					<span class="total-count">（全 {data.removedMembers.length} 人中）</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- メンバー一覧 -->
	{#if filteredMembers && filteredMembers.length > 0}
		<div class="member-list">
			{#each filteredMembers as member}
				<div class="member-card">
					<div class="member-info">
						<div class="member-header">
							<h3 class="member-name">
								{member.profile?.full_name || 'プロフィール未設定'}
							</h3>
							<span class="role-badge" class:is-admin={member.role === 'admin'}>
								{roleNames[member.role] || member.role}
							</span>
						</div>

						<div class="meta">
							<div class="meta-item">
								<span class="meta-label">参加日:</span>
								<span class="meta-value">{formatDate(member.joined_at)}</span>
							</div>
							<div class="meta-item">
								<span class="meta-label">削除日:</span>
								<span class="meta-value">{formatDate(member.removed_at)}</span>
							</div>
							<div class="meta-item">
								<span class="meta-label">削除者:</span>
								<span class="meta-value">
									{member.removed_by_profile?.full_name || '不明'}
								</span>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if data.removedMembers && data.removedMembers.length > 0}
		<!-- フィルター結果が0件の場合 -->
		<div class="empty-state">
			<p class="empty-message">検索条件に一致するメンバーが見つかりません</p>
			<button
				class="reset-filter-btn"
				on:click={() => {
					searchQuery = '';
					selectedRole = 'all';
				}}
			>
				フィルターをリセット
			</button>
		</div>
	{:else}
		<!-- 削除されたメンバーが全くない場合 -->
		<div class="empty-state">
			<p class="empty-message">削除されたメンバーはいません</p>
		</div>
	{/if}

	<!-- ナビゲーション -->
	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/organization/${data.organization.id}`)}>
			組織ページに戻る
		</NavButton>
		<NavButton on:click={() => goto('/dashboard')}>ダッシュボードに戻る</NavButton>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 80px 20px 60px;
		max-width: 900px;
		margin: 0 auto;
		min-height: calc(100vh - 140px);
	}

	.page-header {
		margin-bottom: 32px;
		text-align: center;
	}

	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 12px 0;
	}

	.subtitle {
		font-size: 15px;
		color: var(--text-secondary);
		margin: 0;
	}

	/* フィルター/検索セクション */
	.filter-section {
		margin-bottom: 24px;
		padding: 20px;
		background: var(--bg-secondary);
		border-radius: 12px;
		border: 1px solid var(--border-light);
	}

	.search-box {
		margin-bottom: 16px;
	}

	.search-input {
		width: 100%;
		padding: 12px 16px;
		font-size: 15px;
		border: 2px solid var(--border-light);
		border-radius: 8px;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: border-color 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.search-input::placeholder {
		color: var(--text-secondary);
	}

	.filter-controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.filter-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		min-width: 80px;
	}

	.filter-select {
		flex: 1;
		padding: 10px 12px;
		font-size: 14px;
		border: 2px solid var(--border-light);
		border-radius: 8px;
		background: var(--bg-primary);
		color: var(--text-primary);
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.result-count {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		text-align: center;
		padding-top: 12px;
		border-top: 1px solid var(--border-light);
	}

	.total-count {
		font-weight: 400;
		color: var(--text-secondary);
		font-size: 13px;
	}

	.reset-filter-btn {
		margin-top: 16px;
		padding: 10px 20px;
		font-size: 14px;
		font-weight: 600;
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.reset-filter-btn:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.reset-filter-btn:active {
		transform: translateY(0);
	}

	/* メンバーリスト */
	.member-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 32px;
	}

	.member-card {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 16px;
		padding: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		transition: all 0.2s;
	}

	.member-card:hover {
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}

	.member-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.member-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.role-badge {
		background: #6b7280;
		color: white;
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
	}

	.role-badge.is-admin {
		background: var(--accent-primary);
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.meta-item {
		display: flex;
		gap: 8px;
		font-size: 14px;
	}

	.meta-label {
		color: var(--text-secondary);
		font-weight: 500;
		min-width: 80px;
	}

	.meta-value {
		color: var(--text-primary);
		font-weight: 600;
	}

	/* 空の状態 */
	.empty-state {
		text-align: center;
		padding: 60px 20px;
	}

	.empty-message {
		font-size: 16px;
		color: var(--text-secondary);
		margin: 0;
	}

	/* ナビゲーション */
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 500px;
		margin: 0 auto;
	}

	/* レスポンシブ */
	@media (min-width: 768px) {
		.container {
			padding: 100px 40px 80px;
		}

		.page-title {
			font-size: 36px;
		}

		.subtitle {
			font-size: 17px;
		}

		.member-name {
			font-size: 22px;
		}

		.filter-controls {
			flex-direction: row;
			gap: 16px;
		}

		.filter-group {
			flex: 1;
		}

		.filter-label {
			min-width: 60px;
		}
	}
</style>
