import type { PageServerLoad, Actions } from './$types';
import { loadSetupEvents, createSetupEventsActions } from '$lib/server/sessionSetup';

export const load: PageServerLoad = (event) => loadSetupEvents(event, 'tournament');

export const actions: Actions = createSetupEventsActions('tournament');
