function normalizeArxivId(value: string | null) {
  const id = (value ?? "").trim().replace(/v\d+$/i, "");
  return /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id : "";
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 250, 800];

function pdfSources(arxivId: string) {
  return [
    `https://arxiv.org/pdf/${arxivId}`,
    `https://export.arxiv.org/pdf/${arxivId}`,
    `https://arxiv.org/pdf/${arxivId}`,
  ];
}

async function wait(milliseconds: number) {
  if (!milliseconds) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPdf(arxivId: string, range: string | null, requestSignal: AbortSignal) {
  let lastStatus = 0;
  let lastError: unknown = null;
  const sources = pdfSources(arxivId);

  for (let attempt = 0; attempt < sources.length; attempt += 1) {
    await wait(RETRY_DELAYS_MS[attempt]);
    try {
      const response = await fetch(sources[attempt], {
        headers: {
          "User-Agent": "daily-arxiv/1.0 (personal research reader)",
          ...(range ? { Range: range } : {}),
        },
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(15_000)]),
      });
      lastStatus = response.status;
      if (response.ok && response.body) return response;
      await response.body?.cancel();
      if (!RETRYABLE_STATUSES.has(response.status)) break;
    } catch (error) {
      if (requestSignal.aborted) throw error;
      lastError = error;
    }
  }

  if (lastStatus) throw new Error(`arXiv PDF ${lastStatus} after retry`);
  throw lastError instanceof Error ? lastError : new Error("arXiv PDF request failed after retry");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const arxivId = normalizeArxivId(url.searchParams.get("arxivId"));
  const download = url.searchParams.get("download") === "1";
  if (!arxivId) {
    return Response.json({ error: "Invalid arXiv id." }, { status: 400 });
  }

  try {
    const range = request.headers.get("range");
    const response = await fetchPdf(arxivId, range, request.signal);

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=21600",
      "Accept-Ranges": response.headers.get("accept-ranges") ?? "bytes",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${arxivId.replace("/", "-")}.pdf"`,
    });
    for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "PDF proxy failed.",
        retryable: !request.signal.aborted,
      },
      { status: request.signal.aborted ? 499 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
