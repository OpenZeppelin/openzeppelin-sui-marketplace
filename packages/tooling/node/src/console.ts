export const withMutedConsole = async <T>(
  action: () => Promise<T> | T
): Promise<T> => {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  }

  const mute = () => {}
  console.log = mute
  console.warn = mute
  console.error = mute
  console.info = mute
  console.debug = mute

  try {
    return await action()
  } finally {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
    console.info = original.info
    console.debug = original.debug
  }
}
