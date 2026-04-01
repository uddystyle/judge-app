<script lang="ts">
	import QRCode from 'qrcode';
	import { createEventDispatcher } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

	export let inviteUrl: string;
	export let sessionName: string;
	export let show: boolean;

	const dispatch = createEventDispatcher<{ close: void }>();

	let qrCodeDataUrl = '';

	$: if (show && inviteUrl) {
		generateQRCode();
	}

	async function generateQRCode() {
		try {
			qrCodeDataUrl = await QRCode.toDataURL(inviteUrl, {
				width: 300,
				margin: 2,
				color: {
					dark: '#171717',
					light: '#FFFFFF'
				}
			});
		} catch (err) {
			console.error('QRコード生成エラー:', err);
		}
	}

	function close() {
		dispatch('close');
	}

	async function downloadQR() {
		try {
			// 高解像度QRコードを生成
			const qrCodeDataUrlHD = await QRCode.toDataURL(inviteUrl, {
				width: 512,
				margin: 2
			});

			// ダウンロード
			const link = document.createElement('a');
			link.href = qrCodeDataUrlHD;
			link.download = `${sessionName}_招待QRコード.png`;
			link.click();
		} catch (err) {
			console.error('QRコードダウンロードエラー:', err);
		}
	}

	function printQR() {
		window.print();
	}
</script>

{#if show}
	<div class="modal-overlay" on:click={close} role="button" tabindex="0" on:keydown={(e) => e.key === 'Escape' && close()}>
		<div class="modal-content" on:click|stopPropagation role="button" tabindex="0" on:keydown={() => {}}>
			<div class="modal-header">
				<h2 class="modal-title">{sessionName}</h2>
				<button class="modal-close" on:click={close} aria-label={m.common_close()}>×</button>
			</div>

			<div class="modal-body">
				{#if qrCodeDataUrl}
					<img src={qrCodeDataUrl} alt="招待QRコード" class="qr-image" />
				{/if}
				<p class="qr-instruction">カメラで読み取ってください</p>
			</div>

			<div class="modal-actions">
				<button class="modal-btn secondary" on:click={downloadQR}>
					ダウンロード
				</button>
				<button class="modal-btn secondary" on:click={printQR}>
					印刷
				</button>
				<button class="modal-btn primary" on:click={close}>
					{m.common_close()}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* QRコードモーダル */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
		padding: 20px;
	}

	.modal-content {
		background: white;
		border-radius: 16px;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
		animation: modalFadeIn 0.2s ease-out;
	}

	@keyframes modalFadeIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 24px;
		border-bottom: 2px solid var(--border-light);
	}

	.modal-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.modal-close {
		width: 32px;
		height: 32px;
		border: none;
		background: var(--bg-secondary);
		border-radius: 50%;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.modal-close:hover {
		background: var(--border-medium);
		color: var(--text-primary);
	}

	.modal-body {
		padding: 32px 24px;
		text-align: center;
	}

	.qr-image {
		width: 300px;
		height: 300px;
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 16px;
		background: white;
		margin: 0 auto 20px;
	}

	.qr-instruction {
		font-size: 15px;
		color: var(--text-secondary);
		margin: 0;
	}

	.modal-actions {
		padding: 16px 24px 24px;
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.modal-btn {
		padding: 14px 24px;
		border: none;
		border-radius: 10px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.modal-btn.primary {
		background: var(--accent-primary);
		color: white;
		flex: 1;
	}

	.modal-btn.primary:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.modal-btn.secondary {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 2px solid var(--border-medium);
	}

	.modal-btn.secondary:hover {
		background: var(--border-light);
	}

	.modal-btn:active {
		transform: translateY(0);
	}
</style>
