import { calculateDiscount } from "../utils/pricing";

vi.mock("../services/inventory");
vi.mock("../services/pricing");
vi.mock("../services/auth");
vi.mock("../services/analytics");

// @domain:pricing
describe("discount calculation", () => {
  it("applies percentage discount to subtotal", () => {
    const result = calculateDiscount(100, "SAVE20");
    expect(result).toBe(80);
  });

  it("rejects expired discount codes", () => {
    expect(() => calculateDiscount(100, "EXPIRED")).toThrow("Discount code expired");
  });
});
