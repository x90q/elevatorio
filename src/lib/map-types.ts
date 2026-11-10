// A single image placed on a map cell.
// A map object is identified by its asset metadata and rendered from its data URL or future storage URL.
export type MapObject = {
    id: string;
    src: string;
    name: string;
};

// The complete editable state that is stored in PostgreSQL.
// Shared contract between admin editor, public world, API, and PostgreSQL JSONB.
export type MapData = {
    blockedCells: string[];
    placedObjects: Record<string, MapObject>;
};