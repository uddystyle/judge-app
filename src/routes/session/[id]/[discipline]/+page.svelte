<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;

	// URLのパラメータ（[id]や[discipline]）を取得
	$: ({ id, discipline } = $page.params);

	// 級ボタンがクリックされたときに実行される関数
	function selectLevel(level: string) {
		// 次のページ（種目選択）へ移動
		goto(`/session/${id}/${discipline}/${level}`);
	}
</script>

<Header />

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
		<NavButton on:click={() => goto(`/session/${id}`)}>種別選択に戻る</NavButton>
	</div>
</div>

<style>
	/* スタイル部分は変更ありません */
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
