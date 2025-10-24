<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';

	export let data: PageData;

	// URLから必要なパラメータを取得
	$: ({ id, discipline, level } = $page.params);

	function selectEvent(eventName: string) {
		// 次のページ（ゼッケン入力）へ移動
		goto(`/session/${id}/${discipline}/${level}/${eventName}`);
	}
</script>

<Header />

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
		<NavButton on:click={() => goto(`/session/${id}/${discipline}`)}>級選択に戻る</NavButton>
	</div>
</div>

<style>
	/* 以前のページからスタイルをコピー */
	.container {
		padding: 28px 20px;
		text-align: center;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
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
</style>
