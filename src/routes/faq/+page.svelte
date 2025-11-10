<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	export let data: PageData;

	// カテゴリー別のFAQ
	const faqCategories = [
		{
			id: 'general',
			name: '基本的な使い方',
			faqs: [
				{
					question: 'TENTOとは何ですか？',
					answer:
						'TENTOは、スキー・スノーボードの検定や大会のための採点管理システムです。検定員がスマートフォンやタブレットで簡単にスコアを入力でき、リアルタイムで結果を集計・公開することができます。'
				},
				{
					question: 'どのデバイスで使えますか？',
					answer:
						'スマートフォン、タブレット、PCなど、インターネットに接続できるすべてのデバイスで利用可能です。ブラウザがあれば専用アプリのインストールは不要です。iOS、Android、Windows、Macに対応しています。'
				},
				{
					question: '無料プランと有料プランの違いは何ですか？',
					answer:
						'無料プランは組織メンバー1名、検定員3名まで、月間3セッションまで利用できます。有料プランでは、より多くのメンバー・検定員を追加でき、大会モードや研修モードなどの高度な機能が利用できます。詳しくは料金プランページをご覧ください。'
				},
				{
					question: 'オフラインでも使えますか？',
					answer:
						'現在のバージョンではインターネット接続が必要です。ただし、モバイルデータ通信でも問題なく動作するよう軽量設計されています。今後のアップデートでオフライン機能の追加を予定しています。'
				}
			]
		},
		{
			id: 'organization',
			name: '組織・メンバー管理',
			faqs: [
				{
					question: '組織とは何ですか？',
					answer:
						'組織は、スキークラブやスクール、団体などの単位でTENTOを利用するためのグループです。組織を作成すると、メンバーを招待してセッションを共有できます。'
				},
				{
					question: '複数の組織に参加できますか？',
					answer:
						'はい、1人のユーザーが複数の組織に参加することができます。異なるクラブや団体の検定員を兼任している場合に便利です。'
				},
				{
					question: 'メンバーを招待するにはどうすればいいですか？',
					answer:
						'ダッシュボードの「組織設定」から招待コードを生成できます。招待コードを共有することで、他のユーザーを組織に追加できます。招待されたユーザーは、招待コードを入力することで組織に参加できます。'
				},
				{
					question: '組織メンバーの役割はありますか？',
					answer:
						'現在は、組織オーナーと一般メンバーの2つの役割があります。オーナーは組織の設定変更、メンバー管理、プラン変更などが可能です。一般メンバーはセッションの作成や検定員としての参加ができます。'
				}
			]
		},
		{
			id: 'session',
			name: 'セッション・採点',
			faqs: [
				{
					question: 'セッションとは何ですか？',
					answer:
						'セッションは、検定や大会などの採点イベントの単位です。1つのセッションに複数の検定員と競技者を登録し、採点を行います。検定モード、大会モード、研修モードの3つのモードがあります。'
				},
				{
					question: '検定モード、大会モード、研修モードの違いは？',
					answer:
						'検定モードは複数の検定員が同じ競技者を採点し、平均点を計算します。大会モードは順位を競う形式で、リアルタイムランキングを表示します。研修モードは検定員の研修用で、各検定員の採点結果を個別に確認できます。'
				},
				{
					question: 'ゲスト検定員として参加するには？',
					answer:
						'セッション作成者から招待コードを受け取り、「ゲスト参加」からコードを入力すると、そのセッションに検定員として参加できます。組織に所属していなくても参加可能です。'
				},
				{
					question: '採点結果を修正できますか？',
					answer:
						'主任検定員（セッション作成者）のみが採点結果の修正を要求できます。修正が必要な場合、主任検定員が該当する採点を削除し、担当検定員に再採点を依頼する形になります。セッション終了後の修正はできませんので、終了前に確認してください。'
				},
				{
					question: 'スコアボードを公開するには？',
					answer:
						'セッション設定で「スコアボード公開」をオンにすると、URLを知っている人が結果をリアルタイムで閲覧できます。競技者や観客がスマートフォンで結果を確認できます。（Basic以上のプラン）'
				}
			]
		},
		{
			id: 'export',
			name: 'エクスポート・データ管理',
			faqs: [
				{
					question: '結果をエクスポートできますか？',
					answer:
						'はい、すべてのプランでExcel形式（.xlsx）での結果エクスポートが可能です。セッション詳細ページの「エクスポート」ボタンから、競技者ごとの詳細スコアをダウンロードできます。'
				},
				{
					question: 'データはどのくらい保存されますか？',
					answer:
						'プランごとにデータ保存期間の目安があります（フリー: 3ヶ月、Basic: 12ヶ月、Standard: 24ヶ月、Premium: 無制限）。重要なデータは定期的にExcelエクスポート機能を使用してバックアップすることをお勧めします。'
				},
				{
					question: 'エクスポートしたファイルの形式は？',
					answer:
						'Excel形式（.xlsx）で出力されます。モードによって内容が異なり、検定モードでは平均点、大会モードでは順位、研修モードでは検定員ごとの詳細スコアが含まれます。Excelで開いて編集や印刷が可能です。'
				}
			]
		},
		{
			id: 'billing',
			name: '料金・支払い',
			faqs: [
				{
					question: '無料で使えますか？',
					answer:
						'はい、フリープランは完全無料で利用できます。組織メンバー1名、検定員3名まで、月間3セッションまで使用できます。検定モードのみ利用可能です。'
				},
				{
					question: 'プランを途中で変更できますか？',
					answer:
						'はい、いつでもプランをアップグレード・ダウングレードできます。プラン変更時はStripeが自動的に日割り計算を行い、差額の請求や返金が発生します。変更は即時反映されます。'
				},
				{
					question: '年間プランの方がお得ですか？',
					answer:
						'はい、年間プランは月額プランに比べて約2ヶ月分お得になります。例えば、Basicプランの場合、月額¥8,800×12ヶ月=¥105,600のところ、年額¥88,000で¥17,600お得です。'
				},
				{
					question: '支払い方法は何がありますか？',
					answer:
						'クレジットカード（Visa、Mastercard、American Express、JCB）に対応しています。決済はStripeを通じて安全に処理されます。'
				},
				{
					question: 'キャンセル・返金はできますか？',
					answer:
						'月額プランはいつでもキャンセル可能で、次回請求日以降は課金されません。ただし、既に支払った料金の返金は原則として行っておりません。年額プランも同様です。'
				}
			]
		},
		{
			id: 'technical',
			name: '技術的な問題',
			faqs: [
				{
					question: 'ログインできません',
					answer:
						'パスワードを忘れた場合は、ログイン画面の「パスワードを忘れた方」からリセットできます。メールアドレスが正しいか、迷惑メールフォルダに確認メールが届いていないかご確認ください。'
				},
				{
					question: 'スコアが保存されません',
					answer:
						'インターネット接続を確認してください。また、ブラウザのキャッシュをクリアすることで解決する場合があります。問題が続く場合は、お問い合わせフォームからご連絡ください。'
				},
				{
					question: '推奨ブラウザは何ですか？',
					answer:
						'Google Chrome、Safari、Microsoft Edge、Firefoxの最新版を推奨しています。Internet Explorer（IE）には対応していません。'
				},
				{
					question: 'セッション招待コードが無効と表示されます',
					answer:
						'招待コードに誤字がないか確認してください。また、セッションが既に終了している場合は参加できません。問題が続く場合は、セッション作成者に確認するか、お問い合わせフォームからご連絡ください。'
				}
			]
		}
	];

</script>

<svelte:head>
	<title>よくある質問 - TENTO</title>
</svelte:head>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="header-section">
		<h1 class="title">よくある質問</h1>
		<p class="subtitle">
			TENTOの使い方や機能について、よくお問い合わせいただく質問をまとめました。<br />
			解決しない場合は、お問い合わせフォームからご連絡ください。
		</p>
	</div>

	<!-- FAQカテゴリー -->
	<div class="faq-categories">
		{#each faqCategories as category}
			<div class="category-section" id={category.id}>
				<div class="category-header">
					<h2 class="category-title">{category.name}</h2>
				</div>

				<div class="faq-list">
					{#each category.faqs as faq, index}
						<details class="faq-item">
							<summary class="faq-question">
								<span class="question-text">Q. {faq.question}</span>
								<span class="toggle-icon">▼</span>
							</summary>
							<div class="faq-answer">
								<p>{faq.answer}</p>
							</div>
						</details>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<!-- お問い合わせCTA -->
	<div class="contact-cta">
		<h2 class="cta-title">解決しませんでしたか？</h2>
		<p class="cta-description">他にご質問がございましたら、お気軽にお問い合わせください。</p>
		<button class="contact-btn" on:click={() => goto('/contact')}> お問い合わせフォームへ </button>
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
		margin-bottom: 16px;
		color: var(--primary-text);
	}

	.subtitle {
		font-size: 16px;
		color: var(--secondary-text);
		line-height: 1.7;
	}

	.faq-categories {
		margin-bottom: 60px;
	}

	.category-section {
		margin-bottom: 56px;
	}

	.category-section:last-child {
		margin-bottom: 0;
	}

	.category-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
		padding-bottom: 12px;
		border-bottom: 3px solid var(--accent-primary);
	}

	.category-title {
		font-size: 22px;
		font-weight: 700;
		color: var(--primary-text);
	}

	.faq-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.faq-item {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		overflow: hidden;
		transition: all 0.3s ease;
	}

	.faq-item:hover {
		border-color: #d0d0d5;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
	}

	.faq-item[open] {
		border-color: var(--ios-blue);
		box-shadow: 0 4px 16px rgba(0, 122, 255, 0.12);
	}

	.faq-question {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 18px 20px;
		background: white;
		cursor: pointer;
		list-style: none;
		transition: background 0.2s;
	}

	.faq-question::-webkit-details-marker {
		display: none;
	}

	.faq-question:hover {
		background: var(--bg-secondary);
	}

	.question-text {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		flex: 1;
		padding-right: 16px;
		line-height: 1.5;
	}

	.faq-item[open] .question-text {
		color: var(--ios-blue);
	}

	.toggle-icon {
		font-size: 14px;
		color: var(--secondary-text);
		transition: transform 0.3s;
		flex-shrink: 0;
	}

	.faq-item[open] .toggle-icon {
		transform: rotate(180deg);
		color: var(--ios-blue);
	}

	.faq-answer {
		padding: 16px 20px 20px 20px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--separator-gray);
	}

	.faq-answer p {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin: 0;
		white-space: pre-line;
	}

	.contact-cta {
		background: linear-gradient(135deg, var(--ios-blue) 0%, #0051d5 100%);
		color: white;
		border-radius: 16px;
		padding: 48px 32px;
		text-align: center;
		box-shadow: 0 4px 16px rgba(0, 122, 255, 0.2);
	}

	.cta-title {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 12px;
	}

	.cta-description {
		font-size: 16px;
		margin-bottom: 24px;
		opacity: 0.95;
	}

	.contact-btn {
		background: white;
		color: var(--ios-blue);
		border: none;
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.contact-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.category-title {
			font-size: 20px;
		}

		.question-text {
			font-size: 15px;
		}

		.contact-cta {
			padding: 32px 24px;
		}

		.cta-title {
			font-size: 20px;
		}
	}
</style>
