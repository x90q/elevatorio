"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { floors, FloorId, getFloor } from "@/lib/floors";
import { MapData, MapObject, MapRoom } from "@/lib/map-types";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 64;
const DRAG_THRESHOLD = 4;

type Point = {
    x: number;
    y: number;
};

type CellPosition = {
    row: number;
    column: number;
};

// The public world uses the same camera and grid dimensions as the editor.
// A cell is walkable only when it is inside the grid and has no collision.
function isFree(position: CellPosition, blockedCells: Set<string>) {
    return (
        position.row >= 0 &&
        position.row < GRID_SIZE &&
        position.column >= 0 &&
        position.column < GRID_SIZE &&
        !blockedCells.has(`${position.row}:${position.column}`)
    );
}

// Find the shortest walkable route using the current map collision state.
function findPath(start: CellPosition, target: CellPosition, blockedCells: Set<string>) {
    const directions = [
        { row: -1, column: 0 },
        { row: 0, column: 1 },
        { row: 1, column: 0 },
        { row: 0, column: -1 },
    ];

    // bfs algorithm search

    // BFS stores pending cells in a queue and prevents duplicate visits with a Set.
    const queue = [start];
    const visited = new Set([`${start.row}:${start.column}`]);
    const previous = new Map<string, CellPosition>();

    while (queue.length > 0) {
        const current = queue.shift();

        if (!current) {
            break;
        }

        if (current.row === target.row && current.column === target.column) {
            // Reconstruct the route by following each cell's predecessor back to the start.
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

            // Only enqueue in-bounds, walkable cells that BFS has not processed yet.
            if (isFree(next, blockedCells) && !visited.has(nextKey)) {
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
    // Store the saved collision cells and objects received from the admin editor.
    // floorId determines which independent map snapshot is displayed publicly.
    const [floorId, setFloorId] = useState<FloorId>("lobby");
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, MapObject>>({});
    const [rooms, setRooms] = useState<Record<string, MapRoom>>({});
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
    // Player coordinates are grid positions, not screen coordinates.
    const [playerPosition, setPlayerPosition] = useState<CellPosition>({ row: 30, column: 30 });
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);
    // Prevent overlapping movement animations from competing with each other.
    const isMoving = useRef(false);

    // Load the same selected floor map that the admin editor saves in PostgreSQL.
    useEffect(() => {
        async function loadMap() {
            setBlockedCells(new Set());
            setPlacedObjects({});
            setRooms({});

            try {
                const response = await fetch(`/api/map?floorId=${floorId}`);

                if (!response.ok) {
                    throw new Error("Map loading failed");
                }

                // The API response is the shared map contract used by admin and public world.
                const mapData: MapData = await response.json();
                setBlockedCells(new Set(mapData.blockedCells));
                setPlacedObjects(mapData.placedObjects);
                setRooms(mapData.rooms ?? {});
            } catch (error) {
                console.error("Failed to load public world map", error);
            }
        }

        loadMap();
    }, [floorId]);

    // Find the room rectangle under the cursor so public users see its available actions.
    const hoveredRoom = hoveredCell ? rooms[`${hoveredCell.row}:${hoveredCell.column}`] : undefined;

    // Move the player only when BFS can find a route through free cells.
    async function movePlayer(target: CellPosition) {
        if (
            !isFree(target, blockedCells) ||
            isMoving.current ||
            (target.row === playerPosition.row && target.column === playerPosition.column)
        ) {
            return;
        }

        const path = findPath(playerPosition, target, blockedCells);

        if (path.length === 0) {
            return;
        }

        isMoving.current = true;

        // Skip the first path item because it is the player's current cell.
        for (const nextPosition of path.slice(1)) {
            setPlayerPosition(nextPosition);
            await new Promise((resolve) => setTimeout(resolve, 120));
        }

        isMoving.current = false;
    }

    // Update zoom and camera position while preserving the cursor focal point.
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

    // Use the wheel for zooming instead of allowing the page to scroll.
    function handleWheel(event: React.WheelEvent<HTMLElement>) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const viewport = event.currentTarget.getBoundingClientRect();
        const currentOffset = cameraOffsetRef.current;
        const mapCenter = {
            x: viewport.left + viewport.width / 2 + currentOffset.x,
            y: viewport.top + viewport.height / 2 + currentOffset.y,
        };
        // Keep the zoom anchored to the cursor instead of the center of the viewport.
        const focalPoint = {
            x: event.clientX - mapCenter.x,
            y: event.clientY - mapCenter.y,
        };

        changeZoom(direction, focalPoint);
    }

    // Start tracking a possible camera drag.
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

    // Move the camera only after the pointer passes the drag threshold.
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

    // Finish the drag and release pointer capture.
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
            {/* Decorative background grid behind the interactive world map. */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-size-[64px_64px]" />

            <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 px-6 py-4 shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                {/* Public users can switch between the maps created in admin. */}
                <select
                    value={floorId}
                    className="mb-2 w-fit border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 outline-none focus:border-emerald-500"
                    aria-label="Select floor"
                    onChange={(event) => setFloorId(event.target.value as FloorId)}
                >
                    {floors.map((floor) => (
                        <option key={floor.id} value={floor.id}>
                            Floor {floor.number} - {floor.name}
                        </option>
                    ))}
                </select>
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-600">
                    Floor {getFloor(floorId).number}
                </p>
                <h1 className="text-2xl font-bold tracking-tight">{getFloor(floorId).name}</h1>
                <p className="mt-1 text-sm text-slate-500">{getFloor(floorId).status}</p>
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
                        {/* Render each saved object inside the cell where it was placed. */}
                        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                            // Convert each flat render index into a grid coordinate pair.
                            const row = Math.floor(index / GRID_SIZE);
                            const column = index % GRID_SIZE;
                            const isHovered = hoveredCell?.row === row && hoveredCell.column === column;
                            const isPlayer = playerPosition.row === row && playerPosition.column === column;
                            const isFreeCell = isFree({ row, column }, blockedCells);
                            const object = placedObjects[`${row}:${column}`];

                            return (
                                <button
                                    key={`${row}-${column}`}
                                    type="button"
                                    className={`relative size-16 transition-colors focus:outline-none ${object ? "border-0" : "border"} ${isDragging ? "cursor-grabbing" : "cursor-default"} ${isFreeCell ? "border-slate-200" : "border-slate-400 hover:z-10 hover:ring-2 hover:ring-red-500"} ${isPlayer
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
                                >
                                    {object && (
                                        <Image
                                            src={object.src}
                                            alt={object.name}
                                            width={64}
                                            height={64}
                                            unoptimized
                                            className="pointer-events-none absolute inset-0 size-full object-contain"
                                        />
                                    )}
                                </button>
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

            {/* Show the coordinates and walkability state under the cursor. */}
            <div className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cursor position</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
                    {hoveredCell
                        ? `X ${hoveredCell.column + 1} / Y ${hoveredCell.row + 1}`
                        : "Move over a cell"}
                </p>
                {hoveredRoom && (
                    <p className="mt-1 max-w-48 truncate text-sm font-semibold text-emerald-700">
                        {hoveredRoom.name}
                    </p>
                )}
            </div>

            {/* Explicit zoom controls for users who do not use the mouse wheel. */}
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
                <p className={`mt-1 text-sm font-semibold ${hoveredCell && !isFree(hoveredCell, blockedCells) ? "text-red-600" : "text-emerald-700"}`}>
                    {hoveredCell && !isFree(hoveredCell, blockedCells) ? "Blocked cell" : "Ready to explore"}
                </p>
            </div>
        </section>
    );
}
