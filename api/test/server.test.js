import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { makeApp } from "../server.js";

test("POST /ask forwards to core and returns its body", async () => {
  const core = http.createServer((req, res) => {
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({ answer: "ok", citations: [{ note_id: "n1" }] }));
  }).listen(0);
  const coreUrl = `http://localhost:${core.address().port}/ask`;
  const app = makeApp(coreUrl);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://localhost:${port}/ask`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "hi", principal_scopes: ["alice-private"], tenant_id: "t1" })
  });
  const body = await r.json();
  assert.equal(body.answer, "ok");
  assert.equal(body.citations[0].note_id, "n1");
  server.close(); core.close();
});
