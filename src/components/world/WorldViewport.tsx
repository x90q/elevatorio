"use client";

import { useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 64;
const DRAG_THRESHOLD = 4;
const BLOCKED_CELLS = new Set([
    "28:28",
    "28:29",
    "28:30",
    "28:31",
    "28:32",
    "29:28",
    "30:28",
    "31:28",
    "32:28",
]);

type Point = {
    x: number;
    y: number;
};

type CellPosition = {
    row: number;
    column: number;
};

function isFree(position: CellPosition) {
    return (
        position.row >= 0 &&
        position.row < GRID_SIZE &&
        position.column >= 0 &&
        position.column < GRID_SIZE &&
        !BLOCKED_CELLS.has(`${position.row}:${position.column}`)
    );
}

function findPath(start: CellPosition, target: CellPosition) {
    const directions = [
        { row: -1, column: 0 },
        { row: 0, column: 1 },
        { row: 1, column: 0 },
        { row: 0, column: -1 },
    ];

    // bfs algorithm search

    const queue = [start];
    const visited = new Set([`${start.row}:${start.column}`]);
    const previous = new Map<string, CellPosition>();

    while (queue.length > 0) {
        const current = queue.shift();

        if (!current) {
            break;
        }

        if (current.row === target.row && current.column === target.column) {
            const path = [current];
            let key = `${current.row}:${current.column}`;

            while (previous.has(key)) {
                const previousCell = previous.get(key);

                if (!previousCell) {
                    break;
                }

                path.unshift(previousCell);
                key = `${previousCell.row}:${previousCell.column}`;
            }

            return path;
        }

        for (const direction of directions) {
            const next = {
                row: current.row + direction.row,
                column: current.column + direction.column,
            };
            const nextKey = `${next.row}:${next.column}`;

            if (isFree(next) && !visited.has(nextKey)) {
                visited.add(nextKey);
                previous.set(nextKey, current);
                queue.push(next);
            }
        }
    }

    return [];
}

function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function WorldViewport() {
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
    const [playerPosition, setPlayerPosition] = useState<CellPosition>({ row: 30, column: 30 });
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);
    const isMoving = useRef(false);

    async function movePlayer(target: CellPosition) {
        if (
            !isFree(target) ||
            isMoving.current ||
            (target.row === playerPosition.row && target.column === playerPosition.column)
        ) {
            return;
        }

        const path = findPath(playerPosition, target);

        if (path.length === 0) {
            return;
        }

        isMoving.current = true;

        for (const nextPosition of path.slice(1)) {
            setPlayerPosition(nextPosition);
            await new Promise((resolve) => setTimeout(resolve, 120));
        }

        isMoving.current = false;
    }

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

        dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            cameraX: cameraOffsetRef.current.x,
            cameraY: cameraOffsetRef.current.y,
        };
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
                        className={`relative grid bg-white shadow-xl shadow-slate-300/40 ${isDragging ? "cursor-grabbing" : "cursor-default"}`}
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
                            const isPlayer = playerPosition.row === row && playerPosition.column === column;
                            const isFreeCell = isFree({ row, column });

                            return (
                                <button
                                    key={`${row}-${column}`}
                                    type="button"
                                    className={`size-16 border transition-colors ${isDragging ? "cursor-grabbing" : "cursor-default"} ${isFreeCell ? "border-slate-200" : "border-slate-400 hover:z-10 hover:ring-2 hover:ring-red-500"} ${isPlayer
                                        ? "z-20 bg-emerald-100 ring-2 ring-emerald-600"
                                        : !isFreeCell
                                            ? "bg-white"
                                            : isHovered
                                                ? "z-10 bg-emerald-300/80 ring-2 ring-emerald-600"
                                                : "bg-white hover:bg-emerald-100"
                                        }`}
                                    aria-label={`Cell ${column + 1}, ${row + 1}`}
                                    title={isFreeCell ? undefined : "Blocked cell"}
                                    onMouseEnter={() => setHoveredCell({ row, column })}
                                    onMouseLeave={() => setHoveredCell(null)}
                                    onDoubleClick={() => movePlayer({ row, column })}
                                />
                            );
                        })}

                        <span
                            className="pointer-events-none absolute z-30 grid size-8 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-md transition-[left,top] duration-100 ease-linear"
                            style={{
                                left: playerPosition.column * CELL_SIZE + CELL_SIZE / 2 - 16,
                                top: playerPosition.row * CELL_SIZE + CELL_SIZE / 2 - 16,
                            }}
                            aria-hidden="true"
                        >
                            You
                        </span>
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
                <p className={`mt-1 text-sm font-semibold ${hoveredCell && !isFree(hoveredCell) ? "text-red-600" : "text-emerald-700"}`}>
                    {hoveredCell && !isFree(hoveredCell) ? "Blocked cell" : "Ready to explore"}
                </p>
            </div>
        </section>
    );
}
