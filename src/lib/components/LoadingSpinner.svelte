<script lang="ts">
	export let size: 'small' | 'medium' | 'large' = 'medium';
	export let inline: boolean = false;
</script>

<div class="spinner-container" class:inline>
	<div class="spinner" class:small={size === 'small'} class:large={size === 'large'}></div>
</div>

<style>
	.spinner-container {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 8px;
	}

	.spinner-container.inline {
		display: inline-flex;
		padding: 0;
		margin-left: 8px;
		vertical-align: middle;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid rgba(255, 255, 255, 0.3);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner.small {
		width: 16px;
		height: 16px;
		border-width: 2px;
	}

	.spinner.large {
		width: 32px;
		height: 32px;
		border-width: 4px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
