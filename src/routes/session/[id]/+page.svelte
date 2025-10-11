<script lang="ts">
	import { currentSession } from '$lib/stores';
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;

	// このページが表示されたら、グローバルなストアを更新する
	onMount(() => {
		currentSession.set(data.sessionDetails);
	});

	function selectDiscipline(discipline: string) {
		// 次のステップ（級選択）のページへ移動
		goto(`/session/${data.sessionDetails.id}/${discipline}`);
	}
</script>

<Header />

<div class="container">
	<div class="instruction">種別を選択してください</div>

	<div class="list-keypad">
		{#each data.disciplines as discipline}
			<NavButton on:click={() => selectDiscipline(discipline)}>
				{discipline}
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>検定選択に戻る</NavButton>
	</div>
</div>

<style>
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
