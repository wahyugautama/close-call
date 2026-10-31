const emittedEvents = new Set<string>();

export function emitFeedbackOnce(eventId: string, emit: () => void) {
  if (emittedEvents.has(eventId)) return false;

  emittedEvents.add(eventId);
  emit();
  return true;
}
