-- Only bind canonical country and issue slugs as text parameters. The private
-- function returns one JSON candidate or SQL NULL in a single statement snapshot.
-- A server must apply the strict materializer before any display; no credential
-- or public route is supplied by this file.
select terra_private.read_issue_candidate($1, $2)
