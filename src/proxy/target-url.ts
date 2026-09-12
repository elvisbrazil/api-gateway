export function buildTargetUrl(
  base: string,
  prefix: string,
  requestUrl: string,
  stripPrefix: boolean,
) {
  const rest = stripPrefix && prefix !== "/" ? requestUrl.slice(prefix.length) : requestUrl;
  const queryIndex = rest.indexOf("?");
  const pathname = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : rest.slice(queryIndex);

  const target = new URL(base);
  const basePath = target.pathname.replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  target.pathname = basePath + path;
  target.search = search;
  return target.toString();
}
