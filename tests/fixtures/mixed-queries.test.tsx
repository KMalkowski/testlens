import { render, screen } from "@testing-library/react";
import { SearchResults } from "../components/SearchResults";

const mockResults = [
  { id: "1", name: "Running Shoes" },
  { id: "2", name: "Hiking Boots" },
  { id: "3", name: "Sandals" },
];

// @domain:search
describe("Search results", () => {
  it("shows result count for matching products", () => {
    render(<SearchResults query="shoes" results={mockResults} />);
    expect(screen.getByText("3 results found")).toBeVisible();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("renders empty state with testid", () => {
    render(<SearchResults query="xyz" results={[]} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("displays each product name in results list", () => {
    render(<SearchResults query="shoes" results={mockResults} />);
    expect(screen.getByText("Running Shoes")).toBeVisible();
    expect(screen.getByText("Hiking Boots")).toBeVisible();
  });
});
