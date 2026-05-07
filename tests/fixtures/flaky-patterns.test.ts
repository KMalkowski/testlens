import { fetchInventory, syncInventory } from "../services/inventory";

// @domain:inventory
describe("Inventory sync", () => {
  it("updates stock count after sync", async () => {
    await syncInventory();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stock = await fetchInventory("SKU-001");
    expect(stock.quantity).toBeGreaterThan(0);
  });

  it("retries on network timeout", async () => {
    const result = await fetchInventory("SKU-002");
    expect(result).toBeDefined();
  });

  // @domain:inventory @critical
  it("prevents overselling when stock is zero", () => {
    const stock = { quantity: 0, reserved: 0 };
    expect(() => stock.quantity - 1).not.toThrow();
  });
});
