import { render, screen } from "@testing-library/react";
import { Cart } from "../components/Cart";

it("renders", () => {
  render(<Cart />);
  expect(screen.getByTestId("cart-wrapper")).toBeInTheDocument();
});

test("works", () => {
  render(<Cart items={[]} />);
  expect(screen.getByTestId("cart-container")).toBeInTheDocument();
});

test("test", () => {
  const { container } = render(<Cart />);
  expect(container).toBeInTheDocument();
});
