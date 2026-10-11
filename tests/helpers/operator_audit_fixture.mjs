// Invented structural examples. Authenticity comes only from a trusted read;
// parsing these does not attest to a source, accepted credential or publication.
export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const scope = () => ({runId:id(1),issueId:id(2),cursor:null});
export function audit() {
  return {
    schemaVersion:1,status:'ok',requested:scope(),observedAt:'2026-10-05T10:00:00.000002Z',
    run:{runId:id(1),jurisdictionId:'fictional-country',mode:'shadow',runState:'completed',commitState:'none',visibilityState:'not_required',createdAt:'2026-10-05T09:00:00Z',finishedAt:'2026-10-05T09:01:00Z'},
    expectedSourcesKnown:true,
    sources:[{registrationId:id(3),sourceKey:'fictional:source',registrationState:'approved',allowFetch:true,fetchEnabled:true,reviewedAt:'2026-10-05T08:00:00Z',outcome:'unchanged',checkedAt:'2026-10-05T09:00:30Z',sourceVersionId:id(4)}],
    history:{issueId:id(2),latestRevision:2,headPublicationId:id(6),headRevision:2,publications:[
      {publicationId:id(6),revision:2,supersedesPublicationId:id(5),publicationKind:'correction',createdAt:'2026-10-05T09:03:00Z',isHead:true},
      {publicationId:id(5),revision:1,supersedesPublicationId:null,publicationKind:'accepted',createdAt:'2026-10-05T09:02:00Z',isHead:false}
    ],nextCursor:null}
  };
}
export const bytes = value => new TextEncoder().encode(JSON.stringify(value));
