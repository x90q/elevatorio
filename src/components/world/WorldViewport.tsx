"use client";

import { useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 64;

function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function WorldViewport() {
    const [zoom, setZoom] = useState(1);
    const [hoveredCell, setHoveredCell] = useState<{ row: number; column: number } | null>(null);

    function changeZoom(amount: number) {
        setZoom((currentZoom) => clampZoom(currentZoom + amount));
    }

    function handleWheel(event: React.WheelEvent<HTMLElement>) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        changeZoom(direction);
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
                    className="absolute left-1/2 top-1/2 grid border-2 border-slate-400 bg-white shadow-xl shadow-slate-300/40 transition-transform duration-200 ease-out"
                    style={{
                        width: GRID_SIZE * CELL_SIZE,
                        height: GRID_SIZE * CELL_SIZE,
                        gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                        transform: `translate(-50%, -50%) scale(${zoom})`,
                        transformOrigin: "center center",
                        willChange: "transform",
                    }}
                >
                    {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                        const row = Math.floor(index / GRID_SIZE);
                        const column = index % GRID_SIZE;
                        const isHovered = hoveredCell?.row === row && hoveredCell.column === column;

                        return (
                            <button
                                key={`${row}-${column}`}
                                type="button"
                                className={`size-16 border border-slate-200 transition-colors ${isHovered
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
                    aria-label="Zoom out"
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
                    aria-label="Zoom in"
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
