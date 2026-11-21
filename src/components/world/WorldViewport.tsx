"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { floors, FloorId, getFloor } from "@/lib/floors";
import { MapData, MapObject, MapRoom } from "@/lib/map-types";
import { CellPosition, CELL_SIZE, GRID_SIZE, WorldGrid } from "@/components/world/WorldGrid";
import { useWorldCamera } from "@/components/world/useWorldCamera";

/*
 * WORLD VIEWPORT — public map lifecycle and rendering pipeline
 *
 * This component behaves like a small 2D game client. The API owns the saved map
 * snapshot, React state describes the visible map, the DOM renders it, and refs plus
 * requestAnimationFrame handle high-frequency camera and player movement.
 *
 * 1. On the first render, React initializes the selected floor, empty collision/object/
 *    room collections, the player's spawn position, and a loading state. The JSX can
 *    describe the grid immediately, even though its map data has not arrived yet.
 *
 * 2. After hydration, an effect reads FLOOR_STORAGE_KEY from localStorage. A valid
 *    FloorId is restored and isFloorReady becomes true. Deferring this browser-only
 *    read avoids making server-rendered HTML depend on localStorage.
 *
 * 3. Once the floor is ready, another effect calls refreshMap(), which sends a
 *    no-cache GET request to /api/map?floorId=.... The response follows MapData:
 *    blockedCells, placedObjects, and rooms.
 *
 * 4. The request checks its active flag and request ID before committing data. This
 *    prevents a stale response from a previous floor, or a request after unmount,
 *    from overwriting the current world.
 *
 * 5. A serialized snapshot signature detects whether polling returned changed data.
 *    An identical snapshot leaves the current map and loading state alone; a changed
 *    snapshot updates React state and marks the API data as ready.
 *
 * 6. React commits the 60 x 60 grid (3,600 cells). Placed assets become image elements,
 *    but receiving JSON does not mean the browser has laid out the grid or decoded
 *    every image yet.
 *
 * 7. checkVisualReady() waits for the next animation frame, verifies the grid has a
 *    real layout box, and checks that every image loaded or was explicitly marked as
 *    failed. This distinguishes visual readiness from network readiness.
 *
 * 8. Image load/error callbacks trigger another readiness check. A broken image is
 *    marked individually, so one bad asset does not prevent the rest of the map from
 *    becoming usable.
 *
 * 9. MIN_LOADING_TIME prevents a flash of the loading overlay. When both data and
 *    visuals are ready, mapLoadState becomes "ready" and CSS fades the overlay out;
 *    while loading or on error, the overlay continues to block map interaction.
 *
 * 10. During exploration, the shared useWorldCamera hook handles wheel zoom, drag,
 *     pinch, and reset. It updates DOM transforms through refs instead of asking React
 *     to rebuild the 3,600-cell grid for every pointer or wheel event.
 *
 * 11. A double-click asks movePlayer() to fetch fresh collision data, validate the
 *     destination, and call findPath(). Breadth-first search finds a shortest route;
 *     refs animate the player marker and trail, then React state records the endpoint.
 *
 * 12. Polling repeats refreshMap() at MAP_REFRESH_INTERVAL. Unchanged snapshots remain
 *     interactive; changed snapshots repeat the data-to-React-to-DOM-to-visual-readiness
 *     pipeline without changing the saved map format.
 */

// The +/- controls change zoom by ten percentage points per click.
const ZOOM_STEP = 0.1;
// Key used to remember the visitor's last selected floor in this browser.
const FLOOR_STORAGE_KEY = "elevatorio:selected-floor";
// Spawn point used when a floor is opened or changed.
const DEFAULT_PLAYER_POSITION: CellPosition = { x: 30, y: 30 };
// Keep the loading screen visible long enough to avoid an abrupt first render.
const MIN_LOADING_TIME = 1000;

// Public users periodically receive map changes saved by the admin.
const MAP_REFRESH_INTERVAL = 15_000;

// The public world uses the same camera and grid dimensions as the editor.
// A cell is walkable only when it is inside the grid and has no collision.
function isFree(position: CellPosition, blockedCells: Set<string>) {
    return (
        position.x >= 0 &&
        position.x < GRID_SIZE &&
        position.y >= 0 &&
        position.y < GRID_SIZE &&
        !blockedCells.has(`${position.x}:${position.y}`)
    );
}

// Find the shortest walkable route using the current map collision state.
function findPath(start: CellPosition, target: CellPosition, blockedCells: Set<string>) {
    // These four vectors represent movement to the neighboring cells: up, right, down, left.
    const directions = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
    ];

    // BFS checks cells in expanding distance order, which gives the shortest walkable route.
    const queue = [start];
    // visited prevents the same cell from being added to the queue more than once.
    const visited = new Set([`${start.x}:${start.y}`]);
    // previous remembers how we reached each cell so the final route can be rebuilt backwards.
    const previous = new Map<string, CellPosition>();

    while (queue.length > 0) {
        const current = queue.shift();

        if (!current) {
            break;
        }

        if (current.x === target.x && current.y === target.y) {
            // Reconstruct the route by following predecessors from target back to start.
            const path = [current];
            let key = `${current.x}:${current.y}`;

            while (previous.has(key)) {
                const previousCell = previous.get(key);

                if (!previousCell) {
                    break;
                }

                path.unshift(previousCell);
                key = `${previousCell.x}:${previousCell.y}`;
            }

            return path;
        }

        for (const direction of directions) {
            const next = {
                x: current.x + direction.x,
                y: current.y + direction.y,
            };
            const nextKey = `${next.x}:${next.y}`;

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

export default function WorldViewport() {
    // Choose which independent floor snapshot to request from the map API.
    const [floorId, setFloorId] = useState<FloorId>("lobby");
    // Gate browser storage restoration until after the first client render.
    const [isFloorReady, setIsFloorReady] = useState(false);
    // Controls loading, interactive, and error overlays independently of map content.
    const [mapLoadState, setMapLoadState] = useState<"loading" | "ready" | "error">("loading");
    // Collision and visual map data received from the API, keyed by cell coordinates.
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, MapObject>>({});
    const [rooms, setRooms] = useState<Record<string, MapRoom>>({});
    // The shared hook owns camera behavior and exposes refs for its DOM layers.
    const camera = useWorldCamera<HTMLElement>();
    const { zoom, cameraOffset, viewportRef: viewportElementRef, cameraRef: cameraElementRef, worldRef: gridElementRef } = camera;
    // Hover is low-volume UI information used by the coordinate and room panels.
    const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
    // State is the final rendered player location; refs support immediate animation.
    const [playerPosition, setPlayerPosition] = useState<CellPosition>(DEFAULT_PLAYER_POSITION);
    // The ref changes on every animation step without re-rendering all 3,600 cells.
    const playerPositionRef = useRef(playerPosition);
    // Player marker position is changed directly while the walking animation runs.
    const playerElementRef = useRef<HTMLSpanElement>(null);
    // This highlight follows the player marker without rerendering the grid.
    const playerTrailRef = useRef<HTMLSpanElement>(null);
    // Snapshot signature avoids state updates when a polling response is unchanged.
    const mapSignatureRef = useRef("");
    // Prevents a second route from starting while the current route is animating.
    const isMoving = useRef(false);
    // These refs coordinate frame scheduling, loading timers, and request races without rendering.
    const visualCheckFrame = useRef<number | null>(null);
    // Keeps the loading overlay visible for a consistent minimum duration.
    const visualReadyTimer = useRef<number | null>(null);
    // Tracks whether the API response is ready, separately from DOM/image readiness.
    const mapDataReady = useRef(false);
    // Timestamp used to enforce the minimum loading-overlay duration.
    const loadingStartedAt = useRef(0);
    // Increasing IDs ensure only the latest in-flight map request may commit.
    const mapRequestId = useRef(0);

    // Restore the last selected floor only in the browser, after hydration is complete.
    useEffect(() => {
        const restoreFloor = window.setTimeout(() => {
            const storedFloor = window.localStorage.getItem(FLOOR_STORAGE_KEY);

            if (floors.some((floor) => floor.id === storedFloor)) {
                setFloorId(storedFloor as FloorId);
            }

            setIsFloorReady(true);
        }, 0);

        return () => window.clearTimeout(restoreFloor);
    }, []);

    // Keep the selected floor across reloads without putting it in the URL.
    useEffect(() => {
        if (isFloorReady) {
            window.localStorage.setItem(FLOOR_STORAGE_KEY, floorId);
        }
    }, [floorId, isFloorReady]);

    // Start a floor transition from a predictable camera/player/loading state.
    function resetViewport() {
        camera.resetCamera();
        isMoving.current = false;
        playerPositionRef.current = DEFAULT_PLAYER_POSITION;
        setPlayerPosition(DEFAULT_PLAYER_POSITION);
        setMapLoadState("loading");
        loadingStartedAt.current = performance.now();
        if (visualReadyTimer.current !== null) {
            window.clearTimeout(visualReadyTimer.current);
            visualReadyTimer.current = null;
        }
    }

    // Rendering readiness is separate from network readiness: the API can return JSON
    // before React has committed the grid and the browser has decoded its textures.
    // Verify that React committed the grid and the browser has resolved its images.
    const checkVisualReady = useCallback(() => {
        if (visualCheckFrame.current !== null) {
            cancelAnimationFrame(visualCheckFrame.current);
        }

        visualCheckFrame.current = requestAnimationFrame(() => {
            const grid = gridElementRef.current;
            const images = grid ? Array.from(grid.querySelectorAll("img")) : [];
            // A non-zero layout box confirms that the grid is mounted and visible.
            const gridDrawn = Boolean(grid && grid.getBoundingClientRect().width > 0 && grid.getBoundingClientRect().height > 0);
            // naturalWidth stays zero when an image has not loaded or failed to decode.
            const imagesDrawn = images.every(
                (image) => (image.complete && image.naturalWidth > 0) || image.dataset.loadState === "failed",
            );

            if (mapDataReady.current && gridDrawn && imagesDrawn) {
                const remainingTime = Math.max(0, MIN_LOADING_TIME - (performance.now() - loadingStartedAt.current));

                if (visualReadyTimer.current === null) {
                    visualReadyTimer.current = window.setTimeout(() => {
                        setMapLoadState("ready");
                        visualReadyTimer.current = null;
                    }, remainingTime);
                }
            }

            visualCheckFrame.current = null;
        });
    }, [gridElementRef]);

    // Load the same selected floor map that the admin editor saves in PostgreSQL.
    // Polling only replaces the world when its JSON snapshot changes, so an unchanged
    // level stays interactive instead of restarting its loading screen every 15 seconds.
    // Fetch the selected floor and poll for admin changes while this page is mounted.
    useEffect(() => {
        if (!isFloorReady) {
            return;
        }

        let isActive = true;
        mapSignatureRef.current = "";

        async function refreshMap() {
            const requestId = ++mapRequestId.current;
            // The interval reuses the visible map; only the first request needs a full overlay.
            const isFirstLoad = mapSignatureRef.current === "";

            if (isFirstLoad) {
                mapDataReady.current = false;
                setMapLoadState("loading");
                loadingStartedAt.current = performance.now();
            }

            try {
                const response = await fetch(`/api/map?floorId=${floorId}`, { cache: "no-store" });

                if (!response.ok) {
                    throw new Error("Map loading failed");
                }

                // The API response is the shared map contract used by admin and public world.
                const mapData: MapData = await response.json();

                if (!isActive || requestId !== mapRequestId.current) {
                    return;
                }

                // JSON stringification creates a cheap snapshot key for comparing the whole map response.
                const nextSignature = JSON.stringify(mapData);

                if (nextSignature !== mapSignatureRef.current) {
                    // A changed snapshot must pass through the same data and visual readiness checks.
                    mapDataReady.current = false;
                    setMapLoadState("loading");
                    loadingStartedAt.current = performance.now();
                    mapSignatureRef.current = nextSignature;
                    setBlockedCells(new Set(mapData.blockedCells));
                    setPlacedObjects(mapData.placedObjects);
                    setRooms(mapData.rooms ?? {});
                    mapDataReady.current = true;
                    checkVisualReady();
                }
            } catch (error) {
                if (!isActive || requestId !== mapRequestId.current) {
                    return;
                }

                console.error("Failed to load public world map", error);
                setMapLoadState("error");
            }
        }

        refreshMap();
        const refreshTimer = window.setInterval(refreshMap, MAP_REFRESH_INTERVAL);

        return () => {
            isActive = false;
            mapRequestId.current += 1;
            window.clearInterval(refreshTimer);
            if (visualCheckFrame.current !== null) {
                cancelAnimationFrame(visualCheckFrame.current);
            }
            if (visualReadyTimer.current !== null) {
                window.clearTimeout(visualReadyTimer.current);
            }
        };
    }, [checkVisualReady, floorId, isFloorReady]);

    // Recheck after React has committed the new grid and its image elements.
    useEffect(() => {
        if (isFloorReady && mapLoadState === "loading") {
            checkVisualReady();
        }
    }, [checkVisualReady, floorId, isFloorReady, mapLoadState, placedObjects]);

    // Resolve the room associated with the currently hovered cell, if any.
    const hoveredRoom = hoveredCell ? rooms[`${hoveredCell.x}:${hoveredCell.y}`] : undefined;

    // Movement is a small gameplay system: refresh collision data, calculate a route,
    // then animate the player through walkable cells without changing the map layout.
    // Validate a destination and animate the player along a shortest walkable route.
    const movePlayer = useCallback(async (target: CellPosition) => {
        const startPosition = playerPositionRef.current;

        if (isMoving.current || (target.x === startPosition.x && target.y === startPosition.y)) {
            return;
        }

        isMoving.current = true;

        try {
            const response = await fetch(`/api/map?floorId=${floorId}`, { cache: "no-store" });

            if (!response.ok) {
                throw new Error("Map refresh failed");
            }

            const mapData: MapData = await response.json();
            // Use this fresh Set for pathfinding so a newly added wall is respected immediately.
            const currentBlockedCells = new Set(mapData.blockedCells);
            const nextSignature = JSON.stringify(mapData);

            if (nextSignature !== mapSignatureRef.current) {
                mapSignatureRef.current = nextSignature;
                setBlockedCells(currentBlockedCells);
                setPlacedObjects(mapData.placedObjects);
                setRooms(mapData.rooms ?? {});
            }

            if (!isFree(target, currentBlockedCells)) {
                return;
            }

            const path = findPath(startPosition, target, currentBlockedCells);

            if (path.length === 0) {
                return;
            }

            // Skip the first path item because it is the player's current cell.
            for (const nextPosition of path.slice(1)) {
                playerPositionRef.current = nextPosition;
                playerElementRef.current?.style.setProperty(
                    "left",
                    `${nextPosition.x * CELL_SIZE + CELL_SIZE / 2 - 16}px`,
                );
                playerElementRef.current?.style.setProperty(
                    "top",
                    `${nextPosition.y * CELL_SIZE + CELL_SIZE / 2 - 16}px`,
                );
                playerTrailRef.current?.style.setProperty(
                    "left",
                    `${nextPosition.x * CELL_SIZE}px`,
                );
                playerTrailRef.current?.style.setProperty(
                    "top",
                    `${nextPosition.y * CELL_SIZE}px`,
                );
                await new Promise((resolve) => setTimeout(resolve, 120));
            }

            setPlayerPosition(playerPositionRef.current);
        } catch (error) {
            console.error("Failed to refresh map before movement", error);
        } finally {
            isMoving.current = false;
        }
    }, [floorId]);

    // Keep hover presentation in the viewport without putting it into the map snapshot.
    const handleCellHover = useCallback((position: CellPosition | null) => {
        setHoveredCell(position);
    }, []);

    // Delegate the cell's double-click to the movement system without blocking the event.
    const handleCellDoubleClick = useCallback((position: CellPosition) => {
        void movePlayer(position);
    }, [movePlayer]);

    // Mark one failed asset so it does not hold the visual readiness gate forever.
    const handleImageError = useCallback((image: HTMLImageElement) => {
        image.dataset.loadState = "failed";
        checkVisualReady();
    }, [checkVisualReady]);

    return (
        // The viewport is the input boundary for camera gestures and map interaction.
        <section
            ref={viewportElementRef}
            className="relative min-h-0 flex-1 touch-none select-none overscroll-none overflow-hidden bg-[#eef1ec]"
            onWheel={camera.handleWheel}
            onDoubleClick={(event) => event.preventDefault()}
        >
            {/* Decorative background grid behind the interactive world map. */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-size-[64px_64px]" />

            <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 px-6 py-4 shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                {/* Public users can switch between the maps created in admin. */}
                <select
                    value={floorId}
                    className="rounded-lg mb-2 w-fit border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 outline-none focus:border-emerald-500"
                    aria-label="Select floor"
                    onChange={(event) => {
                        resetViewport();
                        setFloorId(event.target.value as FloorId);
                    }}
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

            {/* Camera translation and world scaling use separate nested DOM layers. */}
            <div className="absolute inset-0 overflow-hidden">
                <div
                    ref={cameraElementRef}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: GRID_SIZE * CELL_SIZE,
                        height: GRID_SIZE * CELL_SIZE,
                        transform: `translate(-50%, -50%) translate(${cameraOffset.x}px, ${cameraOffset.y}px)`,
                        willChange: "transform",
                    }}
                >
                    <div
                        ref={gridElementRef}
                        className="relative touch-manipulation select-none cursor-grab"
                        style={{
                            width: GRID_SIZE * CELL_SIZE,
                            height: GRID_SIZE * CELL_SIZE,
                            transform: `scale(${zoom})`,
                            transformOrigin: "center center",
                            willChange: "transform",
                        }}
                        onPointerDown={camera.handlePointerDown}
                        onPointerMove={camera.handlePointerMove}
                        onPointerUp={camera.handlePointerUp}
                        onPointerCancel={camera.handlePointerUp}
                    >
                        {/* The shared grid renders map data; player markers are lightweight overlays. */}
                        <WorldGrid
                            mode="world"
                            blockedCells={blockedCells}
                            placedObjects={placedObjects}
                            rooms={rooms}
                            onCellHover={handleCellHover}
                            onCellDoubleClick={handleCellDoubleClick}
                            onImageLoad={checkVisualReady}
                            onImageError={handleImageError}
                        />

                        {/* This lightweight overlay keeps the cell highlight visible while the player moves. */}
                        <span
                            ref={playerTrailRef}
                            className="pointer-events-none absolute z-20 size-16 border-2 border-emerald-300 bg-emerald-100/40 transition-[left,top] duration-100 ease-linear"
                            style={{
                                left: playerPosition.x * CELL_SIZE,
                                top: playerPosition.y * CELL_SIZE,
                            }}
                            aria-hidden="true"
                        />

                        <span
                            ref={playerElementRef}
                            className="pointer-events-none absolute z-30 grid size-8 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-md transition-[left,top] duration-100 ease-linear"
                            style={{
                                left: playerPosition.x * CELL_SIZE + CELL_SIZE / 2 - 16,
                                top: playerPosition.y * CELL_SIZE + CELL_SIZE / 2 - 16,
                            }}
                            aria-hidden="true"
                        >
                            You
                        </span>
                    </div>
                </div>
            </div>

            <div
                className={`absolute inset-0 z-30 grid place-items-center bg-[#eef1ec]/95 backdrop-blur-sm transition-opacity duration-300 ease-out ${mapLoadState === "ready" ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"}`}
                aria-hidden={mapLoadState === "ready"}
            >
                <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-center shadow-xl">
                    {mapLoadState === "error" ? (
                        <>
                            <p className="text-sm font-semibold text-red-600">Could not load this floor</p>
                            <button
                                type="button"
                                className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                                onClick={() => window.location.reload()}
                            >
                                Reload
                            </button>
                        </>
                    ) : mapLoadState === "loading" ? (
                        <>
                            <div className="mx-auto size-8 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
                            <p className="mt-3 text-sm font-semibold text-slate-700">Loading floor...</p>
                            <p className="mt-1 text-xs text-slate-500">Drawing the grid and images</p>
                        </>
                    ) : (
                        null
                    )}
                </div>
            </div>

            {/* Show the coordinates and walkability state under the cursor. */}
            <div className="absolute right-4 top-4 z-10 hidden rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm md:block">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cursor position</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
                    {hoveredCell
                        ? `X ${hoveredCell.x + 1} / Y ${hoveredCell.y + 1}`
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
                    onClick={() => camera.zoomBy(ZOOM_STEP)}
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
                    onClick={() => camera.zoomBy(-ZOOM_STEP)}
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
