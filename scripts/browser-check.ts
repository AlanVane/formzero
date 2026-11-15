/**
 * Browser check for the FormZero dashboard and CSV export.
 *
 * Launches headless Chrome, sets a session cookie, loads a page, asserts that
 * expected strings appear in the rendered DOM, screenshots it, optionally
 * clicks a button and captures any file it downloads.
 *
 *   bun run scripts/browser-check.ts \
 *     --url http://localhost:5178/forms/<formId>/submissions \
 *     --cookie "better-auth.session_token=<token>" \
 *     --expect "Project Type" --expect "Web app, Mobile app" \
 *     --click "csv" --out /tmp/browser-check
 *
 * Exit code is 1 when an assertion fails, so it can gate a merge.
 */
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome-stable";

type Args = {
  url: string;
  cookies: string[];
  expects: string[];
  click?: string;
  out: string;
  wait: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: "",
    cookies: [],
    expects: [],
    out: "/tmp/browser-check",
    wait: 4500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--cookie") args.cookies.push(argv[++i]);
    else if (a === "--expect") args.expects.push(argv[++i]);
    else if (a === "--click") args.click = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--wait") args.wait = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.url) throw new Error("--url is required");
  return args;
}

const args = parseArgs(Bun.argv.slice(2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const profileDir = `${args.out}/profile`;
const downloadDir = `${args.out}/downloads`;

await Bun.$`mkdir -p ${profileDir} ${downloadDir}`.quiet();

// --- launch Chrome ---------------------------------------------------------
// --remote-debugging-port=0 makes Chrome pick a free port and write it to
// <profile>/DevToolsActivePort, which avoids clashing with a Chrome that is
// already running.
const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-extensions",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);

async function debugPort(): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const f = Bun.file(`${profileDir}/DevToolsActivePort`);
    if (await f.exists()) {
      const [portLine] = (await f.text()).split("\n");
      const port = Number(portLine);
      if (port > 0) return port;
    }
    await sleep(200);
  }
  throw new Error("Chrome did not expose a debug port");
}

const port = await debugPort();
const host = new URL(args.url).hostname;

// --- minimal CDP client ----------------------------------------------------
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void }
>();

function connect(url: string) {
  const ws = new WebSocket(url);
  const opened = new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error(`cannot connect to ${url}`));
  });
  ws.onmessage = (msg) => {
    const data = JSON.parse(String(msg.data));
    if (!data.id) return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error
      ? p.reject(new Error(JSON.stringify(data.error)))
      : p.resolve(data.result);
  };
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    await opened;
    const id = ++nextId;
    const result = new Promise((resolve, reject) =>
      pending.set(id, { resolve, reject }),
    );
    ws.send(JSON.stringify({ id, method, params }));
    return (await result) as any;
  };
  return { send, ws };
}

const tab = await (
  await fetch(`http://127.0.0.1:${port}/json/new?url=about:blank`, {
    method: "PUT",
  })
).json();
const { send, ws } = connect(tab.webSocketDebuggerUrl);

await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: downloadDir,
});

for (const raw of args.cookies) {
  const eq = raw.indexOf("=");
  await send("Network.setCookie", {
    name: raw.slice(0, eq),
    value: raw.slice(eq + 1),
    domain: host,
    path: "/",
    httpOnly: true,
  });
}

await send("Page.navigate", { url: args.url });
await sleep(args.wait);

const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result?.value;
};

const href = await evaluate("location.href");
const text: string = (await evaluate("document.body.innerText")) ?? "";

const results = args.expects.map((needle) => ({
  needle,
  ok: text.includes(needle),
}));
const screenshot = await send("Page.captureScreenshot", { format: "png" });
await Bun.write(`${args.out}/page.png`, Buffer.from(screenshot.data, "base64"));

let clicked: string | null = null;
if (args.click) {
  const re = new RegExp(args.click, "i");
  clicked = await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => ${re}.test(x.textContent || ''));
    if (!b) return 'no button matched ${args.click}';
    b.click();
    return 'clicked: ' + b.textContent.trim();
  })()`);
  await sleep(3500);
}

ws.close();
chrome.kill();

const downloads = Array.from(new Bun.Glob("*").scanSync(downloadDir));

console.log(
  JSON.stringify(
    {
      url: args.url,
      landedOn: href,
      screenshot: `${args.out}/page.png`,
      expectations: results,
      clicked,
      downloads,
      textPreview: text.slice(0, 400),
    },
    null,
    2,
  ),
);

process.exit(results.every((r) => r.ok) ? 0 : 1);
