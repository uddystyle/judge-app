<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import SetupParticipants from '$lib/components/SetupParticipants.svelte';
	import { page } from '$app/stores';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
</script>

<SetupParticipants {data} {form} backPath={`/session/${sessionId}/training-setup`} />
