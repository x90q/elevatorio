// Keep floor identifiers centralized so admin and public world use the same map keys.
export const floors = [
    { id: "lobby", number: "00", name: "Lobby", status: "Our home" },
    { id: "tokyo", number: "01", name: "Tokyo", status: "Want some sushi?" },
    { id: "singapore", number: "02", name: "Singapore", status: "Oh wow" },
    { id: "moscow", number: "03", name: "Moscow", status: "Here comes the tanks!" },
    { id: "london", number: "04", name: "London", status: "Really? London?" },
] as const;

export type FloorId = (typeof floors)[number]["id"];

export function getFloor(floorId: FloorId) {
    return floors.find((floor) => floor.id === floorId) ?? floors[floors.length - 1];
}