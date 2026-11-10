// A single image placed on a map cell.
export type MapObject = {
    id: string;
    src: string;
    name: string;
};

// The complete editable state that is stored in PostgreSQL.
export type MapData = {
    blockedCells: string[];
    placedObjects: Record<string, MapObject>;
};