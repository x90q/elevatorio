"use client";

// React hooks hold camera state and browser-only references for this interactive controller.
import { useCallback, useEffect, useRef, useState } from "react";
// These event types describe the React Pointer Events and Wheel Events handled below.
import type { PointerEvent, WheelEvent } from "react";

// Prevent zooming out until the map is unreadably small.
const MIN_ZOOM = 0.4;
// Prevent zooming in until the map overwhelms the viewport.
const MAX_ZOOM = 2.5;
// Standard mouse wheels report relatively small pixel deltas, so use a gentle factor.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
// Trackpads often send Ctrl+wheel with different deltas, so give that gesture its own factor.
const TRACKPAD_ZOOM_SENSITIVITY = 0.012;
// Ignore tiny pointer movement so clicking a cell does not accidentally pan the map.
const DRAG_THRESHOLD = 4;

// A point is expressed in CSS pixels in the relevant viewport coordinate space.
export type Point = { x: number; y: number };
// Camera translation is represented by the same two-dimensional point shape.
export type CameraOffset = Point;

// Capture the pointer and camera positions at the start of a one-pointer pan.
type DragStart = {
    // Pointer Events gives each active mouse or touch pointer a stable identifier.
    pointerId: number;
    // Screen-space pointer origin used to calculate the pan distance.
    x: number;
    y: number;
    // Camera translation at pointer-down, before the drag starts.
    camera: CameraOffset;
};

// Capture the initial geometry needed to calculate a two-pointer pinch gesture.
type PinchStart = {
    // Distance between the two fingers when the pinch begins.
    distance: number;
    // Camera scale at the beginning of the gesture.
    zoom: number;
    // Screen-space midpoint of the two fingers at the beginning of the gesture.
    midpoint: Point;
    // Map-space point that should remain under the midpoint while pinching.
    focalPoint: Point;
    // Camera translation at the beginning of the gesture.
    camera: CameraOffset;
};

// Keep every zoom request inside the supported minimum and maximum values.
function clampZoom(value: number) {
    // Clamp to the lower limit first and then to the upper limit.
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

// Measure the straight-line distance between two pointer positions.
function distance(first: Point, second: Point) {
    // Math.hypot applies the Pythagorean theorem to the horizontal and vertical deltas.
    return Math.hypot(second.x - first.x, second.y - first.y);
}

// Find the exact center between two pointer positions.
function midpoint(first: Point, second: Point): Point {
    // Averaging each axis gives the midpoint without depending on map dimensions.
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * Shared pan/zoom controller for the public world and the map editor.
 * React state exposes the settled camera to UI such as the zoom percentage.
 * Refs hold high-frequency input so pointer and wheel events do not rerender every cell.
 * CSS transforms move the existing DOM layers; the map's x/y data never changes.
 */
export function useWorldCamera<T extends HTMLElement>() {
    // React state makes the settled zoom available to controls and labels.
    const [zoom, setZoom] = useState(1);
    // React state makes the settled pan offset available to the viewport layout.
    const [cameraOffset, setCameraOffset] = useState<CameraOffset>({ x: 0, y: 0 });
    // The element that receives wheel and pointer input; T lets editor and world use their own element type.
    const viewportRef = useRef<T>(null);
    // This layer is translated to pan the complete map around the viewport center.
    const cameraRef = useRef<HTMLDivElement>(null);
    // This inner layer is scaled, leaving the camera translation independent from zoom.
    const worldRef = useRef<HTMLDivElement>(null);
    // Immediate zoom value for event handlers, which cannot wait for React to rerender.
    const zoomRef = useRef(zoom);
    // Immediate translation value for event handlers and animation frames.
    const cameraOffsetRef = useRef(cameraOffset);
    // Latest screen coordinates for each active touch pointer, indexed by pointer ID.
    const activePointers = useRef(new Map<number, Point>());
    // The active one-pointer drag origin, or null when no pan is underway.
    const dragStart = useRef<DragStart | null>(null);
    // The captured initial values for the active two-pointer pinch, or null when inactive.
    const pinchStart = useRef<PinchStart | null>(null);
    // The scheduled animation frame ID, used to avoid duplicate loops and cancel on cleanup.
    const animationFrame = useRef<number | null>(null);
    // Accumulated destination zoom when several wheel events arrive during one animation.
    const wheelTargetZoom = useRef(zoom);
    // Cursor position relative to the viewport center; camera offset is applied per frame.
    const wheelAnchor = useRef<Point | null>(null);
    // Tells the editor whether a pointer gesture moved the camera instead of clicking a cell.
    const didDragRef = useRef(false);

    // Apply camera changes directly to existing DOM layers for smooth input without grid rerenders.
    function applyTransform(nextZoom: number, nextOffset: CameraOffset) {
        // Scale the map around its own center while preserving its logical cell coordinates.
        worldRef.current?.style.setProperty("transform", `scale(${nextZoom})`);
        // Center the camera layer, then add its pan offset; translate3d encourages compositing.
        cameraRef.current?.style.setProperty(
            "transform",
            `translate(-50%, -50%) translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`,
        );
    }

    // Copy fast ref values into React state after an interaction or animation has settled.
    function commitCamera() {
        // Update the visible zoom controls without scheduling renders for every input event.
        setZoom(zoomRef.current);
        // Copy the object so React receives a new state reference.
        setCameraOffset({ ...cameraOffsetRef.current });
    }

    // Set an absolute zoom and optionally keep one map point fixed under a screen-space focal point.
    function zoomTo(nextZoomValue: number, focalPoint?: Point) {
        // Read refs because they are the freshest values during rapid input.
        const currentZoom = zoomRef.current;
        // Clamp before doing math so the camera never passes its supported limits.
        const nextZoom = clampZoom(nextZoomValue);

        // Nothing needs updating if the requested zoom is already at a limit.
        if (nextZoom === currentZoom) {
            return;
        }

        // Use the current translation as the base for any focal-point correction.
        const currentOffset = cameraOffsetRef.current;
        // Scaling multiplies every map-relative coordinate by this ratio.
        const ratio = nextZoom / currentZoom;
        // Translate so the selected focal point remains visually fixed during scaling.
        const nextOffset = focalPoint
            ? {
                x: currentOffset.x + focalPoint.x * (1 - ratio),
                y: currentOffset.y + focalPoint.y * (1 - ratio),
            }
            : currentOffset;

        // Store immediate values first so the next input event uses this camera state.
        zoomRef.current = nextZoom;
        cameraOffsetRef.current = nextOffset;
        // Update the DOM immediately, then notify React for the settled UI values.
        applyTransform(nextZoom, nextOffset);
        commitCamera();
    }

    // Change zoom by a relative amount, as used by the plus and minus buttons.
    function zoomBy(amount: number) {
        // Button zoom has no pointer focal point, so it remains centered on the map.
        zoomTo(zoomRef.current + amount);
    }

    // Smooth a wheel/trackpad request while keeping its screen-space anchor stationary.
    function animateWheelZoom(amount: number, anchor: Point) {
        // Continue from the current animation target, otherwise start from the displayed zoom.
        const baseZoom = animationFrame.current === null ? zoomRef.current : wheelTargetZoom.current;
        // Accumulate wheel deltas so a burst of input is not lost during an active animation.
        wheelTargetZoom.current = clampZoom(baseZoom + amount);
        // New wheel events may move the cursor; the most recent pointer location wins.
        wheelAnchor.current = anchor;

        // Reuse the already scheduled frame, or skip animation if the limit cannot change.
        if (animationFrame.current !== null || wheelTargetZoom.current === zoomRef.current) {
            return;
        }

        // One animation step: move partway toward the target and schedule another frame if needed.
        const animate = () => {
            // Read the latest state because another wheel event may have changed the target.
            const currentZoom = zoomRef.current;
            const targetZoom = wheelTargetZoom.current;
            // Remaining distance to the destination controls the easing speed.
            const difference = targetZoom - currentZoom;
            // Snap the last tiny remainder to the target to prevent an endless animation.
            const nextZoom = Math.abs(difference) < 0.001 ? targetZoom : currentZoom + difference * 0.22;
            // The zoom ratio tells us how much the map's anchored distances will change.
            const ratio = nextZoom / currentZoom;
            // Read the latest camera translation and latest pointer anchor.
            const currentOffset = cameraOffsetRef.current;
            const activeAnchor = wheelAnchor.current;
            // Recompute the map-relative cursor vector from the latest camera position.
            // This keeps the same screen-space cell under the pointer for the whole animation.
            // Compensate translation by the anchor's current distance from the map center.
            const nextOffset = activeAnchor
                ? {
                    x: currentOffset.x + (activeAnchor.x - currentOffset.x) * (1 - ratio),
                    y: currentOffset.y + (activeAnchor.y - currentOffset.y) * (1 - ratio),
                }
                : currentOffset;

            // Keep refs synchronized before the next browser frame or wheel event runs.
            zoomRef.current = nextZoom;
            cameraOffsetRef.current = nextOffset;
            // Animate with compositor-friendly transforms rather than rebuilding the grid.
            applyTransform(nextZoom, nextOffset);

            // Finish by committing final values to React when the target is reached.
            if (nextZoom === targetZoom) {
                animationFrame.current = null;
                commitCamera();
                return;
            }

            // Otherwise continue the easing loop on the next browser animation frame.
            animationFrame.current = requestAnimationFrame(animate);
        };

        // Start the single active animation loop.
        animationFrame.current = requestAnimationFrame(animate);
    }

    // Normalize browser wheel input and convert it into a zoom request anchored at the cursor.
    function handleWheel(event: WheelEvent<T>) {
        // Prevent the page itself from scrolling while the pointer is over the map.
        event.preventDefault();
        // Keep the viewport element and its bounds for coordinate conversion.
        const viewport = event.currentTarget;
        const rect = viewport.getBoundingClientRect();
        // Wheel deltas can be pixels, lines, or pages; convert all modes to pixel-like units.
        const delta = event.deltaMode === 1
            ? event.deltaY * 16
            : event.deltaMode === 2
                ? event.deltaY * viewport.clientHeight
                : event.deltaY;
        // Detect the common Ctrl+wheel trackpad gesture and choose its sensitivity.
        const sensitivity = event.ctrlKey ? TRACKPAD_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
        // Express the cursor position relative to viewport center, independent of map translation.
        const anchor = {
            x: event.clientX - (rect.left + rect.width / 2),
            y: event.clientY - (rect.top + rect.height / 2),
        };

        // Reverse wheel direction so scrolling up zooms in, then animate around the cursor anchor.
        animateWheelZoom(-delta * sensitivity, anchor);
    }

    // Begin a potential mouse pan or register the first/second finger of a pinch gesture.
    function handlePointerDown(event: PointerEvent<T>) {
        // Only the primary mouse button starts a pan; other buttons keep browser behavior.
        if (event.button !== 0) {
            return;
        }

        // A new gesture has not yet moved the camera, so a click remains possible.
        didDragRef.current = false;
        // Keep the event's screen location for drag or pinch calculations.
        const point = { x: event.clientX, y: event.clientY };

        // Touch pointers need to be tracked together to recognize a two-finger pinch.
        if (event.pointerType === "touch") {
            // Save or update this finger's current screen coordinates.
            activePointers.current.set(event.pointerId, point);

            // The second active finger changes the gesture from a possible pan into a pinch.
            if (activePointers.current.size === 2) {
                // Read both finger positions and the viewport's current geometry.
                const [first, second] = Array.from(activePointers.current.values());
                const rect = event.currentTarget.getBoundingClientRect();
                const center = midpoint(first, second);
                const offset = cameraOffsetRef.current;

                // Capture all values that should remain the pinch's stable starting point.
                pinchStart.current = {
                    distance: distance(first, second),
                    zoom: zoomRef.current,
                    midpoint: center,
                    focalPoint: {
                        x: center.x - (rect.left + rect.width / 2 + offset.x),
                        y: center.y - (rect.top + rect.height / 2 + offset.y),
                    },
                    camera: { ...offset },
                };
                // Do not also treat the two-finger gesture as a one-finger drag.
                dragStart.current = null;
                // Capture both touches so movement remains observable even if they leave the element.
                for (const pointerId of activePointers.current.keys()) {
                    event.currentTarget.setPointerCapture(pointerId);
                }
                // The pinch setup is complete; no one-pointer drag origin is needed.
                return;
            }
        }

        // Save the origin for a one-pointer pan; actual movement begins after the threshold.
        dragStart.current = {
            pointerId: event.pointerId,
            x: point.x,
            y: point.y,
            camera: { ...cameraOffsetRef.current },
        };
    }

    // Update an active pan or pinch directly on the camera DOM layers.
    function handlePointerMove(event: PointerEvent<T>) {
        // Track the current screen position of this pointer for touch gesture math.
        const point = { x: event.clientX, y: event.clientY };

        // Update a tracked touch and handle pinch whenever two fingers remain active.
        if (event.pointerType === "touch" && activePointers.current.has(event.pointerId)) {
            activePointers.current.set(event.pointerId, point);

            // A valid pinch has a saved start snapshot and two current finger positions.
            if (pinchStart.current && activePointers.current.size >= 2) {
                // Read the current fingers and the stable starting camera snapshot.
                const [first, second] = Array.from(activePointers.current.values());
                const start = pinchStart.current;
                // Scale in proportion to the change in distance between the fingers.
                const nextZoom = clampZoom(start.zoom * (distance(first, second) / start.distance));
                // Pinch midpoint movement also pans the camera at the same time.
                const currentMidpoint = midpoint(first, second);
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = nextZoom / start.zoom;
                // Compute the correction relative to the original pinch snapshot, not per-event drift.
                const nextOffset = {
                    x: start.camera.x + (currentMidpoint.x - start.midpoint.x) + start.focalPoint.x * (1 - ratio),
                    y: start.camera.y + (currentMidpoint.y - start.midpoint.y) + start.focalPoint.y * (1 - ratio),
                };

                // A zero-size viewport cannot provide a reliable focal coordinate.
                // Ignore unusable geometry; otherwise update refs and transforms without a React render.
                if (rect.width > 0 && rect.height > 0) {
                    zoomRef.current = nextZoom;
                    cameraOffsetRef.current = nextOffset;
                    applyTransform(nextZoom, nextOffset);
                    didDragRef.current = true;
                }
                // Do not run one-pointer drag logic for a pinch event.
                return;
            }
        }

        // A mouse/touch pan requires a matching pointer-down origin.
        const start = dragStart.current;
        if (!start || start.pointerId !== event.pointerId) {
            return;
        }

        // Measure how far the pointer has moved from its original screen position.
        const deltaX = point.x - start.x;
        const deltaY = point.y - start.y;
        // Preserve clicks by ignoring movement smaller than the intentional drag threshold.
        if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
            return;
        }

        // Capture the pointer and update the cursor only once when a real drag begins.
        if (!didDragRef.current) {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.remove("cursor-grab");
            event.currentTarget.classList.add("cursor-grabbing");
            didDragRef.current = true;
        }

        // Calculate pan from the original offset so small event timing differences do not accumulate.
        const nextOffset = {
            x: start.camera.x + deltaX,
            y: start.camera.y + deltaY,
        };
        // Store the latest position and move the existing camera layer immediately.
        cameraOffsetRef.current = nextOffset;
        applyTransform(zoomRef.current, nextOffset);
    }

    // End the active pointer interaction, release browser capture, and commit its final camera.
    function handlePointerUp(event: PointerEvent<T>) {
        // Remove a released touch and finish or rebase a pinch when fewer than two fingers remain.
        if (event.pointerType === "touch") {
            activePointers.current.delete(event.pointerId);
            if (activePointers.current.size < 2 && pinchStart.current) {
                pinchStart.current = null;
                const remaining = Array.from(activePointers.current.entries())[0];
                // If one finger remains, allow it to continue as a pan from its current location.
                dragStart.current = remaining
                    ? {
                        pointerId: remaining[0],
                        x: remaining[1].x,
                        y: remaining[1].y,
                        camera: { ...cameraOffsetRef.current },
                    }
                    : null;
            }
        }

        // Release pointer capture only when this element currently owns that pointer.
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        // Clear this pointer's drag origin so later movement cannot reuse stale coordinates.
        if (dragStart.current?.pointerId === event.pointerId) {
            dragStart.current = null;
        }
        // Restore the idle cursor and synchronize the final camera values with React.
        event.currentTarget.classList.remove("cursor-grabbing");
        event.currentTarget.classList.add("cursor-grab");
        commitCamera();
    }

    // Let editor cell clicks distinguish a completed pan from an actual cell click.
    const consumeDrag = useCallback(() => {
        // Read and clear the flag so each completed gesture is consumed only once.
        const wasDragging = didDragRef.current;
        didDragRef.current = false;
        // Ensure the world returns to its idle cursor after a pan gesture.
        worldRef.current?.classList.remove("cursor-grabbing");
        worldRef.current?.classList.add("cursor-grab");
        return wasDragging;
    }, []);

    // Return the camera to its initial state, cancelling any unfinished wheel animation.
    function resetCamera() {
        // A cancelled animation must not later overwrite the reset values.
        if (animationFrame.current !== null) {
            cancelAnimationFrame(animationFrame.current);
            animationFrame.current = null;
        }

        // Forget all active gesture snapshots so old pointers cannot move the reset map.
        activePointers.current.clear();
        dragStart.current = null;
        pinchStart.current = null;
        // Reset internal refs synchronously for the next input event.
        didDragRef.current = false;
        // Reset the React-facing values and directly reset the DOM transforms as well.
        zoomRef.current = 1;
        cameraOffsetRef.current = { x: 0, y: 0 };
        wheelTargetZoom.current = 1;
        applyTransform(1, { x: 0, y: 0 });
        setZoom(1);
        setCameraOffset({ x: 0, y: 0 });
    }

    // Cancel a pending animation frame when this component using the hook unmounts.
    useEffect(() => () => {
        if (animationFrame.current !== null) {
            cancelAnimationFrame(animationFrame.current);
        }
    }, []);

    // Expose the camera state, refs, and event handlers required by the viewport component.
    return {
        zoom,
        cameraOffset,
        viewportRef,
        cameraRef,
        worldRef,
        zoomBy,
        resetCamera,
        consumeDrag,
        handleWheel,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
    };
}
