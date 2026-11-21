"use client";

// Next Image renders saved map assets while React memoization keeps stable cells inexpensive.
import Image from "next/image";
import { memo } from "react";
// Import the data contracts used for cell objects and room labels.
import type { MapObject, MapRoom } from "@/lib/map-types";

// The logical world has sixty x coordinates and sixty y coordinates.
export const GRID_SIZE = 60;
// Each logical cell occupies sixty-four CSS pixels before camera scaling.
export const CELL_SIZE = 64;

// A cell position always uses zero-based x and y coordinates.
export type CellPosition = { x: number; y: number };
// The same cell renderer has different visuals and interactions in these two contexts.
type GridMode = "world" | "editor";

// Props shared by the complete grid, including its model and interaction callbacks.
type WorldGridProps = {
    // Select whether cells are displayed to a public visitor or an administrator.
    mode: GridMode;
    // The set of cell keys such as "4:12" that block player movement.
    blockedCells: ReadonlySet<string>;
    // Map objects keyed by the cell where each image is placed.
    placedObjects: Readonly<Record<string, MapObject>>;
    // Room metadata keyed by the cell assigned to that room.
    rooms: Readonly<Record<string, MapRoom>>;
    // Called by the editor when an administrator selects a cell.
    onCellClick?: (position: CellPosition) => void;
    // Called by the public world when a visitor double-clicks a destination cell.
    onCellDoubleClick?: (position: CellPosition) => void;
    // Called when the pointer enters or leaves a cell.
    onCellHover?: (position: CellPosition | null) => void;
    // Notifies the loading lifecycle when an image has loaded successfully.
    onImageLoad?: () => void;
    // Notifies the loading lifecycle when an image could not be loaded.
    onImageError?: (image: HTMLImageElement) => void;
};

// Props for one memoized cell, reduced to the values that determine that cell's output.
type WorldCellProps = {
    // Determines whether the cell behaves as a visitor cell or an editor cell.
    mode: GridMode;
    // The cell's zero-based x coordinate.
    x: number;
    // The cell's zero-based y coordinate.
    y: number;
    // Whether collision blocks walking through this cell.
    blocked: boolean;
    // Optional image data for an object placed in this cell.
    object?: MapObject;
    // Optional room information assigned to this cell.
    room?: MapRoom;
    // Called by the editor when this cell is selected.
    onClick?: (position: CellPosition) => void;
    // Called by the public map when this cell is double-clicked.
    onDoubleClick?: (position: CellPosition) => void;
    // Reports pointer entry/exit without making hover part of the map model.
    onHover?: (position: CellPosition | null) => void;
    // Shared image loading callbacks used by the viewport loading state.
    onImageLoad?: () => void;
    onImageError?: (image: HTMLImageElement) => void;
};

// Memo prevents this button from rerendering when its primitive and asset props have not changed.
const WorldCell = memo(function WorldCell({
    mode,
    x,
    y,
    blocked,
    object,
    room,
    onClick,
    onDoubleClick,
    onHover,
    onImageLoad,
    onImageError,
}: WorldCellProps) {
    // Build the callback payload once for this render from the cell's x and y coordinates.
    const position = { x, y };
    // Use this flag to select editor-specific styling and click behavior.
    const editor = mode === "editor";
    // Derive cell appearance from its role, collision state, room, and placed object.
    const className = editor
        ? `relative size-16 text-left transition-colors focus:outline-none ${object ? "border-0" : "border"} ${room ? `${blocked ? "bg-red-400/20" : "bg-blue-50/20"} border-blue-400 z-10 ring-2 ring-blue-500` : blocked ? "border-red-400 bg-red-400/20 z-10 ring-2 ring-red-500" : "border-slate-200 hover:z-10 hover:bg-emerald-200 hover:ring-1 hover:ring-emerald-600"}`
        : `relative size-16 touch-manipulation cursor-default transition-colors focus:outline-none ${object ? "border-0" : "border"} ${blocked ? "border-slate-400 bg-white hover:z-10 hover:ring-2 hover:ring-red-500" : "border-slate-200 bg-white hover:z-10 hover:bg-emerald-300/80 hover:ring-2 hover:ring-emerald-600"}`;

    return (
        // A button gives every cell keyboard semantics and a stable interactive target.
        <button
            type="button"
            className={className}
            // Expose readable coordinates to assistive technology.
            aria-label={`${editor ? "Edit cell" : "Cell"} X ${x + 1}, Y ${y + 1}`}
            // Explain public collision state without changing the saved map model.
            title={!editor && blocked ? "Blocked cell" : undefined}
            // Update hover information only while no mouse button is held for dragging.
            onMouseEnter={(event) => {
                if (event.buttons === 0) {
                    onHover?.(position);
                }
            }}
            // Clear hover information on exit, while preserving it during a drag.
            onMouseLeave={(event) => {
                if (event.buttons === 0) {
                    onHover?.(null);
                }
            }}
            // Only editor cells use a single click to change map data.
            onClick={editor ? () => onClick?.(position) : undefined}
            // Public cells use a double click to request player movement.
            onDoubleClick={!editor ? (event) => {
                // Prevent default double-click behavior such as text selection.
                event.preventDefault();
                // Keep the event from triggering a parent viewport double-click handler.
                event.stopPropagation();
                // Delegate movement to the public world, which owns collision and pathfinding.
                onDoubleClick?.(position);
            } : undefined}
        >
            {/* Render a placed image only when the map model contains one for this cell. */}
            {object && (
                <Image
                    // Use the object's saved source, name, and the fixed logical cell size.
                    src={object.src}
                    alt={object.name}
                    width={CELL_SIZE}
                    height={CELL_SIZE}
                    // Data URLs or external storage URLs are already fully specified.
                    unoptimized
                    // Position the image inside the cell without intercepting cell input.
                    className="pointer-events-none absolute inset-0 size-full object-contain"
                    // Report success or failure so the viewport can finish loading.
                    onLoad={onImageLoad}
                    onError={(event) => onImageError?.(event.currentTarget)}
                />
            )}
            {/* Room names are labels in the editor, not interactive child controls. */}
            {editor && room && (
                <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate text-[9px] font-bold text-slate-700">
                    {room.name}
                </span>
            )}
        </button>
    );
});

/**
 * Render the complete 60-by-60 map as a stable React subtree.
 * Camera transforms are applied outside this component, and hover state is not a prop,
 * so those frequent interactions do not rebuild all 3,600 cell descriptions.
 */
export const WorldGrid = memo(function WorldGrid({
    mode,
    blockedCells,
    placedObjects,
    rooms,
    onCellClick,
    onCellDoubleClick,
    onCellHover,
    onImageLoad,
    onImageError,
}: WorldGridProps) {
    return (
        // CSS Grid gives every logical cell a fixed x/y position.
        <div
            className={`grid select-none ${mode === "editor" ? " bg-white shadow-xl" : " bg-white shadow-xl shadow-slate-600/10"}`}
            // Fixed dimensions keep camera math and cell-coordinate conversion predictable.
            style={{
                width: GRID_SIZE * CELL_SIZE,
                height: GRID_SIZE * CELL_SIZE,
                gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                // CSS containment limits layout and painting work to the grid subtree.
                contain: "layout paint",
            }}
        >
            {/* Generate one cell for each flat index, then convert it to x and y. */}
            {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                // Remainder determines the x coordinate within the current y line.
                const x = index % GRID_SIZE;
                // Integer division determines the y coordinate in the grid.
                const y = Math.floor(index / GRID_SIZE);
                // This stable key indexes collision, objects, and rooms consistently.
                const key = `${x}:${y}`;

                return (
                    // Each cell receives only the data and stable callbacks it needs.
                    <WorldCell
                        key={key}
                        mode={mode}
                        x={x}
                        y={y}
                        // Derive cell state from the canonical map snapshot.
                        blocked={blockedCells.has(key)}
                        object={placedObjects[key]}
                        room={rooms[key]}
                        onClick={onCellClick}
                        onDoubleClick={onCellDoubleClick}
                        onHover={onCellHover}
                        onImageLoad={onImageLoad}
                        onImageError={onImageError}
                    />
                );
            })}
        </div>
    );
});
