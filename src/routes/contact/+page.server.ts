import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { validateEmail, validateName, validateText } from '$lib/server/validation';
import { Resend } from 'resend';
import { RESEND_API_KEY } from '$env/static/private';

export const load: PageServerLoad = async ({ locals }) => {
	const { supabase } = locals;

	// getUser()を使用してセキュアにユーザー情報を取得
	const { data: { user } } = await supabase.auth.getUser();

	let profile = null;
	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();
		profile = profileData;
	}

	return {
		user,
		profile
	};
};

export const actions = {
	default: async ({ request, locals }) => {
		const { supabase } = locals;
		const formData = await request.formData();

		const nameRaw = formData.get('name') as string;
		const emailRaw = formData.get('email') as string;
		const organizationRaw = formData.get('organization') as string;
		const subjectRaw = formData.get('subject') as string;
		const category = formData.get('category') as string;
		const messageRaw = formData.get('message') as string;

		const errors: Record<string, string> = {};

		// バリデーション
		const nameValidation = validateName(nameRaw);
		if (!nameValidation.valid) {
			errors.name = nameValidation.error || 'お名前を入力してください。';
		}
		const name = nameValidation.sanitized || '';

		const emailValidation = validateEmail(emailRaw);
		if (!emailValidation.valid) {
			errors.email = emailValidation.error || 'メールアドレスを入力してください。';
		}
		const email = emailValidation.sanitized || '';

		let organization = '';
		if (organizationRaw) {
			const orgValidation = validateText(organizationRaw, 1, 100);
			if (!orgValidation.valid) {
				errors.organization = orgValidation.error || '組織名が無効です。';
			}
			organization = orgValidation.sanitized || '';
		}

		const subjectValidation = validateText(subjectRaw, 1, 200);
		if (!subjectValidation.valid) {
			errors.subject = subjectValidation.error || '件名を入力してください。';
		}
		const subject = subjectValidation.sanitized || '';

		// カテゴリのホワイトリスト検証
		const validCategories = ['general', 'technical', 'billing', 'feature', 'other'];
		if (!category || !validCategories.includes(category)) {
			errors.category = 'お問い合わせ種別を選択してください。';
		}

		const messageValidation = validateText(messageRaw, 10, 5000);
		if (!messageValidation.valid) {
			errors.message =
				messageValidation.error || 'お問い合わせ内容を10文字以上で入力してください。';
		}
		const message = messageValidation.sanitized || '';

		// エラーがある場合は返す
		if (Object.keys(errors).length > 0) {
			return fail(400, {
				errors,
				name: nameRaw,
				email: emailRaw,
				organization: organizationRaw,
				subject: subjectRaw,
				category,
				message: messageRaw
			});
		}

		// お問い合わせをデータベースに保存
		try {
			const { error: insertError } = await supabase.from('contact_submissions').insert({
				name,
				email,
				organization: organization || null,
				subject,
				category,
				message,
				status: 'new',
				submitted_at: new Date().toISOString()
			});

			if (insertError) {
				console.error('Contact submission error:', insertError);
				return fail(500, {
					error: 'お問い合わせの送信に失敗しました。しばらくしてから再度お試しください。',
					name: nameRaw,
					email: emailRaw,
					organization: organizationRaw,
					subject: subjectRaw,
					category,
					message: messageRaw
				});
			}

			// メール通知を送信（Resend APIキーが設定されている場合のみ）
			if (RESEND_API_KEY) {
				try {
					const resend = new Resend(RESEND_API_KEY);

					// カテゴリの日本語ラベル
					const categoryLabels: Record<string, string> = {
						general: '一般的な質問',
						technical: '技術的な問題',
						billing: '料金・請求について',
						feature: '機能に関する要望',
						other: 'その他'
					};

					const categoryLabel = categoryLabels[category] || category;

					await resend.emails.send({
						from: 'TENTO <onboarding@resend.dev>',
						to: 'support@tentoapp.com',
						subject: `【TENTO】新規お問い合わせ: ${subject}`,
						text: `
新しいお問い合わせが届きました。

━━━━━━━━━━━━━━━━━━━━━━
お問い合わせ情報
━━━━━━━━━━━━━━━━━━━━━━

【お名前】
${name}

【メールアドレス】
${email}

${organization ? `【組織名・団体名】\n${organization}\n\n` : ''}【件名】
${subject}

【お問い合わせ種別】
${categoryLabel}

【お問い合わせ内容】
${message}

━━━━━━━━━━━━━━━━━━━━━━
送信日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
━━━━━━━━━━━━━━━━━━━━━━

※ このメールは自動送信されています。
※ 返信はお問い合わせ者のメールアドレス（${email}）宛にお送りください。
						`.trim()
					});

					console.log('Contact notification email sent successfully');
				} catch (emailError) {
					// メール送信に失敗してもデータベースには保存されているので、
					// エラーログのみ出力してユーザーには成功を返す
					console.error('Failed to send contact notification email:', emailError);
				}
			}

			// 成功
			return {
				success: true
			};
		} catch (err) {
			console.error('Contact submission error:', err);
			return fail(500, {
				error: 'お問い合わせの送信に失敗しました。しばらくしてから再度お試しください。',
				name: nameRaw,
				email: emailRaw,
				organization: organizationRaw,
				subject: subjectRaw,
				category,
				message: messageRaw
			});
		}
	}
} satisfies Actions;
