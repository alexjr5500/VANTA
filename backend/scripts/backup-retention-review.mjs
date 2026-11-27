// Automatic review, not deletion authorization. Remote metadata alone cannot
// prove provenance, independent restore, legal holds or provider retention.
export function reviewRetention({nowMs,sets,retainDays=7}){
  if(!Number.isSafeInteger(nowMs)||nowMs<0||!Number.isInteger(retainDays)||retainDays<7||retainDays>365||!Array.isArray(sets))throw Error('Invalid retention review');
  const seen=new Set(),counts={};
  for(const s of sets){
    if(!s||!['production','production-db','production-media'].includes(s.scope)||typeof s.id!=='string'||!Number.isSafeInteger(s.completedAtMs)||s.completedAtMs<=0||s.completedAtMs>nowMs||seen.has(s.scope+'/'+s.id))throw Error('Invalid retention inventory');
    seen.add(s.scope+'/'+s.id);
    const group=counts[s.scope]??={total:0,olderThanPolicy:0,protected:0};
    group.total++;group.protected++;
    if(s.completedAtMs<nowMs-retainDays*86400000)group.olderThanPolicy++;
  }
  return {retainDays,scopes:counts,deletionAuthorized:false,deleteCandidates:[],reason:'independent_restore_and_hold_evidence_required'};
}
