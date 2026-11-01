import { expect, test } from "@playwright/test";

/** The static host serves single byte ranges for real and rejects every range it does not support. */
const FILE = "/tools/browser/serve.mjs";

test("a valid single range returns exactly that slice with 206", async ({ request }) => {
  const whole = await request.get(FILE);
  expect(whole.status()).toBe(200);
  expect(whole.headers()["accept-ranges"]).toBe("bytes");
  const all = await whole.body();
  expect(Number(whole.headers()["content-length"])).toBe(all.length);

  const slice = await request.get(FILE, { headers: { range: "bytes=10-29" } });
  expect(slice.status()).toBe(206);
  expect(slice.headers()["content-range"]).toBe(`bytes 10-29/${all.length}`);
  expect(slice.headers()["content-length"]).toBe("20");
  expect(Buffer.from(await slice.body()).equals(all.subarray(10, 30))).toBe(true);

  const suffix = await request.get(FILE, { headers: { range: "bytes=-5" } });
  expect(suffix.status()).toBe(206);
  expect(suffix.headers()["content-range"]).toBe(`bytes ${all.length - 5}-${all.length - 1}/${all.length}`);
  expect(Buffer.from(await suffix.body()).equals(all.subarray(all.length - 5))).toBe(true);

  const open = await request.get(FILE, { headers: { range: `bytes=${all.length - 3}-` } });
  expect(open.status()).toBe(206);
  expect(Buffer.from(await open.body()).equals(all.subarray(all.length - 3))).toBe(true);
});

test("unsatisfiable, malformed, multiple and non-byte ranges are rejected with 416", async ({ request }) => {
  const size = (await (await request.get(FILE)).body()).length;
  for (const range of [`bytes=${size}-`, `bytes=${size + 100}-${size + 200}`, "bytes=9-3", "bytes=-0", "bytes=0-1,4-5", "items=0-1", "bytes=abc"]) {
    const rejected = await request.get(FILE, { headers: { range } });
    expect(rejected.status(), range).toBe(416);
    expect(rejected.headers()["content-range"], range).toBe(`bytes */${size}`);
  }
});
