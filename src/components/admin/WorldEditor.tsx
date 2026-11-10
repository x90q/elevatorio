"use client";

import { ChangeEvent, useRef, useState } from "react";
import Image from "next/image";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 48;
const DRAG_THRESHOLD = 4;

type EditorTool = "wall" | "object" | "erase";

type PlacedObject = {
    id: string;
    src: string;
    name: string;
};

type Point = {
    x: number;
    y: number;
};

function cellKey(row: number, column: number) {
    return `${row}:${column}`;
}

function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function WorldEditor() {
    const [tool, setTool] = useState<EditorTool>("wall");
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, PlacedObject>>({});
    const [selectedAsset, setSelectedAsset] = useState<PlacedObject | null>(null);
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredCell, setHoveredCell] = useState<{ row: number; column: number } | null>(null);
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);
    const suppressClick = useRef(false);

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

    function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const viewport = event.currentTarget.getBoundingClientRect();
        const focalPoint = {
            x: event.clientX - (viewport.left + viewport.width / 2 + cameraOffsetRef.current.x),
            y: event.clientY - (viewport.top + viewport.height / 2 + cameraOffsetRef.current.y),
        };

        changeZoom(direction, focalPoint);
    }

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) {
            return;
        }

        dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            cameraX: cameraOffsetRef.current.x,
            cameraY: cameraOffsetRef.current.y,
        };
        suppressClick.current = false;
        setIsDragging(false);
    }

    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!dragStart.current) {
            return;
        }

        const distanceX = event.clientX - dragStart.current.x;
        const distanceY = event.clientY - dragStart.current.y;

        if (!isDragging && Math.hypot(distanceX, distanceY) < DRAG_THRESHOLD) {
            return;
        }

        if (!isDragging) {
            event.currentTarget.setPointerCapture(event.pointerId);
            suppressClick.current = true;
            setIsDragging(true);
        }

        const nextOffset = {
            x: dragStart.current.cameraX + distanceX,
            y: dragStart.current.cameraY + distanceY,
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

    function handleAssetUpload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];

        if (!file || !file.type.startsWith("image/")) {
            return;
        }

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result !== "string") {
                return;
            }

            setSelectedAsset({
                id: `${file.name}-${file.lastModified}`,
                src: reader.result,
                name: file.name,
            });
            setTool("object");
        });
        reader.readAsDataURL(file);
    }

    function handleCellClick(row: number, column: number) {
        if (suppressClick.current) {
            suppressClick.current = false;
            return;
        }

        const key = cellKey(row, column);

        if (tool === "wall") {
            setBlockedCells((currentCells) => {
                const nextCells = new Set(currentCells);

                if (nextCells.has(key)) {
                    nextCells.delete(key);
                } else {
                    nextCells.add(key);
                }

                return nextCells;
            });
            return;
        }

        if (tool === "object" && selectedAsset) {
            setPlacedObjects((currentObjects) => ({
                ...currentObjects,
                [key]: selectedAsset,
            }));
            return;
        }

        if (tool === "erase") {
            setBlockedCells((currentCells) => {
                const nextCells = new Set(currentCells);
                nextCells.delete(key);
                return nextCells;
            });
            setPlacedObjects((currentObjects) => {
                const nextObjects = { ...currentObjects };
                delete nextObjects[key];
                return nextObjects;
            });
        }
    }

    return (
        <main className="min-h-dvh bg-[#eef1ec] pt-16 text-slate-950">
            <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1600px] flex-col gap-4 p-4 lg:flex-row">
                <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30">
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Admin editor</p>
                            <h1 className="mt-1 text-xl font-bold">Lobby layout</h1>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{blockedCells.size} walls</span>
                            <span>{Object.keys(placedObjects).length} objects</span>
                        </div>
                    </header>

                    <div
                        className="relative min-h-0 flex-1 touch-none overscroll-none overflow-hidden bg-[#f7f9f6]"
                        onWheel={handleWheel}
                    >
                        <div className="absolute left-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-600 shadow-md backdrop-blur-sm">
                            Editor viewport
                        </div>
                        <div className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cursor position</p>
                            <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
                                {hoveredCell
                                    ? `X ${hoveredCell.column + 1} / Y ${hoveredCell.row + 1}`
                                    : "Move over a cell"}
                            </p>
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
                                    className={`grid border border-slate-300 bg-white shadow-lg ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
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
                                        const key = cellKey(row, column);
                                        const object = placedObjects[key];
                                        const isBlocked = blockedCells.has(key);

                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                className={`relative size-12 border text-left transition-colors ${isBlocked ? "border-red-400 bg-red-50/20" : "border-slate-200 hover:bg-emerald-50"}`}
                                                aria-label={`Edit cell ${column + 1}, ${row + 1}`}
                                                onMouseEnter={() => setHoveredCell({ row, column })}
                                                onMouseLeave={() => setHoveredCell(null)}
                                                onClick={() => handleCellClick(row, column)}
                                            >
                                                {object && (
                                                    <Image
                                                        src={object.src}
                                                        alt={object.name}
                                                        width={40}
                                                        height={40}
                                                        unoptimized
                                                        className="pointer-events-none absolute inset-1 size-10 object-contain"
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="absolute bottom-4 right-4 z-10 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-300/30">
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
                    </div>
                </section>

                <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-300/30 lg:w-72">
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Tools</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {(["wall", "object", "erase"] as EditorTool[]).map((editorTool) => (
                            <button
                                key={editorTool}
                                type="button"
                                className={`rounded-lg px-2 py-2 text-xs font-semibold capitalize transition ${tool === editorTool ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-emerald-50"}`}
                                onClick={() => setTool(editorTool)}
                            >
                                {editorTool}
                            </button>
                        ))}
                    </div>

                    <label className="mt-6 block text-sm font-semibold text-slate-700">
                        Upload PNG object
                        <input
                            type="file"
                            accept="image/png,image/webp,image/jpeg"
                            className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
                            onChange={handleAssetUpload}
                        />
                    </label>

                    <div className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-500">
                        {selectedAsset ? (
                            <div className="flex items-center gap-3">
                                <Image
                                    src={selectedAsset.src}
                                    alt={selectedAsset.name}
                                    width={48}
                                    height={48}
                                    unoptimized
                                    className="size-12 object-contain"
                                />
                                <span className="min-w-0 truncate">{selectedAsset.name}</span>
                            </div>
                        ) : (
                            <p>Upload an image, choose Object, then click a cell.</p>
                        )}
                    </div>
                </aside>
            </div>
        </main>
    );
}