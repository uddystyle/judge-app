import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const organizationId = url.searchParams.get('id');

	if (!organizationId) {
		return json({ error: 'Organization ID is required' }, { status: 400 });
	}

	// 組織情報を取得
	const { data: organization, error: orgError } = await supabase
		.from('organizations')
		.select('*')
		.eq('id', organizationId)
		.single();

	if (orgError) {
		return json({ error: orgError.message }, { status: 500 });
	}

	// サブスクリプション情報を取得
	const { data: subscriptions } = await supabase
		.from('subscriptions')
		.select('*')
		.eq('organization_id', organizationId);

	return json({
		organization,
		subscriptions
	});
};
