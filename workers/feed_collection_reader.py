"""Fixed invented metadata-inventory adapter, no raw or write permission.

The isolated owner must assign collection scope independently. Existing raw
page/result APIs retain their separate stream allowlist and private boundaries.
"""
from workers.feed_collection_inventory import InventoryRequest,FeedInventoryError,MAX_INVENTORY_STATEMENT


def restricted_inventory_statement(request):
 if type(request) is not InventoryRequest:raise FeedInventoryError('restricted_inventory_request_invalid')
 statement=request.statement()
 before,separator,after=statement.partition('select tf_feed_inventory.page(')
 if not separator:raise FeedInventoryError('restricted_inventory_request_invalid')
 result=before+'select tf_feed_runtime.collection_inventory('+after
 if len(result.encode())>MAX_INVENTORY_STATEMENT:raise FeedInventoryError('restricted_inventory_statement_limit')
 return result
