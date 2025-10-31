<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	type KeypadEvent = {
		input: string;
		clear: void;
		confirm: void;
	};

	const dispatch = createEventDispatcher<KeypadEvent>();
</script>

<div class="numeric-keypad">
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '7')}>7</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '8')}>8</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '9')}>9</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '4')}>4</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '5')}>5</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '6')}>6</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '1')}>1</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '2')}>2</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '3')}>3</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '0')}>0</button>

	<button type="button" class="numeric-key spacer" aria-label="spacer" tabindex="-1"></button>

	<button type="button" class="numeric-key clear" on:click={() => dispatch('clear')}>C</button>

	<button type="button" class="numeric-key confirm" on:click={() => dispatch('confirm')}
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
		background: var(--bg-white);
		border: 2px solid var(--border-light);
		border-radius: 18px;
		font-size: 32px;
		font-weight: 600;
		height: 80px;
		cursor: pointer;
		transition: all 0.2s;
		color: var(--text-primary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.numeric-key:hover {
		border-color: var(--primary-orange);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.2);
		transform: translateY(-2px);
	}
	.numeric-key:active {
		transform: translateY(0);
		background: var(--bg-beige);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}
	.numeric-key.confirm {
		background: linear-gradient(135deg, var(--primary-orange) 0%, var(--primary-orange-light) 100%);
		color: white;
		grid-column: span 3;
		border: none;
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
	}
	.numeric-key.confirm:hover {
		box-shadow: 0 6px 16px rgba(255, 107, 53, 0.4);
		transform: translateY(-2px);
	}
	.numeric-key.confirm:active {
		background: linear-gradient(135deg, #e65a2f 0%, #ff7b42 100%);
		transform: translateY(0);
	}
	.numeric-key.clear {
		background: var(--ios-red);
		color: white;
		border: none;
	}
	.numeric-key.clear:hover {
		box-shadow: 0 4px 12px rgba(234, 67, 53, 0.3);
	}
	.numeric-key.clear:active {
		background: #d93025;
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
