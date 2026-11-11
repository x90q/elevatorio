// A single image placed on a map cell.
// A map object is identified by its asset metadata and rendered from its data URL or future storage URL.
export type MapObject = {
    // Stable asset identifier used when the object is replaced or extended later.
    id: string;
    // Data URL for now; this can become an object-storage URL in production.
    src: string;
    // Original filename used for accessibility text and editor previews.
    name: string;
};

// A room assignment belongs to one map cell, allowing rooms to have any shape.
export type MapRoom = {
    id: string;
    name: string;
};

// The complete editable state that is stored in PostgreSQL.
// Shared contract between admin editor, public world, API, and PostgreSQL JSONB.
export type MapData = {
    // Cell keys with collision enabled for player pathfinding.
    blockedCells: string[];
    // Objects indexed by their row:column cell key.
    placedObjects: Record<string, MapObject>;
    // Rooms indexed by their anchor cell for future boundaries and access rules.
    rooms: Record<string, MapRoom>;
};