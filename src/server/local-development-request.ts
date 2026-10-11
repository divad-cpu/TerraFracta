export function hasLocalDevelopmentOrigin(request: Request, requireOrigin = true): boolean {
  return hasLocalDevelopmentAuthority(request, requireOrigin) && !new URL(request.url).search;
}

// A caller admitting search parameters must validate its own closed selector
// grammar before doing any work. Existing no-query entry points stay above.
export function hasLocalDevelopmentAuthority(request: Request, requireOrigin = true): boolean {
  const url = new URL(request.url);
  const authority = request.headers.get("host") ?? url.host;
  const localAuthority = /^(?:127\.0\.0\.1|localhost)(?::[1-9][0-9]{0,4})?$/.test(authority);
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  return url.protocol === "http:" && !url.username && !url.password &&
    ["127.0.0.1", "localhost"].includes(url.hostname) && localAuthority &&
    !["cross-site", "same-site"].includes(site ?? "") &&
    (origin === `http://${authority}` || (!requireOrigin && origin === null && site === "same-origin"));
}
