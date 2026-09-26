import type { Browser } from "puppeteer-core";

// 2026-09-26: 방문자 브라우저가 보낸 보고서 HTML(report-snapshot.ts)을 헤드리스 크롬으로 PDF로 만든다.
// - Vercel에서는 @sparticuz/chromium, 로컬에서는 puppeteer가 받은 크롬을 쓴다
//   (로컬 크롬 경로는 PUPPETEER_EXECUTABLE_PATH로 바꿀 수 있다)
// - HTML은 외부에서 온 값이므로 스크립트를 끄고, 한글 웹폰트 CDN과 data: 외에는 네트워크를 막는다
// - 서버 크롬에는 한글 글꼴이 없어서, 보고서 CSS의 글꼴 목록에 이미 들어 있는
//   Noto Sans KR(본문)·Gowun Batang(제목) 웹폰트를 Google Fonts에서 받아 넣어준다

const FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&family=Gowun+Batang:wght@400;700&display=block";

const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const [{ default: chromium }, puppeteer] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { default: puppeteer } = await import("puppeteer");
  return (await puppeteer.launch({ headless: true })) as unknown as Browser;
}

function withFonts(html: string) {
  const head = `<link rel="stylesheet" href="${FONT_LINK}">`;
  return html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : `${head}${html}`;
}

export async function renderReportPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || url === "about:blank") return void request.continue();
      try {
        const { protocol, hostname } = new URL(url);
        if (protocol === "https:" && ALLOWED_HOSTS.has(hostname)) return void request.continue();
      } catch {
        // 잘못된 주소는 막는다
      }
      void request.abort();
    });

    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(withFonts(html), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      timeout: 30_000,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
