"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { floors, FloorId, getFloor } from "@/lib/floors";
import { MapData, MapObject, MapRoom } from "@/lib/map-types";

/*
 * WORLD VIEWPORT: порядок выполнения после открытия /world
 *
 * Компонент работает как маленький 2D game engine. API хранит snapshot уровня,
 * React хранит состояние, DOM рисует сетку, а refs и requestAnimationFrame отвечают
 * за быстрые движения камеры и игрока.
 *
 * 1. React вызывает WorldViewport(). Создаются начальные значения: lobby, пустые
 *    blockedCells, placedObjects и rooms, zoom = 1, старт игрока и mapLoadState
 *    = loading. JSX уже описывает сетку, но данных уровня пока нет.
 *
 * 2. useEffect восстановления этажа после mount читает localStorage по
 *    FLOOR_STORAGE_KEY. Если найден допустимый FloorId, setFloorId восстанавливает
 *    его. Затем setIsFloorReady(true) разрешает загрузку. Отложенное чтение нужно,
 *    чтобы localStorage не участвовал в server render и не вызвал hydration mismatch.
 *
 * 3. useEffect загрузки после isFloorReady запускает refreshMap(). Функция получает
 *    новый mapRequestId и делает GET /api/map?floorId=... с cache: no-store. Сервер
 *    возвращает MapData: blockedCells, placedObjects и rooms.
 *
 * 4. refreshMap() проверяет response.ok, isActive и mapRequestId. Это защита от
 *    гонки: старый fetch после смены этажа или размонтирования не может записать
 *    результат поверх нового уровня.
 *
 * 5. JSON.stringify(mapData) создает mapSignatureRef. Неизменившийся snapshot не
 *    перезапускает loading. Новый snapshot записывается через setBlockedCells,
 *    setPlacedObjects и setRooms, после чего mapDataReady означает: данные API готовы.
 *
 * 6. React делает commit DOM и строит 60 x 60 = 3,600 кнопок-клеток. Объекты
 *    получают Image, но JSON-ответ еще не означает, что браузер уже создал layout
 *    и декодировал текстуры.
 *
 * 7. checkVisualReady() запускается через requestAnimationFrame после текущего layout
 *    цикла. gridDrawn проверяет реальный размер сетки, imagesDrawn проверяет
 *    image.complete и naturalWidth > 0. Поэтому уровень открывается только после
 *    появления реального DOM, а не сразу после ответа сервера.
 *
 * 8. onLoad у Image сообщает об успешной текстуре. onError помечает только одну
 *    картинку как failed и не ломает весь уровень. После всех попыток checkVisualReady
 *    разрешает переход дальше, даже если один asset поврежден.
 *
 * 9. MIN_LOADING_TIME удерживает overlay минимум одну секунду. Затем
 *    setMapLoadState("ready") отключает pointer-events и запускает CSS fade-out.
 *    Ошибка выводится только при mapLoadState = error; ready во время fade-out не
 *    маскируется под ошибку.
 *
 * 10. После загрузки начинается игровая фаза. resetViewport() сбрасывает камеру и
 *     позицию при смене этажа. changeZoom(), handlePointerDown/Move/Up и
 *     animateWheelZoom() обслуживают zoom, drag и pinch. Быстрые transform-изменения
 *     идут через refs и DOM, чтобы React не пересоздавал 3,600 клеток на каждый event.
 *
 * 11. movePlayer() обновляет collision snapshot, вызывает findPath(), а findPath()
 *     использует BFS для поиска маршрута по свободным клеткам. Путь анимируется
 *     через playerElementRef и playerTrailRef, а финальная позиция записывается state.
 *
 * 12. Каждые MAP_REFRESH_INTERVAL refreshMap() проверяет сервер снова. Неизменившийся
 *     snapshot остается интерактивным; изменившийся снова проходит pipeline:
 *     API data -> React state -> DOM -> checkVisualReady -> ready.
 */

// Zoom is limited so the map cannot become unusably tiny or fill the whole page.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
// The +/- buttons change zoom by 10 percentage points per click.
const ZOOM_STEP = 0.1;
// Wheel and trackpad use separate sensitivities because their delta values differ.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const TRACKPAD_ZOOM_SENSITIVITY = 0.012;
// The map contains 60 rows and 60 columns, so it renders 3,600 cells.
const GRID_SIZE = 60;
// Every logical cell occupies a 64 by 64 pixel square before zoom is applied.
const CELL_SIZE = 64;
// Ignore tiny pointer movements so a click does not immediately become a drag.
const DRAG_THRESHOLD = 4;
const FLOOR_STORAGE_KEY = "elevatorio:selected-floor";
const DEFAULT_PLAYER_POSITION: CellPosition = { row: 30, column: 30 };
// Keep the loading screen visible long enough to avoid an abrupt first render.
const MIN_LOADING_TIME = 1000;

// Public users periodically receive map changes saved by the admin.
const MAP_REFRESH_INTERVAL = 15_000;

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
    // These four vectors represent movement to the neighboring cells: up, right, down, left.
    const directions = [
        { row: -1, column: 0 },
        { row: 0, column: 1 },
        { row: 1, column: 0 },
        { row: 0, column: -1 },
    ];

    // BFS checks cells in expanding distance order, which gives the shortest walkable route.
    const queue = [start];
    // visited prevents the same cell from being added to the queue more than once.
    const visited = new Set([`${start.row}:${start.column}`]);
    // previous remembers how we reached each cell so the final route can be rebuilt backwards.
    const previous = new Map<string, CellPosition>();

    while (queue.length > 0) {
        const current = queue.shift();

        if (!current) {
            break;
        }

        if (current.row === target.row && current.column === target.column) {
            // Reconstruct the route by following predecessors from target back to start.
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
    // Math.max applies the lower limit first; Math.min then applies the upper limit.
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function pointerDistance(first: Point, second: Point) {
    // Pythagorean distance: sqrt((x2 - x1)^2 + (y2 - y1)^2).
    return Math.hypot(second.x - first.x, second.y - first.y);
}

export default function WorldViewport() {
    // The public world follows a game-engine pipeline: fetch the level snapshot,
    // build the grid from that snapshot, wait for visible assets, then unlock input.
    // Store the saved collision cells and objects received from the admin editor.
    // floorId determines which independent map snapshot is displayed publicly.
    const [floorId, setFloorId] = useState<FloorId>("lobby");
    const [isFloorReady, setIsFloorReady] = useState(false);
    const [mapLoadState, setMapLoadState] = useState<"loading" | "ready" | "error">("loading");
    const [blockedCells, setBlockedCells] = useState<Set<string>>(new Set());
    const [placedObjects, setPlacedObjects] = useState<Record<string, MapObject>>({});
    const [rooms, setRooms] = useState<Record<string, MapRoom>>({});
    const [zoom, setZoom] = useState(1);
    const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
    const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
    // React state is used for stable values that belong to the rendered world.
    // Fast animation values use refs below so 3,600 cells are not rebuilt every frame.
    const [playerPosition, setPlayerPosition] = useState<CellPosition>(DEFAULT_PLAYER_POSITION);
    // The ref changes on every animation step without re-rendering all 3,600 cells.
    const playerPositionRef = useRef(playerPosition);
    // Stores the pointer-down position and camera offset used as the drag origin.
    const dragStart = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
    // The outer viewport is needed to convert screen coordinates into map-centered coordinates.
    const viewportElementRef = useRef<HTMLElement>(null);
    // Camera transform moves the whole map during drag and focal zoom.
    const cameraElementRef = useRef<HTMLDivElement>(null);
    // Grid transform changes scale without asking React to render every cell again.
    const gridElementRef = useRef<HTMLDivElement>(null);
    // Player marker position is changed directly while the walking animation runs.
    const playerElementRef = useRef<HTMLSpanElement>(null);
    // This highlight follows the player marker without rerendering the grid.
    const playerTrailRef = useRef<HTMLSpanElement>(null);
    // These refs mirror React state so event handlers always use the latest values immediately.
    const zoomRef = useRef(zoom);
    const cameraOffsetRef = useRef(cameraOffset);
    // Pointer Events identifies each finger by pointerId; the map stores the latest point per finger.
    const activePointers = useRef(new Map<number, Point>());
    // Snapshot taken when the second finger lands: initial distance, zoom, focal point, and offset.
    const pinchStart = useRef<{ distance: number; zoom: number; midpoint: Point; cameraX: number; cameraY: number } | null>(null);
    // Stores the browser animation frame used to smooth desktop wheel/trackpad zoom.
    const wheelAnimationFrame = useRef<number | null>(null);
    // Accumulates wheel input while one animation frame sequence is still running.
    const wheelTargetZoom = useRef(zoom);
    // The latest cursor point is the focal point for the current wheel zoom.
    const wheelFocalPoint = useRef<Point | null>(null);
    // Avoid re-rendering the grid when polling returns an unchanged map snapshot.
    const mapSignatureRef = useRef("");
    // Prevents a second route from starting while the current route is animating.
    const isMoving = useRef(false);
    // Tracks the browser frame used to verify that the current grid and its images are visible.
    const visualCheckFrame = useRef<number | null>(null);
    // Keeps the loading overlay visible for a consistent minimum duration.
    const visualReadyTimer = useRef<number | null>(null);
    // Separates a successful API response from the later DOM/image rendering check.
    const mapDataReady = useRef(false);
    const loadingStartedAt = useRef(0);
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

    // Reset the camera and player spawn before loading another floor.
    function resetViewport() {
        if (wheelAnimationFrame.current !== null) {
            cancelAnimationFrame(wheelAnimationFrame.current);
            wheelAnimationFrame.current = null;
        }

        activePointers.current.clear();
        pinchStart.current = null;
        dragStart.current = null;
        isMoving.current = false;
        zoomRef.current = 1;
        cameraOffsetRef.current = { x: 0, y: 0 };
        wheelTargetZoom.current = 1;
        setZoom(1);
        setCameraOffset({ x: 0, y: 0 });
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
    function checkVisualReady() {
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
    }

    // Load the same selected floor map that the admin editor saves in PostgreSQL.
    // Polling only replaces the world when its JSON snapshot changes, so an unchanged
    // level stays interactive instead of restarting its loading screen every 15 seconds.
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
    }, [floorId, isFloorReady]);

    // Recheck after React has committed the new grid and its image elements.
    useEffect(() => {
        if (isFloorReady && mapLoadState === "loading") {
            checkVisualReady();
        }
    }, [floorId, isFloorReady, mapLoadState, placedObjects]);

    // Find the room rectangle under the cursor so public users see its available actions.
    const hoveredRoom = hoveredCell ? rooms[`${hoveredCell.row}:${hoveredCell.column}`] : undefined;

    // Movement is a small gameplay system: refresh collision data, calculate a route,
    // then animate the player through walkable cells without changing the map layout.
    async function movePlayer(target: CellPosition) {
        const startPosition = playerPositionRef.current;

        if (isMoving.current || (target.row === startPosition.row && target.column === startPosition.column)) {
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
                    `${nextPosition.column * CELL_SIZE + CELL_SIZE / 2 - 16}px`,
                );
                playerElementRef.current?.style.setProperty(
                    "top",
                    `${nextPosition.row * CELL_SIZE + CELL_SIZE / 2 - 16}px`,
                );
                playerTrailRef.current?.style.setProperty(
                    "left",
                    `${nextPosition.column * CELL_SIZE}px`,
                );
                playerTrailRef.current?.style.setProperty(
                    "top",
                    `${nextPosition.row * CELL_SIZE}px`,
                );
                await new Promise((resolve) => setTimeout(resolve, 120));
            }

            setPlayerPosition(playerPositionRef.current);
        } catch (error) {
            console.error("Failed to refresh map before movement", error);
        } finally {
            isMoving.current = false;
        }
    }

    // The camera is not the world itself: it changes only the transform around the
    // already-rendered level, which makes zooming and panning cheap.
    function changeZoom(amount: number, focalPoint?: Point) {
        const currentZoom = zoomRef.current;
        const currentOffset = cameraOffsetRef.current;
        const nextZoom = clampZoom(currentZoom + amount);

        if (nextZoom === currentZoom) {
            return;
        }

        let nextOffset = currentOffset;

        if (focalPoint) {
            // Ratio > 1 means zoom in; ratio < 1 means zoom out.
            const zoomRatio = nextZoom / currentZoom;
            // This offset compensates for scaling around the map center instead of the cursor.
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

    // Animate wheel zoom outside React so the 3,600-cell grid is not re-rendered per wheel event.
    function animateWheelZoom(amount: number, focalPoint: Point) {
        const baseZoom = wheelAnimationFrame.current === null ? zoomRef.current : wheelTargetZoom.current;
        wheelTargetZoom.current = clampZoom(baseZoom + amount);
        wheelFocalPoint.current = focalPoint;

        if (wheelAnimationFrame.current !== null) {
            return;
        }

        const animate = () => {
            const currentZoom = zoomRef.current;
            const targetZoom = wheelTargetZoom.current;
            // Move only part of the remaining distance each frame for smooth easing.
            const difference = targetZoom - currentZoom;
            const nextZoom = Math.abs(difference) < 0.001 ? targetZoom : currentZoom + difference * 0.22;
            const currentOffset = cameraOffsetRef.current;
            const activeFocalPoint = wheelFocalPoint.current;
            // Recalculate the ratio every frame so the cursor point remains visually fixed.
            const zoomRatio = nextZoom / currentZoom;
            const nextOffset = activeFocalPoint
                ? {
                    x: currentOffset.x + activeFocalPoint.x * (1 - zoomRatio),
                    y: currentOffset.y + activeFocalPoint.y * (1 - zoomRatio),
                }
                : currentOffset;

            zoomRef.current = nextZoom;
            cameraOffsetRef.current = nextOffset;
            gridElementRef.current?.style.setProperty("transform", `scale(${nextZoom})`);
            cameraElementRef.current?.style.setProperty(
                "transform",
                `translate(-50%, -50%) translate(${nextOffset.x}px, ${nextOffset.y}px)`,
            );

            if (nextZoom === targetZoom) {
                wheelAnimationFrame.current = null;
                setZoom(nextZoom);
                setCameraOffset(nextOffset);
                return;
            }

            wheelAnimationFrame.current = requestAnimationFrame(animate);
        };

        wheelAnimationFrame.current = requestAnimationFrame(animate);
    }

    // Use the wheel for zooming instead of allowing the page to scroll.
    function handleWheel(event: React.WheelEvent<HTMLElement>) {
        event.preventDefault();
        const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        const sensitivity = event.ctrlKey ? TRACKPAD_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
        const direction = -normalizedDelta * sensitivity;
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

        animateWheelZoom(direction, focalPoint);
    }

    // Start tracking a possible camera drag.
    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) {
            return;
        }

        if (event.pointerType === "touch") {
            activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (activePointers.current.size === 2) {
                const [first, second] = Array.from(activePointers.current.values());
                const viewport = viewportElementRef.current?.getBoundingClientRect();
                // The midpoint between fingers is the point the user expects to stay fixed.
                const midpoint = {
                    x: (first.x + second.x) / 2,
                    y: (first.y + second.y) / 2,
                };
                pinchStart.current = {
                    distance: pointerDistance(first, second),
                    zoom: zoomRef.current,
                    midpoint,
                    cameraX: cameraOffsetRef.current.x,
                    cameraY: cameraOffsetRef.current.y,
                };
                if (viewport) {
                    // Convert the screen midpoint into coordinates relative to the map center.
                    pinchStart.current.midpoint = {
                        x: midpoint.x - (viewport.left + viewport.width / 2 + cameraOffsetRef.current.x),
                        y: midpoint.y - (viewport.top + viewport.height / 2 + cameraOffsetRef.current.y),
                    };
                }
                dragStart.current = null;
                event.currentTarget.setPointerCapture(event.pointerId);
            }
        }

        dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            cameraX: cameraOffsetRef.current.x,
            cameraY: cameraOffsetRef.current.y,
        };
    }

    // Move the camera only after the pointer passes the drag threshold.
    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (event.pointerType === "touch" && activePointers.current.has(event.pointerId)) {
            activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (pinchStart.current && activePointers.current.size >= 2) {
                const [first, second] = Array.from(activePointers.current.values());
                // A distance ratio of 1.2 means the fingers moved 20% apart, so zoom by 1.2x.
                const nextZoom = clampZoom(pinchStart.current.zoom * (pointerDistance(first, second) / pinchStart.current.distance));
                // Scaling around the map center requires an offset correction around the focal point.
                const zoomRatio = nextZoom / pinchStart.current.zoom;
                const nextOffset = {
                    x: pinchStart.current.cameraX + pinchStart.current.midpoint.x * (1 - zoomRatio),
                    y: pinchStart.current.cameraY + pinchStart.current.midpoint.y * (1 - zoomRatio),
                };
                zoomRef.current = nextZoom;
                cameraOffsetRef.current = nextOffset;
                cameraElementRef.current?.style.setProperty(
                    "transform",
                    `translate(-50%, -50%) translate(${nextOffset.x}px, ${nextOffset.y}px)`,
                );
                gridElementRef.current?.style.setProperty("transform", `scale(${nextZoom})`);
                return;
            }
        }

        if (!dragStart.current) {
            return;
        }

        const distanceX = event.clientX - dragStart.current.x;
        const distanceY = event.clientY - dragStart.current.y;

        if (Math.hypot(distanceX, distanceY) < DRAG_THRESHOLD) {
            return;
        }

        if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.remove("cursor-grab");
            event.currentTarget.classList.add("cursor-grabbing");
        }

        // Move the camera directly in CSS so dragging does not re-render all 3,600 cells.
        const nextOffset = {
            x: dragStart.current.cameraX + distanceX,
            y: dragStart.current.cameraY + distanceY,
        };
        cameraOffsetRef.current = nextOffset;
        cameraElementRef.current?.style.setProperty(
            "transform",
            `translate(-50%, -50%) translate(${nextOffset.x}px, ${nextOffset.y}px)`,
        );
    }

    // Finish the drag and release pointer capture.
    function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        if (event.pointerType === "touch") {
            activePointers.current.delete(event.pointerId);
            if (activePointers.current.size < 2 && pinchStart.current) {
                pinchStart.current = null;
                setZoom(zoomRef.current);
                setCameraOffset(cameraOffsetRef.current);
            }
        }

        event.currentTarget.classList.remove("cursor-grabbing");
        event.currentTarget.classList.add("cursor-grab");

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        dragStart.current = null;
        // Commit the final drag position to React after the fast pointer updates finish.
        setCameraOffset(cameraOffsetRef.current);
    }

    return (
        <section
            ref={viewportElementRef}
            className="relative min-h-0 flex-1 touch-none select-none overscroll-none overflow-hidden bg-[#eef1ec]"
            onWheel={handleWheel}
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
                        className="relative grid touch-manipulation select-none cursor-grab bg-white shadow-xl shadow-slate-300/40"
                        style={{
                            width: GRID_SIZE * CELL_SIZE,
                            height: GRID_SIZE * CELL_SIZE,
                            gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                            transform: `scale(${zoom})`,
                            transformOrigin: "center center",
                            willChange: "transform",
                            contain: "layout paint",
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
                            const isFreeCell = isFree({ row, column }, blockedCells);
                            const object = placedObjects[`${row}:${column}`];

                            return (
                                <button
                                    key={`${row}-${column}`}
                                    type="button"
                                    className={`relative size-16 touch-manipulation cursor-default transition-colors focus:outline-none ${object ? "border-0" : "border"} ${isFreeCell ? "border-slate-200" : "border-slate-400 hover:z-10 hover:ring-2 hover:ring-red-500"} ${!isFreeCell
                                        ? "bg-white"
                                        : isHovered
                                            ? "z-10 bg-emerald-300/80 ring-2 ring-emerald-600"
                                            : "bg-white hover:bg-emerald-100"
                                        }`}
                                    aria-label={`Cell ${column + 1}, ${row + 1}`}
                                    title={isFreeCell ? undefined : "Blocked cell"}
                                    onMouseEnter={(event) => {
                                        if (!dragStart.current && event.buttons === 0) {
                                            setHoveredCell({ row, column });
                                        }
                                    }}
                                    onMouseLeave={(event) => {
                                        if (event.buttons === 0) {
                                            setHoveredCell(null);
                                        }
                                    }}
                                    onDoubleClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void movePlayer({ row, column });
                                    }}
                                >
                                    {object && (
                                        <Image
                                            src={object.src}
                                            alt={object.name}
                                            width={64}
                                            height={64}
                                            unoptimized
                                            className="pointer-events-none absolute inset-0 size-full object-contain"
                                            onLoad={checkVisualReady}
                                            onError={(event) => {
                                                event.currentTarget.dataset.loadState = "failed";
                                                checkVisualReady();
                                            }}
                                        />
                                    )}
                                </button>
                            );
                        })}

                        {/* This lightweight overlay keeps the cell highlight visible while the player moves. */}
                        <span
                            ref={playerTrailRef}
                            className="pointer-events-none absolute z-20 size-16 border-2 border-emerald-300 bg-emerald-100/40 transition-[left,top] duration-100 ease-linear"
                            style={{
                                left: playerPosition.column * CELL_SIZE,
                                top: playerPosition.row * CELL_SIZE,
                            }}
                            aria-hidden="true"
                        />

                        <span
                            ref={playerElementRef}
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
