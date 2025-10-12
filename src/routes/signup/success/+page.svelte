<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
</script>

<div class="container">
	<div class="instruction">ご登録ありがとうございます</div>
	<p class="message">
		確認メールを送信しました。<br
		/>メールに記載されているリンクをクリックして、アカウントの登録を完了してください。
	</p>
	<div class="nav-buttons">
		<NavButton variant="primary" on:click={() => goto('/login')}>ログインページへ</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 400px;
		margin: 40px auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 16px;
	}
	.message {
		color: var(--secondary-text);
		margin-bottom: 24px;
		line-height: 1.6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
