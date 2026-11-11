import { NextResponse } from "next/server";
import { floors } from "@/lib/floors";
import { pool } from "@/lib/db";
import { MapData } from "@/lib/map-types";
import { getCurrentSession } from "@/lib/require-auth";

// Used when the client omits the floor query parameter.
const DEFAULT_FLOOR_ID = "lobby";

// Keep API access aligned with the floors available in the admin and public UI.
function isValidFloorId(value: string): boolean {
    // The registry is the single source of truth for supported floor IDs.
    return floors.some((floor) => floor.id === value);
}

// Create the table lazily so a fresh development database works without a manual migration step.
async function ensureTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS world_maps (
            floor_id TEXT PRIMARY KEY,
            map_data JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

// Validate the JSON shape before it reaches PostgreSQL.
function isMapData(value: unknown): value is MapData {
    if (!value || typeof value !== "object") {
        return false;
    }

    const mapData = value as Partial<MapData>;
    // Both fields must be JSON-compatible containers before the payload is persisted.
    return Array.isArray(mapData.blockedCells)
        && typeof mapData.placedObjects === "object"
        && mapData.placedObjects !== null
        && typeof mapData.rooms === "object"
        && mapData.rooms !== null;
}

// Load the saved map for one floor, or return an empty map for a new floor.
export async function GET(request: Request) {
    // Map data is available only after the browser presents a valid session cookie.
    const session = await getCurrentSession(request.headers);

    if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Read the floor key from the URL so each floor has an independent map.
    const floorId = new URL(request.url).searchParams.get("floorId") ?? DEFAULT_FLOOR_ID;

    if (!isValidFloorId(floorId)) {
        return NextResponse.json({ error: "Invalid floor id" }, { status: 400 });
    }

    try {
        await ensureTable();
        // Parameterized SQL keeps the floor ID separate from the query text.
        const result = await pool.query("SELECT map_data FROM world_maps WHERE floor_id = $1", [floorId]);

        if (result.rowCount === 0) {
            return NextResponse.json({
                blockedCells: [],
                placedObjects: {},
                rooms: {},
            });
        }

        // PostgreSQL returns JSONB as an object that can be sent directly to the client.
        return NextResponse.json(result.rows[0].map_data);
    } catch (error) {
        console.error("Failed to load world map", error);
        return NextResponse.json({ error: "Failed to load world map" }, { status: 500 });
    }
}

// Insert a new floor map or replace the existing version of that floor.
export async function PUT(request: Request) {
    // Saving the map is an admin action, so a logged-in regular user is not enough.
    const session = await getCurrentSession(request.headers);

    if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // The request body contains the complete editor snapshot for one floor.
    const floorId = new URL(request.url).searchParams.get("floorId") ?? DEFAULT_FLOOR_ID;
    const body: unknown = await request.json();

    if (!isValidFloorId(floorId)) {
        return NextResponse.json({ error: "Invalid floor id" }, { status: 400 });
    }

    if (!isMapData(body)) {
        return NextResponse.json({ error: "Invalid map data" }, { status: 400 });
    }

    try {
        await ensureTable();
        // Upsert makes repeated saves update one floor instead of creating duplicates.
        await pool.query(
            `
                INSERT INTO world_maps (floor_id, map_data, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (floor_id)
                DO UPDATE SET map_data = EXCLUDED.map_data, updated_at = NOW()
            `,
            [floorId, JSON.stringify(body)],
        );

        return NextResponse.json({ saved: true });
    } catch (error) {
        console.error("Failed to save world map", error);
        return NextResponse.json({ error: "Failed to save world map" }, { status: 500 });
    }
}