"use client";

/*
 * WORLD EDITOR — admin map editing lifecycle
 *
 * The editor is a browser-side tool for changing one floor's map snapshot. Its API
 * contract is the same MapData used by the public world: collision cells, placed
 * objects, and room labels. React state is the editable model; WorldGrid renders that
 * model; useWorldCamera handles camera gestures without rebuilding the grid.
 *
 * 1. React initializes the floor, editor tool, empty map collections, room form, and
 *    loading indicators. Browser localStorage is read only after hydration, then the
 *    selected floor is loaded with GET /api/map?floorId=....
 *
 * 2. A request ID and active flag prevent an older response from replacing the map
 *    after a floor switch or component unmount. Successful data is copied into React
 *    state and separately marked as API-ready.
 *
 * 3. The grid and object images are rendered from that state. A requestAnimationFrame
 *    check waits for a real grid layout box and for each image to load or fail. Only
 *    after this visual readiness check does the loading overlay fade away.
 *
 * 4. The selected tool determines what a cell click means: toggle collision, place the
 *    selected image, paint one cell of a room, or erase all data from that cell. These
 *    operations update immutable React collections; they do not manually edit cell DOM.
 *
 * 5. Uploaded image files are read as data URLs and kept as the selected asset. The
 *    shared WorldGrid displays the image preview and the same asset can be placed in
 *    multiple cells.
 *
 * 6. Camera wheel, drag, and pinch interactions are delegated to useWorldCamera. A
 *    camera drag is distinguished from a cell click, and camera-only changes are
 *    applied to DOM transforms rather than re-rendering all 3,600 cells.
 *
 * 7. Save serializes the whole floor snapshot with PUT /api/map?floorId=.... Sets are
 *    converted to arrays for JSON; objects and rooms are sent as keyed records. The
 *    saved database format and public-world rendering contract remain unchanged.
 */

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { floors, FloorId, getFloor } from "@/lib/floors";
import { MapData, MapObject, MapRoom } from "@/lib/map-types";
import { WorldGrid } from "@/components/world/WorldGrid";
import { useWorldCamera } from "@/components/world/useWorldCamera";

// Match the public world's zoom increment for consistent camera controls.
const ZOOM_STEP = 0.1;
// Keep editor grid geometry identical to the shared WorldGrid and camera math.
const GRID_SIZE = 60;
const CELL_SIZE = 64;
// Remember the admin's floor selection separately from the public user's selection.
const FLOOR_STORAGE_KEY = "elevatorio:admin-floor";
// Avoid a flash of the editor before its saved map is visibly ready.
const MIN_LOADING_TIME = 1000;

// Each tool maps a cell click to one specific kind of map-model edit.
type EditorTool = "collision" | "object" | "room" | "erase";
// Reuse the shared API type rather than defining a second object format for the editor.
type PlacedObject = MapObject;

// Encode x and y in the same stable key format used by the API and WorldGrid.
function cellKey(x: number, y: number) {
    return `${x}:${y}`;
}

export default function WorldEditor() {
    // The chosen floor determines which saved map snapshot is loaded and edited.
    const [floorId, setFloorId] = useState<FloorId>("lobby");
    // Prevent browser-only floor restoration from affecting server-rendered markup.
    const [isFloorReady, setIsFloorReady] = useState(false);
    // Controls the visual loading/error overlay, separate from save feedback.
    const [mapLoadState, setMapLoadState] = useState<"loading" | "ready" | "error">("loading");
    // Current editing mode, selected image, and room form values.
    const [tool, setTool] = useState<EditorTool>("collision");
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, PlacedObject>>({});
    const [rooms, setRooms] = useState<Record<string, MapRoom>>({});
    const [selectedAsset, setSelectedAsset] = useState<PlacedObject | null>(null);
    const [roomId, setRoomId] = useState("meeting-room");
    const [roomName, setRoomName] = useState("Meeting room");
    // Validation errors are shown beside the room form.
    const [roomError, setRoomError] = useState("");
    // Reuse the shared camera engine so public map and editor gestures behave alike.
    const camera = useWorldCamera<HTMLDivElement>();
    const { zoom, cameraOffset, viewportRef: viewportElementRef, cameraRef: cameraElementRef, worldRef: gridElementRef } = camera;
    const { consumeDrag } = camera;
    // Hovered coordinates are only UI feedback, not part of the persisted map.
    const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
    // Save state reports whether the snapshot is loading, dirty, saving, or saved.
    const [saveState, setSaveState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
    // Stable cell callbacks read current tool/form values here without being recreated.
    const cellActionRef = useRef({ tool, selectedAsset, roomId, roomName });
    // Refs coordinate browser frames and timers without triggering React renders.
    const visualCheckFrame = useRef<number | null>(null);
    const visualReadyTimer = useRef<number | null>(null);
    const mapDataReady = useRef(false);
    const loadingStartedAt = useRef(0);
    // The map request generation guards against stale responses after floor changes.
    const mapRequestId = useRef(0);

    // Keep the stable click handler's ref synchronized with the latest controls.
    useEffect(() => {
        cellActionRef.current = { tool, selectedAsset, roomId, roomName };
    }, [roomId, roomName, selectedAsset, tool]);

    // Restore the last admin floor after hydration, then permit the API request.
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

    // Persist the selected floor in this browser for the next editor visit.
    useEffect(() => {
        if (isFloorReady) {
            window.localStorage.setItem(FLOOR_STORAGE_KEY, floorId);
        }
    }, [floorId, isFloorReady]);

    // Reset camera and loading timers before switching the edited floor.
    function resetViewport() {
        camera.resetCamera();
        setMapLoadState("loading");
        loadingStartedAt.current = performance.now();
        if (visualReadyTimer.current !== null) {
            window.clearTimeout(visualReadyTimer.current);
            visualReadyTimer.current = null;
        }
    }

    // Unlock the editor only after its grid and image elements are visually resolved.
    const checkVisualReady = useCallback(() => {
        if (visualCheckFrame.current !== null) {
            cancelAnimationFrame(visualCheckFrame.current);
        }
        visualCheckFrame.current = requestAnimationFrame(() => {
            const grid = gridElementRef.current;
            const images = grid ? Array.from(grid.querySelectorAll("img")) : [];
            const gridDrawn = Boolean(grid && grid.getBoundingClientRect().width > 0 && grid.getBoundingClientRect().height > 0);
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

    // Load the selected floor and invalidate requests/frames when the floor changes.
    useEffect(() => {
        if (!isFloorReady) {
            return;
        }
        let isActive = true;
        async function loadMap() {
            const requestId = ++mapRequestId.current;
            setSaveState("loading");
            setMapLoadState("loading");
            mapDataReady.current = false;
            loadingStartedAt.current = performance.now();
            if (visualReadyTimer.current !== null) {
                window.clearTimeout(visualReadyTimer.current);
                visualReadyTimer.current = null;
            }
            try {
                const response = await fetch(`/api/map?floorId=${floorId}`);
                if (!response.ok) {
                    throw new Error("Map loading failed");
                }
                const mapData: MapData = await response.json();
                if (!isActive || requestId !== mapRequestId.current) {
                    return;
                }
                setBlockedCells(new Set(mapData.blockedCells));
                setPlacedObjects(mapData.placedObjects);
                setRooms(mapData.rooms ?? {});
                setSaveState("idle");
                mapDataReady.current = true;
                checkVisualReady();
            } catch {
                if (!isActive || requestId !== mapRequestId.current) {
                    return;
                }

                setSaveState("error");
                setMapLoadState("error");
            }
        }

        loadMap();
        return () => {
            isActive = false;
            mapRequestId.current += 1;
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

    // Save the whole level snapshot rather than individual clicks. This keeps the
    // database format deterministic and lets one floor be restored as a single unit.
    // Persist the complete floor snapshot as one deterministic API update.
    async function saveMap() {
        setSaveState("saving");

        const mapData: MapData = {
            // Convert Set to an array because JSON.stringify cannot serialize Set entries.
            blockedCells: Array.from(blockedCells),
            placedObjects,
            rooms,
        };

        try {
            const response = await fetch(`/api/map?floorId=${floorId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mapData),
            });

            if (!response.ok) {
                throw new Error("Map saving failed");
            }

            setSaveState("saved");
        } catch {
            setSaveState("error");
        }
    }

    // Keep button-based zoom routed through the shared camera implementation.
    function changeZoom(amount: number) {
        camera.zoomBy(amount);
    }

    // Animate wheel zoom outside React so the 3,600-cell grid is not re-rendered per wheel event.
    // Convert mouse-wheel movement into zoom and prevent page scrolling inside the viewport.
    function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
        camera.handleWheel(event);
    }

    // Remember where a possible drag starts.
    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        camera.handlePointerDown(event);
    }

    // Move the camera after the pointer has crossed the drag threshold.
    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        camera.handlePointerMove(event);
    }

    // Release pointer capture and finish the camera drag.
    function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        camera.handlePointerUp(event);
    }

    // Read an uploaded image as a data URL so it can be previewed and saved with the map.
    // Read a validated image file into a browser-safe data URL for preview and saving.
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

    // A tool changes the level model, not the DOM directly. React then re-renders the
    // affected cell from the new model, keeping collision, objects, and rooms consistent.
    // Apply the active editor tool to one logical cell, updating the React map model.
    const handleCellClick = useCallback((position: { x: number; y: number }) => {
        if (consumeDrag()) {
            return;
        }

        const { tool, selectedAsset, roomId, roomName } = cellActionRef.current;
        const key = cellKey(position.x, position.y);

        if (tool === "collision") {
            // Use the previous Set to avoid losing edits when React batches rapid clicks.
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
            // Replace an existing object at this cell or create a new placement.
            setPlacedObjects((currentObjects) => ({
                ...currentObjects,
                [key]: selectedAsset,
            }));
            return;
        }

        if (tool === "room") {
            const trimmedRoomId = roomId.trim();
            const trimmedRoomName = roomName.trim();
            const isValidRoomId = /^[a-z0-9][a-z0-9_-]*$/.test(trimmedRoomId);

            if (!trimmedRoomId || !isValidRoomId) {
                setRoomError("Use a lowercase ID with letters, numbers, hyphens, or underscores.");
                return;
            }

            if (!trimmedRoomName) {
                setRoomError("Room name is required.");
                return;
            }

            // Each click paints one cell, so a room can have any shape instead of fixed dimensions.
            setRooms((currentRooms) => {
                const nextRooms = { ...currentRooms };
                nextRooms[key] = {
                    id: trimmedRoomId,
                    name: trimmedRoomName,
                };
                return nextRooms;
            });
            setRoomError("");
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
            setRooms((currentRooms) => {
                const nextRooms = { ...currentRooms };
                delete nextRooms[key];
                return nextRooms;
            });
            setRoomError("");
        }
    }, [consumeDrag]);

    // Update the small cursor-status panel when the pointer enters or leaves a cell.
    const handleCellHover = useCallback((position: { x: number; y: number } | null) => {
        setHoveredCell(position);
    }, []);

    // Treat a failed asset as resolved so one broken image cannot block the editor.
    const handleImageError = useCallback((image: HTMLImageElement) => {
        image.dataset.loadState = "failed";
        checkVisualReady();
    }, [checkVisualReady]);

    // The main viewport is the editor's renderer: the grid shows the current model,
    // while the camera transforms let us inspect it without changing map coordinates.
    return (
        <main className="min-h-dvh bg-[#eef1ec] pt-16 text-slate-950">
            <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1600px] flex-col gap-4 p-2 sm:p-4 lg:flex-row">
                <section className="flex min-h-[70dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30 lg:min-h-0">
                    {/* Header summarizes map contents and exposes the whole-map save action. */}
                    <header className="flex flex-col gap-3 border-b border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Admin editor</p>
                            <h1 className="mt-1 truncate text-xl font-bold">{getFloor(floorId).name} layout</h1>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 text-xs text-slate-500 sm:w-auto sm:justify-end">
                            <span>{blockedCells.size} walls</span>
                            <span>{Object.keys(placedObjects).length} objects</span>
                            <span>{Object.keys(rooms).length} room cells</span>
                            <button
                                type="button"
                                className="ml-auto rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-0"
                                disabled={saveState === "loading" || saveState === "saving"}
                                onClick={saveMap}
                            >
                                {saveState === "saving" ? "Saving..." : "Save map"}
                            </button>
                        </div>
                    </header>

                    {/* Main viewport owns pointer gestures, camera layers, grid, and loading overlay. */}
                    <div
                        ref={viewportElementRef}
                        className="relative min-h-0 flex-1 touch-none select-none overscroll-none overflow-hidden bg-[#f7f9f6]"
                        onWheel={handleWheel}
                        onDoubleClick={(event) => event.preventDefault()}
                    >
                        <div className="absolute left-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-600 shadow-md backdrop-blur-sm">
                            Editor viewport
                        </div>
                        <div className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cursor position</p>
                            <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
                                {hoveredCell
                                    ? `X ${hoveredCell.x + 1} / Y ${hoveredCell.y + 1}`
                                    : "Move over a cell"}
                            </p>
                            {hoveredCell && (
                                <p className={`mt-1 text-sm font-semibold ${blockedCells.has(cellKey(hoveredCell.x, hoveredCell.y)) ? "text-red-600" : "text-emerald-600"}`}>
                                    Collision: {blockedCells.has(cellKey(hoveredCell.x, hoveredCell.y)) ? "Yes" : "No"}
                                </p>
                            )}
                            {hoveredCell && rooms[cellKey(hoveredCell.x, hoveredCell.y)] && (
                                <p className="mt-1 max-w-48 truncate text-sm font-semibold text-blue-700">
                                    Room: {rooms[cellKey(hoveredCell.x, hoveredCell.y)].name}
                                    <span className="block text-xs font-medium text-slate-500">
                                        ID: {rooms[cellKey(hoveredCell.x, hoveredCell.y)].id}
                                    </span>
                                </p>
                            )}
                        </div>
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
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                >
                                    {/* Shared rendering keeps editor and public cell geometry identical. */}
                                    <WorldGrid
                                        mode="editor"
                                        blockedCells={blockedCells}
                                        placedObjects={placedObjects}
                                        rooms={rooms}
                                        onCellClick={handleCellClick}
                                        onCellHover={handleCellHover}
                                        onImageLoad={checkVisualReady}
                                        onImageError={handleImageError}
                                    />
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
                        <div
                            className={`absolute inset-0 z-30 grid place-items-center bg-[#f7f9f6]/95 backdrop-blur-sm transition-opacity duration-300 ease-out ${mapLoadState === "ready" ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"}`}
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
                    </div>
                </section>

                {/* Sidebar controls floor, active tool, room metadata, asset selection, and status. */}
                <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-300/30 lg:w-72">
                    {/* The sidebar contains editing tools, asset upload, and save status. */}
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Tools</p>
                    {/* The selected floor determines which PostgreSQL map is loaded and saved. */}
                    <label className="mt-3 block text-sm font-semibold text-slate-700">
                        Floor
                        <select
                            value={floorId}
                            className="rounded-lg mt-2 w-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            onChange={(event) => {
                                resetViewport();
                                setFloorId(event.target.value as FloorId);
                            }}
                        >
                            {floors.map((floor) => (
                                <option key={floor.id} value={floor.id}>
                                    {floor.number} - {floor.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {(["collision", "object", "room", "erase"] as EditorTool[]).map((editorTool) => (
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

                    {tool === "room" && (
                        <div className="mt-4 space-y-3">
                            <label className="block text-sm font-semibold text-slate-700">
                                Room ID
                                <input
                                    type="text"
                                    value={roomId}
                                    placeholder="meeting-room"
                                    aria-invalid={Boolean(roomError)}
                                    className="mt-2 w-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                    onChange={(event) => {
                                        setRoomId(event.target.value);
                                        setRoomError("");
                                    }}
                                />
                            </label>
                            <label className="block text-sm font-semibold text-slate-700">
                                Room name
                                <input
                                    type="text"
                                    value={roomName}
                                    className="mt-2 w-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                    onChange={(event) => {
                                        setRoomName(event.target.value);
                                        setRoomError("");
                                    }}
                                />
                            </label>
                            <p className="text-xs font-normal text-slate-500">Click cells to paint any room shape.</p>
                            {roomError && <p className="text-xs font-medium text-red-600">{roomError}</p>}
                        </div>
                    )}

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
                        <p className={`mt-3 text-xs ${saveState === "error" ? "text-red-600" : saveState === "saved" ? "text-emerald-600" : "text-slate-400"}`}>
                            {saveState === "loading" && "Loading saved map..."}
                            {saveState === "idle" && "Unsaved changes are stored locally until you save."}
                            {saveState === "saving" && "Saving map..."}
                            {saveState === "saved" && "Map saved successfully."}
                            {saveState === "error" && "Could not connect to the map database."}
                        </p>
                    </div>
                </aside>
            </div>
        </main>
    );
}