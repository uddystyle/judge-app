<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	type KeypadEvent = {
		input: string;
		clear: void;
		confirm: void;
	};

	export let disabled: boolean = false;

	const dispatch = createEventDispatcher<KeypadEvent>();
</script>

<div class="numeric-keypad">
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '7')} {disabled}>7</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '8')} {disabled}>8</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '9')} {disabled}>9</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '4')} {disabled}>4</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '5')} {disabled}>5</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '6')} {disabled}>6</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '1')} {disabled}>1</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '2')} {disabled}>2</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '3')} {disabled}>3</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '0')} {disabled}>0</button>

	<button type="button" class="numeric-key spacer" aria-label="spacer" tabindex="-1" disabled></button>

	<button type="button" class="numeric-key clear" on:click={() => dispatch('clear')} {disabled}>C</button>

	<button type="button" class="numeric-key confirm" on:click={() => dispatch('confirm')} {disabled}
		>確定</button
	>
</div>

<style>
	.numeric-keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		width: 100%;
		max-width: 100%;
		margin: 24px auto;
	}
	.numeric-key {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 18px;
		font-size: 32px;
		font-weight: 600;
		height: 80px;
		cursor: pointer;
		transition: all 0.15s ease;
		color: var(--text-primary);
		box-shadow: none;
	}
	.numeric-key:hover {
		border-color: var(--border-dark);
		background: var(--bg-hover);
		transform: translateY(-2px);
	}
	.numeric-key:active {
		transform: translateY(0);
		background: var(--gray-200);
	}
	.numeric-key.confirm {
		background: var(--accent-primary);
		color: white;
		grid-column: span 3;
		border: 2px solid var(--accent-primary);
		box-shadow: none;
	}
	.numeric-key.confirm:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
		transform: translateY(-2px);
	}
	.numeric-key.confirm:active {
		background: var(--accent-active);
		border-color: var(--accent-active);
		transform: translateY(0);
	}
	.numeric-key.clear {
		background: var(--gray-700);
		color: white;
		border: 2px solid var(--gray-700);
	}
	.numeric-key.clear:hover {
		background: var(--gray-600);
		border-color: var(--gray-600);
	}
	.numeric-key.clear:active {
		background: var(--gray-800);
		border-color: var(--gray-800);
	}
	.numeric-key.spacer {
		background: transparent;
		border: none;
		cursor: default;
		box-shadow: none;
	}
	.numeric-key.spacer:hover,
	.numeric-key.spacer:active {
		background: transparent;
		transform: none;
	}
	.numeric-key:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		pointer-events: none;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.numeric-keypad {
			gap: 20px;
			margin: 32px auto;
		}
		.numeric-key {
			height: 100px;
			font-size: 40px;
			border-radius: 20px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.numeric-key {
			height: 120px;
			font-size: 48px;
		}
	}
</style>
