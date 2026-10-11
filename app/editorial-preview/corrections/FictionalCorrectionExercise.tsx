"use client";
import { useEffect, useRef, useState } from "react";
import { createFictionalCorrectionWorkflow, type FictionalWorkflowBackend, type FictionalCorrectionWorkflow } from "../../../src/fictional-correction-workflow.ts";
import { FictionalCorrectionWorkflowView, type FictionalWorkflowActions } from "../../../src/fictional-correction-workflow-view.tsx";
import { observeClientError } from "../../../src/client-error-diagnostics.ts";

type WorkflowOwner = { backend: FictionalWorkflowBackend | undefined; workflow: FictionalCorrectionWorkflow };

// The optional port is a trusted local composition/test seam, never a URL,
// browser setting, server prop containing functions or operational provider.
// The real page passes no port, so all storage/review controls stay disabled.
export function FictionalCorrectionExercise({ backend }: { backend?: FictionalWorkflowBackend }) {
  const owned = useRef<WorkflowOwner | null>(null);
  const [display, setDisplay] = useState(() => ({ owner: null as WorkflowOwner | null,
    state: createFictionalCorrectionWorkflow().snapshot() }));
  useEffect(() => {
    let active = true;
    const workflow = createFictionalCorrectionWorkflow(backend, { onChange: state => { if (active) setDisplay({ owner, state }); } });
    const owner = { backend, workflow };
    owned.current = owner; setDisplay({ owner, state: workflow.snapshot() });
    return () => { active = false; workflow.dispose(); if (owned.current?.workflow === workflow) owned.current = null; };
  }, [backend]);
  // Backend identity may be reused by a later effect. A rendered control owns
  // this exact visit and must never resolve itself onto a successor workflow.
  const owner = owned.current;
  const current = owner !== null && owner.backend === backend && display.owner === owner;
  const state = current ? display.state : createFictionalCorrectionWorkflow().snapshot();
  const invoke = (action: (workflow: FictionalCorrectionWorkflow) => unknown) => {
    if (!current || owner === null || owned.current !== owner) return;
    try { void Promise.resolve(action(owner.workflow)).catch(() => observeClientError("browser_promise")); }
    catch { observeClientError("browser_promise"); }
  };
  const freshId = () => crypto.randomUUID();
  const actions: FictionalWorkflowActions | undefined = current && backend ? {
    load: () => invoke(workflow => workflow.load()), preparePage: () => invoke(workflow => workflow.prepare("page", freshId)),
    prepareStatement: () => invoke(workflow => workflow.prepare("statement", freshId)), submit: () => invoke(workflow => workflow.submit()),
    queue: () => invoke(workflow => workflow.queue()), nextPage: () => invoke(workflow => workflow.queue(true)),
    detail: () => invoke(workflow => workflow.detail()), startReview: () => invoke(workflow => workflow.review("in_review", freshId)),
    closeReview: () => invoke(workflow => workflow.review("closed", freshId)), recover: () => invoke(workflow => workflow.recover()),
    cancel: () => invoke(workflow => workflow.cancel()),
  } : undefined;
  return <FictionalCorrectionWorkflowView state={state} actions={actions} />;
}
