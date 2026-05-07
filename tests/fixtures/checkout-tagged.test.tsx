import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkout } from "../components/Checkout";

// @domain:checkout @critical
describe("Checkout — guest flow", () => {
  // @domain:checkout
  it("blocks progression when cart is empty", async () => {
    render(<Checkout items={[]} />);
    const button = screen.getByRole("button", { name: /proceed/i });
    expect(button).toBeDisabled();
  });

  // @domain:checkout @regression
  it("displays error when payment fails", async () => {
    render(<Checkout items={[{ id: "1", price: 10 }]} />);
    await userEvent.click(screen.getByRole("button", { name: /pay/i }));
    expect(screen.getByText(/payment failed/i)).toBeVisible();
  });

  // @domain:checkout @happy-path
  it("shows order total before payment step", () => {
    render(
      <Checkout
        items={[
          { id: "1", price: 25 },
          { id: "2", price: 30 },
        ]}
      />,
    );
    expect(screen.getByText("$55.00")).toBeVisible();
    expect(screen.getByRole("heading", { name: /order summary/i })).toBeVisible();
  });
});
