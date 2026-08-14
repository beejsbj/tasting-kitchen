function selectForLocal(order) {
  if (order.fragile) return { method: "courier", message: "Fragile order requires courier" };
  if (order.weight > 20) return { method: "freight", message: "Heavy order requires freight" };
  if (order.rush) return { method: "express", message: "Rush order uses express" };
  return { method: "standard", message: "Standard delivery" };
}

function selectForRemote(order) {
  if (order.fragile) return { method: "courier", message: "Fragile order requires courier" };
  if (order.weight > 20) return { method: "freight", message: "Heavy order requires freight" };
  if (order.rush) return { method: "express", message: "Rush order uses express" };
  return { method: "standard", message: "Standard delivery" };
}

export function selectDelivery(order) {
  return order.zone === "remote" ? selectForRemote(order) : selectForLocal(order);
}
