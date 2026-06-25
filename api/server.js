import express from "express";
export function makeApp(coreUrl = process.env.CORE_URL || "http://localhost:8099/ask") {
  const app = express();
  app.use(express.json());
  app.post("/ask", async (req, res) => {
    try {
      const r = await fetch(coreUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) });
      res.status(r.status).json(await r.json());
    } catch (e) { res.status(502).json({ error: String(e) }); }
  });
  return app;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  makeApp().listen(3030, () => console.log("vault-api on :3030"));
}
