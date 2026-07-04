import type { PageServerLoad, Actions } from './$types';
import { loadSetupParticipants, participantsSetupActions } from '$lib/server/sessionSetup';

export const load: PageServerLoad = (event) => loadSetupParticipants(event, 'training');

export const actions: Actions = participantsSetupActions;
