const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"])

export const isLocalhostHost = (hostname?: string) => {
  return Boolean(hostname && LOCALHOST_HOSTNAMES.has(hostname))
}
