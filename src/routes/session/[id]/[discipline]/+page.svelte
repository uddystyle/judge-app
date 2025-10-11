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
	<div class="instruction">級を選択してください</div>

	<div class="list-keypad">
		{#each data.levels as level}
			<NavButton on:click={() => console.log('Selected level:', level)}>
				{level}
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => window.history.back()}>種別選択に戻る</NavButton>
	</div>
</div>

<style>
	.container,
	.instruction,
	.list-keypad,
	.nav-buttons {
		/* 前のページからスタイルをコピー */
		padding: 28px 20px;
		text-align: center;
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 28px;
	}
	.instruction {
		margin-top: 0;
	}
	.list-keypad {
		margin-top: 0;
	}
</style>
