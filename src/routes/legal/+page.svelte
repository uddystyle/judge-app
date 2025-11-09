<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	export let data: PageData;
</script>

<svelte:head>
	<title>特定商取引法に基づく表記 - TENTO</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="header-section">
		<h1 class="title">特定商取引法に基づく表記</h1>
		<p class="updated">最終更新日: 2025年11月9日</p>
	</div>

	<div class="content">
		<section class="section">
			<p class="intro">
				特定商取引法第11条（通信販売についての広告）の規定に基づき、以下のとおり表示いたします。
			</p>
		</section>

		<section class="section">
			<h2>販売業者</h2>
			<p class="value">内田智久</p>
		</section>

		<section class="section">
			<h2>運営統括責任者</h2>
			<p class="value">内田智久</p>
		</section>

		<section class="section">
			<h2>所在地</h2>
			<p class="value">東京都足立区</p>
			<p class="note-small">
				※ 個人情報保護の観点から、詳細な住所は公開しておりません。特定商取引法第11条に基づき、お客様からの請求があった場合には遅滞なく開示いたします。開示請求はお問い合わせフォームよりご連絡ください。
			</p>
		</section>

		<section class="section">
			<h2>電話番号</h2>
			<p class="value">お問い合わせフォームよりご連絡ください</p>
			<p class="note-small">
				※ 個人情報保護のため、電話番号は公開しておりません。特定商取引法第11条に基づき、お客様からの請求があった場合には遅滞なく開示いたします。開示請求はお問い合わせフォームよりご連絡ください。
			</p>
		</section>

		<section class="section">
			<h2>メールアドレス</h2>
			<p class="value">
				<a href="/contact">お問い合わせフォーム</a>よりご連絡ください
			</p>
		</section>

		<section class="section">
			<h2>販売価格</h2>
			<div class="price-table">
				<div class="price-row">
					<div class="price-label">フリープラン</div>
					<div class="price-value">無料</div>
				</div>
				<div class="price-row">
					<div class="price-label">Basicプラン（月額）</div>
					<div class="price-value">¥8,800 / 月</div>
				</div>
				<div class="price-row">
					<div class="price-label">Basicプラン（年額）</div>
					<div class="price-value">¥88,000 / 年</div>
				</div>
				<div class="price-row">
					<div class="price-label">Standardプラン（月額）</div>
					<div class="price-value">¥24,800 / 月</div>
				</div>
				<div class="price-row">
					<div class="price-label">Standardプラン（年額）</div>
					<div class="price-value">¥248,000 / 年</div>
				</div>
				<div class="price-row">
					<div class="price-label">Premiumプラン（月額）</div>
					<div class="price-value">¥49,800 / 月</div>
				</div>
				<div class="price-row">
					<div class="price-label">Premiumプラン（年額）</div>
					<div class="price-value">¥498,000 / 年</div>
				</div>
			</div>
			<p class="note-small">※ 全て税込価格です</p>
		</section>

		<section class="section">
			<h2>販売価格以外でお客様に発生する金銭</h2>
			<ul>
				<li>インターネット接続料金</li>
				<li>通信料金（お客様がご利用のインターネットプロバイダー、携帯電話会社の料金体系による）</li>
			</ul>
			<p class="note-small">※ 上記費用はお客様のご負担となります</p>
		</section>

		<section class="section">
			<h2>支払方法</h2>
			<ul>
				<li>クレジットカード決済（Visa、Mastercard、American Express、JCB）</li>
			</ul>
			<p class="note-small">
				※ 決済はStripe社のシステムを利用しており、安全に処理されます。クレジットカード情報は当社のサーバーには保存されません。
			</p>
		</section>

		<section class="section">
			<h2>支払時期</h2>
			<ul>
				<li>月額プラン: 毎月の契約更新日に自動課金されます</li>
				<li>年額プラン: 毎年の契約更新日に自動課金されます</li>
				<li>初回: 有料プラン申込時に即時課金されます</li>
			</ul>
		</section>

		<section class="section">
			<h2>サービス提供時期</h2>
			<p>お申込み完了後、即時ご利用いただけます。</p>
		</section>

		<section class="section">
			<h2>返品・交換・キャンセル等</h2>
			<div class="important-box">
				<h3>デジタルコンテンツの性質上、以下の対応となります</h3>
				<ul>
					<li>
						<strong>返金について:</strong> サービスの性質上、一度お支払いいただいた料金の返金は原則としてお受けできません。
					</li>
					<li>
						<strong>解約について:</strong>
						月額プラン・年額プランともに、いつでも解約が可能です。解約後は次回更新日以降、課金されません。
					</li>
					<li>
						<strong>解約の方法:</strong>
						アカウント設定ページから、いつでも解約手続きを行うことができます。
					</li>
					<li>
						<strong>組織削除時の自動キャンセル:</strong>
						組織を削除した場合、有料プランのサブスクリプションは自動的に即座にキャンセルされます。次回以降の請求は発生しませんが、既にお支払いいただいた期間分の料金は返金されません。
					</li>
					<li>
						<strong>既払い料金:</strong> 解約した場合でも、既にお支払いいただいた期間分のサービスはご利用いただけます。
					</li>
					<li>
						<strong>プラン変更:</strong>
						プランのアップグレード・ダウングレードはいつでも可能です。プラン変更時は日割り計算が適用されます。
					</li>
				</ul>
			</div>
		</section>

		<section class="section">
			<h2>不良品・誤配送の対応</h2>
			<p>
				サービスに不具合や障害が発生した場合は、速やかに対応いたします。お問い合わせフォームよりご連絡ください。
			</p>
		</section>

		<section class="section">
			<h2>動作環境</h2>
			<h3>推奨ブラウザ</h3>
			<ul>
				<li>Google Chrome（最新版）</li>
				<li>Safari（最新版）</li>
				<li>Microsoft Edge（最新版）</li>
				<li>Firefox（最新版）</li>
			</ul>
			<p class="note-small">
				※ Internet Explorer（IE）には対応しておりません<br />
				※ スマートフォン、タブレット、PCでご利用いただけます
			</p>

			<h3>インターネット環境</h3>
			<p>常時インターネット接続が必要です。</p>
		</section>

		<section class="section">
			<h2>引渡時期</h2>
			<p>
				サービス申込み完了後、即時ご利用いただけます。アカウント登録が完了した時点で、サービスの提供が開始されます。
			</p>
		</section>

		<section class="section">
			<h2>サービスの利用条件</h2>
			<p>
				当サービスのご利用には、<a href="/terms">利用規約</a>への同意が必要です。利用規約を必ずご確認ください。
			</p>
		</section>

		<section class="section">
			<h2>個人情報の取り扱い</h2>
			<p>
				お客様の個人情報は、当社の<a href="/privacy">プライバシーポリシー</a>に基づき、適切に管理いたします。
			</p>
		</section>

		<section class="section">
			<h2>表現、及び商品に関する注意書き</h2>
			<p>
				本サービスの効果や性能については、ご利用環境や使用方法により異なる場合があります。サービス内容は予告なく変更される場合があります。
			</p>
		</section>

		<section class="section">
			<h2>その他</h2>
			<ul>
				<li>サービス利用中に発生したトラブルについて、当社は一切の責任を負いません</li>
				<li>
					お客様が当サービスを利用して作成されたデータの消失・破損について、当社は一切の責任を負いません
				</li>
				<li>定期的にデータのバックアップ（エクスポート機能の利用）を推奨します</li>
			</ul>
		</section>
	</div>

	<div class="back-section">
		<button class="back-btn" on:click={() => goto('/')}>トップページに戻る</button>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 900px;
		margin: 0 auto;
		min-height: calc(100vh - 200px);
	}

	.header-section {
		text-align: center;
		margin-bottom: 48px;
	}

	.title {
		font-size: 32px;
		font-weight: 700;
		margin-bottom: 12px;
		color: var(--primary-text);
	}

	.updated {
		font-size: 14px;
		color: var(--secondary-text);
	}

	.content {
		background: white;
		border-radius: 16px;
		padding: 32px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		margin-bottom: 32px;
	}

	.intro {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 32px;
		padding: 16px;
		background: var(--bg-secondary);
		border-radius: 8px;
		border-left: 4px solid var(--accent-primary);
	}

	.section {
		margin-bottom: 40px;
	}

	.section:last-child {
		margin-bottom: 0;
	}

	.section h2 {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 16px;
		padding-bottom: 8px;
		border-bottom: 2px solid var(--accent-primary);
	}

	.section h3 {
		font-size: 17px;
		font-weight: 600;
		color: var(--primary-text);
		margin-top: 20px;
		margin-bottom: 12px;
	}

	.section p {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.value {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.note {
		font-size: 14px;
		color: var(--secondary-text);
		font-style: italic;
		margin-top: 4px;
	}

	.note-small {
		font-size: 13px;
		color: var(--secondary-text);
		margin-top: 8px;
		line-height: 1.6;
	}

	.section ul {
		padding-left: 24px;
		margin-top: 8px;
		margin-bottom: 8px;
	}

	.section ul li {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.section a {
		color: var(--ios-blue);
		text-decoration: none;
		border-bottom: 1px solid var(--ios-blue);
		transition: all 0.2s;
	}

	.section a:hover {
		color: #0051d5;
		border-bottom-color: #0051d5;
	}

	.price-table {
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		overflow: hidden;
		margin: 16px 0;
	}

	.price-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 20px;
		border-bottom: 1px solid var(--separator-gray);
	}

	.price-row:last-child {
		border-bottom: none;
	}

	.price-row:nth-child(even) {
		background: var(--bg-secondary);
	}

	.price-label {
		font-size: 15px;
		font-weight: 600;
		color: var(--primary-text);
	}

	.price-value {
		font-size: 16px;
		font-weight: 700;
		color: var(--ios-blue);
	}

	.important-box {
		background: #fff4e6;
		border: 2px solid var(--accent-primary);
		border-radius: 12px;
		padding: 20px;
		margin: 16px 0;
	}

	.important-box h3 {
		font-size: 16px;
		font-weight: 700;
		color: var(--primary-text);
		margin-top: 0;
		margin-bottom: 16px;
	}

	.important-box ul {
		padding-left: 20px;
		margin: 0;
	}

	.important-box li {
		margin-bottom: 12px;
		line-height: 1.8;
	}

	.important-box strong {
		color: var(--accent-primary);
	}

	.back-section {
		text-align: center;
		margin-bottom: 32px;
	}

	.back-btn {
		background: white;
		color: var(--ios-blue);
		border: 2px solid var(--ios-blue);
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.back-btn:hover {
		background: var(--ios-blue);
		color: white;
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.content {
			padding: 24px 20px;
		}

		.section h2 {
			font-size: 18px;
		}

		.section h3 {
			font-size: 16px;
		}

		.price-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}

		.price-value {
			align-self: flex-end;
		}
	}
</style>
