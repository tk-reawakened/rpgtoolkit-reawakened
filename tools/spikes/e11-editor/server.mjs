// The spike's HTTP server for the Chromium runs; the responses are in page.mjs.
import { createServer } from "node:http";
import { respond } from "./page.mjs";

const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 4199);
createServer((request, response) => {
  const { status, type, body } = respond(new URL(request.url, `http://127.0.0.1:${port}`));
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.end(body);
}).listen(port, "127.0.0.1", () => console.log(`spike server on http://127.0.0.1:${port}`));
