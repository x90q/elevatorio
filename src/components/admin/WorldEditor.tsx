"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { floors, FloorId, getFloor } from "@/lib/floors";
import { MapData, MapObject, MapRoom } from "@/lib/map-types";

// Shared editor limits keep the grid and camera behavior predictable.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 60;
const CELL_SIZE = 64;
const DRAG_THRESHOLD = 4;

type EditorTool = "collision" | "object" | "room" | "erase";

type PlacedObject = MapObject;

type Point = {
    x: number;
    y: number;
};

// Use a stable string key so cells can be stored in Sets and JSON objects.
function cellKey(row: number, column: number) {
    return `${row}:${column}`;
}

// Keep zoom controls inside the supported viewport range.
function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function WorldEditor() {
    // React state contains the editable map and the current viewport controls.
    // floorId selects which PostgreSQL JSONB snapshot this editor reads and writes.
    const [floorId, setFloorId] = useState<FloorId>("lobby");
    const [tool, setTool] = useState<EditorTool>("collision");
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, PlacedObject>>({});
    const [rooms, setRooms] = useState<Record<string, MapRoom>>({});
    const [selectedAsset, setSelectedAsset] = useState<PlacedObject | null>(null);
    const [roomId, setRoomId] = useState("meeting-room");
    const [roomName, setRoomName] = useState("Meeting room");
    const [roomError, setRoomError] = useState("");
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredCell, setHoveredCell] = useState<{ row: number; column: number } | null>(null);
    // saveState controls loading, disabled, success, and error UI around persistence.
    const [saveState, setSaveState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);
    // Prevent a drag release from triggering an accidental cell edit.
    const suppressClick = useRef(false);

    // Load the selected floor map whenever the admin changes floors.
    useEffect(() => {
        async function loadMap() {
            setSaveState("loading");

            try {
                const response = await fetch(`/api/map?floorId=${floorId}`);

                if (!response.ok) {
                    throw new Error("Map loading failed");
                }

                const mapData: MapData = await response.json();
                // Rebuild the Set because JSON responses only contain arrays.
                setBlockedCells(new Set(mapData.blockedCells));
                setPlacedObjects(mapData.placedObjects);
                setRooms(mapData.rooms ?? {});
                setSaveState("idle");
            } catch {
                setSaveState("error");
            }
        }

        loadMap();
    }, [floorId]);

    // Send the current editor state to the API as JSON.
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

    // Change zoom and keep the point under the cursor in the same visual position.
    function changeZoom(amount: number, focalPoint?: Point) {
        const currentZoom = zoomRef.current;
        const currentOffset = cameraOffsetRef.current;
        const nextZoom = clampZoom(currentZoom + amount);

        if (nextZoom === currentZoom) {
            return;
        }

        let nextOffset = currentOffset;

        if (focalPoint) {
            // Adjust the camera offset so the point under the cursor stays fixed during zoom.
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

    // Convert mouse-wheel movement into zoom and prevent page scrolling inside the viewport.
    function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const viewport = event.currentTarget.getBoundingClientRect();
        // Convert the pointer position from viewport coordinates into map-centered coordinates.
        const focalPoint = {
            x: event.clientX - (viewport.left + viewport.width / 2 + cameraOffsetRef.current.x),
            y: event.clientY - (viewport.top + viewport.height / 2 + cameraOffsetRef.current.y),
        };

        changeZoom(direction, focalPoint);
    }

    // Remember where a possible drag starts.
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

    // Move the camera after the pointer has crossed the drag threshold.
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

        // Apply pointer movement to the camera while preserving the original drag origin.
        const nextOffset = {
            x: dragStart.current.cameraX + distanceX,
            y: dragStart.current.cameraY + distanceY,
        };
        cameraOffsetRef.current = nextOffset;
        setCameraOffset(nextOffset);
    }

    // Release pointer capture and finish the camera drag.
    function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        dragStart.current = null;
        setIsDragging(false);
    }

    // Read an uploaded image as a data URL so it can be previewed and saved with the map.
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

    // Apply the selected editor tool to one grid cell.
    function handleCellClick(row: number, column: number) {
        if (suppressClick.current) {
            suppressClick.current = false;
            return;
        }

        const key = cellKey(row, column);

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
    }

    // The main viewport contains the editable map and its camera controls.
    return (
        <main className="min-h-dvh bg-[#eef1ec] pt-16 text-slate-950">
            <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1600px] flex-col gap-4 p-4 lg:flex-row">
                <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30">
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Admin editor</p>
                            <h1 className="mt-1 text-xl font-bold">{getFloor(floorId).name} layout</h1>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{blockedCells.size} walls</span>
                            <span>{Object.keys(placedObjects).length} objects</span>
                            <span>{Object.keys(rooms).length} room cells</span>
                            <button
                                type="button"
                                className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={saveState === "loading" || saveState === "saving"}
                                onClick={saveMap}
                            >
                                {saveState === "saving" ? "Saving..." : "Save map"}
                            </button>
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
                            {hoveredCell && (
                                <p className={`mt-1 text-sm font-semibold ${blockedCells.has(cellKey(hoveredCell.row, hoveredCell.column)) ? "text-red-600" : "text-emerald-600"}`}>
                                    Collision: {blockedCells.has(cellKey(hoveredCell.row, hoveredCell.column)) ? "Yes" : "No"}
                                </p>
                            )}
                            {hoveredCell && rooms[cellKey(hoveredCell.row, hoveredCell.column)] && (
                                <p className="mt-1 max-w-48 truncate text-sm font-semibold text-blue-700">
                                    Room: {rooms[cellKey(hoveredCell.row, hoveredCell.column)].name}
                                    <span className="block text-xs font-medium text-slate-500">
                                        ID: {rooms[cellKey(hoveredCell.row, hoveredCell.column)].id}
                                    </span>
                                </p>
                            )}
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
                                    {/* Each button represents one editable map cell. */}
                                    {/* Derive row and column from the flat array index for each cell. */}
                                    {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                                        const row = Math.floor(index / GRID_SIZE);
                                        const column = index % GRID_SIZE;
                                        const key = cellKey(row, column);
                                        const object = placedObjects[key];
                                        const isBlocked = blockedCells.has(key);
                                        const room = rooms[key];

                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                className={`relative size-16 text-left transition-colors focus:outline-none ${object ? "border-0" : "border"} ${room ? `${isBlocked ? "bg-red-400/20" : "bg-blue-50/20"} border-blue-400 z-10 ring-2 ring-blue-500` : isBlocked ? "border-red-400 bg-red-400/20 z-10 ring-2 ring-red-500" : "border-slate-200 hover:bg-emerald-50"}`}
                                                aria-label={`Edit cell ${column + 1}, ${row + 1}`}
                                                onMouseEnter={() => setHoveredCell({ row, column })}
                                                onMouseLeave={() => setHoveredCell(null)}
                                                onClick={() => handleCellClick(row, column)}
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
                                                {room && (
                                                    <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate text-[9px] font-bold text-slate-700">
                                                        {room.name}
                                                    </span>
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
                    {/* The sidebar contains editing tools, asset upload, and save status. */}
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-600">Tools</p>
                    {/* The selected floor determines which PostgreSQL map is loaded and saved. */}
                    <label className="mt-3 block text-sm font-semibold text-slate-700">
                        Floor
                        <select
                            value={floorId}
                            className="mt-2 w-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            onChange={(event) => setFloorId(event.target.value as FloorId)}
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