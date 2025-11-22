<script lang="ts">
	// このページは通常表示されません（サーバー側で自動的にリダイレクトされます）
	// エラーが発生した場合のみ表示されます
</script>

<div class="container">
	<div class="loading">
		<div class="spinner"></div>
		<p>組織に参加しています...</p>
	</div>
</div>

<style>
	.container {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 100vh;
		padding: 20px;
	}

	.loading {
		text-align: center;
	}

	.spinner {
		width: 50px;
		height: 50px;
		margin: 0 auto 20px;
		border: 4px solid var(--border-light);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading p {
		font-size: 16px;
		color: var(--text-secondary);
	}
</style>
