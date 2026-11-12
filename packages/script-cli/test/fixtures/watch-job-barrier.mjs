// The first process cannot spawn descendants until the parent assigns its Windows job.
import { createConnection } from "node:net";

if (process.env.TKR_WATCH_JOB_PIPE) {
  const socket = createConnection(process.env.TKR_WATCH_JOB_PIPE);
  await new Promise((resolve, reject) => {
    socket.once("data", () => { socket.end(); resolve(); });
    socket.once("error", reject);
    socket.once("end", () => { reject(new Error("watch job barrier closed before release")); });
  });
}
