/**
 * Runtime live-trading gate. `capable` is set once from the env gates at
 * startup; `armed` flips only after the on-screen typed confirmation. The
 * provider build reads `armed` to choose live vs paper endpoints + credentials.
 */
export const liveState = {
  capable: false,
  armed: false
}
