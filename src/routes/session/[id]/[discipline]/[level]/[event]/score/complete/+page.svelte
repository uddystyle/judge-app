<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentBib as bibStore } from '$lib/stores';

	$: bib = $page.url.searchParams.get('bib');
	$: score = $page.url.searchParams.get('score');

	function handleNextSkier() {
		bibStore.set(null);
		const bibInputPath = $page.url.pathname.replace('/score/complete', '');
		goto(bibInputPath);
	}
</script>

<Header />

<div class="container">
	<div class="instruction">送信完了</div>
	<div class="status">
		データが正常に送信されました<br />
		<strong>ゼッケン{bib}番: {score}点</strong>
	</div>

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextSkier}>次の滑走者</NavButton>
		<NavButton>結果を共有</NavButton>
		<NavButton>検定を終了</NavButton>
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
	.status {
		padding: 15px;
		border-radius: 12px;
		margin: 20px auto;
		text-align: center;
		font-size: 15px;
		max-width: 340px;
		background: #e6f6e8;
		border: 1px solid var(--ios-green);
		color: #1e5c2e;
		line-height: 1.6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
