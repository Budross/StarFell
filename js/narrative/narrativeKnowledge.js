// Authority was already consumed upstream. This policy only narrows admitted facts.
// Current local perception is plausible knowledge; proximity now is never a witness record.
export function narrativeKnowledge(fact,scope) {
  if (!scope.speaker) return true;
  if (fact.basis==='history') return fact.evidence.participants.includes(scope.observerId);
  if (fact.exposure==='participant_private') return false;
  return scope.observerLocationId===scope.locationId;
}
