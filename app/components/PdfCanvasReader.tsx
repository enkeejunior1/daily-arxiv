"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MIN_ZOOM = 50;
const MAX_ZOOM = 300;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function describePdfError(error: unknown) {
  if (!(error instanceof Error)) return "알 수 없는 PDF 오류가 발생했어요.";
  const status = (error as Error & { status?: number }).status;
  if (status) return `arXiv PDF 요청이 실패했어요 (HTTP ${status}).`;
  if (/missing pdf/i.test(error.name) || /missing pdf/i.test(error.message)) {
    return "arXiv에서 PDF를 찾지 못했어요.";
  }
  if (/invalid pdf/i.test(error.name) || /invalid pdf/i.test(error.message)) {
    return "PDF 파일 형식을 읽지 못했어요.";
  }
  if (/password/i.test(error.name) || /password/i.test(error.message)) {
    return "암호로 보호된 PDF는 앱 뷰어에서 열 수 없어요.";
  }
  if (/worker|window is not defined/i.test(error.message)) {
    return "PDF 렌더러를 시작하지 못했어요.";
  }
  return "네트워크가 불안정하거나 arXiv가 잠시 응답하지 않았어요.";
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
  onRetry,
}: {
  url: string;
  title: string;
  zoomPercent: number;
  onZoomChange: (zoom: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoomPercent);
  const firstPageReadyRef = useRef(false);
  const callbacksRef = useRef({ onReady, onError, onRetry });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [baseWidth, setBaseWidth] = useState(612);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    callbacksRef.current = { onReady, onError, onRetry };
  }, [onError, onReady, onRetry]);

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
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        document = await task.promise;
        const firstPage = await document.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup();
        if (!active) return;
        setBaseWidth(viewport.width);
        setPdf(document);
      } catch (cause) {
        if (!active) return;
        const message = describePdfError(cause);
        setError(message);
        callbacksRef.current.onError(message);
      }
    }

    void loadPdf();
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [retryCount, url]);

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

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const points = new Map<number, { x: number; y: number }>();
    let pinchStartDistance = 0;
    let pinchStartZoom = zoomRef.current;

    const pinchGeometry = () => {
      const [first, second] = [...points.values()];
      if (!first || !second) return null;
      return {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
      };
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size === 2) {
        const geometry = pinchGeometry();
        if (!geometry) return;
        event.preventDefault();
        pinchStartDistance = geometry.distance;
        pinchStartZoom = zoomRef.current;
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size < 2 || pinchStartDistance <= 0) return;
      const geometry = pinchGeometry();
      if (!geometry) return;
      event.preventDefault();
      applyZoomAtPoint(
        pinchStartZoom * (geometry.distance / pinchStartDistance),
        geometry.centerX,
        geometry.centerY,
      );
    };
    const handlePointerEnd = (event: PointerEvent) => {
      points.delete(event.pointerId);
      if (points.size < 2) pinchStartDistance = 0;
    };

    root.addEventListener("pointerdown", handlePointerDown, { passive: false });
    root.addEventListener("pointermove", handlePointerMove, { passive: false });
    root.addEventListener("pointerup", handlePointerEnd);
    root.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerup", handlePointerEnd);
      root.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [applyZoomAtPoint]);

  const fitScale = Math.max(0.1, (availableWidth - 32) / baseWidth);
  const scale = fitScale * (zoomPercent / 100);
  const handleFirstPageRendered = useCallback(() => {
    if (firstPageReadyRef.current) return;
    firstPageReadyRef.current = true;
    callbacksRef.current.onReady();
  }, []);

  const retryPdf = useCallback(() => {
    firstPageReadyRef.current = false;
    setPdf(null);
    setError("");
    callbacksRef.current.onRetry();
    setRetryCount((value) => value + 1);
  }, []);

  return (
    <div
      className="pdf-canvas-reader"
      ref={scrollRef}
      aria-label={`${title} PDF 뷰어. 트랙패드 또는 두 손가락 핀치로 확대 및 축소`}
    >
      {error ? (
        <div className="pdf-canvas-message pdf-canvas-error">
          <strong>PDF를 앱 뷰어로 불러오지 못했어요.</strong>
          <p>{error}</p>
          <button onClick={retryPdf}>다시 시도</button>
        </div>
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
