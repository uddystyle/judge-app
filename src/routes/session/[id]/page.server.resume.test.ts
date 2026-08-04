/**
 * session/[id] load のゲスト復帰経路（1026）
 *
 * 本丸の回帰テスト: 旧 `?guest=<guest_identifier>` では**再採用も uid 再束縛も起きない**こと。
 * guest_identifier は採点行の owner 列として同席者全員に見えるため、これをベアラ資格情報に
 * すると同席者が他検定員の identity を乗っ取り、uid 束縛ごと奪って本人をロックアウトできる。
 * 復帰は service role 専用テーブルの resume_token（?resume=）だけで行う。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', async () => {
	const actual = await vi.importActual<typeof import('@sveltejs/kit')>('@sveltejs/kit');
	return {
		...actual,
		redirect: vi.fn((status: number, location: string) => {
			const e = new Error(`REDIRECT:${location}`);
			(e as unknown as { status: number }).status = status;
			(e as unknown as { location: string }).location = location;
			throw e;
		})
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}));

// 復帰ブロックを抜けた直後で止めるための番兵。
// これが投げられた＝「再採用せずに通常の認証へ進んだ」ことを意味する。
vi.mock('$lib/server/sessionAuth', () => ({
	authenticateSession: vi.fn(() => {
		throw new Error('REACHED_AUTHENTICATE_SESSION');
	}),
	authenticateAction: vi.fn()
}));

vi.mock('$lib/server/guestResume', () => ({
	findParticipantByResumeToken: vi.fn(),
	getResumeToken: vi.fn(() => Promise.resolve(null)),
	issueResumeToken: vi.fn()
}));

import { load } from './+page.server';
import { findParticipantByResumeToken } from '$lib/server/guestResume';

const VICTIM = {
	id: 'participant-victim',
	session_id: 42,
	guest_identifier: 'victim-guest-identifier',
	guest_name: '被害者',
	user_id: 'anon-victim'
};

function makeLocals(currentUser: { id: string; is_anonymous: boolean } | null) {
	const bindEq = vi.fn().mockResolvedValue({ error: null });
	const bindUpdate = vi.fn(() => ({ eq: bindEq }));
	const signInAnonymously = vi.fn().mockResolvedValue({
		data: { user: { id: 'anon-attacker-new' }, session: { access_token: 't' } },
		error: null
	});

	const supabase = {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: currentUser }, error: null }),
			signInAnonymously
		},
		from: vi.fn(() => ({ update: bindUpdate }))
	};
	const supabaseAdmin = { from: vi.fn(() => ({ update: bindUpdate })) };

	return { locals: { supabase, supabaseAdmin }, signInAnonymously, bindUpdate, bindEq };
}

const runLoad = (query: string, locals: unknown) =>
	load({
		params: { id: '42' },
		url: new URL(`http://localhost/session/42${query}`),
		locals
	} as never);

describe('session/[id] load — ゲスト復帰（1026）', () => {
	beforeEach(() => vi.clearAllMocks());

	it('❗ 旧 ?guest= では再採用も uid 再束縛も起きない（乗っ取りの回帰テスト）', async () => {
		const { locals, signInAnonymously, bindUpdate } = makeLocals(null);

		await expect(runLoad(`?guest=${VICTIM.guest_identifier}`, locals)).rejects.toThrow(
			'REDIRECT:/session/42'
		);

		// 被害者の identity は一切引かれず、JWT も発行されず、user_id も書き換わらない
		expect(findParticipantByResumeToken).not.toHaveBeenCalled();
		expect(signInAnonymously).not.toHaveBeenCalled();
		expect(bindUpdate).not.toHaveBeenCalled();
	});

	it('?guest= を落とすとき、他のクエリパラメータは保持する', async () => {
		const { locals } = makeLocals(null);

		await expect(runLoad('?guest=x&restart=true&join=true', locals)).rejects.toThrow(
			/REDIRECT:\/session\/42\?.*restart=true/
		);
	});

	it('?resume=<正しい token> なら JWT を発行し uid を束縛してリダイレクトする', async () => {
		vi.mocked(findParticipantByResumeToken).mockResolvedValue(VICTIM);
		const { locals, signInAnonymously, bindUpdate, bindEq } = makeLocals(null);

		await expect(runLoad('?resume=tok-valid', locals)).rejects.toThrow('REDIRECT:/session/42');

		expect(findParticipantByResumeToken).toHaveBeenCalledWith(expect.anything(), '42', 'tok-valid');
		expect(signInAnonymously).toHaveBeenCalled();
		expect(bindUpdate).toHaveBeenCalledWith({ user_id: 'anon-attacker-new' });
		// 束縛対象は token から引いた参加行の id（guest_identifier ではない）
		expect(bindEq).toHaveBeenCalledWith('id', VICTIM.id);
	});

	it('❗ 未知の token では再採用せず、通常の認証へ進む', async () => {
		vi.mocked(findParticipantByResumeToken).mockResolvedValue(null);
		const { locals, signInAnonymously, bindUpdate } = makeLocals(null);

		await expect(runLoad('?resume=unknown', locals)).rejects.toThrow(
			'REACHED_AUTHENTICATE_SESSION'
		);

		expect(signInAnonymously).not.toHaveBeenCalled();
		expect(bindUpdate).not.toHaveBeenCalled();
	});

	it('既に本端末の uid が束縛済みなら再発行しない', async () => {
		vi.mocked(findParticipantByResumeToken).mockResolvedValue(VICTIM);
		const { locals, signInAnonymously } = makeLocals({ id: VICTIM.user_id, is_anonymous: true });

		await expect(runLoad('?resume=tok-valid', locals)).rejects.toThrow('REDIRECT:/session/42');

		expect(signInAnonymously).not.toHaveBeenCalled();
	});

	it('❗ 通常ユーザー（匿名でない）は復帰リンクを踏んでもゲストに降格しない', async () => {
		const { locals, signInAnonymously } = makeLocals({ id: 'real-user', is_anonymous: false });

		await expect(runLoad('?resume=tok-valid', locals)).rejects.toThrow('REDIRECT:/session/42');

		expect(findParticipantByResumeToken).not.toHaveBeenCalled();
		expect(signInAnonymously).not.toHaveBeenCalled();
	});
});
