import { applyPromotion, validatePromoCode } from "../utils/pricing";

// @domain:pricing
describe("Promotions", () => {
  describe("promo code validation", () => {
    // @domain:pricing
    it("accepts valid promo codes", () => {
      expect(validatePromoCode("SUMMER2024")).toBe(true);
    });

    // @domain:pricing @edge-case
    it("rejects codes with special characters", () => {
      expect(validatePromoCode("SAVE<script>")).toBe(false);
    });
  });

  describe("promotion application", () => {
    // @domain:pricing
    test("applies buy-one-get-one to eligible items", () => {
      const cart = [{ id: "1", price: 20, qty: 2 }];
      const result = applyPromotion(cart, "BOGO");
      expect(result.total).toBe(20);
    });

    it.skip("handles fractional penny rounding", () => {
      const cart = [{ id: "1", price: 9.99, qty: 3 }];
      const result = applyPromotion(cart, "THIRD_OFF");
      expect(result.total).toBe(19.98);
    });
  });
});
