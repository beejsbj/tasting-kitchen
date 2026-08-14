// Source S1: synthetic Relay adapter path.
export function canExport(config, secrets) {
  const relay = config.adapters?.relay;
  return Boolean(relay?.enabled && relay.tokenRef && secrets[relay.tokenRef]);
}
