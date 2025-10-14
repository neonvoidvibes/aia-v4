import type { SupabaseClient } from '@supabase/supabase-js';

export type AgentEventsResponse = {
  events: string[];
  eventTypes: Record<string, string>; // e.g. { "abc123": "personal" | "group" | "breakout" }
  allowedEvents: string[];
  personalEventId: string | null;
};

function reorderEvents(events: string[], eventTypes: Record<string, string>): string[] {
  const unique = Array.from(new Set(events));
  const personal = unique.filter(evt => eventTypes[evt] === 'personal').sort();
  const others = unique.filter(evt => evt !== '0000' && eventTypes[evt] !== 'personal').sort();
  const ordered = [...personal, '0000', ...others];
  return Array.from(new Set(ordered));
}

type AgentEventRow = {
  event_id: string | null;
  type?: string | null;
  visibility_hidden?: boolean | null;
  owner_user_id?: string | null;
};

export async function loadAgentEventsForUser(
  supabase: SupabaseClient<unknown, 'public', unknown>,
  agentName: string,
  userId: string,
): Promise<AgentEventsResponse> {
  // 1) Read agent_events the user can see (RLS handles access)
  const { data, error } = await supabase
    .from('agent_events')
    .select('event_id,type,visibility_hidden,owner_user_id,created_at')
    .eq('agent_name', agentName)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Failed to load agent events');
  }

  const eventRows: AgentEventRow[] = data || [];
  const allowedEvents = new Set<string>();
  const eventTypes: Record<string, string> = {};
  const visibleEvents: string[] = [];
  let personalEventId: string | null = null;

  for (const row of eventRows) {
    const rawId = row.event_id;
    const eventId = (rawId || '').trim().toLowerCase();
    if (!eventId) continue;

    const type = (row.type || 'group').toLowerCase();
    // For breakout events, default to visible (false) if null; for others, default to hidden (true)
    const defaultHidden = type === 'breakout' ? false : true;
    const hidden = row.visibility_hidden ?? defaultHidden;
    const isOwner = row.owner_user_id === userId;

    allowedEvents.add(eventId);
    eventTypes[eventId] = type;

    // Visibility rules:
    // - Not hidden (visibility_hidden = false)
    // - Personal events are visible to owner even if marked as hidden
    const isVisible = !hidden || (type === 'personal' && isOwner);
    if (isVisible) {
      visibleEvents.push(eventId);
    }
    if (type === 'personal' && isOwner && !personalEventId) {
      personalEventId = eventId;
    }
  }

  allowedEvents.add('0000');
  eventTypes['0000'] = 'shared';
  if (!visibleEvents.includes('0000')) {
    visibleEvents.push('0000');
  }

  const events = reorderEvents(visibleEvents, eventTypes);

  return {
    events,
    eventTypes,
    allowedEvents: Array.from(allowedEvents),
    personalEventId,
  };
}
