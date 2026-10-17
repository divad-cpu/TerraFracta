"""Join two confirmed retained originals to existing offline change planning.

Both vintages are mandatory here: an unavailable prior original must not turn
into a first-observation request. The caller chooses the prior version and
supplies independent bindings; this helper neither discovers a baseline nor
renews source/recipe/rights trust. No SQL, provider, write or publication.
"""
from datetime import datetime
from workers.document_result_reopen import ReopenedDocumentResult,confirm_reopened_document_result
from workers.document_passage_comparison import DocumentPassageCapture,compare_document_passages
from workers.document_dispatch_plan import DocumentChangeRequest


class ReopenedDocumentChangeError(ValueError):pass


def _capture(reopened,receipt,at):
 if type(reopened) is not ReopenedDocumentResult or type(receipt) is not bytes:raise ValueError
 confirm_reopened_document_result(receipt,reopened,observed_at=at)
 result=reopened.result_request
 return DocumentPassageCapture(result.document_raw,result.document,result.binding,result.mapping)


def prepare_reopened_document_change(current: ReopenedDocumentResult,current_receipt: bytes,
 previous: ReopenedDocumentResult,previous_receipt: bytes,*,observed_at: datetime) -> DocumentChangeRequest:
 """Reconfirm both complete receipts and delegate all comparison semantics."""
 try:
  now=_capture(current,current_receipt,observed_at);before=_capture(previous,previous_receipt,observed_at)
  comparison=compare_document_passages(now,before,observed_at=observed_at)
  return DocumentChangeRequest(comparison.current.snapshot.item_key,now,before)
 except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
  raise ReopenedDocumentChangeError('reopened_document_change_unavailable') from None
