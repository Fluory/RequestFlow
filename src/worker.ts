// Worker entrypoint (module `jobs`, ADR-0001 D2). No-op until #7 adds pg-boss and `drain()`:
// it proves the second process starts from the same image and stops cleanly.
const log = (message: string) => console.log(JSON.stringify({ level: "info", process: "worker", message }));

log("worker started – no job handlers registered yet");
const keepAlive = setInterval(() => {}, 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(keepAlive);
    log(`worker stopped (${signal})`);
    process.exit(0);
  });
}
