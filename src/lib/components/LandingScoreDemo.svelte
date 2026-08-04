<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

	// ランディング用の「採点画面」自動再生デモ（純・表示用）。
	// 実際の ScoreInput / NumericKeypad は再利用せず、見た目だけ忠実に複製する
	// （採点ロジック・送信・検証は持たない）。パレットは本物と同じトークンを使う。
	// prefers-reduced-motion では静止（数字が入った状態）を表示する。

	const KEYPAD: string[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'];
	const CONFIRM = 'confirm';
	const CLEAR = 'clear';
	const FRAME_MS = 620;

	// 採点対象（実画面のヘッダーと同じく 種別 / 級 / 種目 / ゼッケン を表示）。
	// ゼッケンは1件採点するごとに次の選手へ進む。
	const DISCIPLINE = 'スキー';
	const LEVEL = '2級';
	const EVENT = '大回り';
	const ATHLETES = [
		{ score: 88, bib: 12 },
		{ score: 92, bib: 13 },
		{ score: 76, bib: 14 },
		{ score: 85, bib: 15 }
	];

	type Frame = { display: string; active: string | null; confirmed: boolean; bib: number };

	// 各選手について「1桁ずつ入力 → 確定 → 保持 → 次の選手」のフレーム列を作る
	function buildFrames(athletes: { score: number; bib: number }[]): Frame[] {
		const frames: Frame[] = [];
		for (const { score, bib } of athletes) {
			frames.push({ display: '', active: null, confirmed: false, bib });
			let display = '';
			for (const digit of String(score)) {
				display += digit;
				frames.push({ display, active: digit, confirmed: false, bib }); // キー押下
				frames.push({ display, active: null, confirmed: false, bib }); // 離す
			}
			frames.push({ display, active: CONFIRM, confirmed: false, bib }); // 確定押下
			frames.push({ display, active: null, confirmed: true, bib }); // 確定済み（弾む＋チェック）
			frames.push({ display, active: null, confirmed: true, bib }); // 保持
		}
		return frames;
	}

	const frames = buildFrames(ATHLETES);
	// 静止時（reduced-motion / 初期）は最初の選手の得点が入った状態を見せる
	const staticFrame: Frame = {
		display: String(ATHLETES[0].score),
		active: null,
		confirmed: true,
		bib: ATHLETES[0].bib
	};

	let frameIndex = 0;
	let reduceMotion = false;
	let inView = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let motionQuery: MediaQueryList | null = null;
	let observer: IntersectionObserver | null = null;
	let root: HTMLElement;

	$: current = reduceMotion ? staticFrame : (frames[frameIndex] ?? staticFrame);

	function tick() {
		frameIndex = (frameIndex + 1) % frames.length;
	}

	function startTimer() {
		if (timer || reduceMotion || !inView) return;
		timer = setInterval(tick, FRAME_MS);
	}

	function stopTimer() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function syncPlayback() {
		if (reduceMotion || !inView) {
			stopTimer();
		} else {
			startTimer();
		}
	}

	onMount(() => {
		motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduceMotion = motionQuery.matches;
		const onMotionChange = (e: MediaQueryListEvent) => {
			reduceMotion = e.matches;
			syncPlayback();
		};
		motionQuery.addEventListener('change', onMotionChange);

		// 画面内の時だけ再生（画面外では停止して軽量化）
		if ('IntersectionObserver' in window && root) {
			observer = new IntersectionObserver(
				(entries) => {
					inView = entries[0]?.isIntersecting ?? false;
					syncPlayback();
				},
				{ threshold: 0.2 }
			);
			observer.observe(root);
		} else {
			inView = true;
			syncPlayback();
		}

		return () => motionQuery?.removeEventListener('change', onMotionChange);
	});

	onDestroy(() => {
		stopTimer();
		observer?.disconnect();
	});

	function keyClass(key: string): string {
		const base = 'key';
		const type = key === CONFIRM ? ' key-confirm' : key === CLEAR ? ' key-clear' : '';
		const active = current.active === key ? ' is-active' : '';
		return base + type + active;
	}
</script>

<div class="demo" bind:this={root} aria-hidden="true">
	<div class="phone">
		<div class="screen">
			<div class="island" aria-hidden="true"></div>

			<div class="app-header">
				<span class="app-info">{DISCIPLINE} / {LEVEL} / {EVENT} / No.{current.bib}</span>
			</div>

			<div class="app-body">
				<p class="instruction">{m.score_enterScore()}</p>

				<div class="score" class:confirmed={current.confirmed}>
					<span class="score-value">{current.display || '0'}</span>
					<span class="check" class:show={current.confirmed}>✓</span>
				</div>

				<div class="keypad">
					{#each KEYPAD as key (key)}
						<div class={keyClass(key)}>{key}</div>
					{/each}
					<div class="key spacer" aria-hidden="true"></div>
					<div class={keyClass(CLEAR)}>C</div>
					<div class={keyClass(CONFIRM)}>{m.score_confirm()}</div>
				</div>
			</div>
			<div class="home-indicator" aria-hidden="true"></div>
		</div>
	</div>
	<p class="caption">{m.landing_scoreDemoCaption()}</p>
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}

	.phone {
		position: relative;
		width: clamp(240px, 78vw, 300px);
		background: #141418;
		border-radius: 44px;
		padding: 12px;
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.28),
			0 4px 12px rgba(0, 0, 0, 0.12);
	}
	/* サイドボタン（音量・電源）でスマホらしさを足す */
	.phone::before,
	.phone::after {
		content: '';
		position: absolute;
		width: 3px;
		border-radius: 2px;
		background: #0b0b0e;
	}
	.phone::before {
		left: -2px;
		top: 24%;
		height: 42px;
	}
	.phone::after {
		right: -2px;
		top: 34%;
		height: 58px;
	}

	.screen {
		position: relative;
		overflow: hidden;
		background: var(--bg-primary);
		border-radius: 34px;
		padding: 0 0 14px;
	}
	.app-header {
		padding: 48px 16px 9px;
		border-bottom: 1px solid var(--border-light);
		text-align: left;
	}
	.app-info {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--text-secondary);
		letter-spacing: -0.01em;
		line-height: 1.5;
	}
	.app-body {
		padding: 18px 18px 4px;
		text-align: center;
	}
	.island {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		width: 84px;
		height: 26px;
		background: #141418;
		border-radius: 16px;
		z-index: 2;
	}
	.home-indicator {
		width: 108px;
		height: 5px;
		margin: 12px auto 0;
		border-radius: 999px;
		background: rgba(22, 22, 28, 0.82);
	}

	.instruction {
		font-size: 15px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 14px;
	}

	.score {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 64px;
		background: var(--bg-primary);
		border: 3px solid var(--border-light);
		border-radius: 14px;
		margin-bottom: 16px;
		transition:
			transform 0.2s ease,
			border-color 0.2s ease;
	}
	.score.confirmed {
		transform: scale(1.06);
		border-color: var(--accent-primary);
	}
	.score-value {
		font-size: 46px;
		font-weight: 700;
		line-height: 1;
		color: var(--accent-primary);
	}
	.check {
		position: absolute;
		right: 12px;
		font-size: 22px;
		font-weight: 700;
		color: var(--accent-primary);
		opacity: 0;
		transform: scale(0.6);
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}
	.check.show {
		opacity: 1;
		transform: scale(1);
	}

	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.key {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 42px;
		border-radius: 12px;
		border: 2px solid var(--border-light);
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 18px;
		font-weight: 600;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
	}
	.key.is-active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
		transform: translateY(1px);
	}
	.key.spacer {
		border: none;
		background: transparent;
	}
	.key-clear {
		background: var(--gray-700);
		border-color: var(--gray-700);
		color: #fff;
	}
	.key-clear.is-active {
		background: var(--gray-700);
		border-color: var(--gray-700);
	}
	.key-confirm {
		grid-column: span 3;
		background: var(--accent);
		border: none;
		color: #fff;
		font-size: 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}
	.key-confirm.is-active {
		background: var(--accent-hover);
		transform: translateY(1px);
	}

	.caption {
		font-size: 13px;
		color: var(--text-secondary);
		margin: 0;
		letter-spacing: -0.01em;
	}

	@media (min-width: 768px) {
		.phone {
			width: 300px;
		}
	}
</style>
