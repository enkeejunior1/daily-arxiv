function normalizeArxivId(value: string | null) {
  const id = (value ?? "").trim().replace(/v\d+$/i, "");
  return /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id : "";
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
    const response = await fetch(`https://arxiv.org/pdf/${arxivId}`, {
      headers: {
        "User-Agent": "daily-arxiv-local/1.0 (personal research reader)",
        ...(range ? { Range: range } : {}),
      },
    });
    if (!response.ok || !response.body) {
      return Response.json({ error: `arXiv PDF ${response.status}` }, { status: 502 });
    }

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
      { error: error instanceof Error ? error.message : "PDF proxy failed." },
      { status: 502 },
    );
  }
}
