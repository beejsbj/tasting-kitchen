const isRecord = (value) => value !== null && typeof value === "object";

const findSize = (product, id) =>
  Array.isArray(product?.sizes) ? product.sizes.find((size) => size.id === id) : undefined;

const findFinish = (product, id) =>
  Array.isArray(product?.finishes) ? product.finishes.find((finish) => finish.id === id) : undefined;

const assertSelection = (selection, product) => {
  if (!isRecord(selection) || !findSize(product, selection.size) || !findFinish(product, selection.finish)) {
    throw new RangeError("Unknown size or finish");
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 3) {
    throw new RangeError("Quantity must be an integer from 1 to 3");
  }
  if (typeof selection.mesh !== "boolean") {
    throw new RangeError("Mesh must be boolean");
  }
};

export function estimate(selection, product) {
  assertSelection(selection, product);

  const size = findSize(product, selection.size);
  const meshCents = selection.mesh ? product.accessory.priceCents : 0;
  const merchandiseCents = (size.priceCents + meshCents) * selection.quantity;
  const stockKey = `${selection.size}:${selection.finish}`;
  const stock = Number(product.stock?.[stockKey] ?? 0);
  const reason = stock < 1 ? "sold-out" : selection.quantity > stock ? "insufficient-stock" : null;
  const available = reason === null;
  const shippingCents = merchandiseCents >= product.delivery.freeAtCents ? 0 : product.delivery.flatCents;

  return { available, reason, merchandiseCents, shippingCents, totalCents: merchandiseCents + shippingCents };
}

export function prepareInquiry(fields, product) {
  const errors = [];
  const topic = isRecord(fields) ? fields.topic : undefined;
  const question = isRecord(fields) ? fields.question : undefined;
  const size = isRecord(fields) ? fields.size : undefined;
  const finish = isRecord(fields) ? fields.finish : undefined;

  if (!Array.isArray(product?.inquiryTopics) || !product.inquiryTopics.includes(topic)) errors.push("topic");

  const trimmedQuestion = typeof question === "string" ? question.trim() : "";
  if (trimmedQuestion.length < 10 || trimmedQuestion.length > 500) errors.push("question");
  if (!findSize(product, size)) errors.push("size");
  if (!findFinish(product, finish)) errors.push("finish");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    preview: { topic, question: trimmedQuestion, size, finish, notice: product.inquiryNotice },
  };
}
