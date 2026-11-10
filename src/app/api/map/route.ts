import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { MapData } from "@/lib/map-types";

const DEFAULT_FLOOR_ID = "lobby";

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
    return Array.isArray(mapData.blockedCells) && typeof mapData.placedObjects === "object" && mapData.placedObjects !== null;
}

// Load the saved map for one floor, or return an empty map for a new floor.
export async function GET(request: Request) {
    const floorId = new URL(request.url).searchParams.get("floorId") ?? DEFAULT_FLOOR_ID;

    try {
        await ensureTable();
        const result = await pool.query("SELECT map_data FROM world_maps WHERE floor_id = $1", [floorId]);

        if (result.rowCount === 0) {
            return NextResponse.json({
                blockedCells: [],
                placedObjects: {},
            });
        }

        return NextResponse.json(result.rows[0].map_data);
    } catch (error) {
        console.error("Failed to load world map", error);
        return NextResponse.json({ error: "Failed to load world map" }, { status: 500 });
    }
}

// Insert a new floor map or replace the existing version of that floor.
export async function PUT(request: Request) {
    const floorId = new URL(request.url).searchParams.get("floorId") ?? DEFAULT_FLOOR_ID;
    const body: unknown = await request.json();

    if (!isMapData(body)) {
        return NextResponse.json({ error: "Invalid map data" }, { status: 400 });
    }

    try {
        await ensureTable();
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