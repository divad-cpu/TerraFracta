export const choiceId = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const bytes = value => new TextEncoder().encode(JSON.stringify(value));
export function choices(selected = null) {
  const runs = [2,1].map(n=>({runId:choiceId(n),jurisdictionId:'invented-jurisdiction',
    createdAt:'2026-10-05T09:00:00.000001Z',runState:'completed'}));
  const selectedRun = runs.find(run=>run.runId===selected) ?? null;
  return {schemaVersion:2,status:'ok',observedAt:'2026-10-05T10:00:00Z',requestedRunId:selected,requestedCursor:null,
    runs,moreRuns:false,selectedRun,issues:selectedRun?[{issueId:choiceId(30),issueKey:'housing-costs'}]:[],moreIssues:false,nextCursor:null};
}
