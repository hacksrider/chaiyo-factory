/**
 * ตรวจว่ามีช่วง Min–Max ที่ใช้เตือนน้ำหนักของดีได้หรือไม่
 * (ไม่เปลี่ยนประเภท good/ng — ใช้แค่แสดงสีในประวัติ)
 */
export function hasWeightToleranceRange(minWeight, maxWeight) {
  const min = Number(minWeight);
  const max = Number(maxWeight);
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 && max >= min;
}

/** ของดีที่น้ำหนักอยู่นอก Min–Max (ยังนับเป็นของดีตามเดิม) */
export function isGoodWeightOutsideMinMax(weight, minWeight, maxWeight) {
  if (!hasWeightToleranceRange(minWeight, maxWeight)) return false;
  const w = Number(weight);
  if (!Number.isFinite(w)) return false;
  const min = Number(minWeight);
  const max = Number(maxWeight);
  return w < min || w > max;
}
