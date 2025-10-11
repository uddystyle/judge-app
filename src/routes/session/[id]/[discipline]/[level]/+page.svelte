<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
</script>

<Header />

<div class="container">
	<div class="instruction">種目を選択してください</div>

	<div class="list-keypad">
		{#each data.eventNames as eventName}
			<NavButton on:click={() => console.log('Selected event:', eventName)}>
				{eventName}
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => window.history.back()}>級選択に戻る</NavButton>
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
