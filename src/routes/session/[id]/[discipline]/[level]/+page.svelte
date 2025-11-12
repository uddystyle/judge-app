<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { currentDiscipline, currentLevel, currentEvent, currentBib } from '$lib/stores';
	import { onMount } from 'svelte';

	export let data: PageData;

	// URLから必要なパラメータを取得
	$: ({ id, discipline, level } = $page.params);
	$: guestIdentifier = $page.url.searchParams.get('guest');

	onMount(() => {
		// 種別と級を設定、種目以降をクリア
		currentDiscipline.set(discipline);
		currentLevel.set(level);
		currentEvent.set(null);
		currentBib.set(null);
	});

	function selectEvent(eventName: string) {
		// 次のページ（ゼッケン入力）へ移動
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		goto(`/session/${id}/${discipline}/${level}/${eventName}${guestParam}`);
	}
</script>

<Header pageUser={data.user} isGuest={!!data.guestIdentifier} guestName={data.guestParticipant?.guest_name || null} />

<div class="container">
	<div class="instruction">種目を選択してください</div>

	<div class="list-keypad">
		{#each data.eventNames as eventName}
			<NavButton on:click={() => selectEvent(eventName)}>
				{eventName}
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => {
			const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
			goto(`/session/${id}/${discipline}${guestParam}`);
		}}>級選択に戻る</NavButton>
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
