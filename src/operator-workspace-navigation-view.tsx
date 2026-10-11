import { operatorWorkspaceLinks, type OperatorWorkspaceContext, type OperatorWorkspaceLocation } from "./operator-workspace-navigation.ts";

export function OperatorWorkspaceNavigation({ context = {}, active }: { context?: OperatorWorkspaceContext; active: OperatorWorkspaceLocation }) {
  const checked = operatorWorkspaceLinks(context);
  return <aside className="operator-workspace-context" aria-label="Recorded exception workspace">
    <nav className="current-issue-nav" aria-label="Recorded workspace views">{checked.links.map((link, index) => link.href ?
      <a key={link.label} href={link.href} aria-current={link.key === active && index === checked.links.findIndex(item => item.key === active) ? "location" : undefined}>{link.label}</a> :
      <span key={index} className="workspace-unselected">{link.label} <small>({link.key === "comparison" ? "choose a held decision" : link.key === "holds" ? "choose a run" : "choose a run and issue"})</small></span>)}</nav>
    <p className="small-note">Each destination makes its own dated read. Recorded states and issue choices do not establish current source health, successful publication or a common atomic snapshot.</p>
  </aside>;
}
