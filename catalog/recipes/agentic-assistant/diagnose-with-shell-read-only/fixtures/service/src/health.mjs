export function healthResponse(config, requestPath) {
  if (requestPath !== config.publicPath) return { status: 404, body: "not found" };
  return { status: 200, body: "ok" };
}
