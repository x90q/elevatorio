// Keep floor identifiers centralized so admin and public world use the same map keys.
export const floors = [
    { id: "lobby", number: "00", name: "Lobby", status: "Our home" },
    { id: "tokyo", number: "01", name: "Tokyo", status: "Want some sushi?" },
    { id: "singapore", number: "02", name: "Singapore", status: "Oh wow" },
    { id: "moscow", number: "03", name: "Moscow", status: "Here comes the tanks!" },
    { id: "london", number: "04", name: "London", status: "Really? London?" },
    { id: "minsk", number: "05", name: "Minsk", status: "Oh bro...." },
] as const;

// Infer a union of valid IDs directly from the immutable floor registry.
export type FloorId = (typeof floors)[number]["id"];

// Resolve display metadata for a selected floor with Lobby as the safe fallback.
export function getFloor(floorId: FloorId) {
    return floors.find((floor) => floor.id === floorId) ?? floors[floors.length - 1];
}