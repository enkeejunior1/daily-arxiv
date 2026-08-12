"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

const MIN_ZOOM = 50;
const MAX_ZOOM = 300;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  scale,
  scrollRoot,
  onFirstPageRendered,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  scrollRoot: RefObject<HTMLDivElement | null>;
  onFirstPageRendered: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [shouldRender, setShouldRender] = useState(pageNumber === 1);

  useEffect(() => {
    let active = true;
    pdf.getPage(pageNumber).then((page) => {
      if (!active) return;
      pageRef.current = page;
      const viewport = page.getViewport({ scale: 1 });
      setBaseSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      active = false;
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [pageNumber, pdf]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const root = scrollRoot.current;
    if (!wrapper || !root || shouldRender) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "900px 0px" },
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [scrollRoot, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    let active = true;
    let task: RenderTask | null = null;

    async function renderPage() {
      const page = pageRef.current ?? (await pdf.getPage(pageNumber));
      if (!active) return;
      pageRef.current = page;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { alpha: false });
      if (!canvas || !context) return;

      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      renderTaskRef.current?.cancel();
      task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (active && pageNumber === 1) onFirstPageRendered();
      } catch (error) {
        if (error instanceof Error && error.name !== "RenderingCancelledException") throw error;
      }
    }

    void renderPage();
    return () => {
      active = false;
      task?.cancel();
    };
  }, [onFirstPageRendered, pageNumber, pdf, scale, shouldRender]);

  return (
    <div
      className="pdf-canvas-page"
      ref={wrapperRef}
      style={{ width: baseSize.width * scale, height: baseSize.height * scale }}
      aria-label={`PDF ${pageNumber}페이지`}
    >
      {shouldRender ? <canvas ref={canvasRef} /> : <span>{pageNumber}</span>}
    </div>
  );
}

export function PdfCanvasReader({
  url,
  title,
  zoomPercent,
  onZoomChange,
  onReady,
  onError,
}: {
  url: string;
  title: string;
  zoomPercent: number;
  onZoomChange: (zoom: number) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoomPercent);
  const firstPageReadyRef = useRef(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [baseWidth, setBaseWidth] = useState(612);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [error, setError] = useState("");

  useEffect(() => {
    zoomRef.current = zoomPercent;
  }, [zoomPercent]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let document: PDFDocumentProxy | null = null;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | null = null;

    async function loadPdf() {
      try {
        const pdfjs = await import("pdfjs-dist/webpack.mjs");
        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        document = await task.promise;
        const firstPage = await document.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup();
        if (!active) return;
        setBaseWidth(viewport.width);
        setPdf(document);
      } catch {
        if (!active) return;
        setError("PDF를 앱 뷰어로 불러오지 못했어요.");
        onError();
      }
    }

    void loadPdf();
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [onError, url]);

  const applyZoomAtPoint = useCallback(
    (nextZoom: number, clientX: number, clientY: number) => {
      const root = scrollRef.current;
      if (!root) return;
      const oldZoom = zoomRef.current;
      const next = clampZoom(nextZoom);
      if (Math.abs(next - oldZoom) < 0.5) return;

      const rect = root.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const anchorX = root.scrollLeft + localX;
      const anchorY = root.scrollTop + localY;
      const ratio = next / oldZoom;
      zoomRef.current = next;
      onZoomChange(Math.round(next));

      window.requestAnimationFrame(() => {
        root.scrollLeft = anchorX * ratio - localX;
        root.scrollTop = anchorY * ratio - localY;
      });
    },
    [onZoomChange],
  );

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let gestureStartZoom = zoomRef.current;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.exp(-event.deltaY * 0.012);
      applyZoomAtPoint(zoomRef.current * factor, event.clientX, event.clientY);
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      const rect = root.getBoundingClientRect();
      applyZoomAtPoint(
        gestureStartZoom * (gesture.scale ?? 1),
        gesture.clientX ?? rect.left + rect.width / 2,
        gesture.clientY ?? rect.top + rect.height / 2,
      );
    };

    root.addEventListener("wheel", handleWheel, { passive: false });
    root.addEventListener("gesturestart", handleGestureStart, { passive: false });
    root.addEventListener("gesturechange", handleGestureChange, { passive: false });
    return () => {
      root.removeEventListener("wheel", handleWheel);
      root.removeEventListener("gesturestart", handleGestureStart);
      root.removeEventListener("gesturechange", handleGestureChange);
    };
  }, [applyZoomAtPoint]);

  const fitScale = Math.max(0.1, (availableWidth - 32) / baseWidth);
  const scale = fitScale * (zoomPercent / 100);
  const handleFirstPageRendered = useCallback(() => {
    if (firstPageReadyRef.current) return;
    firstPageReadyRef.current = true;
    onReady();
  }, [onReady]);

  return (
    <div
      className="pdf-canvas-reader"
      ref={scrollRef}
      aria-label={`${title} PDF 뷰어. 트랙패드 핀치로 확대 및 축소`}
    >
      {error ? (
        <div className="pdf-canvas-message">{error}</div>
      ) : pdf ? (
        <div className="pdf-canvas-pages">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPageCanvas
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              scale={scale}
              scrollRoot={scrollRef}
              onFirstPageRendered={handleFirstPageRendered}
            />
          ))}
        </div>
      ) : (
        <div className="pdf-canvas-message">PDF를 불러오는 중</div>
      )}
    </div>
  );
}
