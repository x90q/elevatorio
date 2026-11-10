"use client";

import { useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 64;

type Point = {
    x: number;
    y: number;
};

function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function WorldViewport() {
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredCell, setHoveredCell] = useState<{ row: number; column: number } | null>(null);
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);

    function changeZoom(amount: number, focalPoint?: Point) {
        const currentZoom = zoomRef.current;
        const currentOffset = cameraOffsetRef.current;
        const nextZoom = clampZoom(currentZoom + amount);

        if (nextZoom === currentZoom) {
            return;
        }

        let nextOffset = currentOffset;

        if (focalPoint) {
            const zoomRatio = nextZoom / currentZoom;
            nextOffset = {
                x: currentOffset.x + focalPoint.x * (1 - zoomRatio),
                y: currentOffset.y + focalPoint.y * (1 - zoomRatio),
            };
        }

        zoomRef.current = nextZoom;
        cameraOffsetRef.current = nextOffset;
        setZoom(nextZoom);
        setCameraOffset(nextOffset);
    }

    function handleWheel(event: React.WheelEvent<HTMLElement>) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const viewport = event.currentTarget.getBoundingClientRect();
        const currentOffset = cameraOffsetRef.current;
        const mapCenter = {
            x: viewport.left + viewport.width / 2 + currentOffset.x,
            y: viewport.top + viewport.height / 2 + currentOffset.y,
        };
        const focalPoint = {
            x: event.clientX - mapCenter.x,
            y: event.clientY - mapCenter.y,
        };

        changeZoom(direction, focalPoint);
    }

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            cameraX: cameraOffsetRef.current.x,
            cameraY: cameraOffsetRef.current.y,
        };
        setIsDragging(true);
    }

    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!dragStart.current) {
            return;
        }

        const nextOffset = {
            x: dragStart.current.cameraX + event.clientX - dragStart.current.x,
            y: dragStart.current.cameraY + event.clientY - dragStart.current.y,
        };
        cameraOffsetRef.current = nextOffset;
        setCameraOffset(nextOffset);
    }

    function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        dragStart.current = null;
        setIsDragging(false);
    }

    return (
        <section
            className="relative min-h-0 flex-1 overscroll-none overflow-hidden bg-[#eef1ec]"
            onWheel={handleWheel}
        >
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-[size:64px_64px]" />

            <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 px-6 py-4 shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-600">
                    Floor 00
                </p>
                <h1 className="text-2xl font-bold tracking-tight">Lobby</h1>
                <p className="mt-1 text-sm text-slate-500">Main building entrance</p>
            </div>

            <div className="absolute inset-0 overflow-hidden">
                <div
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: GRID_SIZE * CELL_SIZE,
                        height: GRID_SIZE * CELL_SIZE,
                        transform: `translate(-50%, -50%) translate(${cameraOffset.x}px, ${cameraOffset.y}px)`,
                    }}
                >
                    <div
                        className={`grid bg-white shadow-xl shadow-slate-300/40 ${isDragging ? "cursor-grabbing" : "cursor-default"}`}
                        style={{
                            width: GRID_SIZE * CELL_SIZE,
                            height: GRID_SIZE * CELL_SIZE,
                            gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                            transform: `scale(${zoom})`,
                            transformOrigin: "center center",
                            willChange: "transform",
                        }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                            const row = Math.floor(index / GRID_SIZE);
                            const column = index % GRID_SIZE;
                            const isHovered = hoveredCell?.row === row && hoveredCell.column === column;

                            return (
                                <button
                                    key={`${row}-${column}`}
                                    type="button"
                                    className={`size-16 border border-slate-200 transition-colors ${isDragging ? "cursor-grabbing" : "cursor-default"} ${isHovered
                                        ? "z-10 bg-emerald-300/80 ring-2 ring-emerald-600"
                                        : "bg-white hover:bg-emerald-100"
                                        }`}
                                    aria-label={`Cell ${column + 1}, ${row + 1}`}
                                    onMouseEnter={() => setHoveredCell({ row, column })}
                                    onMouseLeave={() => setHoveredCell(null)}
                                />
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cursor position</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
                    {hoveredCell
                        ? `X ${hoveredCell.column + 1} / Y ${hoveredCell.row + 1}`
                        : "Move over a cell"}
                </p>
            </div>

            <div className="absolute bottom-6 right-6 z-10 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-300/30">
                <button
                    type="button"
                    className="grid size-10 place-items-center border-b border-slate-200 text-xl text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
                    aria-label="Zoom in"
                    onClick={() => changeZoom(ZOOM_STEP)}
                >
                    +
                </button>
                <span className="grid size-10 place-items-center font-mono text-xs text-slate-500">
                    {Math.round(zoom * 100)}%
                </span>
                <button
                    type="button"
                    className="grid size-10 place-items-center border-t border-slate-200 text-xl text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
                    aria-label="Zoom out"
                    onClick={() => changeZoom(-ZOOM_STEP)}
                >
                    -
                </button>
            </div>

            <div className="absolute bottom-6 left-6 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Map status</p>
                <p className="mt-1 text-sm font-semibold text-emerald-700">Ready to explore</p>
            </div>
        </section>
    );
}
