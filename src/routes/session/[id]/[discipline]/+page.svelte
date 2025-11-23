<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { currentSession, currentDiscipline, currentLevel, currentEvent, currentBib } from '$lib/stores';
	import { onMount } from 'svelte';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;

	// URLのパラメータ（[id]や[discipline]）を取得
	$: ({ id, discipline } = $page.params);
	$: guestIdentifier = $page.url.searchParams.get('guest');

	onMount(() => {
		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
		// 種別を設定、級以降をクリア
		currentDiscipline.set(discipline);
		currentLevel.set(null);
		currentEvent.set(null);
		currentBib.set(null);
	});

	// 級ボタンがクリックされたときに実行される関数
	function selectLevel(level: string) {
		// 次のページ（種目選択）へ移動
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		goto(`/session/${id}/${discipline}/${level}${guestParam}`);
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">級を選択してください</div>

	<div class="list-keypad">
		{#each data.levels as level}
			<NavButton on:click={() => selectLevel(level)}>
				{level}
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => {
			const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
			goto(`/session/${id}${guestParam}`);
		}}>種別選択に戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 800px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 28px;
	}
	.list-keypad {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 600px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.list-keypad {
			gap: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.instruction {
			font-size: 42px;
		}
		.list-keypad {
			gap: 20px;
		}
	}
</style>
