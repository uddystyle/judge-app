<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import SetupEvents from '$lib/components/SetupEvents.svelte';
	import { page } from '$app/stores';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
</script>

<SetupEvents
	{data}
	{form}
	backPath={`/session/${sessionId}/tournament-setup`}
	nameKey="event_name"
/>
