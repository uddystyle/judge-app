import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { validateEmail, validateName, validateText } from '$lib/server/validation';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.getSession();
	const user = session?.user || null;

	let profile = null;
	if (user) {
		const { supabase } = locals;
		const { data } = await supabase
			.from('profiles')
			.select('id, full_name, avatar_url')
			.eq('id', user.id)
			.single();
		profile = data;
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
