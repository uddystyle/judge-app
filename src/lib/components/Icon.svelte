<script lang="ts">
	/**
	 * TENTO アイコンコンポーネント（SvelteKit）
	 *
	 *   <Icon name="kentei" />
	 *   <Icon name="ready" size={20} color="var(--color-success)" />
	 *   <Icon name="play" size={22} />            // play は塗りアイコン
	 *
	 * すべて 24×24 / ストローク基準。色は color プロパティ（既定 currentColor）。
	 * 装飾アイコンは aria-hidden。意味を持たせる場合は title を渡す。
	 */
	export let name: string;
	export let size: number = 24;
	export let color: string = 'currentColor';
	export let stroke: number = 2;
	export let title: string = '';

	// 塗りで描くアイコン
	const FILLED = new Set(['play']);

	const P: Record<string, string> = {
		// モード
		kentei: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
		taikai: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
		kenshu: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
		// ドメイン
		organization: '<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>',
		judges: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
		judge: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
		bib: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
		score: '<path d="m12 2 3 6.5 7 .8-5 4.8 1.3 7L12 17.8 5.4 21l1.3-7-5-4.8 7-.8L12 2Z"/>',
		scoreboard: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7" rx=".5"/><rect x="12" y="6" width="3" height="12" rx=".5"/><rect x="17" y="13" width="3" height="5" rx=".5"/>',
		// ステータス
		ready: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
		waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
		error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
		live: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>',
		// 操作
		play: '<path d="M6 4.5v15a1 1 0 0 0 1.5.87l13-7.5a1 1 0 0 0 0-1.74l-13-7.5A1 1 0 0 0 6 4.5Z"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
		edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
		share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/>',
		export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
		invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6"/>',
		settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
		trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
		backspace: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM18 9l-6 6M12 9l6 6"/>',
		// ナビ / その他
		home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
		back: '<path d="M15 18l-6-6 6-6"/>',
		forward: '<path d="M9 18l6-6-6-6"/>',
		'chevron-down': '<path d="M6 9l6 6 6-6"/>',
		close: '<path d="M18 6 6 18M6 6l12 12"/>',
		logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
	};

	$: d = P[name] ?? '';
	$: filled = FILLED.has(name);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? color : 'none'}
	stroke={filled ? 'none' : color}
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title || undefined}
>
	{#if title}<title>{title}</title>{/if}
	{@html d}
</svg>
